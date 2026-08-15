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
import { ROUTING_CONFIG } from '../app.config';
import { initVideoItem, InstructorPublicData, VideoItem, VodAccessTier, VodStatus } from '../../../functions/src/data-model';
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
  };
  let mockFirebaseState: {
    user: WritableSignal<null>;
  };
  let mockRoutingService: {
    signals: {
      videos: {
        urlParams: {
          q: WritableSignal<string | null>;
          tag: WritableSignal<string | null>;
          instructorId: WritableSignal<string | null>;
          tier: WritableSignal<string | null>;
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
            durationSeconds: 1800,
            tags: ['basics', 'footwork'],
          },
          {
            ...initVideoItem(),
            docId: 'v2',
            title: 'Advanced Sticky Hands',
            accessTier: VodAccessTier.MembersOnly,
            isPublished: true,
            durationSeconds: 5400,
            tags: ['advanced', 'sticky hands'],
          },
        ]),
        search: vi.fn().mockReturnValue([]),
      },
      instructors: {
        entries: signal([]),
        search: vi.fn().mockReturnValue([]),
      },
      getMyVideoProgressList: vi.fn().mockResolvedValue([]),
    };

    mockFirebaseState = {
      user: signal(null),
    };

    mockRoutingService = {
      signals: {
        videos: {
          urlParams: {
            q: signal(null),
            tag: signal(null),
            instructorId: signal(null),
            tier: signal(null),
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

  it('should extract available tags from videos', () => {
    const tags = component.availableTags();
    expect(tags).toContain('basics');
    expect(tags).toContain('footwork');
    expect(tags).toContain('advanced');
    expect(tags).toContain('sticky hands');
  });

  it('should return appropriate access tier badge', () => {
    const pubVideo = { ...initVideoItem(), accessTier: VodAccessTier.Public, accessTiers: [VodAccessTier.Public] };
    const pubBadge = component.getAccessTierBadge(pubVideo);
    expect(pubBadge.label).toBe('Free');
    expect(pubBadge.cssClass).toBe('badge-public');

    const memVideo = { ...initVideoItem(), accessTier: VodAccessTier.MembersOnly, accessTiers: [VodAccessTier.MembersOnly] };
    const memBadge = component.getAccessTierBadge(memVideo);
    expect(memBadge.label).toBe('Members');
    expect(memBadge.cssClass).toBe('badge-members');
  });

  it('should evaluate userHasAccess correctly', () => {
    const pubVideo = { ...initVideoItem(), accessTier: VodAccessTier.Public };
    const memVideo = { ...initVideoItem(), accessTier: VodAccessTier.MembersOnly };

    // Unauthenticated user
    expect(component.userHasAccess(pubVideo)).toBe(true);
    expect(component.userHasAccess(memVideo)).toBe(false);
  });
});
