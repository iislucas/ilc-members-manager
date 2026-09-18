import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActionQueueDialogComponent } from './action-queue-dialog.component';
import {
  ActionQueueService,
  QueuedAction,
  QueuedActionKind,
  ActionStatus,
  ConflictResolution,
} from '../action-queue.service';
import { FirestoreCollection } from '../../../functions/src/data-model/collections';
import { NetworkStateService } from '../network-state.service';
import { signal, Signal, WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MockActionQueue {
  queuedActions: WritableSignal<QueuedAction[]>;
  pendingCount: Signal<number>;
  conflictCount: Signal<number>;
  hasPending: Signal<boolean>;
  isSyncing: WritableSignal<boolean>;
  isDialogOpen: Signal<boolean>;
  syncQueue: ReturnType<typeof vi.fn>;
  discardAction: ReturnType<typeof vi.fn>;
  clearAll: ReturnType<typeof vi.fn>;
  resolveConflict: ReturnType<typeof vi.fn>;
  closeDialog: ReturnType<typeof vi.fn>;
}

interface MockNetworkState {
  isOffline: WritableSignal<boolean>;
  isOnline: Signal<boolean>;
  isReconnecting: Signal<boolean>;
  statusMessage: Signal<string>;
}

describe('ActionQueueDialogComponent', () => {
  let component: ActionQueueDialogComponent;
  let fixture: ComponentFixture<ActionQueueDialogComponent>;
  let mockActionQueue: MockActionQueue;
  let mockNetwork: MockNetworkState;

  const queuedActionsSignal = signal<QueuedAction[]>([]);
  const isSyncingSignal = signal<boolean>(false);
  const isOfflineSignal = signal<boolean>(false);

  beforeEach(async () => {
    queuedActionsSignal.set([]);
    isSyncingSignal.set(false);
    isOfflineSignal.set(false);

    mockActionQueue = {
      queuedActions: queuedActionsSignal,
      pendingCount: signal(0),
      conflictCount: signal(0),
      hasPending: signal(false),
      isSyncing: isSyncingSignal,
      isDialogOpen: signal(true),
      syncQueue: vi.fn().mockResolvedValue({ applied: 0, conflicts: 0, failed: 0 }),
      discardAction: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined),
      resolveConflict: vi.fn().mockResolvedValue(undefined),
      closeDialog: vi.fn(),
    };

    mockNetwork = {
      isOffline: isOfflineSignal,
      isOnline: signal(true),
      isReconnecting: signal(false),
      statusMessage: signal(''),
    };

    await TestBed.configureTestingModule({
      imports: [ActionQueueDialogComponent],
      providers: [
        { provide: ActionQueueService, useValue: mockActionQueue },
        { provide: NetworkStateService, useValue: mockNetwork },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ActionQueueDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders empty queue state when there are no queued actions', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Queue is empty');
    expect(el.textContent).toContain('All your local edits are in sync');
  });

  it('renders queued action card with details', () => {
    const action: QueuedAction = {
      id: 'act-1',
      timestamp: new Date().toISOString(),
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'doc1',
      entityTitle: 'Lucas Dixon',
      description: 'Updated phone and city',
      collectionPath: FirestoreCollection.Members,
      oldState: { phone: '123', city: 'London' },
      newState: { phone: '456', city: 'London' },
      status: ActionStatus.Pending,
    };

    queuedActionsSignal.set([action]);
    mockActionQueue.pendingCount = signal(1);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Lucas Dixon');
    expect(el.textContent).toContain('Updated phone and city');
    expect(el.textContent).toContain(FirestoreCollection.Members);
  });

  it('detects changed keys correctly for diff display', () => {
    const action: QueuedAction = {
      id: 'act-1',
      timestamp: new Date().toISOString(),
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'doc1',
      entityTitle: 'Lucas Dixon',
      description: 'Updated phone',
      collectionPath: FirestoreCollection.Members,
      oldState: { phone: '123', city: 'London' },
      newState: { phone: '456', city: 'London' },
      status: ActionStatus.Pending,
    };

    const keys = component.getChangedKeys(action);
    expect(keys).toEqual(['phone']);
  });

  it('renders conflict details when an action has conflict status', () => {
    const action: QueuedAction = {
      id: 'act-conflict',
      timestamp: new Date().toISOString(),
      kind: QueuedActionKind.UpdateSchool,
      entityDocId: 'sch-1',
      entityTitle: 'Main School',
      description: 'Updated email',
      collectionPath: FirestoreCollection.Schools,
      oldState: { email: 'old@example.com' },
      newState: { email: 'local@example.com' },
      status: ActionStatus.Conflict,
      conflictDetails: {
        conflictingKeys: ['email'],
        remoteState: { email: 'server@example.com' },
        detectedAt: new Date().toISOString(),
      },
    };

    queuedActionsSignal.set([action]);
    mockActionQueue.pendingCount = signal(1);
    mockActionQueue.conflictCount = signal(1);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Conflict');
    expect(el.textContent).toContain('This record was modified on the server');
    expect(el.textContent).toContain('local@example.com');
    expect(el.textContent).toContain('server@example.com');
  });

  it('calls resolveConflict with force_local when keep edits button is clicked', async () => {
    const action: QueuedAction = {
      id: 'act-conflict',
      timestamp: new Date().toISOString(),
      kind: QueuedActionKind.UpdateSchool,
      entityDocId: 'sch-1',
      entityTitle: 'Main School',
      description: 'Updated email',
      collectionPath: FirestoreCollection.Schools,
      oldState: { email: 'old@example.com' },
      newState: { email: 'local@example.com' },
      status: ActionStatus.Conflict,
      conflictDetails: {
        conflictingKeys: ['email'],
        remoteState: { email: 'server@example.com' },
        detectedAt: new Date().toISOString(),
      },
    };

    queuedActionsSignal.set([action]);
    fixture.detectChanges();

    const keepBtn = fixture.nativeElement.querySelector('.btn-keep-local') as HTMLButtonElement;
    expect(keepBtn).toBeTruthy();
    keepBtn.click();

    expect(mockActionQueue.resolveConflict).toHaveBeenCalledWith('act-conflict', ConflictResolution.ForceLocal);
  });

  it('closes dialog on close button click', () => {
    let closedEmitted = false;
    component.closed.subscribe(() => {
      closedEmitted = true;
    });

    const closeBtn = fixture.nativeElement.querySelector('.close-btn') as HTMLButtonElement;
    closeBtn.click();

    expect(closedEmitted).toBe(true);
    expect(mockActionQueue.closeDialog).toHaveBeenCalled();
  });

  it('renders custom displays for multiline text, booleans, and tags without raw JSON', () => {
    const action: QueuedAction = {
      id: 'act-custom',
      timestamp: new Date().toISOString(),
      kind: QueuedActionKind.UpdateMember,
      entityDocId: 'mem-1',
      entityTitle: 'Lucas Dixon',
      description: 'Updated notes and status',
      collectionPath: FirestoreCollection.Members,
      oldState: {
        notes: 'Original note line 1\nOriginal note line 2',
        isInstructor: false,
        roles: ['member'],
      },
      newState: {
        notes: 'Updated note line 1\nUpdated note line 2',
        isInstructor: true,
        roles: ['member', 'instructor'],
      },
      status: ActionStatus.Pending,
    };

    queuedActionsSignal.set([action]);
    component.toggleExpanded('act-custom');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // Notes formatted as multiline blocks, not JSON string with \n escapes
    const multiline = el.querySelectorAll('.data-val-multiline');
    expect(multiline.length).toBeGreaterThanOrEqual(2);
    expect(multiline[0].textContent).toContain('Original note line 1');
    expect(multiline[1].textContent).toContain('Updated note line 1');

    // Booleans rendered as Yes/No badges
    const badges = el.querySelectorAll('.data-val-badge');
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(badges[0].textContent).toBe('No');
    expect(badges[1].textContent).toBe('Yes');

    // Tags rendered as chips
    const tagChips = el.querySelectorAll('.data-tag-chip');
    expect(tagChips.length).toBeGreaterThanOrEqual(3);

    // Human labels rendered
    expect(el.textContent).toContain('Notes');
    expect(el.textContent).toContain('Instructor Status');
    expect(el.textContent).toContain('Roles');
  });
});
