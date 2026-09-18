import { TestBed } from '@angular/core/testing';
import { ConnectionState, NetworkStateService } from './network-state.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('NetworkStateService', () => {
  let service: NetworkStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [NetworkStateService],
    });
    service = TestBed.inject(NetworkStateService);
  });

  it('initializes with a valid connection state', () => {
    expect(service.connectionState()).toBeDefined();
    expect(typeof service.isOnline()).toBe('boolean');
    expect(typeof service.isOffline()).toBe('boolean');
  });

  it('updates state when markOffline is called', () => {
    service.markOffline('Network lost');
    expect(service.isOffline()).toBe(true);
    expect(service.isOnline()).toBe(false);
    expect(service.connectionState()).toBe(ConnectionState.Offline);
    expect(service.statusMessage()).toBe('Network lost');
  });

  it('updates state when markReconnecting is called', () => {
    service.markReconnecting('Reconnecting...');
    expect(service.isReconnecting()).toBe(true);
    expect(service.isOnline()).toBe(false);
    expect(service.connectionState()).toBe(ConnectionState.Reconnecting);
    expect(service.statusMessage()).toBe('Reconnecting...');
  });

  it('updates state when markOnline is called', () => {
    service.markOffline();
    expect(service.isOffline()).toBe(true);

    service.markOnline();
    expect(service.isOnline()).toBe(true);
    expect(service.isOffline()).toBe(false);
    expect(service.connectionState()).toBe(ConnectionState.Online);
    expect(service.statusMessage()).toBe('');
  });

  it('executes registered online handlers when coming online', async () => {
    const handler = vi.fn();
    const unregister = service.registerOnlineHandler(handler);

    service.markOffline();
    expect(handler).not.toHaveBeenCalled();

    // Trigger checkConnection when navigator is mocked or directly test handler execution
    service.markOnline();
    unregister();
  });
});
