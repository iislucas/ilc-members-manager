import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ThumbnailEditorModalComponent } from '../thumbnail-editor-modal/thumbnail-editor-modal';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageVodEditVideoComponent } from './manage-vod-edit-video';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
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

describe('ManageVodEditVideoComponent', () => {
  let component: ManageVodEditVideoComponent;
  let fixture: ComponentFixture<ManageVodEditVideoComponent>;
  let mockDataService: any;
  let mockRoutingService: any;
  let mockFirebaseState: any;
  let sampleVideos: VideoItem[];
  let sampleSeries: VideoSeries;

  beforeEach(async () => {
    sampleVideos = [
      {
        ...initVideoItem(),
        docId: 'v1',
        title: 'Spinning Hands Practice',
        description: 'Detailed analysis of basic exercises.',
        recordedDate: '2026-03-20',
        vodStatus: VodStatus.Ready,
        accessTier: VodAccessTier.MembersOnly,
        accessTiers: [VodAccessTier.MembersOnly],
        tags: ['spinning', 'form'],
        isPublished: true,
        featured: false,
        durationSeconds: 3600,
      },
      {
        ...initVideoItem(),
        docId: 'v2',
        title: 'Masterclass Part 1',
        description: 'Series episode 1',
        recordedDate: '2026-04-01',
        vodStatus: VodStatus.Ready,
        seriesId: 'series_123',
        seriesTitle: 'Complete Masterclass',
        seriesPartIndex: 1,
        accessTier: VodAccessTier.MembersOnly,
        tags: ['masterclass'],
        isPublished: true,
        durationSeconds: 4200,
      },
    ];

    sampleSeries = {
      seriesId: 'series_123',
      title: 'Complete Masterclass',
      description: 'Full series',
      tags: [],
      videoCount: 1,
      totalDurationSeconds: 4200,
      videos: [sampleVideos[1]],
      accessTier: VodAccessTier.MembersOnly,
      isPublished: true,
    };

    mockDataService = {
      videos: {
        entries: signal(sampleVideos),
        loading: signal(false),
        get: (id: string) => sampleVideos.find((v) => v.docId === id),
      },
      getVideoSeriesList: vi.fn().mockReturnValue([sampleSeries]),
      getVideoById: vi.fn((id: string) => Promise.resolve(sampleVideos.find((v) => v.docId === id) ?? null)),
      updateVideoMetadata: vi.fn().mockResolvedValue(undefined),
      systemTags: signal([]),
      tagsSet: new SearchableSet<'tag', any>(['tag', 'label', 'description'], 'tag', []),
      getTagMeta: vi.fn().mockReturnValue(null),
    };

    mockFirebaseState = {
      app: {},
      user: signal({ isAdmin: true, member: { docId: 'admin1' } }),
    };

    mockRoutingService = {
      signals: {
        [Views.ManageVod]: {
          urlParams: {
            tab: signal('all_videos'),
          },
        },
        [Views.VideoView]: {
          pathVars: {
            videoId: signal(''),
          },
        },
      },
      hrefForView: vi.fn((view: string, params?: Record<string, string>, urlParams?: Record<string, string>) => {
        if (view === Views.ManageVodSeries && params) {
          return `/manage-vod/series/${params['seriesId']}?tab=${urlParams?.['tab'] ?? ''}`;
        }
        if (params && params['videoId']) return `/videos/${params['videoId']}`;
        if (view === Views.ManageVod) {
          return params && params['tab'] ? `/manage-vod?tab=${params['tab']}` : '/manage-vod';
        }
        return `/${view}`;
      }),
      navigateTo: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ManageVodEditVideoComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageVodEditVideoComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('videoId', 'v1');
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form fields from the active video', () => {
    expect(component.title()).toBe('Spinning Hands Practice');
    expect(component.description()).toBe('Detailed analysis of basic exercises.');
    expect(component.recordedDate()).toBe('2026-03-20');
    expect(component.tags()).toEqual(['spinning', 'form']);
    expect(component.freeAccessTier()).toBe(VodAccessTier.MembersOnly);
    expect(component.isPublished()).toBe(true);
    expect(component.featured()).toBe(false);
    expect(component.isInSeries()).toBe(false);
  });

  it('should recognize and populate series video metadata', () => {
    fixture.componentRef.setInput('videoId', 'v2');
    fixture.detectChanges();

    expect(component.title()).toBe('Masterclass Part 1');
    expect(component.seriesTitle()).toBe('Complete Masterclass');
    expect(component.seriesPartIndex()).toBe(1);
    expect(component.isInSeries()).toBe(true);
    expect(component.getSeriesHref()).toBe('/manage-vod/series/series_123?tab=details');
    expect(component.getSeriesHref('overview')).toBe('/manage-vod/series/series_123?tab=overview');
  });

  it('should validate title before saving', async () => {
    component.title.set('   ');
    await component.saveVideoChanges();

    expect(component.errorMessage()).toBe('Video title cannot be empty.');
    expect(mockDataService.updateVideoMetadata).not.toHaveBeenCalled();
  });

  it('should save standalone video changes and stay on the page', async () => {
    component.title.set('Updated Spinning Hands');
    component.recordedDate.set('2026-05-15');
    component.freeAccessTier.set(VodAccessTier.Public);
    component.isBuyable.set(true);
    component.priceDollars.set(19.99);
    component.stripePriceId.set('price_spin_hands');

    await component.saveVideoChanges();

    expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v1', expect.objectContaining({
      title: 'Updated Spinning Hands',
      recordedDate: '2026-05-15',
      accessTier: VodAccessTier.Public,
      isBuyable: true,
      priceCents: 1999,
      stripePriceId: 'price_spin_hands',
    }));

    expect(component.successMessage()).toBe('Video details saved.');
    expect(mockRoutingService.navigateTo).not.toHaveBeenCalled();
  });

  it('should save series video changes properly', async () => {
    fixture.componentRef.setInput('videoId', 'v2');
    fixture.detectChanges();

    component.title.set('Masterclass Part 1 — Revised');
    component.seriesPartIndex.set(2);

    await component.saveVideoChanges();

    expect(mockDataService.updateVideoMetadata).toHaveBeenCalledWith('v2', expect.objectContaining({
      title: 'Masterclass Part 1 — Revised',
      seriesPartIndex: 2,
    }));
    expect(component.successMessage()).toBe('Video details saved.');
  });

  it('should discard unsaved edits and repopulate the form', () => {
    component.title.set('Unsaved title');
    component.featured.set(true);
    component.discardChanges();
    TestBed.flushEffects();
    expect(component.title()).toBe('Spinning Hands Practice');
    expect(component.featured()).toBe(false);
  });

  it('should clear feedback when switching to a different video', async () => {
    await component.saveVideoChanges();
    expect(component.successMessage()).toBe('Video details saved.');
    fixture.componentRef.setInput('videoId', 'v2');
    fixture.detectChanges();
    expect(component.title()).toBe('Masterclass Part 1');
    expect(component.successMessage()).toBeNull();
  });

  it('should pass sprite-sheet inputs to the thumbnail picker', () => {
    sampleVideos[0].spriteSheetUrl = 'https://example.com/sprite.jpg';
    sampleVideos[0].spriteFrameCount = 100;
    component.openThumbnailModal();
    fixture.detectChanges();
    const modal = fixture.debugElement.query(By.directive(ThumbnailEditorModalComponent))
      .componentInstance as ThumbnailEditorModalComponent;
    expect(modal.spriteSheetUrl()).toBe('https://example.com/sprite.jpg');
    expect(modal.spriteFrameCount()).toBe(100);
    expect(modal.spriteWidth()).toBe(160);
  });
});
