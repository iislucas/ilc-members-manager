import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { IncrementalSyncService, CachedCollectionBundle, SyncCollectionConfig } from './incremental-sync.service';
import { SearchableSet } from './searchable-set';
import { IdbStorageService } from './idb-storage.service';
import { FIREBASE_APP } from './app.config';
import * as firestore from 'firebase/firestore';

vi.mock('firebase/firestore', () => {
  return {
    getFirestore: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    getDocs: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: {
      fromDate: (d: Date) => ({ toDate: () => d, seconds: Math.floor(d.getTime() / 1000) }),
    },
  };
});

type TestItem = {
  docId: string;
  name: string;
  country: string;
  lastUpdated: string;
};

describe('IncrementalSyncService', () => {
  let service: IncrementalSyncService;
  let mockIdb: IdbStorageService;
  let targetSet: SearchableSet<'docId', TestItem>;
  let app: FirebaseApp;

  beforeEach(() => {
    app = initializeApp(
      {
        apiKey: 'fake',
        authDomain: 'fake',
        projectId: 'fake',
        storageBucket: 'fake',
        messagingSenderId: 'fake',
        appId: 'fake',
      },
      `test-app-${Math.random()}`,
    );

    mockIdb = new IdbStorageService();

    TestBed.configureTestingModule({
      providers: [
        IncrementalSyncService,
        { provide: FIREBASE_APP, useValue: app },
        { provide: IdbStorageService, useValue: mockIdb },
      ],
    });

    service = TestBed.inject(IncrementalSyncService);
    targetSet = new SearchableSet<'docId', TestItem>(['name', 'country'], 'docId');
  });

  it('loadCachedData populates SearchableSet immediately when cache exists', async () => {
    const cachedData: CachedCollectionBundle<TestItem> = {
      lastSyncTimestamp: '2026-08-01T12:00:00.000Z',
      entries: [
        { docId: '1', name: 'Alice', country: 'US', lastUpdated: '2026-08-01T10:00:00.000Z' },
        { docId: '2', name: 'Bob', country: 'FR', lastUpdated: '2026-08-01T11:00:00.000Z' },
      ],
    };

    await mockIdb.set('test_cache_key', cachedData);

    const loaded = await service.loadCachedData('test_cache_key', targetSet);

    expect(loaded).toBe(true);
    expect(targetSet.entries().length).toBe(2);
    expect(targetSet.get('1')?.name).toBe('Alice');
    expect(targetSet.get('2')?.name).toBe('Bob');
  });

  it('loadCachedData returns false and leaves targetSet empty if no cache exists', async () => {
    const loaded = await service.loadCachedData('non_existent_key', targetSet);

    expect(loaded).toBe(false);
    expect(targetSet.entries().length).toBe(0);
  });

  it('clearCache and clearAllCaches delete stored entries', async () => {
    await mockIdb.set('k1', { entries: [{ docId: '1' }], lastSyncTimestamp: '2026-01-01' });
    await mockIdb.set('k2', { entries: [{ docId: '2' }], lastSyncTimestamp: '2026-01-01' });

    await service.clearCache('k1');
    expect(await mockIdb.get('k1')).toBeUndefined();
    expect(await mockIdb.get('k2')).toBeDefined();

    await service.clearAllCaches();
    expect(await mockIdb.get('k2')).toBeUndefined();
  });

  it('getAllCachedCollectionSummaries and getCachedBundle return formatted inspection metadata', async () => {
    await mockIdb.set('public_instructors', {
      entries: [{ docId: 'inst1', name: 'Master Sam' }],
      lastSyncTimestamp: '2026-08-14T18:00:00.000Z',
    });
    await mockIdb.set('schools', {
      entries: [{ docId: 'sch1', name: 'Paris School' }, { docId: 'sch2', name: 'London School' }],
      lastSyncTimestamp: '2026-08-14T19:00:00.000Z',
    });

    const summaries = await service.getAllCachedCollectionSummaries();
    expect(summaries.length).toBe(2);
    expect(summaries[0].cacheKey).toBe('public_instructors');
    expect(summaries[0].count).toBe(1);
    expect(summaries[0].approximateSizeBytes).toBeGreaterThan(0);
    expect(summaries[1].cacheKey).toBe('schools');
    expect(summaries[1].count).toBe(2);

    const bundle = await service.getCachedBundle('public_instructors');
    expect(bundle).toBeDefined();
    expect(bundle?.entries.length).toBe(1);
  });

  it('syncCollection merges delta updates and persists to cache', async () => {
    // Seed initial cache
    await mockIdb.set('test_items', {
      lastSyncTimestamp: '2026-08-14T10:00:00.000Z',
      entries: [
        { docId: '1', name: 'Alice', country: 'US', lastUpdated: '2026-08-14T09:00:00.000Z' },
        { docId: '2', name: 'Bob', country: 'FR', lastUpdated: '2026-08-14T09:30:00.000Z' },
      ],
    });

    // Mock Firestore returning 1 updated doc and 1 new doc, and 0 tombstones
    const updatedBob = { docId: '2', name: 'Bob Updated', country: 'FR', lastUpdated: '2026-08-14T11:00:00.000Z' };
    const newCharlie = { docId: '3', name: 'Charlie', country: 'DE', lastUpdated: '2026-08-14T11:30:00.000Z' };

    let callCount = 0;
    vi.mocked(firestore.getDocs).mockImplementation(async (q: any) => {
      callCount++;
      // First call is delta query, second call is tombstones query
      if (callCount % 2 === 1) {
        return {
          empty: false,
          docs: [
            { id: '2', data: () => updatedBob },
            { id: '3', data: () => newCharlie },
          ],
        } as any;
      }
      return {
        empty: true,
        docs: [],
      } as any;
    });

    const config: SyncCollectionConfig<'docId', TestItem> = {
      cacheKey: 'test_items',
      collectionPath: 'test_items',
      idField: 'docId',
      targetSet,
      docConverter: (doc) => ({ ...(doc.data() as object), docId: doc.id } as TestItem),
    };

    await service.syncCollection(config);

    // Verify SearchableSet has all 3 items with merged update
    expect(targetSet.entries().length).toBe(3);
    expect(targetSet.get('1')?.name).toBe('Alice');
    expect(targetSet.get('2')?.name).toBe('Bob Updated');
    expect(targetSet.get('3')?.name).toBe('Charlie');

    // Verify cache updated in IndexedDB
    const cached = await mockIdb.get<CachedCollectionBundle<TestItem>>('test_items');
    expect(cached?.entries.length).toBe(3);
    expect(cached?.lastSyncTimestamp).toBe('2026-08-14T11:30:00.000Z');
  });

  it('loadCachedData populates SearchableSet and marks loaded when cache is an empty array', async () => {
    const emptyCache: CachedCollectionBundle<TestItem> = {
      lastSyncTimestamp: '2026-08-01T12:00:00.000Z',
      entries: [],
    };

    await mockIdb.set('empty_cache_key', emptyCache);

    const loaded = await service.loadCachedData('empty_cache_key', targetSet);

    expect(loaded).toBe(true);
    expect(targetSet.entries().length).toBe(0);
    expect(targetSet.loading()).toBe(false);
    expect(targetSet.loaded()).toBe(true);
  });

  it('syncCollection sets loading to false when cache is empty and delta has no changes', async () => {
    await mockIdb.set('empty_delta_key', {
      lastSyncTimestamp: '2026-08-14T10:00:00.000Z',
      entries: [],
    });

    vi.mocked(firestore.getDocs).mockResolvedValue({
      empty: true,
      docs: [],
    } as any);

    const config: SyncCollectionConfig<'docId', TestItem> = {
      cacheKey: 'empty_delta_key',
      collectionPath: 'empty_delta_key',
      idField: 'docId',
      targetSet,
      docConverter: (doc) => ({ ...(doc.data() as object), docId: doc.id } as TestItem),
    };

    await service.syncCollection(config);

    expect(targetSet.entries().length).toBe(0);
    expect(targetSet.loading()).toBe(false);
    expect(targetSet.loaded()).toBe(true);
  });

  it('upsertCachedEntry updates existing and appends new cached records', async () => {
    await mockIdb.set('test_upsert', {
      lastSyncTimestamp: '2026-08-14T10:00:00.000Z',
      entries: [{ docId: '1', name: 'Alice' }],
    });

    // Update existing
    await service.upsertCachedEntry('test_upsert', 'docId', { docId: '1', name: 'Alice Renamed' });
    let bundle = await service.getCachedBundle<{ docId: string; name: string }>('test_upsert');
    expect(bundle?.entries.length).toBe(1);
    expect(bundle?.entries[0].name).toBe('Alice Renamed');

    // Insert new
    await service.upsertCachedEntry('test_upsert', 'docId', { docId: '2', name: 'Bob' });
    bundle = await service.getCachedBundle<{ docId: string; name: string }>('test_upsert');
    expect(bundle?.entries.length).toBe(2);
    expect(bundle?.entries[1].name).toBe('Bob');
  });

  it('deleteCachedEntry removes record from cache bundle', async () => {
    await mockIdb.set('test_delete', {
      lastSyncTimestamp: '2026-08-14T10:00:00.000Z',
      entries: [{ docId: '1', name: 'Alice' }, { docId: '2', name: 'Bob' }],
    });

    await service.deleteCachedEntry('test_delete', 'docId', '1');
    const bundle = await service.getCachedBundle<{ docId: string; name: string }>('test_delete');
    expect(bundle?.entries.length).toBe(1);
    expect(bundle?.entries[0].docId).toBe('2');
  });
});

