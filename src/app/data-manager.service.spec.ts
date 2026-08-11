import { TestBed } from '@angular/core/testing';
import { DataManagerService } from './data-manager.service';
import { FIREBASE_APP } from './app.config';
import { FirebaseStateService } from './firebase-state.service';
import { initializeApp, deleteApp, FirebaseApp } from 'firebase/app';
import { vi } from 'vitest';
import { getDocs, query, where, collection } from 'firebase/firestore';

vi.mock('firebase/firestore', () => {
  return {
    getFirestore: vi.fn(),
    collection: vi.fn(),
    collectionGroup: vi.fn(),
    addDoc: vi.fn().mockResolvedValue({ id: 'test-doc-id' }),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    onSnapshot: vi.fn().mockReturnValue(() => {}), // return unsubscribe function
    doc: vi.fn(),
    updateDoc: vi.fn(),
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
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: FIREBASE_APP, useValue: app },
        DataManagerService,
      ],
    });

    service = TestBed.inject(DataManagerService);
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
});

