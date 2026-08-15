/* incremental-sync.service.ts
 *
 * Incremental Collection Sync Engine (Delta Sync) with local IndexedDB persistence.
 *
 * Provides:
 * 1. Instant (<20ms) local cache loading into SearchableSet for immediate offline responsiveness.
 * 2. Background delta queries against Firestore (`lastUpdated > cachedTimestamp`).
 * 3. Tombstone deletion reconciliation (`/system/deletions/{collection}`).
 * 4. Automatic cache persistence and in-memory signal updates.
 */

import { inject, Injectable } from '@angular/core';
import {
  collection,
  getDocs,
  getFirestore,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { FIREBASE_APP } from './app.config';
import { GenericFsDoc } from '../../functions/src/data-model';
import { IdbStorageService } from './idb-storage.service';
import { SearchableSet } from './searchable-set';

export interface CachedCollectionBundle<T> {
  entries: T[];
  lastSyncTimestamp: string; // ISO string
}

export interface CachedCollectionSummary {
  cacheKey: string;
  count: number;
  lastSyncTimestamp: string;
  approximateSizeBytes: number;
}

export interface SyncCollectionConfig<
  ID extends string,
  T extends { [key in ID]: string },
> {
  cacheKey: string;
  collectionPath: string;
  idField: ID;
  targetSet: SearchableSet<ID, T>;
  docConverter: (doc: GenericFsDoc) => T;
  sortFn?: (a: T, b: T) => number;
  additionalFilter?: (item: T) => boolean;
  forceFullRefresh?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class IncrementalSyncService {
  private app = inject(FIREBASE_APP);
  private db = getFirestore(this.app);
  private idb = inject(IdbStorageService);

  /**
   * Immediately loads any cached collection from IndexedDB into the target SearchableSet.
   * Returns true if cached data was found and loaded.
   */
  async loadCachedData<ID extends string, T extends { [key in ID]: string }>(
    cacheKey: string,
    targetSet: SearchableSet<ID, T>,
    sortFn?: (a: T, b: T) => number,
  ): Promise<boolean> {
    try {
      const bundle = await this.idb.get<CachedCollectionBundle<T>>(cacheKey);
      if (bundle && Array.isArray(bundle.entries)) {
        const sorted = sortFn ? [...bundle.entries].sort(sortFn) : bundle.entries;
        targetSet.setEntries(sorted);
        return true;
      }
    } catch (err) {
      console.warn(`[IncrementalSync] Error loading cache for ${cacheKey}:`, err);
    }
    return false;
  }

  /**
   * Performs an incremental delta sync from Firestore, merges updates/deletions,
   * updates the SearchableSet in memory, and persists back to IndexedDB.
   */
  async syncCollection<ID extends string, T extends { [key in ID]: string }>(
    config: SyncCollectionConfig<ID, T>,
  ): Promise<void> {
    const {
      cacheKey,
      collectionPath,
      idField,
      targetSet,
      docConverter,
      sortFn,
      additionalFilter,
      forceFullRefresh,
    } = config;

    try {
      let cachedBundle = await this.idb.get<CachedCollectionBundle<T>>(cacheKey);

      // If forceFullRefresh or no valid cache, do a full collection fetch
      if (forceFullRefresh || !cachedBundle || !cachedBundle.lastSyncTimestamp) {
        await this.performFullSync(config);
        return;
      }

      // Populate memory if targetSet is still in loading state
      if (Array.isArray(cachedBundle.entries) && targetSet.loading()) {
        const initialSorted = sortFn ? [...cachedBundle.entries].sort(sortFn) : cachedBundle.entries;
        targetSet.setEntries(initialSorted);
      }

      const lastSyncIso = cachedBundle.lastSyncTimestamp;

      // Convert local ISO string timestamp to Firestore Timestamp for query
      let lastSyncTimestamp: Timestamp;
      try {
        const date = new Date(lastSyncIso);
        lastSyncTimestamp = !isNaN(date.getTime()) && date.getTime() > 0
          ? Timestamp.fromDate(date)
          : Timestamp.fromMillis(0);
      } catch {
        lastSyncTimestamp = Timestamp.fromMillis(0);
      }

      // Query modified records using Firestore Timestamp: lastUpdated > lastSyncTimestamp
      const colRef = collection(this.db, collectionPath);
      const deltaQuery = query(
        colRef,
        where('lastUpdated', '>', lastSyncTimestamp),
        orderBy('lastUpdated', 'asc'),
      );

      // Fetch delta changes and tombstones in parallel
      const [deltaSnap, tombstones] = await Promise.all([
        getDocs(deltaQuery).catch(async (err) => {
          console.warn(`[IncrementalSync] Delta query on ${collectionPath} failed, falling back to full sync:`, err);
          return null;
        }),
        this.fetchTombstones(collectionPath, lastSyncIso),
      ]);

      if (!deltaSnap) {
        await this.performFullSync(config);
        return;
      }

      // If no updates and no deletions, cache is already up-to-date!
      if (deltaSnap.empty && tombstones.length === 0) {
        if (targetSet.loading()) {
          const initialSorted = sortFn ? [...cachedBundle.entries].sort(sortFn) : cachedBundle.entries;
          targetSet.setEntries(initialSorted);
        }
        return;
      }

      // Build working map from cached entries
      const map = new Map<string, T>();
      for (const item of cachedBundle.entries) {
        map.set(item[idField], item);
      }

      // Merge additions and modifications
      let maxLastUpdated = lastSyncIso;
      for (const d of deltaSnap.docs) {
        const item = docConverter(d);
        if (!additionalFilter || additionalFilter(item)) {
          map.set(item[idField], item);
        } else {
          map.delete(item[idField]);
        }

        const itemTime = (item as unknown as { lastUpdated?: string }).lastUpdated;
        if (itemTime && itemTime > maxLastUpdated) {
          maxLastUpdated = itemTime;
        }
      }

      // Prune tombstones
      for (const deletedDocId of tombstones) {
        map.delete(deletedDocId);
        if (idField !== 'docId') {
          for (const [key, val] of map.entries()) {
            if ((val as unknown as { docId?: string }).docId === deletedDocId) {
              map.delete(key);
              break;
            }
          }
        }
      }

      const mergedEntries = Array.from(map.values());
      const sorted = sortFn ? mergedEntries.sort(sortFn) : mergedEntries;

      // Update SearchableSet
      targetSet.setEntries(sorted);

      // Update IndexedDB cache
      await this.idb.set(cacheKey, {
        entries: sorted,
        lastSyncTimestamp: maxLastUpdated,
      });
    } catch (err: unknown) {
      console.error(`[IncrementalSync] Failed syncing ${collectionPath}:`, err);
      targetSet.setError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Performs a clean full fetch of the entire collection and initializes the local cache.
   */
  async performFullSync<ID extends string, T extends { [key in ID]: string }>(
    config: SyncCollectionConfig<ID, T>,
  ): Promise<void> {
    const {
      cacheKey,
      collectionPath,
      targetSet,
      docConverter,
      sortFn,
      additionalFilter,
    } = config;

    const colRef = collection(this.db, collectionPath);
    const snap = await getDocs(colRef);

    let maxLastUpdated = new Date(0).toISOString();
    const entries: T[] = [];

    for (const d of snap.docs) {
      const item = docConverter(d);
      if (!additionalFilter || additionalFilter(item)) {
        entries.push(item);
      }
      const itemTime = (item as unknown as { lastUpdated?: string }).lastUpdated;
      if (itemTime && itemTime > maxLastUpdated) {
        maxLastUpdated = itemTime;
      }
    }

    if (maxLastUpdated === new Date(0).toISOString()) {
      maxLastUpdated = new Date().toISOString();
    }

    const sorted = sortFn ? entries.sort(sortFn) : entries;
    targetSet.setEntries(sorted);

    await this.idb.set(cacheKey, {
      entries: sorted,
      lastSyncTimestamp: maxLastUpdated,
    });
  }

  /**
   * Fetches deleted document IDs from the deletions tombstone collection.
   */
  private async fetchTombstones(
    collectionPath: string,
    sinceIso: string,
  ): Promise<string[]> {
    try {
      let sinceTimestamp: Timestamp;
      try {
        const date = new Date(sinceIso);
        sinceTimestamp = !isNaN(date.getTime()) && date.getTime() > 0
          ? Timestamp.fromDate(date)
          : Timestamp.fromMillis(0);
      } catch {
        sinceTimestamp = Timestamp.fromMillis(0);
      }

      const simpleName = collectionPath.split('/').pop() || collectionPath;
      const tombstonesRef = collection(this.db, `system/deletions/${simpleName}`);
      const q = query(
        tombstonesRef,
        where('deletedAt', '>', sinceTimestamp),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.id);
    } catch {
      // Tombstones collection might not exist yet or no deletions, ignore gracefully
      return [];
    }
  }

  /**
   * Gets a summary of all currently cached collections in IndexedDB.
   */
  async getAllCachedCollectionSummaries(): Promise<CachedCollectionSummary[]> {
    const keys = await this.idb.keys();
    const summaries: CachedCollectionSummary[] = [];

    for (const key of keys) {
      const bundle = await this.idb.get<CachedCollectionBundle<unknown>>(key);
      if (bundle && Array.isArray(bundle.entries)) {
        const jsonStr = JSON.stringify(bundle);
        summaries.push({
          cacheKey: key,
          count: bundle.entries.length,
          lastSyncTimestamp: bundle.lastSyncTimestamp || 'Unknown',
          approximateSizeBytes: new Blob([jsonStr]).size,
        });
      }
    }

    return summaries.sort((a, b) => a.cacheKey.localeCompare(b.cacheKey));
  }

  /**
   * Retrieves the raw cached bundle for a specific cache key.
   */
  async getCachedBundle<T = unknown>(cacheKey: string): Promise<CachedCollectionBundle<T> | undefined> {
    return await this.idb.get<CachedCollectionBundle<T>>(cacheKey);
  }

  /**
   * Clears local cache for a specific collection.
   */
  async clearCache(cacheKey: string): Promise<void> {
    await this.idb.delete(cacheKey);
  }

  /**
   * Clears all cached collections.
   */
  async clearAllCaches(): Promise<void> {
    await this.idb.clear();
  }
}
