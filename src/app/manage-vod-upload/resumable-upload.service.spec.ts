/* resumable-upload.service.spec.ts
 *
 * Unit tests for ResumableUploadService.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  ResumableUploadService,
  formatUploadSpeed,
  formatEta,
  getUploadSessionKey,
} from './resumable-upload.service';
import { FirebaseStateService } from '../firebase-state.service';
import { signal } from '@angular/core';

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
  _UploadTask: class {},
  _FbsBlob: class {},
}));

describe('ResumableUploadService', () => {
  let service: ResumableUploadService;

  beforeEach(() => {
    localStorage.clear();
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

    it('generates consistent upload session keys', () => {
      const file = new File(['data'], 'test.mp4', { type: 'video/mp4' });
      const key = getUploadSessionKey(file);
      expect(key).toContain('ilc_resumable_upload_test.mp4_4');
    });
  });

  describe('Session Storage', () => {
    it('saves, retrieves, and clears upload sessions in localStorage', () => {
      const file = new File(['content'], 'sample.mp4', { type: 'video/mp4' });
      const session = {
        uploadUrl: 'https://gcs.session/123',
        storagePath: 'path/to/sample.mp4',
        uploadItemId: 'item_123',
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        createdAt: Date.now(),
      };

      expect(service.getSavedSession(file)).toBeNull();

      service.saveSession(file, session);
      const retrieved = service.getSavedSession(file);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.uploadUrl).toBe('https://gcs.session/123');

      service.clearSession(file);
      expect(service.getSavedSession(file)).toBeNull();
    });

    it('expires stale sessions older than 7 days', () => {
      const file = new File(['content'], 'old.mp4', { type: 'video/mp4' });
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const session = {
        uploadUrl: 'https://gcs.session/old',
        storagePath: 'path/old.mp4',
        uploadItemId: 'item_old',
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        createdAt: eightDaysAgo,
      };

      service.saveSession(file, session);
      expect(service.getSavedSession(file)).toBeNull();
    });
  });

  describe('Upload Configuration', () => {
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
  });
});
