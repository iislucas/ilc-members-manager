/* synced-collection.spec.ts
 *
 * Exhaustive test suite for SyncedCollection<ID, T>:
 * - Local mutations (save new/existing, update, delete, getById hit/miss, offline queuing)
 * - Remote updates (loadCache, sync delta, sync full refresh)
 * - Search integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncedCollection, SyncedCollectionConfig } from './synced-collection';
import { SearchableSet } from './searchable-set';
import { IncrementalSyncService } from './incremental-sync.service';
import { ActionQueueService } from './action-queue.service';
import { NetworkStateService } from './network-state.service';
import { GenericFsDoc } from '../../functions/src/data-model/base';
import * as firestore from 'firebase/firestore';

// Mock firestore
vi.mock('firebase/firestore', () => {
  return {
    getFirestore: vi.fn(),
    collection: vi.fn((_db, path) => ({ path, id: path })),
    doc: vi.fn((_colOrDb, pathOrId, ...rest) => {
      let fullPath = pathOrId;
      if (rest.length > 0) {
        fullPath = `${pathOrId}/${rest.join('/')}`;
      } else if (typeof _colOrDb === 'object' && _colOrDb && 'path' in _colOrDb) {
        fullPath = `${_colOrDb.path}/${pathOrId}`;
      }
      const id = fullPath.split('/').pop() || 'mock-id';
      return { path: fullPath, id };
    }),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    serverTimestamp: vi.fn().mockReturnValue('MOCK_SERVER_TIMESTAMP'),
    Timestamp: {
      fromDate: (d: Date) => ({ toDate: () => d, seconds: Math.floor(d.getTime() / 1000) }),
      fromMillis: (ms: number) => ({ toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) }),
    },
  };
});

interface TestEntity {
  docId: string;
  title: string;
  category: string;
  lastUpdated?: string;
}

function docToTestEntity(doc: GenericFsDoc): TestEntity {
  const data = doc.data() as Omit<TestEntity, 'docId'>;
  return {
    ...data,
    docId: doc.id,
  };
}

describe('SyncedCollection', () => {
  let mockSyncService: IncrementalSyncService;
  let mockActionQueue: ActionQueueService;
  let mockNetworkState: NetworkStateService;
  let collectionInstance: SyncedCollection<'docId', TestEntity>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSyncService = {
      loadCachedData: vi.fn().mockResolvedValue(true),
      syncCollection: vi.fn().mockResolvedValue(undefined),
      upsertCachedEntry: vi.fn().mockResolvedValue(undefined),
      deleteCachedEntry: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    } as unknown as IncrementalSyncService;

    mockActionQueue = {
      enqueueAction: vi.fn().mockResolvedValue({ id: 'action-1' }),
    } as unknown as ActionQueueService;

    mockNetworkState = {
      isOffline: vi.fn().mockReturnValue(false),
    } as unknown as NetworkStateService;

    const config: SyncedCollectionConfig<'docId', TestEntity> = {
      collectionPath: 'test_items',
      cacheKey: 'test_items_cache',
      idField: 'docId',
      searchFields: ['title', 'category'],
      docConverter: docToTestEntity,
      sortFn: (a, b) => a.title.localeCompare(b.title),
      syncService: mockSyncService,
      actionQueue: mockActionQueue,
      networkState: mockNetworkState,
    };

    collectionInstance = new SyncedCollection<'docId', TestEntity>(config);
  });

  describe('Local Mutations (3-Way Synchronization)', () => {
    it('save() new item: auto-generates ID, writes to Firestore, updates signals, and persists to IDB', async () => {
      const newItem: TestEntity = {
        docId: '',
        title: 'Beginner Form',
        category: 'Instruction',
      };

      const id = await collectionInstance.save(newItem);

      expect(id).toBeTruthy();
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ id }),
        expect.objectContaining({
          title: 'Beginner Form',
          category: 'Instruction',
          lastUpdated: 'MOCK_SERVER_TIMESTAMP',
        }),
      );

      // In-memory signals immediately reflect the change
      expect(collectionInstance.get(id)).toBeDefined();
      expect(collectionInstance.get(id)?.title).toBe('Beginner Form');
      expect(collectionInstance.entries().length).toBe(1);
      expect(collectionInstance.entries()[0].docId).toBe(id);

      // IndexedDB persistence called
      expect(mockSyncService.upsertCachedEntry).toHaveBeenCalledWith(
        'test_items_cache',
        'docId',
        expect.objectContaining({ docId: id, title: 'Beginner Form' }),
      );
    });

    it('save() existing item: preserves existing ID, updates Firestore, in-memory signals, and IDB', async () => {
      const existing: TestEntity = {
        docId: 'item-123',
        title: 'Original Title',
        category: 'Forms',
      };
      await collectionInstance.save(existing);

      const updated: TestEntity = {
        docId: 'item-123',
        title: 'Updated Title',
        category: 'Forms',
      };
      await collectionInstance.save(updated);

      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'item-123' }),
        expect.objectContaining({
          title: 'Updated Title',
          lastUpdated: 'MOCK_SERVER_TIMESTAMP',
        }),
      );

      expect(collectionInstance.get('item-123')?.title).toBe('Updated Title');
      expect(collectionInstance.entries().length).toBe(1);
      expect(mockSyncService.upsertCachedEntry).toHaveBeenCalledWith(
        'test_items_cache',
        'docId',
        expect.objectContaining({ docId: 'item-123', title: 'Updated Title' }),
      );
    });

    it('update() partial fields: writes to Firestore with serverTimestamp, merges in memory, and persists to IDB', async () => {
      const item: TestEntity = {
        docId: 'item-456',
        title: 'Sticky Hands',
        category: 'Drills',
      };
      await collectionInstance.save(item);

      await collectionInstance.update('item-456', { title: 'Advanced Sticky Hands' });

      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'item-456' }),
        expect.objectContaining({
          title: 'Advanced Sticky Hands',
          lastUpdated: 'MOCK_SERVER_TIMESTAMP',
        }),
      );

      const merged = collectionInstance.get('item-456');
      expect(merged?.title).toBe('Advanced Sticky Hands');
      expect(merged?.category).toBe('Drills');

      expect(mockSyncService.upsertCachedEntry).toHaveBeenCalledWith(
        'test_items_cache',
        'docId',
        expect.objectContaining({
          docId: 'item-456',
          title: 'Advanced Sticky Hands',
          category: 'Drills',
        }),
      );
    });

    it('update() item not in memory: fetches item via getById, updates Firestore, and merges', async () => {
      vi.mocked(firestore.getDoc).mockResolvedValueOnce({
        exists: () => true,
        id: 'remote-789',
        data: () => ({ title: 'Remote Item', category: 'Remote Cat' }),
      } as any);

      await collectionInstance.update('remote-789', { category: 'Updated Cat' });

      expect(firestore.updateDoc).toHaveBeenCalled();
      const updated = collectionInstance.get('remote-789');
      expect(updated?.title).toBe('Remote Item');
      expect(updated?.category).toBe('Updated Cat');
    });

    it('delete() item: deletes from Firestore, writes deletion tombstone, removes from signals and IDB', async () => {
      const item: TestEntity = {
        docId: 'del-1',
        title: 'To Be Deleted',
        category: 'Archive',
      };
      await collectionInstance.save(item);
      expect(collectionInstance.get('del-1')).toBeDefined();

      await collectionInstance.delete('del-1');

      // Firestore deletion
      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'del-1' }),
      );

      // Tombstone written to /system/deletions/test_items/del-1
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'system/deletions/test_items/del-1' }),
        expect.objectContaining({
          docId: 'del-1',
          deletedAt: 'MOCK_SERVER_TIMESTAMP',
        }),
      );

      // In-memory signals removed
      expect(collectionInstance.get('del-1')).toBeUndefined();
      expect(collectionInstance.entries().length).toBe(0);

      // IDB removal
      expect(mockSyncService.deleteCachedEntry).toHaveBeenCalledWith(
        'test_items_cache',
        'docId',
        'del-1',
      );
    });

    it('getById() cache hit: returns cached entity immediately without Firestore read', async () => {
      const item: TestEntity = {
        docId: 'cache-hit-1',
        title: 'In Memory',
        category: 'Fast',
      };
      collectionInstance.upsert(item);

      const result = await collectionInstance.getById('cache-hit-1');
      expect(result).toEqual(item);
      expect(firestore.getDoc).not.toHaveBeenCalled();
    });

    it('getById() cache miss: fetches from Firestore, self-heals memory and IDB cache, and returns entity', async () => {
      vi.mocked(firestore.getDoc).mockResolvedValueOnce({
        exists: () => true,
        id: 'remote-1',
        data: () => ({ title: 'Fetched Remote', category: 'Cloud' }),
      } as any);

      const result = await collectionInstance.getById('remote-1');

      expect(result).toBeDefined();
      expect(result?.title).toBe('Fetched Remote');
      expect(result?.docId).toBe('remote-1');

      // Memory self-healed
      expect(collectionInstance.get('remote-1')).toEqual(result);

      // IDB self-healed
      expect(mockSyncService.upsertCachedEntry).toHaveBeenCalledWith(
        'test_items_cache',
        'docId',
        result,
      );
    });

    it('getById() cache miss where document does not exist returns undefined', async () => {
      vi.mocked(firestore.getDoc).mockResolvedValueOnce({
        exists: () => false,
      } as any);

      const result = await collectionInstance.getById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('Offline Handling', () => {
    beforeEach(() => {
      vi.mocked(mockNetworkState.isOffline).mockReturnValue(true);
    });

    it('save() offline: enqueues to ActionQueue, updates memory and IDB without Firestore write', async () => {
      const item: TestEntity = {
        docId: 'off-1',
        title: 'Offline Item',
        category: 'Local',
      };

      const id = await collectionInstance.save(item);

      expect(id).toBe('off-1');
      expect(firestore.setDoc).not.toHaveBeenCalled();

      // Enqueued to ActionQueue
      expect(mockActionQueue.enqueueAction).toHaveBeenCalledWith(
        expect.objectContaining({
          entityDocId: 'off-1',
          collectionPath: 'test_items',
          newState: expect.objectContaining({ title: 'Offline Item' }),
        }),
      );

      // Memory and IDB updated optimistically
      expect(collectionInstance.get('off-1')?.title).toBe('Offline Item');
      expect(mockSyncService.upsertCachedEntry).toHaveBeenCalledWith(
        'test_items_cache',
        'docId',
        expect.objectContaining({ docId: 'off-1', title: 'Offline Item' }),
      );
    });

    it('update() offline: enqueues to ActionQueue, updates memory and IDB without Firestore write', async () => {
      collectionInstance.upsert({
        docId: 'off-2',
        title: 'Pre-existing',
        category: 'Old',
      });

      await collectionInstance.update('off-2', { title: 'Updated Offline' });

      expect(firestore.updateDoc).not.toHaveBeenCalled();
      expect(mockActionQueue.enqueueAction).toHaveBeenCalledWith(
        expect.objectContaining({
          entityDocId: 'off-2',
          collectionPath: 'test_items',
          newState: { title: 'Updated Offline' },
        }),
      );

      expect(collectionInstance.get('off-2')?.title).toBe('Updated Offline');
      expect(mockSyncService.upsertCachedEntry).toHaveBeenCalled();
    });

    it('delete() offline: does not call deleteDoc, removes from memory and IDB', async () => {
      collectionInstance.upsert({
        docId: 'off-del',
        title: 'Delete While Offline',
        category: 'Test',
      });

      await collectionInstance.delete('off-del');

      expect(firestore.deleteDoc).not.toHaveBeenCalled();
      expect(collectionInstance.get('off-del')).toBeUndefined();
      expect(mockSyncService.deleteCachedEntry).toHaveBeenCalledWith(
        'test_items_cache',
        'docId',
        'off-del',
      );
    });
  });

  describe('Cache Loading, Remote Delta Sync & Search', () => {
    it('loadCache() calls syncService.loadCachedData()', async () => {
      const result = await collectionInstance.loadCache();
      expect(result).toBe(true);
      expect(mockSyncService.loadCachedData).toHaveBeenCalledWith(
        'test_items_cache',
        collectionInstance.targetSet,
        expect.any(Function),
      );
    });

    it('sync() delegates to syncService.loadCachedData and syncCollection', async () => {
      await collectionInstance.sync();

      expect(mockSyncService.loadCachedData).toHaveBeenCalled();
      expect(mockSyncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'test_items_cache',
          collectionPath: 'test_items',
          idField: 'docId',
          targetSet: collectionInstance.targetSet,
          forceFullRefresh: false,
        }),
      );
    });

    it('sync(true) passes forceFullRefresh: true', async () => {
      await collectionInstance.sync(true);

      expect(mockSyncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          forceFullRefresh: true,
        }),
      );
    });

    it('search() performs search across MiniSearch indexed fields', () => {
      collectionInstance.setEntries([
        { docId: '1', title: 'Spinning Kick Workshop', category: 'Kicking' },
        { docId: '2', title: 'Meditation & Breathwork', category: 'Qi Gong' },
        { docId: '3', title: 'Push Hands Intensive', category: 'Partner' },
      ]);

      const results = collectionInstance.search('Breathwork');
      expect(results.length).toBe(1);
      expect(results[0].docId).toBe('2');

      const resultsCat = collectionInstance.search('Partner');
      expect(resultsCat.length).toBe(1);
      expect(resultsCat[0].docId).toBe('3');
    });

    it('inherits directly from SearchableSet and provides backwards-compatible targetSet', () => {
      expect(collectionInstance instanceof SearchableSet).toBe(true);
      expect(collectionInstance.targetSet).toBe(collectionInstance);
      expect(typeof collectionInstance.entries).toBe('function');
      expect(typeof collectionInstance.entriesMap).toBe('function');
    });

    it('loadCache and sync support dynamic override options for cacheKey, path, and constraints', async () => {
      vi.mocked(mockSyncService.loadCachedData).mockClear();
      vi.mocked(mockSyncService.syncCollection).mockClear();

      await collectionInstance.loadCache('scoped_cache_key');
      expect(mockSyncService.loadCachedData).toHaveBeenCalledWith(
        'scoped_cache_key',
        collectionInstance,
        expect.any(Function),
      );

      await collectionInstance.sync({
        cacheKey: 'scoped_cache_key',
        collectionPath: 'scoped/path/items',
        forceFullRefresh: true,
      });

      expect(mockSyncService.syncCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'scoped_cache_key',
          collectionPath: 'scoped/path/items',
          idField: 'docId',
          targetSet: collectionInstance,
          forceFullRefresh: true,
        }),
      );
    });
  });
});
