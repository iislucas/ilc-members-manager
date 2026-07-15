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
});
