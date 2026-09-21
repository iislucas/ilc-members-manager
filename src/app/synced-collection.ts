/* synced-collection.ts
 *
 * Generic SyncedCollection abstraction for Firestore collections with local IndexedDB persistence,
 * in-memory SearchableSet (signals + MiniSearch), atomic 3-way synchronization, and delta sync.
 */

import {
  collection,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
  deleteDoc,
  Firestore,
  QueryConstraint,
  serverTimestamp,
} from 'firebase/firestore';
import { GenericFsDoc } from '../../functions/src/data-model/base';
import { SearchableSet, SearchOptions } from './searchable-set';
import { IncrementalSyncService } from './incremental-sync.service';
import { ActionQueueService, QueuedActionKind } from './action-queue.service';
import { NetworkStateService } from './network-state.service';

export interface SyncedCollectionConfig<
  ID extends string,
  T extends { [key in ID]: string },
> {
  collectionPath: string;
  cacheKey: string;
  idField: ID;
  searchFields: string[];
  docConverter: (doc: GenericFsDoc) => T;
  sortFn?: (a: T, b: T) => number;
  additionalFilter?: (item: T) => boolean;
  queryConstraints?: QueryConstraint[];
  db?: Firestore;
  syncService?: IncrementalSyncService;
  actionQueue?: ActionQueueService;
  networkState?: NetworkStateService;
}

export interface SyncOptions<T> {
  forceFullRefresh?: boolean;
  cacheKey?: string;
  collectionPath?: string;
  queryConstraints?: QueryConstraint[];
  additionalFilter?: (item: T) => boolean;
}

export interface LoadCacheOptions<T> {
  cacheKey?: string;
  additionalFilter?: (item: T) => boolean;
}

export class SyncedCollection<
  ID extends string,
  T extends { [key in ID]: string },
> extends SearchableSet<ID, T> {
  private readonly db: Firestore;
  private readonly syncService: IncrementalSyncService;
  private readonly actionQueue?: ActionQueueService;
  private readonly networkState?: NetworkStateService;

  constructor(
    public readonly config: SyncedCollectionConfig<ID, T>,
    deps?: {
      db?: Firestore;
      syncService?: IncrementalSyncService;
      actionQueue?: ActionQueueService;
      networkState?: NetworkStateService;
    },
  ) {
    super(config.searchFields, config.idField);

    this.db = deps?.db ?? config.db ?? getFirestore();
    const syncService = deps?.syncService ?? config.syncService;
    if (!syncService) {
      throw new Error(
        `[SyncedCollection] IncrementalSyncService must be provided for ${config.collectionPath}`,
      );
    }
    this.syncService = syncService;
    this.actionQueue = deps?.actionQueue ?? config.actionQueue;
    this.networkState = deps?.networkState ?? config.networkState;
  }

  /**
   * Backwards-compatible targetSet accessor returning this collection as a SearchableSet.
   */
  get targetSet(): SearchableSet<ID, T> {
    return this;
  }

  /**
   * Resolves entity by ID. Checks memory first; on miss, fetches directly from Firestore,
   * self-heals local memory and IndexedDB, and returns the result.
   */
  async getById(id: string): Promise<T | undefined> {
    if (!id) return undefined;
    const cached = this.get(id);
    if (cached) return cached;

    try {
      const docRef = doc(this.db, this.config.collectionPath, id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const item = this.config.docConverter(snap as unknown as GenericFsDoc);
        this.upsert(item);
        await this.syncService.upsertCachedEntry(
          this.config.cacheKey,
          this.config.idField,
          item,
        );
        return item;
      }
      return undefined;
    } catch (err) {
      console.error(
        `[SyncedCollection] Error fetching ${this.config.collectionPath}/${id}:`,
        err,
      );
      return undefined;
    }
  }

  /**
   * Atomic 3-way save (Create or full Upsert):
   * 1. Generates ID if not set.
   * 2. If offline, enqueues to ActionQueueService.
   * 3. Writes to Firestore with serverTimestamp().
   * 4. Updates in-memory SearchableSet.
   * 5. Updates local IndexedDB cache.
   */
  async save(item: T): Promise<string> {
    const colRef = collection(this.db, this.config.collectionPath);
    const existingId = item[this.config.idField];
    const targetDoc = existingId ? doc(colRef, existingId) : doc(colRef);
    const docId = targetDoc.id;

    const nowIso = new Date().toISOString();
    const itemWithId: T = {
      ...item,
      [this.config.idField]: docId,
      lastUpdated: nowIso,
    };

    const isOffline = Boolean(this.networkState?.isOffline?.());

    if (isOffline) {
      if (this.actionQueue) {
        const existing = this.get(docId);
        await this.actionQueue.enqueueAction({
          kind: QueuedActionKind.Custom,
          entityDocId: docId,
          entityTitle:
            (item as unknown as { title?: string; name?: string }).title ||
            (item as unknown as { title?: string; name?: string }).name ||
            docId,
          description: `Save ${this.config.collectionPath} ${docId}`,
          collectionPath: this.config.collectionPath,
          oldState: (existing ?? {}) as Record<string, unknown>,
          newState: item as unknown as Record<string, unknown>,
          baselineSnapshot: existing
            ? (structuredClone(existing) as Record<string, unknown>)
            : undefined,
        });
      }
    } else {
      const { [this.config.idField]: _, ...docPayload } = itemWithId as Record<
        string,
        unknown
      >;
      await setDoc(targetDoc, {
        ...docPayload,
        lastUpdated: serverTimestamp(),
      });
    }

    this.upsert(itemWithId);
    await this.syncService.upsertCachedEntry(
      this.config.cacheKey,
      this.config.idField,
      itemWithId,
    );

    return docId;
  }

  /**
   * Atomic 3-way partial update:
   * 1. If offline, enqueues to ActionQueueService.
   * 2. Writes partial payload to Firestore with serverTimestamp().
   * 3. Merges updates into in-memory SearchableSet.
   * 4. Persists updated entry into local IndexedDB cache.
   */
  async update(id: string, updates: Partial<T>): Promise<void> {
    if (!id) return;
    const colRef = collection(this.db, this.config.collectionPath);
    const docRef = doc(colRef, id);

    const isOffline = Boolean(this.networkState?.isOffline?.());
    let existing = this.get(id);
    if (!existing && !isOffline) {
      existing = await this.getById(id);
    }

    if (isOffline) {
      if (this.actionQueue) {
        await this.actionQueue.enqueueAction({
          kind: QueuedActionKind.Custom,
          entityDocId: id,
          entityTitle:
            (existing as unknown as { title?: string; name?: string })?.title ||
            (existing as unknown as { title?: string; name?: string })?.name ||
            id,
          description: `Update ${this.config.collectionPath} ${id}`,
          collectionPath: this.config.collectionPath,
          oldState: (existing ?? {}) as Record<string, unknown>,
          newState: updates as Record<string, unknown>,
          baselineSnapshot: existing
            ? (structuredClone(existing) as Record<string, unknown>)
            : undefined,
        });
      }
    } else {
      const updatesToSave = { ...updates };
      delete (updatesToSave as Record<string, unknown>)[this.config.idField];
      await updateDoc(docRef, {
        ...updatesToSave,
        lastUpdated: serverTimestamp(),
      });
    }

    const updatedItem = {
      ...(existing ?? {}),
      ...updates,
      [this.config.idField]: id,
      lastUpdated: new Date().toISOString(),
    } as unknown as T;

    this.upsert(updatedItem);
    await this.syncService.upsertCachedEntry(
      this.config.cacheKey,
      this.config.idField,
      updatedItem,
    );
  }

  /**
   * Atomic 3-way delete:
   * 1. Deletes from Firestore.
   * 2. Records tombstone in /system/deletions/{collection}/{id}.
   * 3. Removes from in-memory SearchableSet.
   * 4. Removes from local IndexedDB cache.
   */
  override async delete(id: string): Promise<void> {
    if (!id) return;
    const colRef = collection(this.db, this.config.collectionPath);
    const docRef = doc(colRef, id);

    const isOffline = Boolean(this.networkState?.isOffline?.());
    if (!isOffline) {
      await deleteDoc(docRef);

      try {
        const simpleName =
          this.config.collectionPath.split('/').pop() ||
          this.config.collectionPath;
        const tombstoneRef = doc(this.db, `system/deletions/${simpleName}`, id);
        await setDoc(tombstoneRef, {
          deletedAt: serverTimestamp(),
          docId: id,
        });
      } catch (err) {
        console.warn(
          `[SyncedCollection] Failed to record tombstone for ${this.config.collectionPath}/${id}:`,
          err,
        );
      }
    }

    super.delete(id);
    await this.syncService.deleteCachedEntry(
      this.config.cacheKey,
      this.config.idField,
      id,
    );
  }

  /**
   * Immediately loads data from IndexedDB cache into memory.
   */
  async loadCache(cacheKeyOrOptions?: string | LoadCacheOptions<T>): Promise<boolean> {
    const opts: LoadCacheOptions<T> =
      typeof cacheKeyOrOptions === 'string'
        ? { cacheKey: cacheKeyOrOptions }
        : cacheKeyOrOptions ?? {};

    const cacheKey = opts.cacheKey ?? this.config.cacheKey;
    const filter = opts.additionalFilter ?? this.config.additionalFilter;

    if (filter) {
      return await this.syncService.loadCachedData(
        cacheKey,
        this,
        this.config.sortFn,
        filter,
      );
    }
    return await this.syncService.loadCachedData(
      cacheKey,
      this,
      this.config.sortFn,
    );
  }

  /**
   * Synchronizes collection with remote Firestore (delta query + tombstones).
   */
  async sync(forceFullRefreshOrOptions?: boolean | SyncOptions<T>): Promise<void> {
    const opts: SyncOptions<T> =
      typeof forceFullRefreshOrOptions === 'boolean'
        ? { forceFullRefresh: forceFullRefreshOrOptions }
        : forceFullRefreshOrOptions ?? {};

    const cacheKey = opts.cacheKey ?? this.config.cacheKey;
    const collectionPath = opts.collectionPath ?? this.config.collectionPath;
    const queryConstraints = opts.queryConstraints ?? this.config.queryConstraints;
    const filter = opts.additionalFilter ?? this.config.additionalFilter;
    const forceFullRefresh = opts.forceFullRefresh ?? false;

    if (filter) {
      await this.syncService.loadCachedData(
        cacheKey,
        this,
        this.config.sortFn,
        filter,
      );
    } else {
      await this.syncService.loadCachedData(
        cacheKey,
        this,
        this.config.sortFn,
      );
    }
    await this.syncService.syncCollection({
      cacheKey,
      collectionPath,
      idField: this.config.idField,
      targetSet: this,
      docConverter: this.config.docConverter,
      sortFn: this.config.sortFn,
      additionalFilter: filter,
      queryConstraints,
      forceFullRefresh,
    });
  }

  /**
   * In-memory removal (for manual local adjustment without touching remote Firestore or cache).
   */
  deleteLocal(id: string): void {
    super.delete(id);
  }
}
