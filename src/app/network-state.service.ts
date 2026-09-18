/* network-state.service.ts
 *
 * Monitors browser online/offline status and manages reconnection states.
 * Provides signals for UI badges, banners, and offline edit management.
 */

import { computed, Injectable, signal } from '@angular/core';

export enum ConnectionState {
  Online = 'online',
  Offline = 'offline',
  Reconnecting = 'reconnecting',
}

@Injectable({
  providedIn: 'root',
})
export class NetworkStateService {
  private state = signal<ConnectionState>(
    typeof navigator !== 'undefined' && !navigator.onLine
      ? ConnectionState.Offline
      : ConnectionState.Online,
  );

  private message = signal<string>('');

  public connectionState = computed(() => this.state());
  public isOnline = computed(() => this.state() === ConnectionState.Online);
  public isOffline = computed(() => this.state() === ConnectionState.Offline);
  public isReconnecting = computed(() => this.state() === ConnectionState.Reconnecting);
  public statusMessage = computed(() => this.message());

  // Callback to trigger when network is back online (e.g. to sync queue or refresh user)
  private onOnlineCallbacks: Array<() => Promise<void> | void> = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }

  public registerOnlineHandler(callback: () => Promise<void> | void): () => void {
    this.onOnlineCallbacks.push(callback);
    return () => {
      this.onOnlineCallbacks = this.onOnlineCallbacks.filter((cb) => cb !== callback);
    };
  }

  public markOffline(message = 'You are currently offline. Edits will be queued for sync.') {
    this.state.set(ConnectionState.Offline);
    this.message.set(message);
  }

  public markReconnecting(message = 'Logging back in and reconnecting...') {
    this.state.set(ConnectionState.Reconnecting);
    this.message.set(message);
  }

  public markOnline() {
    this.state.set(ConnectionState.Online);
    this.message.set('');
  }

  public async checkConnection(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.markOffline();
      return false;
    }

    this.markReconnecting('Checking connection...');
    try {
      // Lightweight fetch probe with cache-busting
      const response = await fetch(`/favicon.ico?_ping=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (response.ok || response.type === 'opaque') {
        this.markOnline();
        await this.runOnlineCallbacks();
        return true;
      }
    } catch {
      // Network unreachable
    }

    this.markOffline('Server unreachable. Running in offline mode.');
    return false;
  }

  private async handleOnline() {
    console.log('[NetworkStateService] Browser online event detected.');
    this.markReconnecting('Reconnecting to network...');
    await this.runOnlineCallbacks();
    this.markOnline();
  }

  private handleOffline() {
    console.log('[NetworkStateService] Browser offline event detected.');
    this.markOffline();
  }

  private async runOnlineCallbacks() {
    for (const callback of this.onOnlineCallbacks) {
      try {
        await callback();
      } catch (err) {
        console.warn('[NetworkStateService] Error running online handler:', err);
      }
    }
  }
}
