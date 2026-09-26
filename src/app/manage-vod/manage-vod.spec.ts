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
import { initVideoItem, VideoItem, VideoSeries, VodAccessTier, VodStatus, TagItem } from '../../../functions/src/data-model/vod';
import { initMailSettings } from '../../../functions/src/data-model/mail';
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
    members: SearchableSet<'memberId', any>;
    mailSettings: WritableSignal<any>;
    getMemberByMemberId: ReturnType<typeof vi.fn>;
    grantVideoAccess: ReturnType<typeof vi.fn>;
    getVideoById: ReturnType<typeof vi.fn>;
    tagsSet: SearchableSet<'tag', TagItem>;
    getTagMeta: ReturnType<typeof vi.fn>;
    getTagDescription: ReturnType<typeof vi.fn>;
    updateVideoMetadata: ReturnType<typeof vi.fn>;
    getVideoSeriesList: ReturnType<typeof vi.fn<() => VideoSeries[]>>;
    updateVideoSeries: ReturnType<typeof vi.fn>;
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
          year: WritableSignal<string | null>;
          instructorId: WritableSignal<string | null>;
          videoId: WritableSignal<string | null>;
          editVideoId: WritableSignal<string | null>;
          grantVideoId: WritableSignal<string | null>;
          grantSeriesId: WritableSignal<string | null>;
          tab: WritableSignal<string | null>;
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
        recordedDate: '2026-03-20',
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
        recordedDate: '2025-11-15',
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
        recordedDate: '2024-05-10',
        lastUpdated: '2026-01-03',
      },
    ];

    const sampleSeries: VideoSeries = {
      seriesId: 'series-1',
      title: 'Sample Series 1',
      description: 'A great series',
      tags: ['basics'],
      recordedDate: '2026-03-20',
      videoCount: 2,
      totalDurationSeconds: 5400,
      videos: [sampleVideos[0], sampleVideos[1]],
      isPublished: true,
    };

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
      getVideoSeriesList: vi.fn().mockReturnValue([sampleSeries]),
      updateVideoSeries: vi.fn().mockResolvedValue(undefined),
      deleteVideo: vi.fn().mockResolvedValue(undefined),
      transcodeVideoForVod: vi.fn().mockResolvedValue({ success: true }),
      checkVodJobStatus: vi.fn().mockResolvedValue({
        success: true,
        videoId: 'v2',
        vodStatus: VodStatus.Ready,
      }),
      members: new SearchableSet(['name'], 'memberId'),
      mailSettings: signal(initMailSettings()),
      getMemberByMemberId: vi.fn(),
      grantVideoAccess: vi.fn().mockResolvedValue({
        success: true,
        grantedCount: 1,
        recipientEmail: 'test@example.com',
      }),
      getVideoById: vi.fn((id: string) => Promise.resolve(mockDataService.videos.get(id))),
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
            year: signal(null),
            instructorId: signal(null),
            videoId: signal(null),
            editVideoId: signal(null),
            grantVideoId: signal<string | null>(null),
            grantSeriesId: signal<string | null>(null),
            tab: signal<string | null>(null),
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
    component.setYearFilter('2025');
    component.selectedTagFilter.set('basics');

    component.clearAllFilters();

    expect(component.searchQuery()).toBe('');
    expect(component.selectedStatus()).toBe('all');
    expect(component.selectedFeatured()).toBe('all');
    expect(component.selectedAccessTier()).toBe('all');
    expect(component.selectedYear()).toBe('all');
    expect(component.selectedTagFilter()).toBe('');
  });

  it('should compute availableYears sorted descending', () => {
    expect(component.availableYears()).toEqual(['2026', '2025', '2024']);
  });

  it('should search videos by recordedDate in search query', () => {
    component.setSearchQuery('2025');
    expect(component.filteredVideos().length).toBe(1);
    expect(component.filteredVideos()[0].docId).toBe('v2');

    component.setSearchQuery('2026-03');
    expect(component.filteredVideos().length).toBe(1);
    expect(component.filteredVideos()[0].docId).toBe('v1');
  });

  it('should filter videos by selectedYear', () => {
    component.setYearFilter('2024');
    expect(component.filteredVideos().length).toBe(1);
    expect(component.filteredVideos()[0].docId).toBe('v3');
  });

  it('should search series by recordedDate or constituent episode recordedDate', () => {
    // v2 has recordedDate '2025-11-15' and is an episode of sampleSeries
    component.setSearchQuery('2025');
    expect(component.filteredSeries().length).toBe(1);
    expect(component.filteredSeries()[0].seriesId).toBe('series-1');

    component.setSearchQuery('1999');
    expect(component.filteredSeries().length).toBe(0);
  });

  it('should filter series by selectedYear', () => {
    component.setYearFilter('2026');
    expect(component.filteredSeries().length).toBe(1);
    expect(component.filteredSeries()[0].seriesId).toBe('series-1');

    // Neither sampleSeries nor any of its episodes has 2024 (only v3 has 2024, not in series)
    component.setYearFilter('2024');
    expect(component.filteredSeries().length).toBe(0);
  });

  it('should edit and save recordedDate in edit modal', async () => {
    const video = mockDataService.videos.entries()[0];
    component.openEditModal(video);
    expect(component.editRecordedDate()).toBe('2026-03-20');

    component.editRecordedDate.set('2026-04-15');
    await component.saveVideoChanges();

    expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v1', expect.objectContaining({
      recordedDate: '2026-04-15',
    }));
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
    component.setViewMode('all_videos');
    mockDataService.videos.loading.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Loading VOD catalog...');
  });

  it('should track deleting status and call deleteVideo on dataService', async () => {
    component.setViewMode('all_videos');
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
    component.setViewMode('all_videos');
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
    component.setViewMode('all_videos');
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

  it('should open and close the grant modal for a video and sync URL params', () => {
    const video = mockDataService.videos.entries()[0];
    component.openGrantModal(video);
    expect(component.grantingVideo()).toEqual(video);
    expect(component.grantingSeries()).toBeNull();
    expect(mockRoutingService.signals.manageVod.urlParams.grantVideoId()).toBe('v1');
    expect(mockRoutingService.signals.manageVod.urlParams.grantSeriesId()).toBe('');

    component.closeGrantModal();
    expect(component.grantingVideo()).toBeNull();
    expect(mockRoutingService.signals.manageVod.urlParams.grantVideoId()).toBe('');
    expect(mockRoutingService.signals.manageVod.urlParams.grantSeriesId()).toBe('');
  });

  it('should open and close the grant modal for a series and sync URL params', () => {
    const series = mockDataService.getVideoSeriesList()[0];
    component.openGrantSeriesModal(series);
    expect(component.grantingSeries()).toEqual(series);
    expect(component.grantingVideo()).toBeNull();
    expect(mockRoutingService.signals.manageVod.urlParams.grantSeriesId()).toBe('series-1');
    expect(mockRoutingService.signals.manageVod.urlParams.grantVideoId()).toBe('');

    component.closeGrantModal();
    expect(component.grantingSeries()).toBeNull();
    expect(mockRoutingService.signals.manageVod.urlParams.grantSeriesId()).toBe('');
    expect(mockRoutingService.signals.manageVod.urlParams.grantVideoId()).toBe('');
  });

  it('should default to series_collections viewMode and sync tab changes with URL', () => {
    expect(component.viewMode()).toBe('series_collections');

    component.setViewMode('all_videos');
    expect(component.viewMode()).toBe('all_videos');
    expect(mockRoutingService.signals.manageVod.urlParams.tab()).toBe('all_videos');

    component.setViewMode('series_collections');
    expect(component.viewMode()).toBe('series_collections');
    expect(mockRoutingService.signals.manageVod.urlParams.tab()).toBe('series_collections');
  });

  it('should open grant modal when grantVideoId URL param is present on deep link', async () => {
    mockRoutingService.signals.manageVod.urlParams.grantVideoId.set('v2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.grantingVideo()?.docId).toBe('v2');
  });

  it('should open grant modal when grantSeriesId URL param is present on deep link', async () => {
    mockRoutingService.signals.manageVod.urlParams.grantSeriesId.set('series-1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.grantingSeries()?.seriesId).toBe('series-1');
  });

  describe('Series Autocomplete Filter', () => {
    it('should initialize seriesFilterSet with standalone option and available series', () => {
      fixture.detectChanges();
      const entries = component.seriesFilterSet.entries();
      expect(entries.length).toBe(2);
      expect(entries[0].seriesId).toBe('no_series');
      expect(entries[1].seriesId).toBe('series-1');
      expect(component.seriesFilterDisplayFns.toName(entries[0])).toContain('Standalone Only (No Series)');
      expect(component.seriesFilterDisplayFns.toName(entries[1])).toBe('Sample Series 1 (2 parts)');
    });

    it('should select a series via onSeriesFilterSelected and update signals', () => {
      const series = mockDataService.getVideoSeriesList()[0];
      component.onSeriesFilterSelected(series);

      expect(component.selectedSeriesFilter()).toBe('series-1');
      expect(component.selectedSeriesSearchTerm()).toBe('Sample Series 1 (2 parts)');
    });

    it('should select standalone videos via setSeriesFilter and update signals', () => {
      component.setSeriesFilter('no_series');

      expect(component.selectedSeriesFilter()).toBe('no_series');
      expect(component.selectedSeriesSearchTerm()).toContain('Standalone Only (No Series)');
    });

    it('should reset series filter to all when search text is emptied', () => {
      const series = mockDataService.getVideoSeriesList()[0];
      component.onSeriesFilterSelected(series);
      expect(component.selectedSeriesFilter()).toBe('series-1');

      component.onSeriesFilterTextUpdated('');
      expect(component.selectedSeriesFilter()).toBe('all');
      expect(component.selectedSeriesSearchTerm()).toBe('');
    });

    it('should clear series filter when clearSeriesFilter is called', () => {
      component.setSeriesFilter('series-1');
      expect(component.selectedSeriesFilter()).toBe('series-1');

      component.clearSeriesFilter();
      expect(component.selectedSeriesFilter()).toBe('all');
      expect(component.selectedSeriesSearchTerm()).toBe('');
    });

    it('should clear series filter when clearAllFilters is called', () => {
      component.setSeriesFilter('series-1');
      component.clearAllFilters();

      expect(component.selectedSeriesFilter()).toBe('all');
      expect(component.selectedSeriesSearchTerm()).toBe('');
    });

    it('should filter videos correctly by series and standalone', () => {
      const videosWithSeries: VideoItem[] = [
        { ...initVideoItem(), docId: 'v1', seriesId: 'series-1', title: 'Video in Series' },
        { ...initVideoItem(), docId: 'v2', seriesId: undefined, title: 'Standalone Video' },
      ];
      mockDataService.videos.entries.set(videosWithSeries);
      fixture.detectChanges();

      component.setSeriesFilter('series-1');
      expect(component.filteredVideos().map((v) => v.docId)).toEqual(['v1']);

      component.setSeriesFilter('no_series');
      expect(component.filteredVideos().map((v) => v.docId)).toEqual(['v2']);

      component.clearSeriesFilter();
      expect(component.filteredVideos().length).toBe(2);
    });

    it('should filter series collections list when series filter is applied', () => {
      component.setSeriesFilter('series-1');
      expect(component.filteredSeries().map((s) => s.seriesId)).toEqual(['series-1']);

      component.setSeriesFilter('no_series');
      expect(component.filteredSeries()).toEqual([]);

      component.clearSeriesFilter();
      expect(component.filteredSeries().length).toBe(1);
    });
  });

  describe('Edit Series Modal', () => {
    it('should populate edit fields when openSeriesModal is called', () => {
      const series = mockDataService.getVideoSeriesList()[0];
      component.openSeriesModal(series);

      expect(component.editingSeries()?.seriesId).toBe('series-1');
      expect(component.editingSeriesTitle()).toBe('Sample Series 1');
      expect(component.editingSeriesDescription()).toBe('A great series');
      expect(component.editingSeriesVideos().length).toBe(2);
      expect(component.isSeriesAccessTierSelected(VodAccessTier.MembersOnly)).toBe(true);
    });

    it('should call updateVideoSeries with trimmed values, access tiers, and close modal on saveSeriesChanges', async () => {
      const series = mockDataService.getVideoSeriesList()[0];
      component.openSeriesModal(series);

      component.editingSeriesTitle.set('  Updated Series Title  ');
      component.editingSeriesDescription.set('  Updated Description  ');
      component.editingSeriesIsBuyable.set(true);
      component.editingSeriesPriceDollars.set(29.99);
      component.editingSeriesStripePriceId.set('price_series_1');
      component.toggleSeriesAccessTier(VodAccessTier.InstructorsOnly);

      // Also set series filter to this series
      component.setSeriesFilter('series-1');

      // Setup drawer video for one of the videos in series
      component.drawerVideo.set({ ...series.videos[0] });

      // When updateVideoSeries completes, mock updated video item returned by get()
      const updatedV1 = { ...series.videos[0], seriesTitle: 'Updated Series Title' };
      mockDataService.videos.get = vi.fn().mockReturnValue(updatedV1);

      await component.saveSeriesChanges();

      expect(mockDataService.updateVideoSeries).toHaveBeenCalledWith(
        'series-1',
        {
          title: 'Updated Series Title',
          description: 'Updated Description',
          priceCents: 2999,
          stripePriceId: 'price_series_1',
          accessTier: VodAccessTier.InstructorsOnly,
          accessTiers: [VodAccessTier.InstructorsOnly, VodAccessTier.DirectPurchase],
          isPublished: true,
        },
        ['v1', 'v2'],
      );

      expect(component.editingSeries()).toBeNull();
      expect(component.selectedSeriesFilter()).toBe('series-1');
      expect(component.drawerVideo()?.seriesTitle).toBe('Updated Series Title');
    });

    it('should identify when an edited video is in a series and navigate to series edit', () => {
      const videoInSeries: VideoItem = {
        ...initVideoItem(),
        docId: 'v-ep-1',
        title: 'Episode 1',
        seriesId: 'series-1',
        seriesTitle: 'Sample Series 1',
        seriesPartIndex: 1,
      };

      component.openEditModal(videoInSeries);
      expect(component.editingVideoInSeries()).toBe(true);

      component.openSeriesFromVideoEdit(videoInSeries);
      expect(component.editingVideo()).toBeNull();
      expect(component.editingSeries()?.seriesId).toBe('series-1');
    });

    it('should save episode metadata without stripePriceId undefined when video is in a series', async () => {
      const videoInSeries: VideoItem = {
        ...initVideoItem(),
        docId: 'v-ep-2',
        title: 'Episode 2',
        seriesId: 'series-1',
        seriesTitle: 'Sample Series 1',
        seriesPartIndex: 2,
        isPublished: true,
      };

      component.openEditModal(videoInSeries);
      component.editingVideo.update((v) => v ? { ...v, title: 'Episode 2 - Updated' } : null);

      await component.saveVideoChanges();

      expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v-ep-2', expect.objectContaining({
        title: 'Episode 2 - Updated',
        seriesId: 'series-1',
      }));
      const lastCallArg = (mockDataService.updateVideoMetadata as ReturnType<typeof vi.fn>).mock.calls.at(-1)[1];
      expect('stripePriceId' in lastCallArg).toBe(false);
      expect('priceCents' in lastCallArg).toBe(false);
    });
  });

  describe('Free Access & Class Subscription Chips & Selection', () => {
    it('should resolve free access tiers correctly following member hierarchy', () => {
      const publicItem = { accessTiers: [VodAccessTier.Public] };
      expect(component.getFreeAccessTier(publicItem)).toBe(VodAccessTier.Public);
      expect(component.getFreeAccessLabel(publicItem)).toBe('Public');

      const memberItem = { accessTiers: [VodAccessTier.MembersOnly] };
      expect(component.getFreeAccessTier(memberItem)).toBe(VodAccessTier.MembersOnly);
      expect(component.getFreeAccessLabel(memberItem)).toBe('Members');

      const instructorItem = { accessTiers: [VodAccessTier.InstructorsOnly] };
      expect(component.getFreeAccessTier(instructorItem)).toBe(VodAccessTier.InstructorsOnly);
      expect(component.getFreeAccessLabel(instructorItem)).toBe('Instructors');

      const adminItem = { accessTiers: [VodAccessTier.AdminOnly] };
      expect(component.getFreeAccessTier(adminItem)).toBe(VodAccessTier.AdminOnly);
      expect(component.getFreeAccessLabel(adminItem)).toBe('Admin only');

      const paidOnlyItem = { accessTiers: [VodAccessTier.DirectPurchase] };
      expect(component.getFreeAccessTier(paidOnlyItem)).toBe(VodAccessTier.AdminOnly);
      expect(component.getFreeAccessLabel(paidOnlyItem)).toBe('Admin only');
    });

    it('should check class video subscriber access independently', () => {
      const withClassSub = { accessTiers: [VodAccessTier.MembersOnly, VodAccessTier.ClassVideoSubscribers] };
      expect(component.hasClassSubscription(withClassSub)).toBe(true);

      const withoutClassSub = { accessTiers: [VodAccessTier.MembersOnly] };
      expect(component.hasClassSubscription(withoutClassSub)).toBe(false);
    });

    it('should toggle series published status via toggleSeriesPublished', async () => {
      const series = mockDataService.getVideoSeriesList()[0];
      await component.toggleSeriesPublished(series);

      expect(mockDataService.updateVideoSeries).toHaveBeenCalledWith(
        'series-1',
        { isPublished: false },
        ['v1', 'v2'],
      );
    });

    it('should render showing/not showing status chip and free access chip in series card', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      const seriesCard = compiled.querySelector('.series-manage-card');
      expect(seriesCard).toBeTruthy();

      const publishedPill = seriesCard?.querySelector('.published-pill');
      expect(publishedPill).toBeTruthy();
      expect(publishedPill?.textContent?.trim()).toBe('Listed');

      const freePills = seriesCard?.querySelectorAll('.tier-pill');
      expect(freePills?.length).toBeGreaterThan(0);
      const freeLabel = freePills?.[0]?.textContent?.trim();
      expect(['Public', 'Members', 'Instructors', 'Admin only']).toContain(freeLabel);
    });

    it('should render free access chip and class subscriber chip in video listing table', () => {
      component.setViewMode('all_videos');
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      const tableRows = compiled.querySelectorAll('.vod-table tbody tr');
      expect(tableRows.length).toBeGreaterThan(0);

      const firstRowTiers = tableRows[0].querySelector('.tier-info');
      expect(firstRowTiers).toBeTruthy();
      const freeChip = firstRowTiers?.querySelector('.tier-pill');
      expect(freeChip).toBeTruthy();
    });

    it('should display "Who can view it for free" heading in Edit Series and Edit Video modals', () => {
      const series = mockDataService.getVideoSeriesList()[0];
      component.openSeriesModal(series);
      fixture.detectChanges();
      let compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Who can view it for free');

      component.closeSeriesModal();
      const video = mockDataService.videos.entries()[0];
      component.openEditModal(video);
      fixture.detectChanges();
      compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Who can view it for free');
    });

    it('should save series with updated free access tier and separate class subscription', async () => {
      const series = mockDataService.getVideoSeriesList()[0];
      component.openSeriesModal(series);

      component.editingSeriesFreeAccessTier.set(VodAccessTier.Public);
      component.editingSeriesHasClassSub.set(true);
      component.editingSeriesIsBuyable.set(false);

      await component.saveSeriesChanges();

      expect(mockDataService.updateVideoSeries).toHaveBeenCalledWith(
        'series-1',
        expect.objectContaining({
          accessTier: VodAccessTier.Public,
          accessTiers: [VodAccessTier.Public, VodAccessTier.ClassVideoSubscribers],
        }),
        ['v1', 'v2'],
      );
    });

    it('should save standalone video with updated free access tier and separate class subscription', async () => {
      const video = mockDataService.videos.entries()[1]; // v2
      component.openEditModal(video);

      component.editFreeAccessTier.set(VodAccessTier.InstructorsOnly);
      component.editHasClassSub.set(true);

      await component.saveVideoChanges();

      expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith(
        'v2',
        expect.objectContaining({
          accessTier: VodAccessTier.InstructorsOnly,
          accessTiers: expect.arrayContaining([
            VodAccessTier.InstructorsOnly,
            VodAccessTier.ClassVideoSubscribers,
          ]),
        }),
      );
    });
  });
});

