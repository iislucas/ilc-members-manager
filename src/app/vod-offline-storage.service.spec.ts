/* vod-offline-storage.service.spec.ts
 *
 * Unit tests for VodOfflineStorageService.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { VodOfflineStorageService } from './vod-offline-storage.service';
import { initVideoItem } from '../../functions/src/data-model';

describe('VodOfflineStorageService', () => {
  let service: VodOfflineStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [VodOfflineStorageService],
    });
    service = TestBed.inject(VodOfflineStorageService);
  });

  it('should create the service', () => {
    expect(service).toBeTruthy();
  });

  it('should format bytes accurately', () => {
    expect(service.formatBytes(0)).toBe('0 B');
    expect(service.formatBytes(1024)).toBe('1.0 KB');
    expect(service.formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB');
    expect(service.formatBytes(1024 * 1024 * 1024 * 2)).toBe('2.0 GB');
  });

  it('should correctly track offline video map and status', () => {
    expect(service.isVideoSavedOffline('vid1')).toBe(false);

    service.offlineVideosMap.set({
      vid1: {
        videoId: 'vid1',
        bytes: 1024 * 1024 * 40,
        chunkCount: 20,
        savedAt: new Date().toISOString(),
      },
    });

    expect(service.isVideoSavedOffline('vid1')).toBe(true);
    expect(service.getVideoOfflineSize('vid1')).toBe(1024 * 1024 * 40);
  });

  it('should handle cancel download gracefully', () => {
    service.cancelOfflineDownload('vid2');
    const prog = service.getProgress('vid2');
    expect(prog?.status).toBe('cancelled');
  });
});
