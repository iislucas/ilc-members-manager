import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageVodEditSeriesComponent } from './manage-vod-edit-series';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import {
  initVideoItem,
  VideoItem,
  VideoSeries,
  VodAccessTier,
  VodStatus,
} from '../../../functions/src/data-model/vod';
import { SearchableSet } from '../searchable-set';

describe('ManageVodEditSeriesComponent', () => {
  let component: ManageVodEditSeriesComponent;
  let fixture: ComponentFixture<ManageVodEditSeriesComponent>;
  let mockDataService: any;
  let mockRoutingService: any;
  let sampleSeries: VideoSeries;
  let sampleVideos: VideoItem[];
  let seriesList: WritableSignal<VideoSeries[]>;

  beforeEach(async () => {
    sampleVideos = [
      {
        ...initVideoItem(),
        docId: 'v1',
        title: 'Episode 1: The Beginning',
        vodStatus: VodStatus.Ready,
        accessTier: VodAccessTier.MembersOnly,
        isPublished: true,
        durationSeconds: 3600,
        seriesId: 'series-test-1',
        seriesPartIndex: 1,
      },
      {
        ...initVideoItem(),
        docId: 'v2',
        title: 'Episode 2: Advanced Concepts',
        vodStatus: VodStatus.Ready,
        accessTier: VodAccessTier.MembersOnly,
        isPublished: true,
        durationSeconds: 2400,
        seriesId: 'series-test-1',
        seriesPartIndex: 2,
      },
      {
        ...initVideoItem(),
        docId: 'v3',
        title: 'Bonus Episode: Applications',
        vodStatus: VodStatus.Ready,
        accessTier: VodAccessTier.Public,
        isPublished: true,
        durationSeconds: 1800,
      },
    ];

    sampleSeries = {
      seriesId: 'series-test-1',
      title: 'Sample Test Series',
      description: 'A comprehensive martial arts series',
      tags: ['internal', 'basics'],
      recordedDate: '2026-04-10',
      videoCount: 2,
      totalDurationSeconds: 6000,
      videos: [sampleVideos[0], sampleVideos[1]],
      priceCents: 4999,
      stripePriceId: 'price_test_series',
      accessTier: VodAccessTier.MembersOnly,
      accessTiers: [VodAccessTier.MembersOnly, VodAccessTier.DirectPurchase],
      isPublished: true,
    };

    seriesList = signal<VideoSeries[]>([sampleSeries]);
    mockDataService = {
      videos: {
        entries: signal(sampleVideos),
        loading: signal(false),
        get: (id: string) => sampleVideos.find((v) => v.docId === id),
      },
      // Like the real service, derive the list from a signal so computeds stay reactive.
      getVideoSeriesList: vi.fn(() => seriesList()),
      updateVideoSeries: vi.fn().mockResolvedValue(undefined),
    };

    mockRoutingService = {
      signals: {
        [Views.ManageVod]: {
          urlParams: {
            tab: signal('series_collections'),
          },
        },
        [Views.VideoView]: {
          pathVars: {
            videoId: signal(''),
          },
        },
      },
      hrefForView: vi.fn(
        (view: string, params?: Record<string, string>, urlParams?: Record<string, string>) => {
          const query = urlParams
            ? '?' + new URLSearchParams(urlParams).toString()
            : '';
          if (view === Views.ManageVodVideo && params && params['videoId']) {
            return `/manage-vod/video/${params['videoId']}${query}`;
          }
          if (params && params['seriesId']) return `/manage-vod/series/${params['seriesId']}`;
          if (params && params['videoId']) return `/videos/${params['videoId']}`;
          if (view === Views.ManageVod) {
            return params && params['tab'] ? `/manage-vod?tab=${params['tab']}` : '/manage-vod';
          }
          return `/${view}`;
        },
      ),
      navigateTo: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ManageVodEditSeriesComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageVodEditSeriesComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('seriesId', 'series-test-1');
    fixture.detectChanges();
  });

  it('should create and initialize form signals from the seriesId input', () => {
    expect(component).toBeTruthy();
    expect(component.seriesId()).toBe('series-test-1');
    expect(component.seriesTitle()).toBe('Sample Test Series');
    expect(component.seriesDescription()).toBe('A comprehensive martial arts series');
    expect(component.seriesPriceDollars()).toBe(49.99);
    expect(component.seriesIsBuyable()).toBe(true);
    expect(component.seriesStripePriceId()).toBe('price_test_series');
    expect(component.seriesVideos().length).toBe(2);
    expect(component.seriesVideos()[0].docId).toBe('v1');
    expect(component.seriesVideos()[1].docId).toBe('v2');
  });

  it('should exclude currently attached series videos from availableVideosForSeries', () => {
    TestBed.flushEffects();
    const available = component.availableVideosForSeries.entries();
    expect(available.some((v) => v.docId === 'v1')).toBe(false);
    expect(available.some((v) => v.docId === 'v2')).toBe(false);
    expect(available.some((v) => v.docId === 'v3')).toBe(true);
  });

  it('should add a video to the series via onVideoSelectedToAdd and addSelectedVideoToSeries', () => {
    const videoToAdd = sampleVideos[2]; // v3
    component.onVideoSelectedToAdd(videoToAdd);
    expect(component.selectedVideoToAdd()).toEqual(videoToAdd);

    component.addSelectedVideoToSeries();
    expect(component.seriesVideos().length).toBe(3);
    expect(component.seriesVideos()[2].docId).toBe('v3');
    expect(component.selectedVideoToAdd()).toBeNull();
  });

  it('should reorder videos up and down', () => {
    // Initial: [v1, v2]
    component.moveSeriesVideoDown(0);
    expect(component.seriesVideos()[0].docId).toBe('v2');
    expect(component.seriesVideos()[1].docId).toBe('v1');

    component.moveSeriesVideoUp(1);
    expect(component.seriesVideos()[0].docId).toBe('v1');
    expect(component.seriesVideos()[1].docId).toBe('v2');
  });

  it('should remove a video from the series', () => {
    component.removeSeriesVideo(0);
    expect(component.seriesVideos().length).toBe(1);
    expect(component.seriesVideos()[0].docId).toBe('v2');
  });

  it('should save series changes and stay on the page with a success message', async () => {
    component.seriesTitle.set('Updated Series Name');
    component.seriesDescription.set('New description');
    component.seriesPriceDollars.set(59.99);
    component.seriesStripePriceId.set('price_new_stripe');
    component.seriesFreeAccessTier.set(VodAccessTier.Public);
    component.seriesHasClassSub.set(true);

    await component.saveSeriesChanges();

    expect(mockDataService.updateVideoSeries).toHaveBeenCalledWith(
      'series-test-1',
      expect.objectContaining({
        title: 'Updated Series Name',
        description: 'New description',
        priceCents: 5999,
        stripePriceId: 'price_new_stripe',
        accessTier: VodAccessTier.Public,
        accessTiers: expect.arrayContaining([VodAccessTier.Public, VodAccessTier.ClassVideoSubscribers, VodAccessTier.DirectPurchase]),
        isPublished: true,
      }),
      ['v1', 'v2'],
    );

    expect(component.successMessage()).toBe('Series details saved.');
    expect(mockRoutingService.navigateTo).not.toHaveBeenCalled();
  });

  it('should show error message if saving with empty series title', async () => {
    component.seriesTitle.set('   ');
    await component.saveSeriesChanges();

    expect(component.errorMessage()).toBe('Series title cannot be empty.');
    expect(mockDataService.updateVideoSeries).not.toHaveBeenCalled();
  });

  it('should discard unsaved edits and repopulate the form from the stored series', () => {
    component.seriesTitle.set('Unsaved edit');
    component.removeSeriesVideo(0);
    component.discardChanges();
    TestBed.flushEffects();
    expect(component.seriesTitle()).toBe('Sample Test Series');
    expect(component.seriesVideos().length).toBe(2);
    expect(mockRoutingService.navigateTo).not.toHaveBeenCalled();
  });

  it('should show not found state if seriesId is unknown', () => {
    fixture.componentRef.setInput('seriesId', 'nonexistent-id');
    fixture.detectChanges();

    expect(component.series()).toBeNull();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.not-found-state')).toBeTruthy();
  });

  it('should use standard primary-button and subtle-button styles and never put spinner inside button', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    // The add button only exists once the add-video panel is unfolded.
    component.addVideoPanelOpen.set(true);
    fixture.detectChanges();
    const addBtn = compiled.querySelector('.add-btn');
    expect(addBtn).toBeTruthy();
    expect(addBtn?.classList.contains('primary-button')).toBe(true);

    const cancelBtn = compiled.querySelector('.series-actions-bar .subtle-button');
    expect(cancelBtn).toBeTruthy();

    const saveBtn = compiled.querySelector('.series-actions-bar .save-btn');
    expect(saveBtn).toBeTruthy();
    expect(saveBtn?.classList.contains('primary-button')).toBe(true);

    // Verify when isSaving is true, spinner replaces button and no button contains app-spinner
    component.isSaving.set(true);
    fixture.detectChanges();

    const spinnerInButton = compiled.querySelector('button app-spinner');
    expect(spinnerInButton).toBeNull();

    const standaloneSpinner = compiled.querySelector('.series-actions-bar app-spinner');
    expect(standaloneSpinner).toBeTruthy();
  });

  it('should remove dark card outlines from sections and use subtle section layout', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    // Details/access section + episodes section (which hosts the add-video panel).
    const sections = compiled.querySelectorAll('.series-section');
    expect(sections.length).toBe(2);
    for (const section of Array.from(sections)) {
      expect(section.classList.contains('card')).toBe(false);
    }
  });

  describe('add-video panel', () => {
    const toggle = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.add-video-toggle')!;
    const panel = () => (fixture.nativeElement as HTMLElement).querySelector('.add-video-panel');

    it('should be collapsed by default with only the "Add a video" button shown', () => {
      expect(panel()).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('app-autocomplete')).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('.add-btn')).toBeNull();
      const btn = toggle();
      expect(btn).toBeTruthy();
      expect(btn.classList.contains('subtle-button')).toBe(true);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(btn.textContent).toContain('Add a video');
    });

    it('should unfold when the + button is clicked and fold again on a second click', () => {
      toggle().click();
      fixture.detectChanges();
      expect(panel()).toBeTruthy();
      expect(panel()!.querySelector('app-autocomplete')).toBeTruthy();
      expect(panel()!.querySelector('.add-btn')).toBeTruthy();
      expect(panel()!.querySelector('#uploadDateFilter')).toBeTruthy();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');

      component.onVideoSelectedToAdd(sampleVideos[2]);
      toggle().click();
      fixture.detectChanges();
      expect(panel()).toBeNull();
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      // Folding drops any pending selection.
      expect(component.selectedVideoToAdd()).toBeNull();
    });

    it('should stay open after adding a video so several can be added', () => {
      toggle().click();
      fixture.detectChanges();
      component.onVideoSelectedToAdd(sampleVideos[2]);
      fixture.detectChanges();
      panel()!.querySelector<HTMLButtonElement>('.add-btn')!.click();
      fixture.detectChanges();
      expect(component.seriesVideos().map((v) => v.docId)).toEqual(['v1', 'v2', 'v3']);
      expect(component.addVideoPanelOpen()).toBe(true);
      expect(panel()).toBeTruthy();
    });

    it('should show the + button under the empty-state notice when there are no episodes', () => {
      component.seriesVideos.set([]);
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('.empty-episodes-notice')).toBeTruthy();
      expect(toggle()).toBeTruthy();
    });
  });

  it('should render a per-episode edit link to the video admin Details tab', () => {
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
        '.episode-item .edit-episode-link',
      ),
    );
    expect(links.length).toBe(2);
    expect(links[0].classList.contains('icon-only-button')).toBe(true);
    expect(links[0].getAttribute('href')).toBe('/manage-vod/video/v1?tab=details');
    expect(links[1].getAttribute('href')).toBe('/manage-vod/video/v2?tab=details');
    expect(links[0].getAttribute('title')).toContain('Edit this video');
    expect(links[0].querySelector('app-icon[name="edit"]')).toBeTruthy();
    expect(mockRoutingService.hrefForView).toHaveBeenCalledWith(
      Views.ManageVodVideo,
      { videoId: 'v1' },
      { tab: 'details' },
    );
  });

  it('should filter available videos by upload date defaulting to 1 month', () => {
    const now = Date.now();
    const recentDate = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
    const oldDate = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

    const testVideos: VideoItem[] = [
      ...sampleVideos,
      {
        ...sampleVideos[2],
        docId: 'v-recent',
        title: 'Recent Upload',
        createdAt: recentDate,
      },
      {
        ...sampleVideos[2],
        docId: 'v-old',
        title: 'Old Upload',
        createdAt: oldDate,
      },
    ];

    mockDataService.videos.entries.set(testVideos);
    TestBed.flushEffects();

    // Default filter is 1_month
    expect(component.uploadDateFilterOption()).toBe('1_month');
    let availableIds = component.availableVideosForSeries.entries().map((v) => v.docId);
    expect(availableIds).toContain('v-recent');
    expect(availableIds).not.toContain('v-old');

    // Change filter to all time
    component.setUploadDateFilterOption('all');
    TestBed.flushEffects();
    availableIds = component.availableVideosForSeries.entries().map((v) => v.docId);
    expect(availableIds).toContain('v-recent');
    expect(availableIds).toContain('v-old');

    // Change filter to custom date between recent and old
    const midwayDate = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    component.setUploadDateFilterOption('custom');
    component.setCustomUploadDate(midwayDate);
    TestBed.flushEffects();
    availableIds = component.availableVideosForSeries.entries().map((v) => v.docId);
    expect(availableIds).toContain('v-recent');
    expect(availableIds).not.toContain('v-old');
  });

  it('should clear feedback when switching to a different series', async () => {
    await component.saveSeriesChanges();
    expect(component.successMessage()).toBe('Series details saved.');
    const other: VideoSeries = { ...sampleSeries, seriesId: 'series-test-2', title: 'Other Series' };
    seriesList.set([sampleSeries, other]);
    fixture.componentRef.setInput('seriesId', 'series-test-2');
    fixture.detectChanges();
    expect(component.seriesTitle()).toBe('Other Series');
    expect(component.successMessage()).toBeNull();
  });
});
