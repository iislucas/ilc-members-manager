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

    mockDataService = {
      videos: {
        entries: signal(sampleVideos),
        loading: signal(false),
        get: (id: string) => sampleVideos.find((v) => v.docId === id),
      },
      getVideoSeriesList: vi.fn().mockReturnValue([sampleSeries]),
      updateVideoSeries: vi.fn().mockResolvedValue(undefined),
    };

    mockRoutingService = {
      signals: {
        [Views.ManageVodEditSeries]: {
          pathVars: {
            seriesId: signal('series-test-1'),
          },
          urlParams: {},
        },
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
      hrefForView: vi.fn((view: string, params?: Record<string, string>) => {
        if (params && params['seriesId']) return `/manage-vod/edit-series/${params['seriesId']}`;
        if (params && params['videoId']) return `/videos/${params['videoId']}`;
        if (view === Views.ManageVod) {
          return params && params['tab'] ? `/manage-vod?tab=${params['tab']}` : '/manage-vod';
        }
        return `/${view}`;
      }),
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
    fixture.detectChanges();
  });

  it('should create and initialize form signals from the seriesId path param', () => {
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

  it('should save series changes and navigate back to ManageVod', async () => {
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

    expect(mockRoutingService.navigateTo).toHaveBeenCalledWith('/manage-vod?tab=series_collections');
  });

  it('should show error message if saving with empty series title', async () => {
    component.seriesTitle.set('   ');
    await component.saveSeriesChanges();

    expect(component.errorMessage()).toBe('Series title cannot be empty.');
    expect(mockDataService.updateVideoSeries).not.toHaveBeenCalled();
  });

  it('should cancel and navigate back to ManageVod', () => {
    component.cancel();
    expect(mockRoutingService.navigateTo).toHaveBeenCalledWith('/manage-vod?tab=series_collections');
  });

  it('should show not found state if seriesId is unknown', () => {
    mockRoutingService.signals[Views.ManageVodEditSeries].pathVars.seriesId.set('nonexistent-id');
    fixture.detectChanges();

    expect(component.series()).toBeNull();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.not-found-state')).toBeTruthy();
  });

  it('should use standard primary-button and subtle-button styles and never put spinner inside button', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

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

    const sections = compiled.querySelectorAll('.series-section');
    expect(sections.length).toBe(3);
    for (const section of Array.from(sections)) {
      expect(section.classList.contains('card')).toBe(false);
    }
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
});
