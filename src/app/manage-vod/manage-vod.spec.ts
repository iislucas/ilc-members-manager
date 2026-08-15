/* manage-vod.spec.ts
 *
 * Unit tests for ManageVodComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageVodComponent } from './manage-vod';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { initVideoItem, VideoItem, VodAccessTier, VodStatus, TagItem } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { signal, WritableSignal, computed } from '@angular/core';

describe('ManageVodComponent', () => {
  let component: ManageVodComponent;
  let fixture: ComponentFixture<ManageVodComponent>;
  let mockDataService: {
    videos: {
      entries: WritableSignal<VideoItem[]>;
      get: (id: string) => VideoItem | undefined;
    };
    tagsSet: SearchableSet<'tag', TagItem>;
    getTagMeta: ReturnType<typeof vi.fn>;
    getTagDescription: ReturnType<typeof vi.fn>;
    updateVideoMetadata: ReturnType<typeof vi.fn>;
    deleteVideo: ReturnType<typeof vi.fn>;
    transcodeVideoForVod: ReturnType<typeof vi.fn>;
    checkVodJobStatus: ReturnType<typeof vi.fn>;
  };
  let mockFirebaseState: {
    user: WritableSignal<{ isAdmin: boolean; member: { docId: string } } | null>;
  };
  let mockRoutingService: {
    signals: {
      manageVod: {
        urlParams: {
          q: WritableSignal<string | null>;
          status: WritableSignal<string | null>;
        };
      };
    };
    hrefForView: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const sampleVideos: VideoItem[] = [
      {
        ...initVideoItem(),
        docId: 'v1',
        title: 'Sample Video 1',
        vodStatus: VodStatus.Ready,
        accessTier: VodAccessTier.Public,
        isPublished: true,
        durationSeconds: 3600,
        tags: ['basics', 'spinning'],
        lastUpdated: '2026-01-01',
      },
      {
        ...initVideoItem(),
        docId: 'v2',
        title: 'Sample Video 2',
        vodStatus: VodStatus.Transcoding,
        accessTier: VodAccessTier.DirectPurchase,
        priceCents: 1500,
        isPublished: false,
        durationSeconds: 1800,
        tags: ['partner'],
        lastUpdated: '2026-01-02',
      },
    ];

    mockDataService = {
      videos: {
        entries: signal(sampleVideos),
        get: (id: string) => sampleVideos.find((v) => v.docId === id),
      },
      tagsSet: new SearchableSet<'tag', TagItem>(['tag', 'label', 'description'], 'tag', [
        { tag: 'basics', description: 'Foundational drills' },
        { tag: 'spinning', description: 'Circular energy exercises' },
        { tag: 'partner', description: '' },
      ]),
      getTagMeta: vi.fn((tag: string) => {
        if (tag === 'spinning') return { tag: 'spinning', description: 'Circular energy exercises', createdAt: '', lastUpdated: '' };
        if (tag === 'basics') return { tag: 'basics', description: 'Foundational drills', createdAt: '', lastUpdated: '' };
        return undefined;
      }),
      getTagDescription: vi.fn((tag: string) => {
        if (tag === 'spinning') return 'Circular energy exercises';
        if (tag === 'basics') return 'Foundational drills';
        return '';
      }),
      updateVideoMetadata: vi.fn().mockResolvedValue(undefined),
      deleteVideo: vi.fn().mockResolvedValue(undefined),
      transcodeVideoForVod: vi.fn().mockResolvedValue({ success: true }),
      checkVodJobStatus: vi.fn().mockResolvedValue({
        success: true,
        videoId: 'v2',
        vodStatus: VodStatus.Ready,
      }),
    };

    mockFirebaseState = {
      user: signal({ isAdmin: true, member: { docId: 'admin1' } }),
    };

    mockRoutingService = {
      signals: {
        manageVod: {
          urlParams: {
            q: signal(null),
            status: signal(null),
          },
        },
      },
      hrefForView: vi.fn().mockReturnValue('/videos/v1'),
    };

    await TestBed.configureTestingModule({
      imports: [ManageVodComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageVodComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should calculate stats correctly', () => {
    const stats = component.stats();
    expect(stats.total).toBe(2);
    expect(stats.published).toBe(1);
    expect(stats.ready).toBe(1);
    expect(stats.processing).toBe(1);
    expect(stats.totalHours).toBe('1.5');
  });

  it('should open and close edit modal', () => {
    const video = mockDataService.videos.entries()[0];
    component.openEditModal(video);
    expect(component.editingVideo()).toBeTruthy();
    expect(component.editingVideo()?.docId).toBe('v1');

    component.closeEditModal();
    expect(component.editingVideo()).toBeNull();
  });

  it('should save edited video metadata using updateVideoMetadata', async () => {
    const video = mockDataService.videos.entries()[0];
    component.openEditModal(video);
    component.editTags.set(['spinning', 'form']);
    component.editIsBuyable.set(true);
    component.priceDollars.set(25.00);

    await component.saveVideoChanges();
    expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v1', expect.objectContaining({
      tags: ['spinning', 'form'],
      isBuyable: true,
      priceCents: 2500,
    }));
    expect(component.editingVideo()).toBeNull();
  });

  it('should toggle access tiers in edit modal', () => {
    const video = mockDataService.videos.entries()[0];
    component.openEditModal(video);

    expect(component.isAccessTierSelected(VodAccessTier.MembersOnly)).toBe(true);
    component.toggleAccessTier(VodAccessTier.InstructorsOnly);
    expect(component.isAccessTierSelected(VodAccessTier.InstructorsOnly)).toBe(true);

    component.toggleAccessTier(VodAccessTier.InstructorsOnly);
    expect(component.isAccessTierSelected(VodAccessTier.InstructorsOnly)).toBe(false);
  });

  it('should format access tier summary correctly', () => {
    const video1 = {
      ...mockDataService.videos.entries()[0],
      accessTiers: [VodAccessTier.InstructorsOnly, VodAccessTier.ClassVideoSubscribers],
      isBuyable: true,
      priceCents: 2000,
    };
    expect(component.getAccessTiersSummary(video1)).toBe('Instructors • Class Subscribers • Buy ($20.00)');
  });

  it('should toggle published / listed status', async () => {
    const video = mockDataService.videos.entries()[0];
    await component.togglePublished(video);
    expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v1', {
      isPublished: false,
    });
  });

  it('should open drawer and check job status', async () => {
    const video = mockDataService.videos.entries()[1];
    component.openDrawer(video);
    expect(component.drawerVideo()?.docId).toBe('v2');

    await component.checkJobStatus('v2');
    expect(mockDataService.checkVodJobStatus).toHaveBeenCalledWith('v2');

    component.closeDrawer();
    expect(component.drawerVideo()).toBeNull();
  });

  it('should filter by tag and clear tag filter', () => {
    component.onTagSelected({ tag: 'spinning' });
    expect(component.selectedTagFilter()).toBe('spinning');

    const filtered = component.filteredVideos();
    expect(filtered.length).toBe(1);
    expect(filtered[0].docId).toBe('v1');

    component.clearTagFilter();
    expect(component.selectedTagFilter()).toBe('');
    expect(component.filteredVideos().length).toBe(2);
  });

  it('should format access tier labels correctly', () => {
    expect(component.getAccessTierLabel(VodAccessTier.Public)).toBe('Public (Free)');
    expect(component.getAccessTierLabel(VodAccessTier.DirectPurchase, 1500)).toBe('Direct Purchase ($15.00)');
    expect(component.getAccessTierLabel(VodAccessTier.MembersOnly)).toBe('Members Only');
  });

  it('should return correct tag tooltips with descriptions', () => {
    expect(component.getTagTooltip('spinning')).toBe('#spinning: Circular energy exercises');
    expect(component.getTagTooltip('partner')).toBe('Filter by #partner');
  });

  it('should toggle featured status', async () => {
    const video = mockDataService.videos.entries()[0];
    component.openDrawer(video);
    await component.toggleFeatured(video);
    expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v1', {
      featured: true,
    });
    expect(component.drawerVideo()?.featured).toBe(true);
  });

  it('should handle quality presets and resolution selection', () => {
    const video = mockDataService.videos.entries()[0];
    component.openDrawer(video);

    expect(component.selectedQualityPreset()).toBe('full');
    expect(component.selectedResolutions()).toEqual(['1080p', '720p', '480p', '360p']);

    component.applyQualityPreset('hd');
    expect(component.selectedQualityPreset()).toBe('hd');
    expect(component.selectedResolutions()).toEqual(['1080p', '720p']);

    component.toggleResolution('4K (2160p)');
    expect(component.isResolutionSelected('4K (2160p)')).toBe(true);
    expect(component.selectedQualityPreset()).toBe('custom');
  });

  it('should trigger transcodeAtQuality with selected resolutions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    const video = mockDataService.videos.entries()[0];
    component.openDrawer(video);
    component.applyQualityPreset('4k');

    await component.transcodeAtQuality(video);
    expect(mockDataService.transcodeVideoForVod).toHaveBeenCalledWith(
      video.sourceUploadDocId,
      video.sourceMemberDocId,
      expect.objectContaining({
        resolutions: ['2160p (4K)', '1080p', '720p', '480p'],
      }),
    );
  });

  it('should copy text to clipboard and set feedback', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });

    component.copyToClipboard('https://example.com/manifest.m3u8', 'Manifest URL');
    expect(writeTextSpy).toHaveBeenCalledWith('https://example.com/manifest.m3u8');
  });
});
