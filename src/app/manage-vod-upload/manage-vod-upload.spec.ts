/* manage-vod-upload.spec.ts
 *
 * Unit tests for ManageVodUploadComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageVodUploadComponent } from './manage-vod-upload';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import {
  initVideoItem,
  VideoItem,
  VideoSeries,
  VodAccessTier,
  VodStatus,
} from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { signal, WritableSignal } from '@angular/core';

// Mock image-utils
vi.mock('../image-utils', () => ({
  makeThumbnail: vi.fn().mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' })),
}));

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn().mockReturnValue({}),
  ref: vi.fn().mockReturnValue({}),
  uploadBytes: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.googleapis.com/test-url'),
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

    await TestBed.configureTestingModule({
      imports: [ManageVodUploadComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
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
  });

  it('should validate before uploading and call storage & transcodeVideoForVod', async () => {
    const file1 = new File(['fake-1'], 'episode_1.mp4', { type: 'video/mp4' });
    await component.addFiles([file1]);

    component.seriesTitle.set('Test Series Title');
    component.seriesPriceDollars.set(39.99);

    await component.startUploadAndTranscode();

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
  });
});
