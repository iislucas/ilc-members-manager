/* videos-catalog.spec.ts
 *
 * Unit tests for VideosCatalogComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VideosCatalogComponent } from './videos-catalog';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { initVideoItem, InstructorPublicData, VideoItem, VodAccessTier } from '../../../functions/src/data-model';
import { signal, WritableSignal } from '@angular/core';

describe('VideosCatalogComponent', () => {
  let component: VideosCatalogComponent;
  let fixture: ComponentFixture<VideosCatalogComponent>;
  let mockDataService: {
    videos: {
      entries: WritableSignal<VideoItem[]>;
      search: ReturnType<typeof vi.fn>;
    };
    instructors: {
      entries: WritableSignal<InstructorPublicData[]>;
      search: ReturnType<typeof vi.fn>;
    };
    getMyVideoProgressList: ReturnType<typeof vi.fn>;
    getMyVideoGrants: ReturnType<typeof vi.fn>;
    getTagMeta: ReturnType<typeof vi.fn>;
  };
  let mockFirebaseState: {
    user: WritableSignal<any>;
  };
  let mockRoutingService: {
    matchedPatternId: ReturnType<typeof vi.fn>;
    signals: {
      videos: {
        urlParams: {
          tab: WritableSignal<string | null>;
          q: WritableSignal<string | null>;
          tag: WritableSignal<string | null>;
          instructorId: WritableSignal<string | null>;
          sortBy: WritableSignal<string | null>;
          sortDir: WritableSignal<string | null>;
        };
      };
      class_video_library: {
        urlParams: {
          q: WritableSignal<string | null>;
          tag: WritableSignal<string | null>;
          instructorId: WritableSignal<string | null>;
          sortBy: WritableSignal<string | null>;
          sortDir: WritableSignal<string | null>;
        };
      };
    };
    hrefForView: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockDataService = {
      videos: {
        entries: signal([
          {
            ...initVideoItem(),
            docId: 'v1',
            title: 'Zhong Xin Dao Fundamentals',
            accessTier: VodAccessTier.Public,
            isPublished: true,
            isBuyable: true,
            priceCents: 2500,
            durationSeconds: 1800,
            tags: ['basics', 'footwork'],
            recordedDate: '2026-01-15',
          },
          {
            ...initVideoItem(),
            docId: 'v2',
            title: 'Advanced Sticky Hands',
            accessTier: VodAccessTier.MembersOnly,
            isPublished: true,
            isBuyable: true,
            priceCents: 4900,
            durationSeconds: 5400,
            tags: ['advanced', 'sticky hands'],
            recordedDate: '2026-03-20',
          },
          {
            ...initVideoItem(),
            docId: 'v3',
            title: 'Saturday Class: Neutral Point Mechanics',
            accessTier: VodAccessTier.ClassVideoSubscribers,
            accessTiers: [VodAccessTier.ClassVideoSubscribers],
            isPublished: true,
            isBuyable: false,
            durationSeconds: 3600,
            tags: ['saturday', 'neutral point'],
            recordedDate: '2026-04-10',
          },
          {
            ...initVideoItem(),
            docId: 'v-trailer',
            title: 'Trailer: Advanced Sticky Hands',
            accessTier: VodAccessTier.Public,
            isPublished: true,
            isTrailer: true,
            durationSeconds: 90,
          },
        ]),
        search: vi.fn().mockReturnValue([]),
      },
      instructors: {
        entries: signal([]),
        search: vi.fn().mockReturnValue([]),
      },
      tagsSet: {
        search: vi.fn().mockReturnValue([]),
        uniqueEntries: vi.fn().mockReturnValue([]),
      },
      myVideoGrants: {
        entries: signal([]),
      },
      getMyVideoProgressList: vi.fn().mockResolvedValue([]),
      getMyVideoGrants: vi.fn().mockResolvedValue([]),
      getTagMeta: vi.fn().mockReturnValue(null),
    };

    mockFirebaseState = {
      user: signal(null),
    };

    mockRoutingService = {
      matchedPatternId: vi.fn().mockReturnValue(Views.Videos),
      signals: {
        videos: {
          urlParams: {
            tab: signal('all'),
            q: signal(null),
            tag: signal(null),
            instructorId: signal(null),
            sortBy: signal('recordedDate'),
            sortDir: signal('desc'),
          },
        },
        class_video_library: {
          urlParams: {
            q: signal(null),
            tag: signal(null),
            instructorId: signal(null),
            sortBy: signal('recordedDate'),
            sortDir: signal('desc'),
          },
        },
      },
      hrefForView: vi.fn().mockReturnValue('/videos/v1'),
    };

    await TestBed.configureTestingModule({
      imports: [VideosCatalogComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VideosCatalogComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should format duration properly', () => {
    expect(component.formatDuration(0)).toBe('0 min');
    expect(component.formatDuration(1800)).toBe('30m');
    expect(component.formatDuration(5400)).toBe('1h 30m');
  });

  it('should extract available tags from published non-trailer videos', () => {
    const tags = component.availableTags();
    expect(tags).toContain('basics');
    expect(tags).toContain('footwork');
    expect(tags).toContain('advanced');
    expect(tags).toContain('sticky hands');
  });

  it('should exclude standalone trailers from filtered catalog list', () => {
    const videos = component.filteredVideos();
    const trailer = videos.find((v) => v.docId === 'v-trailer');
    expect(trailer).toBeUndefined();
  });

  it('should filter to class video library subscribers when in class_library mode', () => {
    fixture.componentRef.setInput('mode', 'class_library');
    fixture.detectChanges();

    const videos = component.filteredVideos();
    expect(videos.length).toBe(1);
    expect(videos[0].docId).toBe('v3');
    expect(videos[0].title).toContain('Saturday Class');
  });

  it('should return appropriate access tier badge', () => {
    const pubVideo = { ...initVideoItem(), accessTier: VodAccessTier.Public, accessTiers: [VodAccessTier.Public] };
    const pubBadge = component.getTopAccessTierBadge(pubVideo);
    expect(pubBadge?.label).toBe('Free');
    expect(pubBadge?.cssClass).toBe('badge-public');

    const classVideo = { ...initVideoItem(), accessTier: VodAccessTier.ClassVideoSubscribers, accessTiers: [VodAccessTier.ClassVideoSubscribers] };
    const classBadge = component.getTopAccessTierBadge(classVideo);
    expect(classBadge?.label).toBe('Class Subs');
    expect(classBadge?.cssClass).toBe('badge-class');

    // Direct purchase videos should have null top badge (skip buy tag and price at top)
    const buyVideo = { ...initVideoItem(), docId: 'v1', isBuyable: true, priceCents: 4999, accessTier: VodAccessTier.DirectPurchase, accessTiers: [VodAccessTier.DirectPurchase] };
    expect(component.getTopAccessTierBadge(buyVideo)).toBeNull();

    // On My Videos tab: should show Purchased
    component.setTab('my-videos');
    const myVideosBadge = component.getAccessTierBadge(buyVideo);
    expect(myVideosBadge.label).toBe('Purchased');
    expect(myVideosBadge.cssClass).toBe('badge-purchased');
  });

  it('should evaluate userHasAccess correctly', () => {
    const pubVideo = { ...initVideoItem(), accessTier: VodAccessTier.Public };
    const memVideo = { ...initVideoItem(), accessTier: VodAccessTier.MembersOnly };

    // Unauthenticated user
    expect(component.userHasAccess(pubVideo)).toBe(true);
    expect(component.userHasAccess(memVideo)).toBe(false);

    // Authenticated member with video grant
    mockFirebaseState.user.set({
      isAdmin: false,
      member: {
        docId: 'm1',
      },
    });
    mockDataService.myVideoGrants.entries.set([{ docId: 'v2', videoId: 'v2' } as any]);
    const grantedVideo = { ...initVideoItem(), docId: 'v2', accessTier: VodAccessTier.DirectPurchase };
    expect(component.userHasAccess(grantedVideo)).toBe(true);
  });

  it('should format video date from recordedDate, createdAt, or publishedAt', () => {
    const videoWithRecorded = { ...initVideoItem(), recordedDate: '2026-04-10' };
    expect(component.formatVideoDate(videoWithRecorded)).toContain('2026');
    expect(component.formatVideoDate(videoWithRecorded)).toContain('Apr');

    const videoWithCreated = { ...initVideoItem(), recordedDate: '', createdAt: '2025-11-20T10:00:00Z' };
    expect(component.formatVideoDate(videoWithCreated)).toContain('2025');
    expect(component.formatVideoDate(videoWithCreated)).toContain('Nov');

    const videoWithoutDate = { ...initVideoItem(), recordedDate: '', createdAt: '', publishedAt: '' };
    expect(component.formatVideoDate(videoWithoutDate)).toBe('');
  });

  it('should count only purchased videos for My Videos and exclude class library videos', () => {
    // v1 is buyable, v2 is buyable ($25), v3 is class video library ($0)
    // Initially no grants
    expect(component.myPurchasedVideosCount()).toBe(0);
    expect(component.myVideosTabLabel()).toBe('My Videos');

    // Grant v2 (buyable) and v3 (class video)
    mockDataService.myVideoGrants.entries.set([
      { docId: 'v2', videoId: 'v2' } as any,
      { docId: 'v3', videoId: 'v3' } as any,
    ]);

    // v2 is purchased, but v3 is a pure class video library item and should be excluded from purchased count
    expect(component.myPurchasedVideosCount()).toBe(1);
    expect(component.myVideosTabLabel()).toBe('My Videos (1)');

    // When switched to my-videos tab, only v2 is returned
    component.setTab('my-videos');
    const myVideos = component.filteredVideos();
    expect(myVideos.length).toBe(1);
    expect(myVideos[0].docId).toBe('v2');
  });

  it('should only return featuredVideo when a video is explicitly marked as featured', () => {
    // None of the sample videos have featured: true
    expect(component.featuredVideo()).toBeNull();

    // Mark v2 as featured
    const updatedVideos = mockDataService.videos.entries().map((v) =>
      v.docId === 'v2' ? { ...v, featured: true } : v,
    );
    mockDataService.videos.entries.set(updatedVideos);

    expect(component.featuredVideo()).not.toBeNull();
    expect(component.featuredVideo()?.docId).toBe('v2');
  });
});
