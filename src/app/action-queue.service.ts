/* action-queue.service.ts
 *
 * Generic Action Queuing System for offline mutations.
 *
 * Captures old and new state for edits made while offline, persists them to
 * IndexedDB, optimistically updates the UI, and synchronizes with conflict
 * detection once connectivity is restored.
 */

import { computed, inject, Injectable, signal } from '@angular/core';
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { FirestoreCollection } from '../../functions/src/data-model/collections';
import { AppPathPatterns, FIREBASE_APP, Views } from './app.config';
import { IdbStorageService } from './idb-storage.service';
import { NetworkStateService } from './network-state.service';
import { RoutingService } from './routing.service';

export const ACTION_QUEUE_STORAGE_KEY = 'ilc_offline_action_queue';

export enum QueuedActionKind {
  UpdateMember = 'update_member',
  UpdateSchool = 'update_school',
  UpdateEvent = 'update_event',
  UpdateGrading = 'update_grading',
  Custom = 'custom',
}

export enum ActionStatus {
  Pending = 'pending',
  Syncing = 'syncing',
  Conflict = 'conflict',
  Failed = 'failed',
  Applied = 'applied',
}

export enum RollbackTarget {
  Baseline = 'baseline',
  Remote = 'remote',
}

export enum ConflictResolution {
  ForceLocal = 'force_local',
  AcceptRemote = 'accept_remote',
}

export interface ConflictDetails<T = Record<string, unknown>> {
  remoteState: T;
  conflictingKeys: string[];
  detectedAt: string;
}

export interface QueuedAction<T = Record<string, unknown>> {
  id: string;
  timestamp: string; // ISO string
  kind: QueuedActionKind;
  entityDocId: string;
  entityTitle: string; // Human-friendly display label (e.g. "(US402) Lucas Dixon")
  description: string; // Summary of the change (e.g. "Updated phone number and address")
  collectionPath: FirestoreCollection | string; // e.g. FirestoreCollection.Members, "members"
  oldState: T; // Snapshot before edit
  newState: T; // Updated attributes / mutation payload
  baselineSnapshot?: Record<string, unknown>; // Full document state before any offline mutations began
  status: ActionStatus;
  conflictDetails?: ConflictDetails<T>;
  errorMessage?: string;
}

export interface EnqueueActionOptions<T = Record<string, unknown>> {
  kind: QueuedActionKind;
  entityDocId: string;
  entityTitle: string;
  description: string;
  collectionPath: FirestoreCollection | string;
  oldState: T;
  newState: T;
  baselineSnapshot?: Record<string, unknown>;
}

export type RollbackHandler = (
  action: QueuedAction,
  targetState: RollbackTarget,
) => Promise<void> | void;

@Injectable({
  providedIn: 'root',
})
export class ActionQueueService {
  private idb = inject(IdbStorageService);
  private networkState = inject(NetworkStateService);
  private app = inject(FIREBASE_APP, { optional: true });
  private routing = inject<RoutingService<AppPathPatterns>>(RoutingService, { optional: true });
  private _db: ReturnType<typeof getFirestore> | null = null;
  private rollbackHandlers: RollbackHandler[] = [];

  private getDb(): ReturnType<typeof getFirestore> {
    if (!this._db) {
      if (this.app) {
        this._db = getFirestore(this.app);
      } else {
        this._db = getFirestore();
      }
    }
    return this._db;
  }

  private actions = signal<QueuedAction[]>([]);
  public isSyncing = signal<boolean>(false);

  public isDialogOpen = signal<boolean>(false);

  public queuedActions = computed(() => this.actions());
  public pendingCount = computed(
    () =>
      this.actions().filter(
        (a) => a.status === ActionStatus.Pending || a.status === ActionStatus.Conflict,
      ).length,
  );
  public conflictCount = computed(
    () => this.actions().filter((a) => a.status === ActionStatus.Conflict).length,
  );
  public hasPending = computed(() => this.pendingCount() > 0);

  public registerRollbackHandler(handler: RollbackHandler): () => void {
    this.rollbackHandlers.push(handler);
    return () => {
      this.rollbackHandlers = this.rollbackHandlers.filter((h) => h !== handler);
    };
  }

  private async executeRollback(
    action: QueuedAction,
    targetState: RollbackTarget = RollbackTarget.Baseline,
  ): Promise<void> {
    for (const handler of this.rollbackHandlers) {
      try {
        await handler(action, targetState);
      } catch (err) {
        console.warn('[ActionQueueService] Rollback handler error:', err);
      }
    }
  }

  public openDialog(): void {
    this.isDialogOpen.set(true);
    if (this.routing && typeof this.routing.matchedPatternId === 'function' && typeof this.routing.navigateTo === 'function') {
      if (this.routing.matchedPatternId() !== Views.OfflineActionQueue) {
        this.routing.navigateTo(this.routing.hrefForView(Views.OfflineActionQueue));
      }
    }
  }

  public closeDialog(): void {
    this.isDialogOpen.set(false);
    if (this.routing && typeof this.routing.matchedPatternId === 'function' && typeof this.routing.navigateTo === 'function') {
      if (this.routing.matchedPatternId() === Views.OfflineActionQueue) {
        if (typeof window !== 'undefined' && window.history.length > 1) {
          window.history.back();
        } else {
          this.routing.navigateTo(this.routing.hrefForView(Views.Home));
        }
      }
    }
  }

  constructor() {
    this.loadPersistedQueue();

    // Auto-sync whenever browser comes back online
    this.networkState.registerOnlineHandler(async () => {
      if (this.pendingCount() > 0) {
        console.log('[ActionQueueService] Online event: initiating queue sync...');
        await this.syncQueue();
      }
    });
  }

  /**
   * Loads persisted queue from IndexedDB on startup.
   */
  public async loadPersistedQueue(): Promise<void> {
    try {
      const persisted = await this.idb.get<QueuedAction[]>(ACTION_QUEUE_STORAGE_KEY);
      if (persisted && Array.isArray(persisted)) {
        this.actions.set(persisted);
      }
    } catch (err) {
      console.warn('[ActionQueueService] Failed to load persisted action queue:', err);
    }
  }

  /**
   * Persists the current queue in-memory state into IndexedDB.
   */
  private async persistQueue(): Promise<void> {
    try {
      await this.idb.set(ACTION_QUEUE_STORAGE_KEY, this.actions());
    } catch (err) {
      console.warn('[ActionQueueService] Failed to persist action queue:', err);
    }
  }

  /**
   * Enqueues an offline mutation.
   */
  public async enqueueAction<T extends object = Record<string, unknown>>(
    opts: EnqueueActionOptions<T>,
  ): Promise<QueuedAction<T>> {
    const current = this.actions();
    const existingIndex = current.findIndex(
      (a) =>
        a.entityDocId === opts.entityDocId &&
        a.collectionPath === opts.collectionPath &&
        a.status === ActionStatus.Pending,
    );

    if (existingIndex >= 0) {
      const existing = current[existingIndex];
      const mergedOldState = { ...existing.oldState } as Record<string, unknown>;
      // For each newly changed key, preserve the original baseline value if already recorded
      for (const [k, v] of Object.entries(opts.oldState)) {
        if (!(k in mergedOldState)) {
          mergedOldState[k] = v;
        }
      }
      const mergedNewState = { ...existing.newState, ...opts.newState } as Record<string, unknown>;

      // Clean up fields that might have reverted back to their baseline value
      for (const key of Object.keys(mergedNewState)) {
        if (this.valuesEqual(mergedOldState[key], mergedNewState[key])) {
          delete mergedOldState[key];
          delete mergedNewState[key];
        }
      }

      const updated = [...current];

      // If all edits were reverted, remove the action from the queue
      if (Object.keys(mergedNewState).length === 0) {
        updated.splice(existingIndex, 1);
        this.actions.set(updated);
        await this.persistQueue();
        console.log(`[ActionQueueService] All changes reverted for ${opts.entityTitle}, removed from queue`);
        return existing as unknown as QueuedAction<T>;
      }

      const mergedAction: QueuedAction<T> = {
        ...existing,
        timestamp: new Date().toISOString(),
        entityTitle: opts.entityTitle || existing.entityTitle,
        description: opts.description || existing.description,
        oldState: mergedOldState as T,
        newState: mergedNewState as T,
        baselineSnapshot: existing.baselineSnapshot || opts.baselineSnapshot,
      } as unknown as QueuedAction<T>;

      updated[existingIndex] = mergedAction as QueuedAction;
      this.actions.set(updated);
      await this.persistQueue();
      console.log(`[ActionQueueService] Updated existing pending action ${existing.id} for ${mergedAction.entityTitle}`);
      return mergedAction;
    }

    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const action: QueuedAction<T> = {
      id,
      timestamp: new Date().toISOString(),
      kind: opts.kind,
      entityDocId: opts.entityDocId,
      entityTitle: opts.entityTitle,
      description: opts.description,
      collectionPath: opts.collectionPath,
      oldState: opts.oldState,
      newState: opts.newState,
      baselineSnapshot: opts.baselineSnapshot || (opts.oldState as Record<string, unknown>),
      status: ActionStatus.Pending,
    };

    this.actions.set([...current, action as QueuedAction]);
    await this.persistQueue();

    console.log(`[ActionQueueService] Enqueued action ${id} (${action.kind}) for ${action.entityTitle}`);
    return action;
  }

  /**
   * Removes an action by ID from the queue.
   */
  public async removeAction(id: string): Promise<void> {
    this.actions.set(this.actions().filter((a) => a.id !== id));
    await this.persistQueue();
  }

  /**
   * Discards an action, executes rollback to restore local data to baseline, and removes it from queue.
   */
  public async discardAction(id: string): Promise<QueuedAction | undefined> {
    const action = this.actions().find((a) => a.id === id);
    if (action) {
      await this.executeRollback(action, RollbackTarget.Baseline);
      await this.removeAction(id);
    }
    return action;
  }

  /**
   * Discards all pending actions in the queue and rolls back each to baseline.
   */
  public async clearAll(): Promise<void> {
    const pendingActions = [...this.actions()];
    for (const action of pendingActions) {
      await this.executeRollback(action, RollbackTarget.Baseline);
    }
    this.actions.set([]);
    await this.persistQueue();
  }

  /**
   * Synchronizes all pending actions against Firestore with conflict detection.
   */
  public async syncQueue(): Promise<{ applied: number; conflicts: number; failed: number }> {
    if (this.networkState.isOffline()) {
      console.warn('[ActionQueueService] Cannot sync queue while offline.');
      return { applied: 0, conflicts: 0, failed: 0 };
    }

    if (this.isSyncing()) {
      console.log('[ActionQueueService] Sync already in progress, skipping duplicate call.');
      return { applied: 0, conflicts: 0, failed: 0 };
    }

    this.isSyncing.set(true);
    this.networkState.markReconnecting('Syncing offline queued edits...');

    let applied = 0;
    let conflicts = 0;
    let failed = 0;

    const remainingActions: QueuedAction[] = [];

    for (const action of this.actions()) {
      if (action.status === ActionStatus.Applied) {
        continue;
      }

      try {
        const docRef = doc(this.getDb(), action.collectionPath, action.entityDocId);
        const snap = await getDoc(docRef);

        if (!snap.exists()) {
          action.status = ActionStatus.Failed;
          action.errorMessage = `Document ${action.entityDocId} does not exist on server.`;
          remainingActions.push(action);
          failed++;
          continue;
        }

        const remoteData = snap.data() as Record<string, unknown>;
        const conflictKeys = this.detectConflicts(
          action.oldState as Record<string, unknown>,
          action.newState as Record<string, unknown>,
          remoteData,
        );

        if (conflictKeys.length > 0) {
          console.warn(`[ActionQueueService] Conflict detected for action ${action.id} on fields:`, conflictKeys);
          action.status = ActionStatus.Conflict;
          action.conflictDetails = {
            remoteState: remoteData,
            conflictingKeys: conflictKeys,
            detectedAt: new Date().toISOString(),
          };
          remainingActions.push(action);
          conflicts++;
          continue;
        }

        // No conflict! Apply update to Firestore
        const updatePayload: Record<string, unknown> = {
          ...action.newState,
          lastUpdated: serverTimestamp(),
        };

        await updateDoc(docRef, updatePayload);
        console.log(`[ActionQueueService] Successfully applied queued action ${action.id} for ${action.entityTitle}`);
        applied++;
      } catch (err: unknown) {
        console.error(`[ActionQueueService] Failed applying action ${action.id}:`, err);
        action.status = ActionStatus.Failed;
        action.errorMessage = err instanceof Error ? err.message : String(err);
        remainingActions.push(action);
        failed++;
      }
    }

    this.actions.set(remainingActions);
    await this.persistQueue();
    this.isSyncing.set(false);

    if (conflicts > 0) {
      this.networkState.markOnline();
    } else {
      this.networkState.markOnline();
    }

    return { applied, conflicts, failed };
  }

  /**
   * Resolves a conflicted action by either forcing the local changes or accepting the remote state.
   */
  public async resolveConflict(
    id: string,
    resolution: ConflictResolution,
  ): Promise<void> {
    const action = this.actions().find((a) => a.id === id);
    if (!action) return;

    if (resolution === ConflictResolution.ForceLocal) {
      try {
        const docRef = doc(this.getDb(), action.collectionPath, action.entityDocId);
        const updatePayload: Record<string, unknown> = {
          ...action.newState,
          lastUpdated: serverTimestamp(),
        };
        await updateDoc(docRef, updatePayload);
        await this.removeAction(id);
      } catch (err) {
        console.error('[ActionQueueService] Failed forcing local resolution:', err);
        action.errorMessage = err instanceof Error ? err.message : String(err);
        await this.persistQueue();
      }
    } else {
      // Accept remote: rollback local state to server's remote snapshot
      await this.executeRollback(action, RollbackTarget.Remote);
      await this.removeAction(id);
    }
  }

  /**
   * Checks for field-level conflicts:
   * A conflict exists if a field modified in `newState` differs from `oldState`
   * AND also differs from `remoteData`.
   */
  public detectConflicts(
    oldState: Record<string, unknown>,
    newState: Record<string, unknown>,
    remoteData: Record<string, unknown>,
  ): string[] {
    const conflictingKeys: string[] = [];

    for (const key of Object.keys(newState)) {
      if (key === 'lastUpdated') continue;

      const oldVal = oldState[key];
      const newVal = newState[key];
      const remoteVal = remoteData[key];

      // If user changed this field locally
      if (!this.valuesEqual(oldVal, newVal)) {
        // Did remote also change this field to something different from local new value?
        if (!this.valuesEqual(oldVal, remoteVal) && !this.valuesEqual(newVal, remoteVal)) {
          conflictingKeys.push(key);
        }
      }
    }

    return conflictingKeys;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return a === b;
    if (typeof a === 'object' && typeof b === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }
}
