import { TestBed } from '@angular/core/testing';
import { DataManagerService } from './data-manager.service';
import { IncrementalSyncService } from './incremental-sync.service';
import { IdbStorageService } from './idb-storage.service';
import { FIREBASE_APP } from './app.config';
import { FirebaseStateService } from './firebase-state.service';
import { initializeApp, deleteApp, FirebaseApp } from 'firebase/app';
import { getDocs, query, where, collection, onSnapshot } from 'firebase/firestore';
import { Member, initMember } from '../../functions/src/data-model/members';
import { School, initSchool } from '../../functions/src/data-model/schools';
import { VideoItem, initVideoItem } from '../../functions/src/data-model/vod';
import { UserDetails } from './firebase-state.service';
import { NetworkStateService } from './network-state.service';
import { ActionQueueService, QueuedActionKind, RollbackTarget } from './action-queue.service';
import { FirestoreCollection } from '../../functions/src/data-model/collections';

vi.mock('firebase/firestore', () => {
  return {
    getFirestore: vi.fn(),
    collection: vi.fn(),
    collectionGroup: vi.fn(),
    addDoc: vi.fn().mockResolvedValue({ id: 'test-doc-id' }),
    setDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    serverTimestamp: vi.fn().mockReturnValue({ seconds: 0, nanoseconds: 0 }),
    query: vi.fn(),
    onSnapshot: vi.fn().mockReturnValue(() => {}), // return unsubscribe function
    doc: vi.fn().mockReturnValue({ id: 'mock-doc-ref' }),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    getDocs: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    Timestamp: {
      now: () => ({ seconds: 0, nanoseconds: 0 }),
    },
  };
});

describe('DataManagerService - searchEvents', () => {
  let service: DataManagerService;
  let app: FirebaseApp;

  beforeEach(() => {
    app = initializeApp({
      apiKey: 'fake',
      authDomain: 'fake',
      projectId: 'fake',
      storageBucket: 'fake',
      messagingSenderId: 'fake',
      appId: 'fake',
    }, `test-app-${Math.random()}`);

    const mockFirebaseState = {
      app,
      loggedIn: vi.fn().mockResolvedValue({ isAdmin: true, schoolsManaged: [] }),
      user: vi.fn().mockReturnValue(null),
      updateCachedMemberProfile: vi.fn().mockResolvedValue(undefined),
    };

    const mockSyncService = {
      loadCachedData: vi.fn().mockResolvedValue(true),
      syncCollection: vi.fn().mockResolvedValue(undefined),
      upsertCachedEntry: vi.fn().mockResolvedValue(undefined),
      deleteCachedEntry: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: FIREBASE_APP, useValue: app },
        { provide: IncrementalSyncService, useValue: mockSyncService },
        DataManagerService,
        IdbStorageService,
      ],
    });

    service = TestBed.inject(DataManagerService);
    vi.mocked(getDocs).mockClear();
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('searchEvents should query both ownerEmails and managerEmails when searching by ownerEmails', async () => {
    const mockDocsOwner = [{ id: 'ev1', data: () => ({ title: 'Event 1', ownerEmails: ['test@example.com'], managerEmails: [], status: 'listed' }) }];
    const mockDocsManager = [{ id: 'ev2', data: () => ({ title: 'Event 2', ownerEmails: [], managerEmails: ['test@example.com'], status: 'listed' }) }];

    const getDocsMock = vi.mocked(getDocs);
    getDocsMock
      .mockResolvedValueOnce({ docs: mockDocsOwner } as any)
      .mockResolvedValueOnce({ docs: mockDocsManager } as any);

    const results = await service.searchEvents({
      kind: 'term',
      searchField: 'ownerEmails',
      term: 'test@example.com',
      statusFilter: 'listed',
    });

    expect(results).toHaveLength(2);
    expect(results.map(r => r.docId)).toContain('ev1');
    expect(results.map(r => r.docId)).toContain('ev2');

    // Confirm that two queries were made with the expected filters
    expect(getDocsMock).toHaveBeenCalledTimes(2);
  });

  it('getMemberUploads should query member uploads and return sorted items', async () => {
    const mockDocs = [
      { id: 'up1', data: () => ({ name: 'Video 1', date: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' }) },
      { id: 'up2', data: () => ({ name: 'Video 2', date: '2026-05-01', createdAt: '2026-05-01T00:00:00Z' }) },
    ];
    const getDocsMock = vi.mocked(getDocs);
    getDocsMock.mockResolvedValueOnce({ docs: mockDocs } as any);

    const uploads = await service.getMemberUploads('mem1');
    expect(uploads).toHaveLength(2);
    // Should be sorted newest first (up2 first)
    expect(uploads[0].docId).toBe('up2');
    expect(uploads[1].docId).toBe('up1');
  });

  describe('getAllUploads', () => {
    it('should query all uploads with orderBy createdAt desc when no options are provided', async () => {
      const mockDocs = [
        { id: 'up1', data: () => ({ name: 'V1', createdAt: '2026-08-01T00:00:00Z' }) },
        { id: 'up2', data: () => ({ name: 'V2', createdAt: '2026-08-05T00:00:00Z' }) },
      ];
      const getDocsMock = vi.mocked(getDocs);
      getDocsMock.mockResolvedValueOnce({ docs: mockDocs } as any);

      const items = await service.getAllUploads();
      expect(items).toHaveLength(2);
      expect(items[0].docId).toBe('up2');
      expect(items[1].docId).toBe('up1');
    });

    it('should build date range query when startDate and endDate are provided', async () => {
      const mockDocs = [
        { id: 'up1', data: () => ({ name: 'V1', createdAt: '2026-08-02T00:00:00Z' }) },
      ];
      const getDocsMock = vi.mocked(getDocs);
      getDocsMock.mockResolvedValueOnce({ docs: mockDocs } as any);

      const items = await service.getAllUploads({ startDate: '2026-08-01', endDate: '2026-08-05' });
      expect(items).toHaveLength(1);
      expect(items[0].docId).toBe('up1');
    });

    it('should build single date query when date is provided', async () => {
      const mockDocs = [
        { id: 'up1', data: () => ({ name: 'V1', createdAt: '2026-08-03T12:00:00Z' }) },
      ];
      const getDocsMock = vi.mocked(getDocs);
      getDocsMock.mockResolvedValueOnce({ docs: mockDocs } as any);

      const items = await service.getAllUploads({ date: '2026-08-03' });
      expect(items).toHaveLength(1);
    });

    it('should query by eventDocId when eventDocId is provided', async () => {
      const mockDocs = [
        { id: 'up1', data: () => ({ name: 'V1', eventDocId: 'ev1', createdAt: '2026-08-01T00:00:00Z' }) },
      ];
      const getDocsMock = vi.mocked(getDocs);
      getDocsMock.mockResolvedValueOnce({ docs: mockDocs } as any);

      const items = await service.getAllUploads({ eventDocId: 'ev1' });
      expect(items).toHaveLength(1);
    });
  });

  describe('loadingState and caching', () => {
    it('loadingState should become Loaded when all sets are not loading', () => {
      service.members.setEntries([]);
      service.schools.setEntries([]);
      service.instructors.setEntries([]);
      service.myStudents.setEntries([]);

      expect(service.loadingState()).toBe('Loaded');
    });

    it('loadingState should be Loading when any set is still loading', () => {
      // Create a fresh unpopulated searchable set
      service.members.setEntries([]);
      service.schools.setEntries([]);
      service.instructors.setEntries([]);
      // Simulate myStudents in loading state
      (service.myStudents as any).state.set({ entries: [], loading: true, error: null });

      expect(service.loadingState()).toBe('Loading');
    });
  });

  describe('optimistic in-memory and local cache updates on mutations', () => {
    it('updateMember updates the in-memory SearchableSet and calls upsertCachedEntry', async () => {
      const initialMember: Member = {
        ...initMember(),
        docId: 'mem1',
        memberId: 'DE195',
        name: 'Hans Student',
        emails: ['hans@example.com'],
        lastRenewalDate: '',
        currentMembershipExpires: '',
      };
      service.members.setEntries([initialMember]);
      expect(service.members.get('mem1')?.lastRenewalDate).toBe('');

      const updatedMember: Member = {
        ...initialMember,
        lastRenewalDate: '2026-08-15',
        currentMembershipExpires: '2027-08-15',
      };

      await service.updateMember('mem1', updatedMember, initialMember);

      // Verify in-memory SearchableSet is updated immediately
      const inMemory = service.members.get('mem1');
      expect(inMemory).toBeDefined();
      expect(inMemory?.lastRenewalDate).toBe('2026-08-15');
      expect(inMemory?.currentMembershipExpires).toBe('2027-08-15');
    });

    it('enqueues only changed fields (delta) when updating a member while offline', async () => {
      const netService = TestBed.inject(NetworkStateService);
      vi.spyOn(netService, 'isOffline').mockReturnValue(true);

      const actionQueue = TestBed.inject(ActionQueueService);
      const enqueueSpy = vi.spyOn(actionQueue, 'enqueueAction');

      const initialMember: Member = {
        ...initMember(),
        docId: 'mem_offline',
        memberId: 'US402',
        name: 'Lucas Dixon',
        notes: 'Old notes',
        phone: '123456',
      };
      service.members.setEntries([initialMember]);

      const updatedMember: Member = {
        ...initialMember,
        notes: 'New notes edited offline',
      };

      await service.updateMember('mem_offline', updatedMember, initialMember);

      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: QueuedActionKind.UpdateMember,
          entityDocId: 'mem_offline',
          description: 'Updated Notes',
          oldState: { notes: 'Old notes' },
          newState: { notes: 'New notes edited offline' },
          baselineSnapshot: initialMember,
        }),
      );

      // Verify immediate optimistic in-memory update
      expect(service.members.get('mem_offline')?.notes).toBe('New notes edited offline');
    });

    it('rollbackQueuedAction restores in-memory entity to baseline snapshot', async () => {
      const initialMember: Member = {
        ...initMember(),
        docId: 'mem_rollback',
        name: 'Original Name',
        notes: 'Original Notes',
      };
      service.members.setEntries([initialMember]);

      // Optimistically modified state
      service.members.upsert({
        ...initialMember,
        name: 'Modified Name',
        notes: 'Modified Notes',
      });
      expect(service.members.get('mem_rollback')?.name).toBe('Modified Name');

      // Now rollback using action queue's baselineSnapshot
      await service.rollbackQueuedAction(
        {
          id: 'action_1',
          timestamp: new Date().toISOString(),
          kind: QueuedActionKind.UpdateMember,
          entityDocId: 'mem_rollback',
          entityTitle: 'Original Name',
          description: 'Modified Name and Notes',
          collectionPath: FirestoreCollection.Members,
          oldState: { name: 'Original Name', notes: 'Original Notes' },
          newState: { name: 'Modified Name', notes: 'Modified Notes' },
          baselineSnapshot: initialMember as unknown as Record<string, unknown>,
          status: 'pending',
        },
        RollbackTarget.Baseline,
      );

      const restored = service.members.get('mem_rollback');
      expect(restored?.name).toBe('Original Name');
      expect(restored?.notes).toBe('Original Notes');
    });

    it('rollbackQueuedAction restores in-memory entity to remote state on conflict accept_remote', async () => {
      const initialMember: Member = {
        ...initMember(),
        docId: 'mem_conflict_test',
        name: 'My Offline Name',
      };
      service.members.setEntries([initialMember]);

      await service.rollbackQueuedAction(
        {
          id: 'action_conflict',
          timestamp: new Date().toISOString(),
          kind: QueuedActionKind.UpdateMember,
          entityDocId: 'mem_conflict_test',
          entityTitle: 'My Offline Name',
          description: 'Offline edit',
          collectionPath: FirestoreCollection.Members,
          oldState: { name: 'Original' },
          newState: { name: 'My Offline Name' },
          status: 'conflict',
          conflictDetails: {
            remoteState: { ...initialMember, name: 'Server Authority Name' } as unknown as Record<string, unknown>,
            conflictingKeys: ['name'],
            detectedAt: new Date().toISOString(),
          },
        },
        RollbackTarget.Remote,
      );

      expect(service.members.get('mem_conflict_test')?.name).toBe('Server Authority Name');
    });

    it('deleteMember removes the member from the in-memory SearchableSet', async () => {
      const initialMember: Member = {
        ...initMember(),
        docId: 'mem1',
        memberId: 'DE195',
        name: 'Hans Student',
        emails: [],
      };
      service.members.setEntries([initialMember]);
      expect(service.members.get('mem1')).toBeDefined();

      await service.deleteMember('mem1');
      expect(service.members.get('mem1')).toBeUndefined();
    });

    it('setSchool updates in-memory schools set', async () => {
      const school: School = {
        ...initSchool(),
        docId: 'sch1',
        schoolId: 'SCH-01',
        schoolName: 'Berlin School',
      };
      service.schools.setEntries([school]);

      const updatedSchool: School = {
        ...school,
        schoolName: 'Berlin Academy',
      };
      await service.setSchool(updatedSchool, school);

      expect(service.schools.get('SCH-01')?.schoolName).toBe('Berlin Academy');
    });

    it('manages video tags dictionary and provides descriptions and labels', async () => {
      service.tagsDoc.set({
        spinning: {
          tag: 'spinning',
          label: 'Spinning Hands',
          description: 'Circular energy partner exercise',
          createdAt: '2026-01-01',
          lastUpdated: '2026-01-01',
        },
      });
      TestBed.flushEffects();

      expect(service.getTagDescription('spinning')).toBe('Circular energy partner exercise');
      expect(service.getTagLabel('spinning')).toBe('Spinning Hands');
      expect(service.getTagDescription('unknown')).toBe('');
      expect(service.getTagLabel('unknown')).toBe('unknown');

      const tags = service.tagsSet.entries();
      expect(tags.find((t) => t.tag === 'spinning')?.description).toBe('Circular energy partner exercise');
    });
  });

  describe('updateVideosSync', () => {
    it('syncs all videos to admin_videos when user is admin', async () => {
      const adminUser = {
        isAdmin: true,
        member: { docId: 'admin1' },
        memberProfiles: [],
        schoolsManaged: [],
        firebaseUser: {} as any,
      } as UserDetails;

      const syncService = TestBed.inject(IncrementalSyncService);
      vi.mocked(syncService.syncCollection).mockClear();
      vi.mocked(syncService.loadCachedData).mockClear();

      await service.updateVideosSync(adminUser);

      expect(syncService.loadCachedData).toHaveBeenCalledWith('admin_videos', service.videos, expect.any(Function));
      expect(syncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'admin_videos',
          collectionPath: 'videos',
          queryConstraints: undefined,
        }),
      );
    });

    it('syncs only published videos to public_videos when user is not admin', async () => {
      const regularUser = {
        isAdmin: false,
        member: { docId: 'mem1' },
        memberProfiles: [],
        schoolsManaged: [],
        firebaseUser: {} as any,
      } as UserDetails;

      const syncService = TestBed.inject(IncrementalSyncService);
      vi.mocked(syncService.syncCollection).mockClear();
      vi.mocked(syncService.loadCachedData).mockClear();

      await service.updateVideosSync(regularUser);

      expect(syncService.loadCachedData).toHaveBeenCalledWith('public_videos', service.videos, expect.any(Function));
      expect(syncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'public_videos',
          collectionPath: 'videos',
          queryConstraints: expect.any(Array),
        }),
      );
    });

    it('syncs only published videos when user is null (unauthenticated)', async () => {
      const syncService = TestBed.inject(IncrementalSyncService);
      vi.mocked(syncService.syncCollection).mockClear();
      vi.mocked(syncService.loadCachedData).mockClear();

      await service.updateVideosSync(null);

      expect(syncService.loadCachedData).toHaveBeenCalledWith('public_videos', service.videos, expect.any(Function));
      expect(syncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'public_videos',
          collectionPath: 'videos',
          queryConstraints: expect.any(Array),
        }),
      );
    });
  });

  describe('updateOrdersSync', () => {
    it('loads cached orders and syncs orders collection', async () => {
      const syncService = TestBed.inject(IncrementalSyncService);
      vi.mocked(syncService.syncCollection).mockClear();
      vi.mocked(syncService.loadCachedData).mockClear();

      await service.updateOrdersSync();

      expect(syncService.loadCachedData).toHaveBeenCalledWith('admin_orders', service.orders, expect.any(Function));
      expect(syncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'admin_orders',
          collectionPath: 'orders',
          idField: 'docId',
        }),
      );
    });
  });

  describe('updateEventsSync', () => {
    it('loads cached events and syncs events collection', async () => {
      const syncService = TestBed.inject(IncrementalSyncService);
      vi.mocked(syncService.syncCollection).mockClear();
      vi.mocked(syncService.loadCachedData).mockClear();

      await service.updateEventsSync();

      expect(syncService.loadCachedData).toHaveBeenCalledWith('public_events', service.events, expect.any(Function));
      expect(syncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'public_events',
          collectionPath: 'events',
          idField: 'docId',
        }),
      );
    });
  });

  describe('updateMyStudentsSync and student local persistence', () => {
    it('updateMyStudentsSync passes additionalFilter and filterFn ensuring only matching students are loaded', async () => {
      const syncService = TestBed.inject(IncrementalSyncService);
      vi.mocked(syncService.syncCollection).mockClear();
      vi.mocked(syncService.loadCachedData).mockClear();

      const instructorUser = {
        member: {
          docId: 'inst_doc_1',
          instructorId: 'INST-101',
        },
      } as any;

      await service.updateMyStudentsSync(instructorUser);

      expect(syncService.loadCachedData).toHaveBeenCalledWith(
        'my_students_inst_doc_1',
        service.myStudents,
        expect.any(Function),
        expect.any(Function),
      );

      const filterFn = vi.mocked(syncService.loadCachedData).mock.calls[0][3] as (m: Member) => boolean;
      expect(filterFn({ ...initMember(), primaryInstructorId: 'INST-101' })).toBe(true);
      expect(filterFn({ ...initMember(), primaryInstructorId: 'inst-101' })).toBe(true);
      expect(filterFn({ ...initMember(), primaryInstructorId: 'INST-202' })).toBe(false);
      expect(filterFn({ ...initMember(), primaryInstructorId: '' })).toBe(false);

      expect(syncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'my_students_inst_doc_1',
          collectionPath: 'instructors/inst_doc_1/members',
          idField: 'docId',
          additionalFilter: expect.any(Function),
        }),
      );

      const additionalFilter = (vi.mocked(syncService.syncCollection).mock.calls[0][0] as any).additionalFilter;
      expect(additionalFilter({ ...initMember(), primaryInstructorId: 'INST-101' })).toBe(true);
      expect(additionalFilter({ ...initMember(), primaryInstructorId: 'INST-202' })).toBe(false);
    });

    it('persistMemberLocally removes member from myStudents and deletes from cache if not student of user', async () => {
      const firebaseState = TestBed.inject(FirebaseStateService);
      const syncService = TestBed.inject(IncrementalSyncService);
      vi.mocked(syncService.upsertCachedEntry).mockClear();
      vi.mocked(syncService.deleteCachedEntry).mockClear();

      vi.mocked(firebaseState.user).mockReturnValue({
        member: {
          docId: 'inst_doc_1',
          instructorId: 'INST-101',
        },
      } as any);

      const studentOfUser: Member = {
        ...initMember(),
        docId: 'student_1',
        name: 'Student One',
        primaryInstructorId: 'INST-101',
      };

      // Initially student is saved
      await (service as any).persistMemberLocally(studentOfUser);
      expect(service.myStudents.get('student_1')).toBeDefined();
      expect(syncService.upsertCachedEntry).toHaveBeenCalledWith(
        'my_students_inst_doc_1',
        'docId',
        studentOfUser,
      );

      vi.mocked(syncService.upsertCachedEntry).mockClear();
      vi.mocked(syncService.deleteCachedEntry).mockClear();

      // Student changes primary instructor to someone else
      const reassignedStudent: Member = {
        ...studentOfUser,
        primaryInstructorId: 'INST-999',
      };

      await (service as any).persistMemberLocally(reassignedStudent);

      // Must be deleted from myStudents
      expect(service.myStudents.get('student_1')).toBeUndefined();
      // Must be deleted from instructor cache
      expect(syncService.deleteCachedEntry).toHaveBeenCalledWith(
        'my_students_inst_doc_1',
        'docId',
        'student_1',
      );
    });
  });
});


