import { TestBed } from '@angular/core/testing';
import {
  ActionQueueService,
  ActionStatus,
  ConflictResolution,
  QueuedActionKind,
  RollbackTarget,
} from './action-queue.service';
import { FirestoreCollection } from '../../functions/src/data-model/collections';
import { IdbStorageService } from './idb-storage.service';
import { NetworkStateService } from './network-state.service';
import { FIREBASE_APP } from './app.config';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ActionQueueService', () => {
  let service: ActionQueueService;
  let mockIdb: Partial<IdbStorageService>;
  let mockNetwork: Partial<NetworkStateService>;

  beforeEach(() => {
    mockIdb = {
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    mockNetwork = {
      isOffline: vi.fn().mockReturnValue(false),
      isOnline: vi.fn().mockReturnValue(true),
      registerOnlineHandler: vi.fn().mockReturnValue(() => {}),
      markReconnecting: vi.fn(),
      markOnline: vi.fn(),
      markOffline: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ActionQueueService,
        { provide: IdbStorageService, useValue: mockIdb },
        { provide: NetworkStateService, useValue: mockNetwork },
        { provide: FIREBASE_APP, useValue: {} },
      ],
    });

    service = TestBed.inject(ActionQueueService);
  });

  it('enqueues actions and increments pending count', async () => {
    expect(service.pendingCount()).toBe(0);

    const action = await service.enqueueAction({
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem_123',
      entityTitle: 'Test Member',
      description: 'Update phone number',
      collectionPath: FirestoreCollection.Members,
      oldState: { phone: '111' },
      newState: { phone: '222' },
    });

    expect(action.id).toBeDefined();
    expect(action.status).toBe(ActionStatus.Pending);
    expect(service.pendingCount()).toBe(1);
    expect(mockIdb.set).toHaveBeenCalled();
  });

  it('detects conflicting keys when remote data differs from old and new values', () => {
    const oldState = { phone: '111', address: 'Old St' };
    const newState = { phone: '222', address: 'Old St' }; // User changed phone locally
    const remoteData = { phone: '333', address: 'Old St' }; // Someone else changed phone on server

    const conflicts = service.detectConflicts(oldState, newState, remoteData);
    expect(conflicts).toContain('phone');
    expect(conflicts).not.toContain('address');
  });

  it('does not detect conflict when remote data matches old state', () => {
    const oldState = { phone: '111', address: 'Old St' };
    const newState = { phone: '222', address: 'Old St' };
    const remoteData = { phone: '111', address: 'Old St' }; // Remote is untouched

    const conflicts = service.detectConflicts(oldState, newState, remoteData);
    expect(conflicts.length).toBe(0);
  });

  it('removes and discards actions properly', async () => {
    const action = await service.enqueueAction({
      kind: QueuedActionKind.UpdateEvent,
      entityDocId: 'event_456',
      entityTitle: 'Test Event',
      description: 'Update event title',
      collectionPath: FirestoreCollection.Events,
      oldState: { title: 'Old' },
      newState: { title: 'New' },
    });

    expect(service.pendingCount()).toBe(1);

    const discarded = await service.discardAction(action.id);
    expect(discarded?.id).toBe(action.id);
    expect(service.pendingCount()).toBe(0);
  });

  it('merges multiple consecutive offline edits for the same entity into a single action', async () => {
    await service.enqueueAction({
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem_999',
      entityTitle: 'Lucas',
      description: 'Updated notes',
      collectionPath: FirestoreCollection.Members,
      oldState: { notes: 'old note' },
      newState: { notes: 'new note' },
    });

    expect(service.pendingCount()).toBe(1);

    await service.enqueueAction({
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem_999',
      entityTitle: 'Lucas',
      description: 'Updated phone',
      collectionPath: FirestoreCollection.Members,
      oldState: { phone: '000' },
      newState: { phone: '111' },
    });

    // Still only 1 pending action for this entity
    expect(service.pendingCount()).toBe(1);
    const queued = service.queuedActions()[0];
    expect(queued.newState).toEqual({ notes: 'new note', phone: '111' });
    expect(queued.oldState).toEqual({ notes: 'old note', phone: '000' });
  });

  it('removes pending action if all changes are reverted back to baseline', async () => {
    await service.enqueueAction({
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem_revert',
      entityTitle: 'Lucas',
      description: 'Updated notes',
      collectionPath: FirestoreCollection.Members,
      oldState: { notes: 'original note' },
      newState: { notes: 'changed note' },
    });

    expect(service.pendingCount()).toBe(1);

    // Revert notes back to original note
    await service.enqueueAction({
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem_revert',
      entityTitle: 'Lucas',
      description: 'Reverted notes',
      collectionPath: FirestoreCollection.Members,
      oldState: { notes: 'changed note' },
      newState: { notes: 'original note' },
    });

    // Should be automatically cleared from the queue
    expect(service.pendingCount()).toBe(0);
  });

  it('triggers rollback handler with baseline snapshot on discardAction', async () => {
    const rollbackSpy = vi.fn();
    const unregister = service.registerRollbackHandler(rollbackSpy);

    const baselineSnapshot = { name: 'Lucas Baseline', phone: '000' };
    const action = await service.enqueueAction({
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem_rollback_1',
      entityTitle: 'Lucas',
      description: 'Updated phone',
      collectionPath: FirestoreCollection.Members,
      oldState: { phone: '000' },
      newState: { phone: '999' },
      baselineSnapshot,
    });

    await service.discardAction(action.id);
    expect(rollbackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: action.id, baselineSnapshot }),
      RollbackTarget.Baseline,
    );
    expect(service.pendingCount()).toBe(0);

    unregister();
  });

  it('triggers rollback handler for all actions on clearAll', async () => {
    const rollbackSpy = vi.fn();
    service.registerRollbackHandler(rollbackSpy);

    await service.enqueueAction({
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem_1',
      entityTitle: 'Member 1',
      description: 'Edit 1',
      collectionPath: FirestoreCollection.Members,
      oldState: { name: 'Old 1' },
      newState: { name: 'New 1' },
    });

    await service.enqueueAction({
      kind: QueuedActionKind.UpdateSchool,
      entityDocId: 'school_1',
      entityTitle: 'School 1',
      description: 'Edit 2',
      collectionPath: FirestoreCollection.Schools,
      oldState: { schoolName: 'Old School' },
      newState: { schoolName: 'New School' },
    });

    expect(service.pendingCount()).toBe(2);
    await service.clearAll();

    expect(rollbackSpy).toHaveBeenCalledTimes(2);
    expect(service.pendingCount()).toBe(0);
  });

  it('triggers rollback handler with remote targetState on resolveConflict accept_remote', async () => {
    const rollbackSpy = vi.fn();
    service.registerRollbackHandler(rollbackSpy);

    const action = await service.enqueueAction({
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem_conflict',
      entityTitle: 'Conflict Member',
      description: 'Conflicting edit',
      collectionPath: FirestoreCollection.Members,
      oldState: { phone: '000' },
      newState: { phone: '111' },
    });

    action.status = ActionStatus.Conflict;
    action.conflictDetails = {
      remoteState: { phone: '222' },
      conflictingKeys: ['phone'],
      detectedAt: new Date().toISOString(),
    };

    await service.resolveConflict(action.id, ConflictResolution.AcceptRemote);

    expect(rollbackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: action.id }),
      RollbackTarget.Remote,
    );
    expect(service.pendingCount()).toBe(0);
  });
});
