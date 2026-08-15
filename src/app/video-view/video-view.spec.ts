/* video-view.spec.ts
 *
 * Unit tests for VideoViewComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VideoViewComponent } from './video-view';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { StripeService } from '../stripe.service';
import { initVideoItem, VideoItem, VodAccessTier, VodCategory, VodStatus } from '../../../functions/src/data-model';
import { signal, WritableSignal } from '@angular/core';

describe('VideoViewComponent', () => {
  let component: VideoViewComponent;
  let fixture: ComponentFixture<VideoViewComponent>;
  let mockDataService: {
    getVideoById: ReturnType<typeof vi.fn>;
    getVideoPlaybackSession: ReturnType<typeof vi.fn>;
    getVideoProgress: ReturnType<typeof vi.fn>;
    saveVideoProgress: ReturnType<typeof vi.fn>;
    videos: { entries: WritableSignal<VideoItem[]> };
  };
  let mockFirebaseState: {
    user: WritableSignal<null>;
  };
  let mockRoutingService: {
    signals: {
      videoView: {
        pathVars: {
          videoId: WritableSignal<string>;
        };
      };
    };
    hrefForView: ReturnType<typeof vi.fn>;
  };
  let mockStripeService: {
    createCheckoutSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockDataService = {
      getVideoById: vi.fn().mockResolvedValue({
        ...initVideoItem(),
        docId: 'v100',
        title: 'Mastering Zhong Xin Dao',
        category: VodCategory.SeminarRecording,
        accessTier: VodAccessTier.Public,
        vodStatus: VodStatus.Ready,
        durationSeconds: 3600,
        manifestUrl: 'https://example.com/vod/v100/master.m3u8',
      }),
      getVideoPlaybackSession: vi.fn().mockResolvedValue({
        authorized: true,
        manifestUrl: 'https://example.com/vod/v100/master.m3u8',
        title: 'Mastering Zhong Xin Dao',
        durationSeconds: 3600,
      }),
      getVideoProgress: vi.fn().mockResolvedValue(null),
      saveVideoProgress: vi.fn().mockResolvedValue(undefined),
      videos: {
        entries: signal([]),
      },
    };

    mockFirebaseState = {
      user: signal(null),
    };

    mockRoutingService = {
      signals: {
        videoView: {
          pathVars: {
            videoId: signal('v100'),
          },
        },
      },
      hrefForView: vi.fn().mockReturnValue('/videos/v100'),
    };

    mockStripeService = {
      createCheckoutSession: vi.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/test', sessionId: 'sess_1' }),
    };

    await TestBed.configureTestingModule({
      imports: [VideoViewComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: StripeService, useValue: mockStripeService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VideoViewComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should load video and authorize playback session on init', async () => {
    await component.ngOnInit();
    expect(mockDataService.getVideoById).toHaveBeenCalledWith('v100');
    expect(mockDataService.getVideoPlaybackSession).toHaveBeenCalledWith('v100');
    expect(component.video()?.title).toBe('Mastering Zhong Xin Dao');
    expect(component.sessionState()?.authorized).toBe(true);
    expect(component.isLoading()).toBe(false);
  });

  it('should sync progress when time is updated', async () => {
    await component.ngOnInit();
    component.onTimeUpdated(120);
    expect(mockDataService.saveVideoProgress).toHaveBeenCalledWith('v100', 120, 3600, false);
  });
});
