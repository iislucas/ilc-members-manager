import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, ApplicationRef } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Subject, of } from 'rxjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppUpdateService } from './app-update.service';

describe('AppUpdateService', () => {
  let service: AppUpdateService;
  let mockSwUpdate: {
    isEnabled: boolean;
    versionUpdates: Subject<unknown>;
    checkForUpdate: ReturnType<typeof vi.fn>;
    activateUpdate: ReturnType<typeof vi.fn>;
  };
  let mockAppRef: {
    isStable: Subject<boolean>;
  };

  beforeEach(() => {
    mockSwUpdate = {
      isEnabled: true,
      versionUpdates: new Subject<unknown>(),
      checkForUpdate: vi.fn().mockResolvedValue(true),
      activateUpdate: vi.fn().mockResolvedValue(true),
    };

    mockAppRef = {
      isStable: new Subject<boolean>(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AppUpdateService,
        { provide: SwUpdate, useValue: mockSwUpdate },
        { provide: ApplicationRef, useValue: mockAppRef },
      ],
    });

    service = TestBed.inject(AppUpdateService);
  });

  it('should be created and have default states', () => {
    expect(service).toBeTruthy();
    expect(service.isUpdateAvailable()).toBe(false);
    expect(service.isChecking()).toBe(false);
    expect(service.updateDismissed()).toBe(false);
    expect(service.isServiceWorkerEnabled()).toBe(true);
  });

  it('should react to VERSION_READY event', () => {
    const readyEvent: VersionReadyEvent = {
      type: 'VERSION_READY',
      currentVersion: { hash: 'hash-v1' },
      latestVersion: { hash: 'hash-v2' },
    };

    mockSwUpdate.versionUpdates.next(readyEvent);

    expect(service.isUpdateAvailable()).toBe(true);
    expect(service.latestVersion()).toBe('hash-v2');
    expect(service.updateDismissed()).toBe(false);
  });

  it('should dismiss prompt on dismissPrompt()', () => {
    service.dismissPrompt();
    expect(service.updateDismissed()).toBe(true);
  });

  it('should execute checkForUpdate and update lastChecked', async () => {
    const result = await service.checkForUpdate();
    expect(result).toBe(true);
    expect(mockSwUpdate.checkForUpdate).toHaveBeenCalled();
    expect(service.lastChecked()).toBeTruthy();
    expect(service.isChecking()).toBe(false);
  });

  it('should execute applyUpdate and call activateUpdate', async () => {
    await service.applyUpdate();
    expect(mockSwUpdate.activateUpdate).toHaveBeenCalled();
  });
});
