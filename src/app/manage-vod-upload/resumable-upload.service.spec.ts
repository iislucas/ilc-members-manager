/* resumable-upload.service.spec.ts
 *
 * Unit tests for ResumableUploadService using official Firebase Storage SDK.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  ResumableUploadService,
  formatUploadSpeed,
  formatEta,
} from './resumable-upload.service';
import { FirebaseStateService } from '../firebase-state.service';
import { signal } from '@angular/core';
import type { UploadTaskSnapshot, StorageError } from 'firebase/storage';

// Mock firebase/storage
const mockTask = {
  on: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
};

const mockStorage = {
  maxUploadRetryTime: 600000,
};

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => mockStorage),
  ref: vi.fn(() => ({})),
  uploadBytesResumable: vi.fn(() => mockTask),
  getDownloadURL: vi.fn().mockResolvedValue('https://download.url/test.mp4'),
}));

describe('ResumableUploadService', () => {
  let service: ResumableUploadService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.maxUploadRetryTime = 600000;

    TestBed.configureTestingModule({
      providers: [
        ResumableUploadService,
        {
          provide: FirebaseStateService,
          useValue: {
            app: {},
            user: signal(null),
          },
        },
      ],
    });

    service = TestBed.inject(ResumableUploadService);
  });

  describe('Formatting utilities', () => {
    it('formats upload speed properly', () => {
      expect(formatUploadSpeed(0)).toBe('');
      expect(formatUploadSpeed(500)).toBe('500 B/s');
      expect(formatUploadSpeed(1024 * 500)).toBe('500 KB/s');
      expect(formatUploadSpeed(1024 * 1024 * 12.4)).toBe('12.4 MB/s');
    });

    it('formats ETA properly', () => {
      expect(formatEta(0)).toBe('');
      expect(formatEta(-10)).toBe('');
      expect(formatEta(45)).toBe('45s left');
      expect(formatEta(90)).toBe('1m 30s left');
      expect(formatEta(3665)).toBe('1h 1m left');
    });
  });

  describe('Upload Configuration & Execution', () => {
    it('sets maxUploadRetryTime to 24 hours on storage instance', () => {
      const storage = service.getStorageInstance();
      expect(storage.maxUploadRetryTime).toBe(24 * 60 * 60 * 1000);
    });

    it('starts uploadVideo and sets up task observers', () => {
      const file = new File(['video-bits'], 'video.mp4', { type: 'video/mp4' });
      const onProgress = vi.fn();

      const result = service.uploadVideo(file, 'members/1/materials/v1', 'item_1', onProgress);
      expect(result.task).toBe(mockTask);
      expect(mockTask.on).toHaveBeenCalledWith(
        'state_changed',
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('emits throttled progress updates on state_changed', () => {
      const file = new File(['video-bits'], 'video.mp4', { type: 'video/mp4' });
      const onProgress = vi.fn();

      service.uploadVideo(file, 'path/video.mp4', 'item_1', onProgress);

      const stateChangedCallback = vi.mocked(mockTask.on).mock.calls[0][1] as (
        snapshot: Partial<UploadTaskSnapshot>,
      ) => void;

      stateChangedCallback({
        bytesTransferred: 500,
        totalBytes: 1000,
        state: 'running',
      });

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          bytesTransferred: 500,
          totalBytes: 1000,
          progressPercent: 50,
          state: 'running',
        }),
      );
    });

    it('resolves promise with download URL on completion', async () => {
      const file = new File(['video-bits'], 'video.mp4', { type: 'video/mp4' });
      const onProgress = vi.fn();

      const { promise } = service.uploadVideo(file, 'path/video.mp4', 'item_1', onProgress);

      const completeCallback = vi.mocked(mockTask.on).mock.calls[0][3] as () => Promise<void>;
      await completeCallback();

      const result = await promise;
      expect(result.downloadUrl).toBe('https://download.url/test.mp4');
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          progressPercent: 100,
          state: 'success',
        }),
      );
    });

    it('rejects promise on storage error', async () => {
      const file = new File(['video-bits'], 'video.mp4', { type: 'video/mp4' });
      const onProgress = vi.fn();

      const { promise } = service.uploadVideo(file, 'path/video.mp4', 'item_1', onProgress);

      const errorCallback = vi.mocked(mockTask.on).mock.calls[0][2] as (err: StorageError) => void;
      const testError = { code: 'storage/canceled', message: 'User canceled' } as StorageError;
      errorCallback(testError);

      await expect(promise).rejects.toEqual(testError);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          progressPercent: 0,
          state: 'error',
        }),
      );
    });

    it('clearSession executes without error', () => {
      expect(() => service.clearSession()).not.toThrow();
    });
  });
});
