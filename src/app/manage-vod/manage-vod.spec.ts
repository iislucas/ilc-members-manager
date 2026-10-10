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

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn().mockReturnValue({}),
  ref: vi.fn().mockReturnValue({}),
  uploadBytes: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.googleapis.com/thumb_new.jpg'),
}));

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
    app: any;
  };
  let mockRoutingService: {
    signals: {
      manageVod: {
        urlParams: {
          q: WritableSignal<string | null>;
          status: WritableSignal<string | null>;
          featured: WritableSignal<string | null>;
          accessTier: WritableSignal<string | null>;
          listing: WritableSignal<string | null>;
          year: WritableSignal<string | null>;
          instructorId: WritableSignal<string | null>;
          videoId: WritableSignal<string | null>;
          grantVideoId: WritableSignal<string | null>;
          grantSeriesId: WritableSignal<string | null>;
          tab: WritableSignal<string | null>;
        };
      };
    };
    hrefForView: ReturnType<typeof vi.fn>;
    navigateTo: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const sampleVideos: VideoItem[] = [
      {
        ...initVideoItem(),
        docId: 'v1',
        title: 'Sample Video 1',
        vodStatus: VodStatus.Ready,
        accessTier: VodAccessTier.Public,
        accessTiers: [VodAccessTier.Public],
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
        accessTiers: [VodAccessTier.DirectPurchase],
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
        accessTiers: [VodAccessTier.ClassVideoSubscribers],
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
      accessTier: VodAccessTier.MembersOnly,
      accessTiers: [VodAccessTier.MembersOnly],
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
      app: {},
    };

    mockRoutingService = {
      signals: {
        manageVod: {
          urlParams: {
            q: signal(null),
            status: signal(null),
            featured: signal(null),
            accessTier: signal(null),
            listing: signal(null),
            year: signal(null),
            instructorId: signal(null),
            videoId: signal(null),
            grantVideoId: signal<string | null>(null),
            grantSeriesId: signal<string | null>(null),
            tab: signal<string | null>(null),
          },
        },
      },
      // Produces distinguishable hrefs per view, e.g.
      // `/manageVodSeries?seriesId=series-1&tab=access`. Mirrors the real
      // signature: hrefForView(view, pathVars?, urlParams?).
      hrefForView: vi.fn(
        (view: string, pathVars: Record<string, string> = {}, urlParams: Record<string, string> = {}) => {
          const query = new URLSearchParams({ ...pathVars, ...urlParams }).toString();
          return query ? `/${view}?${query}` : `/${view}`;
        },
      ),
      navigateTo: vi.fn(),
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
      expect(component.hasFreeAccess(adminItem)).toBe(false);

      const paidOnlyItem = { accessTiers: [VodAccessTier.DirectPurchase] };
      expect(component.getFreeAccessTier(paidOnlyItem)).toBe(VodAccessTier.AdminOnly);
      expect(component.getFreeAccessLabel(paidOnlyItem)).toBe('Admin only');
      expect(component.hasFreeAccess(paidOnlyItem)).toBe(false);

      expect(component.hasFreeAccess(publicItem)).toBe(true);
      expect(component.hasFreeAccess(memberItem)).toBe(true);
      expect(component.hasFreeAccess(instructorItem)).toBe(true);
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

    it('should render Listed/Unlisted chip and free access chip in series card, omitting Admin only chip', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      const seriesCard = compiled.querySelector('.series-manage-card');
      expect(seriesCard).toBeTruthy();

      const publishedPill = seriesCard?.querySelector('.published-pill');
      expect(publishedPill).toBeTruthy();
      expect(publishedPill?.textContent?.trim()).toBe('Listed');
      expect(publishedPill?.classList.contains('listed')).toBe(true);

      const freePills = seriesCard?.querySelectorAll('.tier-pill.free');
      expect(freePills?.length).toBe(1);
      expect(freePills?.[0]?.textContent?.trim()).toBe('Members');

      // Admin only chip must not be rendered
      const adminOnlyPill = seriesCard?.querySelector('.tier-pill.admin-only');
      expect(adminOnlyPill).toBeNull();
      expect(seriesCard?.textContent).not.toContain('Admin only');
    });

    it('should render free access chip, class subscriber chip, and Listed/Unlisted pill without Admin only chip in video table', () => {
      component.setViewMode('all_videos');
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      const tableRows = compiled.querySelectorAll('.vod-table tbody tr');
      expect(tableRows.length).toBeGreaterThanOrEqual(3);

      // Row 0: v3 (ClassVideoSubscribers, Listed, lastUpdated 2026-01-03)
      const row0Tiers = tableRows[0].querySelector('.tier-info');
      expect(row0Tiers?.querySelector('.tier-pill.free')).toBeNull();
      expect(row0Tiers?.querySelector('.tier-pill.admin-only')).toBeNull();
      expect(row0Tiers?.textContent).not.toContain('Admin only');
      expect(row0Tiers?.querySelector('.tier-pill.class-sub')?.textContent?.trim()).toBe('Class Video Subscribers');
      const row0PubPill = tableRows[0].querySelector('.published-pill');
      expect(row0PubPill?.textContent?.trim()).toBe('Listed');

      // Row 1: v2 (DirectPurchase, Unlisted, lastUpdated 2026-01-02) - should NOT render Admin only chip
      const row1Tiers = tableRows[1].querySelector('.tier-info');
      expect(row1Tiers?.querySelector('.tier-pill.free')).toBeNull();
      expect(row1Tiers?.querySelector('.tier-pill.admin-only')).toBeNull();
      expect(row1Tiers?.textContent).not.toContain('Admin only');
      expect(row1Tiers?.querySelector('.tier-pill.paid')?.textContent?.trim()).toBe('Buy ($15.00)');
      const row1PubPill = tableRows[1].querySelector('.published-pill');
      expect(row1PubPill?.textContent?.trim()).toBe('Unlisted');
      expect(row1PubPill?.classList.contains('unlisted')).toBe(true);

      // Row 2: v1 (Public, Listed, lastUpdated 2026-01-01)
      const row2Tiers = tableRows[2].querySelector('.tier-info');
      expect(row2Tiers?.querySelector('.tier-pill.free')?.textContent?.trim()).toBe('Public');
      expect(row2Tiers?.querySelector('.tier-pill.admin-only')).toBeNull();
      expect(row2Tiers?.textContent).not.toContain('Admin only');
      const row2PubPill = tableRows[2].querySelector('.published-pill');
      expect(row2PubPill?.textContent?.trim()).toBe('Listed');
    });
  });

  describe('Listing and Access Search & Filter Options', () => {
    it('should filter videos and series by listing filter (listed vs unlisted)', () => {
      // Listed filter
      component.setListingFilter('listed');
      expect(component.selectedListing()).toBe('listed');
      expect(component.filteredVideos().every((v) => v.isPublished)).toBe(true);
      expect(component.filteredSeries().every((s) => s.isPublished)).toBe(true);

      // Unlisted filter
      component.setListingFilter('unlisted');
      expect(component.selectedListing()).toBe('unlisted');
      expect(component.filteredVideos().every((v) => !v.isPublished)).toBe(true);
      expect(component.filteredSeries().every((s) => !s.isPublished)).toBe(true);

      // Reset
      component.setListingFilter('all');
      expect(component.filteredVideos().length).toBe(3);
    });

    it('should search listed and unlisted videos and series via free-text search query', () => {
      component.setSearchQuery('unlisted');
      expect(component.filteredVideos().map((v) => v.docId)).toContain('v2');
      expect(component.filteredVideos().map((v) => v.docId)).not.toContain('v1');

      component.setSearchQuery('listed');
      expect(component.filteredVideos().map((v) => v.docId)).toContain('v1');
      expect(component.filteredVideos().map((v) => v.docId)).not.toContain('v2');

      component.setSearchQuery('');
    });

    it('should reset listing filter when clearAllFilters is called', () => {
      component.setListingFilter('unlisted');
      expect(component.selectedListing()).toBe('unlisted');

      component.clearAllFilters();
      expect(component.selectedListing()).toBe('all');
    });

    it('should filter videos and series by aligned access tier options', () => {
      // Public / Free Access
      component.setAccessTierFilter('public');
      expect(component.filteredVideos().some((v) => v.docId === 'v1')).toBe(true);
      expect(component.filteredVideos().some((v) => v.docId === 'v2')).toBe(false);

      // Class Video Library
      component.setAccessTierFilter('class_library');
      expect(component.filteredVideos().some((v) => v.docId === 'v3')).toBe(true);
      expect(component.filteredVideos().some((v) => v.docId === 'v1')).toBe(false);

      // Direct Purchase
      component.setAccessTierFilter('direct_purchase');
      expect(component.filteredVideos().some((v) => v.docId === 'v2')).toBe(true);

      // Reset
      component.setAccessTierFilter('all');
    });

    it('should render listing-chip class with listed and unlisted styles', () => {
      component.setViewMode('all_videos');
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      const chips = compiled.querySelectorAll('.listing-chip');
      expect(chips.length).toBeGreaterThan(0);
      expect(compiled.querySelector('.listing-chip.listed')).toBeTruthy();
      expect(compiled.querySelector('.listing-chip.unlisted')).toBeTruthy();
    });
  });

  describe('Thumbnail Customization', () => {
    it('should open and close the thumbnail customization modal for a video', () => {
      const video = mockDataService.videos.entries()[0];
      component.openThumbnailModalForVideo(video);
      expect(component.thumbnailModalVideo()).toBe(video);

      component.closeThumbnailModal();
      expect(component.thumbnailModalVideo()).toBeNull();
    });

    it('should upload thumbnail to Cloud Storage and update metadata when thumbnail is selected', async () => {
      const video = mockDataService.videos.entries()[0];
      component.openThumbnailModalForVideo(video);

      const newBlob = new Blob(['thumb-bytes'], { type: 'image/jpeg' });
      await component.onVideoThumbnailSelected({
        blob: newBlob,
        previewUrl: 'blob:mock-url',
        width: 1280,
        height: 720,
      });

      expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v1', {
        thumbnailUrl: 'https://storage.googleapis.com/thumb_new.jpg',
      });
      expect(component.thumbnailModalVideo()).toBeNull();
    });
  });

  describe('Links to dedicated video & series pages', () => {
    it('should render series card links to the series overview, details and access tabs', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const seriesCard = compiled.querySelector('.series-manage-card');
      expect(seriesCard).toBeTruthy();

      const titleLink = seriesCard?.querySelector('.series-title-row h4 a.inline-link-button');
      expect(titleLink?.getAttribute('href')).toBe('/manageVodSeries?seriesId=series-1&tab=overview');
      expect(titleLink?.textContent?.trim()).toBe('Sample Series 1');

      const actionLinks = Array.from(
        seriesCard?.querySelectorAll<HTMLAnchorElement>('.series-actions-col a') ?? [],
      );
      const editLink = actionLinks.find((a) => a.textContent?.includes('Edit Series'));
      const accessLink = actionLinks.find((a) => a.textContent?.includes('Who has access'));
      expect(editLink?.getAttribute('href')).toBe('/manageVodSeries?seriesId=series-1&tab=details');
      expect(accessLink?.getAttribute('href')).toBe('/manageVodSeries?seriesId=series-1&tab=access');
    });

    it('should link episode edit icons to the video page details tab', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const episodeLinks = Array.from(
        compiled.querySelectorAll<HTMLAnchorElement>('.episode-actions a[title^="Edit episode"]'),
      );
      expect(episodeLinks.map((a) => a.getAttribute('href'))).toEqual([
        '/manageVodVideo?videoId=v1&tab=details',
        '/manageVodVideo?videoId=v2&tab=details',
      ]);
    });

    it('should link video titles to the video overview and the actions menu to details and access tabs', () => {
      component.setViewMode('all_videos');
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      const titleLinks = Array.from(
        compiled.querySelectorAll<HTMLAnchorElement>('.vod-table a.video-title'),
      );
      expect(titleLinks.map((a) => a.getAttribute('href'))).toContain('/manageVodVideo?videoId=v1&tab=overview');

      component.activeMenuVideoId.set('v1');
      fixture.detectChanges();
      const menuLinks = Array.from(
        compiled.querySelectorAll<HTMLAnchorElement>('.actions-menu a.menu-item'),
      ).map((a) => a.getAttribute('href'));
      expect(menuLinks).toContain('/manageVodVideo?videoId=v1&tab=details');
      expect(menuLinks).toContain('/manageVodVideo?videoId=v1&tab=access');
    });

    it('should not open the drawer when the video title link is clicked', () => {
      component.setViewMode('all_videos');
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const titleLink = compiled.querySelector<HTMLAnchorElement>('.vod-table a.video-title');
      expect(titleLink).toBeTruthy();
      // Prevent jsdom from attempting navigation.
      titleLink?.addEventListener('click', (e) => e.preventDefault());
      titleLink?.click();
      expect(component.drawerVideo()).toBeNull();

      const metaCell = compiled.querySelector<HTMLElement>('.vod-table td.meta-cell .video-sub-row');
      metaCell?.click();
      expect(component.drawerVideo()).toBeTruthy();
    });
  });
});

