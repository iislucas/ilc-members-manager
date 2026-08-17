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
      loading: WritableSignal<boolean>;
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
          featured: WritableSignal<string | null>;
          accessTier: WritableSignal<string | null>;
          instructorId: WritableSignal<string | null>;
          videoId: WritableSignal<string | null>;
          editVideoId: WritableSignal<string | null>;
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
        featured: true,
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
        featured: false,
        durationSeconds: 1800,
        tags: ['partner'],
        lastUpdated: '2026-01-02',
      },
      {
        ...initVideoItem(),
        docId: 'v3',
        title: 'Saturday Class Stream',
        vodStatus: VodStatus.Ready,
        accessTier: VodAccessTier.ClassVideoSubscribers,
        isPublished: true,
        featured: false,
        durationSeconds: 5400,
        tags: ['saturday'],
        lastUpdated: '2026-01-03',
      },
    ];

    mockDataService = {
      videos: {
        entries: signal(sampleVideos),
        loading: signal(false),
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
            featured: signal(null),
            accessTier: signal(null),
            instructorId: signal(null),
            videoId: signal(null),
            editVideoId: signal(null),
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
    fixture.detectChanges();
  });

  it('should create and calculate catalog stats', () => {
    expect(component).toBeTruthy();
    const stats = component.stats();
    expect(stats.total).toBe(3);
    expect(stats.published).toBe(2);
    expect(stats.ready).toBe(2);
    expect(stats.processing).toBe(1);
    expect(stats.totalHours).toBe('3.0');
  });

  it('should filter by featured status', () => {
    // All
    expect(component.filteredVideos().length).toBe(3);

    // Featured only
    component.setFeaturedFilter('featured');
    expect(component.filteredVideos().length).toBe(1);
    expect(component.filteredVideos()[0].docId).toBe('v1');

    // Not featured
    component.setFeaturedFilter('not_featured');
    expect(component.filteredVideos().length).toBe(2);
    expect(component.filteredVideos().map((v) => v.docId)).toEqual(['v3', 'v2']);
  });

  it('should filter by access / permissions tier', () => {
    // Class library
    component.setAccessTierFilter('class_library');
    expect(component.filteredVideos().length).toBe(1);
    expect(component.filteredVideos()[0].docId).toBe('v3');

    // Direct purchase
    component.setAccessTierFilter('direct_purchase');
    expect(component.filteredVideos().length).toBe(1);
    expect(component.filteredVideos()[0].docId).toBe('v2');

    // Public
    component.setAccessTierFilter('public');
    expect(component.filteredVideos().length).toBe(1);
    expect(component.filteredVideos()[0].docId).toBe('v1');
  });

  it('should match featured keyword in search query', () => {
    component.setSearchQuery('featured');
    expect(component.filteredVideos().length).toBe(1);
    expect(component.filteredVideos()[0].docId).toBe('v1');
  });

  it('should clear all filters', () => {
    component.setSearchQuery('sample');
    component.setStatus('ready');
    component.setFeaturedFilter('featured');
    component.setAccessTierFilter('public');
    component.selectedTagFilter.set('basics');

    component.clearAllFilters();

    expect(component.searchQuery()).toBe('');
    expect(component.selectedStatus()).toBe('all');
    expect(component.selectedFeatured()).toBe('all');
    expect(component.selectedAccessTier()).toBe('all');
    expect(component.selectedTagFilter()).toBe('');
  });

  it('should open and close edit modal with URL parameter sync', () => {
    const video = mockDataService.videos.entries()[0];
    component.openEditModal(video);
    expect(component.editingVideo()).toBeTruthy();
    expect(component.editingVideo()?.docId).toBe('v1');
    expect(mockRoutingService.signals.manageVod.urlParams.editVideoId()).toBe('v1');

    component.closeEditModal();
    expect(component.editingVideo()).toBeNull();
    expect(mockRoutingService.signals.manageVod.urlParams.editVideoId()).toBe('');
  });

  it('should auto-open edit modal when editVideoId URL param is present', () => {
    mockRoutingService.signals.manageVod.urlParams.editVideoId.set('v2');
    fixture.detectChanges();
    expect(component.editingVideo()?.docId).toBe('v2');
  });

  it('should save edited video metadata using updateVideoMetadata and clear URL param', async () => {
    const video = mockDataService.videos.entries()[0];
    component.openEditModal(video);
    expect(mockRoutingService.signals.manageVod.urlParams.editVideoId()).toBe('v1');

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
    expect(mockRoutingService.signals.manageVod.urlParams.editVideoId()).toBe('');
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

  it('should open drawer and update videoId in URL, and clear it on close', async () => {
    const video = mockDataService.videos.entries()[1];
    component.openDrawer(video);
    expect(component.drawerVideo()?.docId).toBe('v2');
    expect(mockRoutingService.signals.manageVod.urlParams.videoId()).toBe('v2');

    await component.checkJobStatus('v2');
    expect(mockDataService.checkVodJobStatus).toHaveBeenCalledWith('v2');

    component.closeDrawer();
    expect(component.drawerVideo()).toBeNull();
    expect(mockRoutingService.signals.manageVod.urlParams.videoId()).toBe('');
  });

  it('should auto-open drawer when videoId URL param is present', () => {
    mockRoutingService.signals.manageVod.urlParams.videoId.set('v1');
    fixture.detectChanges();
    expect(component.drawerVideo()?.docId).toBe('v1');
  });

  it('should filter by tag and clear tag filter', () => {
    component.onTagSelected({ tag: 'spinning' });
    expect(component.selectedTagFilter()).toBe('spinning');

    const filtered = component.filteredVideos();
    expect(filtered.length).toBe(1);
    expect(filtered[0].docId).toBe('v1');

    component.clearTagFilter();
    expect(component.selectedTagFilter()).toBe('');
    expect(component.filteredVideos().length).toBe(3);
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
    const video = mockDataService.videos.entries()[1]; // v2 has featured: false
    component.openDrawer(video);
    await component.toggleFeatured(video);
    expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v2', {
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

  it('should display loading state when videos.loading is true', () => {
    mockDataService.videos.loading.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Loading VOD catalog...');
  });

  it('should track deleting status and call deleteVideo on dataService', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let resolveDelete: () => void;
    const deletePromise = new Promise<void>((res) => {
      resolveDelete = res;
    });
    mockDataService.deleteVideo.mockReturnValue(deletePromise);

    const video = mockDataService.videos.entries()[0];
    const deleteOp = component.deleteVideo(video);

    expect(component.isDeleting('v1')).toBe(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const deletingRow = compiled.querySelector('tr.deleting-row');
    expect(deletingRow).toBeTruthy();

    resolveDelete!();
    await deleteOp;

    expect(component.isDeleting('v1')).toBe(false);
    expect(mockDataService.deleteVideo).toHaveBeenCalledWith('v1');
  });

  it('should render supported resolutions in the resolutions column', () => {
    const sampleWithResolutions: VideoItem = {
      ...mockDataService.videos.entries()[0],
      resolutions: ['1080p', '720p', '480p', '360p'],
    };
    mockDataService.videos.entries.set([sampleWithResolutions]);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const resPills = compiled.querySelectorAll('.res-mini-pill');
    expect(resPills.length).toBe(4);
    expect(resPills[0].textContent?.trim()).toBe('1080p');
    expect(resPills[1].textContent?.trim()).toBe('720p');
  });

  it('should format and display date and time added under title and tags without Added prefix', () => {
    const videoWithDate: VideoItem = {
      ...mockDataService.videos.entries()[0],
      createdAt: '2026-05-15T10:30:00Z',
    };
    mockDataService.videos.entries.set([videoWithDate]);
    fixture.detectChanges();

    const formatted = component.formatAddedDate(videoWithDate);
    expect(formatted).toBeTruthy();

    const compiled = fixture.nativeElement as HTMLElement;
    const dateEl = compiled.querySelector('.table-video-date');
    expect(dateEl).toBeTruthy();
    expect(dateEl?.textContent?.trim()).toBe(formatted);
    expect(dateEl?.textContent).not.toContain('Added');
  });
});
