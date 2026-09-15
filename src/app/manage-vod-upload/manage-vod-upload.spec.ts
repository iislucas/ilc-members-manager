/* manage-vod-upload.spec.ts
 *
 * Unit tests for ManageVodUploadComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageVodUploadComponent, UploadFileEntry } from './manage-vod-upload';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { initVideoItem, VideoItem, VideoSeries, VodAccessTier, VodStatus } from '../../../functions/src/data-model/vod';
import { SearchableSet } from '../searchable-set';
import { signal, WritableSignal } from '@angular/core';
import { ResumableUploadService } from './resumable-upload.service';

// Mock image-utils
vi.mock('../image-utils', () => ({
  makeThumbnail: vi.fn().mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' })),
}));

const { MockTask } = vi.hoisted(() => {
  class MockTask {
    on = vi.fn((event: string, onNext?: any, onError?: any, onComplete?: any) => {
      if (onComplete) {
        setTimeout(() => onComplete(), 0);
      }
    });
    pause = vi.fn();
    resume = vi.fn();
    cancel = vi.fn();
  }
  return { MockTask };
});

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn().mockReturnValue({ maxUploadRetryTime: 600000 }),
  ref: vi.fn().mockReturnValue({}),
  uploadBytes: vi.fn().mockResolvedValue({}),
  uploadBytesResumable: vi.fn().mockReturnValue(new MockTask()),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.googleapis.com/test-url'),
  _UploadTask: MockTask,
  _FbsBlob: class {},
}));

describe('ManageVodUploadComponent', () => {
  let component: ManageVodUploadComponent;
  let fixture: ComponentFixture<ManageVodUploadComponent>;

  let mockDataService: {
    videos: {
      entries: WritableSignal<VideoItem[]>;
      get: (id: string) => VideoItem | undefined;
    };
    instructors: SearchableSet<'instructorId', any>;
    getRecentEvents: ReturnType<typeof vi.fn>;
    getVideoSeriesList: ReturnType<typeof vi.fn>;
    createUploadItem: ReturnType<typeof vi.fn>;
    transcodeVideoForVod: ReturnType<typeof vi.fn>;
  };

  let mockFirebaseState: {
    user: WritableSignal<any>;
    app: any;
  };

  let mockRoutingService: {
    hrefForView: ReturnType<typeof vi.fn>;
  };

  let mockResumableService: {
    getStorageInstance: ReturnType<typeof vi.fn>;
    getSavedSession: ReturnType<typeof vi.fn>;
    saveSession: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    uploadVideo: ReturnType<typeof vi.fn>;
  };

  const sampleSeries: VideoSeries[] = [
    {
      seriesId: 'series_123',
      title: 'Existing Series Title',
      description: 'Existing series description',
      priceCents: 4999,
      tags: ['basics'],
      videoCount: 2,
      totalDurationSeconds: 7200,
      videos: [
        { ...initVideoItem(), docId: 'v1', seriesPartIndex: 1, title: 'Part 1' },
        { ...initVideoItem(), docId: 'v2', seriesPartIndex: 2, title: 'Part 2' },
      ],
    },
  ];

  beforeEach(async () => {
    localStorage.clear();

    mockDataService = {
      videos: {
        entries: signal([]),
        get: vi.fn(),
      },
      instructors: new SearchableSet<'instructorId', any>(['name', 'instructorId'], 'instructorId', []),
      tagsSet: new SearchableSet<'tag', any>(['tag', 'label', 'description'], 'tag', []),
      getRecentEvents: vi.fn().mockResolvedValue([]),
      getVideoSeriesList: vi.fn().mockReturnValue(sampleSeries),
      createUploadItem: vi.fn().mockResolvedValue('upload_item_123'),
      transcodeVideoForVod: vi.fn().mockResolvedValue({ success: true, videoId: 'upload_item_123', vodStatus: VodStatus.Queued }),
    };

    mockFirebaseState = {
      user: signal({
        isAdmin: true,
        member: { docId: 'admin_doc_id', memberId: 'ADMIN-001', name: 'Admin User' },
        uid: 'admin_uid',
      }),
      app: {},
    };

    mockRoutingService = {
      hrefForView: vi.fn().mockReturnValue('#/manage-vod'),
    };

    const taskInstance = new MockTask();
    mockResumableService = {
      getStorageInstance: vi.fn().mockReturnValue({ maxUploadRetryTime: 24 * 60 * 60 * 1000 }),
      getSavedSession: vi.fn().mockReturnValue(null),
      saveSession: vi.fn(),
      clearSession: vi.fn(),
      uploadVideo: vi.fn().mockImplementation((file, storagePath, uploadItemId, onProgress) => {
        onProgress({
          bytesTransferred: file.size,
          totalBytes: file.size,
          progressPercent: 100,
          uploadSpeed: '15 MB/s',
          eta: '',
          state: 'success',
        });
        return {
          task: taskInstance,
          promise: Promise.resolve({ downloadUrl: 'https://storage.googleapis.com/test-url' }),
        };
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ManageVodUploadComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: ResumableUploadService, useValue: mockResumableService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageVodUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should initialize with default new_series mode and preset settings', () => {
    expect(component).toBeTruthy();
    expect(component.uploadMode()).toBe('new_series');
    expect(component.seriesPriceDollars()).toBe(49.99);
    expect(component.selectedQualityPreset()).toBe('full');
    expect(component.fileEntries().length).toBe(0);
  });

  it('should switch upload mode correctly', () => {
    component.setUploadMode('standalone');
    expect(component.uploadMode()).toBe('standalone');

    component.setUploadMode('existing_series');
    expect(component.uploadMode()).toBe('existing_series');
  });

  it('should populate metadata when selecting existing series', () => {
    component.onExistingSeriesSelected('series_123');
    expect(component.seriesTitle()).toBe('Existing Series Title');
    expect(component.seriesDescription()).toBe('Existing series description');
    expect(component.seriesPriceDollars()).toBe(49.99);
  });

  it('should add video files and calculate part numbers', async () => {
    const file1 = new File(['fake-video-content-1'], 'part_1_intro.mp4', { type: 'video/mp4' });
    const file2 = new File(['fake-video-content-2'], 'part_2_advanced.mp4', { type: 'video/mp4' });

    await component.addFiles([file1, file2]);

    expect(component.fileEntries().length).toBe(2);
    expect(component.fileEntries()[0].partIndex).toBe(1);
    expect(component.fileEntries()[1].partIndex).toBe(2);
  });

  it('should detect existing resumable session when adding files', async () => {
    mockResumableService.getSavedSession.mockReturnValueOnce({
      uploadUrl: 'https://gcs.resumable.url',
      storagePath: 'path/to/part_1.mp4',
      uploadItemId: 'saved_item_id_1',
      fileName: 'part_1.mp4',
      fileSize: 100,
      fileLastModified: 12345,
      createdAt: Date.now(),
    });

    const file = new File(['fake'], 'part_1.mp4', { type: 'video/mp4' });
    await component.addFiles([file]);

    expect(component.fileEntries().length).toBe(1);
    expect(component.fileEntries()[0].hasSavedSession).toBe(true);
    expect(component.fileEntries()[0].uploadItemId).toBe('saved_item_id_1');
  });

  it('should allow reordering files up and down', async () => {
    const file1 = new File(['fake-1'], 'first.mp4', { type: 'video/mp4' });
    const file2 = new File(['fake-2'], 'second.mp4', { type: 'video/mp4' });

    await component.addFiles([file1, file2]);

    expect(component.fileEntries()[0].file.name).toBe('first.mp4');
    expect(component.fileEntries()[1].file.name).toBe('second.mp4');

    // Move second file up
    component.moveFileUp(1);
    expect(component.fileEntries()[0].file.name).toBe('second.mp4');
    expect(component.fileEntries()[1].file.name).toBe('first.mp4');
    expect(component.fileEntries()[0].partIndex).toBe(1);
    expect(component.fileEntries()[1].partIndex).toBe(2);
  });

  it('should allow removing files and recalculates indices', async () => {
    const file1 = new File(['fake-1'], 'first.mp4', { type: 'video/mp4' });
    const file2 = new File(['fake-2'], 'second.mp4', { type: 'video/mp4' });

    await component.addFiles([file1, file2]);
    const firstId = component.fileEntries()[0].id;

    component.removeFile(firstId);
    expect(component.fileEntries().length).toBe(1);
    expect(component.fileEntries()[0].file.name).toBe('second.mp4');
    expect(component.fileEntries()[0].partIndex).toBe(1);
    expect(mockResumableService.clearSession).toHaveBeenCalledWith(file1);
  });

  it('should pause and resume active uploads', async () => {
    const file = new File(['video'], 'episode.mp4', { type: 'video/mp4' });
    await component.addFiles([file]);

    const task = new MockTask();
    const entry = component.fileEntries()[0];
    entry.status = 'uploading';
    entry.uploadTask = task as any;

    component.pauseUpload(entry);
    expect(task.pause).toHaveBeenCalled();
    expect(entry.status).toBe('paused');

    component.resumeUpload(entry);
    expect(task.resume).toHaveBeenCalled();
    expect(entry.status).toBe('uploading');
  });

  it('should execute resumable upload and trigger transcodeVideoForVod', async () => {
    const file1 = new File(['fake-1'], 'episode_1.mp4', { type: 'video/mp4' });
    await component.addFiles([file1]);

    component.seriesTitle.set('Test Series Title');
    component.seriesPriceDollars.set(39.99);

    await component.startUploadAndTranscode();

    expect(mockResumableService.uploadVideo).toHaveBeenCalled();
    expect(mockDataService.createUploadItem).toHaveBeenCalled();
    expect(mockDataService.transcodeVideoForVod).toHaveBeenCalledWith(
      'upload_item_123',
      'admin_doc_id',
      expect.objectContaining({
        seriesTitle: 'Test Series Title',
        seriesPriceCents: 3999,
        seriesPartIndex: 1,
        isBuyable: true,
      }),
    );
    expect(component.uploadComplete()).toBe(true);
    expect(component.fileEntries()[0].status).toBe('done');
  });
});
