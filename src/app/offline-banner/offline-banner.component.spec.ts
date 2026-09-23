import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OfflineBannerComponent } from './offline-banner.component';
import { NetworkStateService } from '../network-state.service';
import { ActionQueueService } from '../action-queue.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { signal, Signal, WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MockNetworkState {
  isOffline: WritableSignal<boolean>;
  isReconnecting: WritableSignal<boolean>;
  statusMessage: WritableSignal<string>;
  checkConnection: ReturnType<typeof vi.fn>;
}

interface MockActionQueue {
  isSyncing: WritableSignal<boolean>;
  pendingCount: WritableSignal<number>;
  conflictCount: WritableSignal<number>;
  hasPending: Signal<boolean>;
  openDialog: ReturnType<typeof vi.fn>;
  syncQueue: ReturnType<typeof vi.fn>;
}

interface MockRouting {
  hrefForView: ReturnType<typeof vi.fn>;
}

interface MockFirebaseState {
  user: WritableSignal<any>;
}

describe('OfflineBannerComponent', () => {
  let component: OfflineBannerComponent;
  let fixture: ComponentFixture<OfflineBannerComponent>;
  let mockNetwork: MockNetworkState;
  let mockActionQueue: MockActionQueue;
  let mockRouting: MockRouting;
  let mockFirebaseState: MockFirebaseState;

  const isOfflineSignal = signal(false);
  const isReconnectingSignal = signal(false);
  const isSyncingSignal = signal(false);
  const pendingCountSignal = signal(0);
  const conflictCountSignal = signal(0);
  const statusMessageSignal = signal('');
  const userSignal = signal<any>(null);

  beforeEach(async () => {
    isOfflineSignal.set(false);
    isReconnectingSignal.set(false);
    isSyncingSignal.set(false);
    pendingCountSignal.set(0);
    conflictCountSignal.set(0);
    statusMessageSignal.set('');
    userSignal.set(null);

    mockNetwork = {
      isOffline: isOfflineSignal,
      isReconnecting: isReconnectingSignal,
      statusMessage: statusMessageSignal,
      checkConnection: vi.fn().mockResolvedValue(true),
    };

    mockActionQueue = {
      isSyncing: isSyncingSignal,
      pendingCount: pendingCountSignal,
      conflictCount: conflictCountSignal,
      hasPending: signal(false),
      openDialog: vi.fn(),
      syncQueue: vi.fn().mockResolvedValue({ applied: 0, conflicts: 0, failed: 0 }),
    };

    mockRouting = {
      hrefForView: vi.fn().mockReturnValue('/offline-queue'),
    };

    mockFirebaseState = {
      user: userSignal,
    };

    await TestBed.configureTestingModule({
      imports: [OfflineBannerComponent],
      providers: [
        { provide: NetworkStateService, useValue: mockNetwork },
        { provide: ActionQueueService, useValue: mockActionQueue },
        { provide: RoutingService, useValue: mockRouting },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OfflineBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('is hidden when online and there are no conflicts or syncing actions', () => {
    expect(fixture.nativeElement.querySelector('.offline-banner')).toBeNull();
  });

  it('renders offline warning when isOffline is true', () => {
    isOfflineSignal.set(true);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.offline-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('You are currently offline');
  });

  it('renders queued action pill and opens dialog when clicked', () => {
    isOfflineSignal.set(true);
    pendingCountSignal.set(3);
    fixture.detectChanges();

    const queueBtn = fixture.nativeElement.querySelector('.btn-queue') as HTMLAnchorElement;
    expect(queueBtn).toBeTruthy();
    expect(queueBtn.textContent).toContain('3 queued');

    queueBtn.click();
    expect(mockActionQueue.openDialog).toHaveBeenCalled();
  });

  it('shows reconnecting state with progress bar when reconnecting', () => {
    isReconnectingSignal.set(true);
    statusMessageSignal.set('Reconnecting to server...');
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.offline-banner');
    expect(banner).toBeTruthy();
    expect(banner.querySelector('.banner-progress-bar')).toBeTruthy();
    expect(banner.textContent).toContain('Reconnecting to server...');
  });

  it('shows conflict warning and button when conflicts exist', () => {
    conflictCountSignal.set(2);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.offline-banner');
    expect(banner).toBeTruthy();
    expect(banner.classList.contains('is-conflict')).toBe(true);
    expect(banner.textContent).toContain('Sync conflict detected in 2 edits');

    const resolveBtn = fixture.nativeElement.querySelector('.btn-action-primary') as HTMLAnchorElement;
    expect(resolveBtn).toBeTruthy();
    resolveBtn.click();
    expect(mockActionQueue.openDialog).toHaveBeenCalled();
  });

  it('calls networkState.checkConnection when retry button is clicked', async () => {
    isOfflineSignal.set(true);
    fixture.detectChanges();

    const retryBtn = fixture.nativeElement.querySelector('.btn-retry') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    retryBtn.click();
    expect(mockNetwork.checkConnection).toHaveBeenCalled();
  });

  it('renders offline warning with cached data notice and sign-in button when signed out and offline', () => {
    userSignal.set(null);
    isOfflineSignal.set(true);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.offline-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('You are currently offline (viewing local cached data)');

    const loginBtn = fixture.nativeElement.querySelector('.btn-login') as HTMLAnchorElement;
    expect(loginBtn).toBeTruthy();
    expect(loginBtn.textContent).toContain('Sign In');
  });

  it('renders standard offline warning and no sign-in button when signed in and offline', () => {
    userSignal.set({ uid: 'test-user-123' });
    isOfflineSignal.set(true);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.offline-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Edits are saved locally');

    const loginBtn = fixture.nativeElement.querySelector('.btn-login');
    expect(loginBtn).toBeNull();
  });
});

