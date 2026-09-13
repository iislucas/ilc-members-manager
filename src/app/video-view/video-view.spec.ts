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
import { initVideoItem, VideoItem, VideoTimeRange, VodAccessTier, VodStatus, VideoGrant, VideoGrantKind } from '../../../functions/src/data-model/vod';
import { initMailSettings, MailSendingStatus, MailSettings } from '../../../functions/src/data-model/mail';
import { signal, WritableSignal } from '@angular/core';

describe('VideoViewComponent', () => {
  let component: VideoViewComponent;
  let fixture: ComponentFixture<VideoViewComponent>;
  let mockDataService: {
    getVideoById: ReturnType<typeof vi.fn>;
    getVideoPlaybackSession: ReturnType<typeof vi.fn>;
    getVideoProgress: ReturnType<typeof vi.fn>;
    saveVideoProgress: ReturnType<typeof vi.fn>;
    getVideoTimeRanges: ReturnType<typeof vi.fn>;
    saveVideoTimeRanges: ReturnType<typeof vi.fn>;
    getTagMeta: ReturnType<typeof vi.fn>;
    videos: { entries: WritableSignal<VideoItem[]> };
    myVideoGrants: { entries: WritableSignal<VideoGrant[]> };
    mailSettings: WritableSignal<MailSettings>;
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
      getVideoTimeRanges: vi.fn().mockResolvedValue([]),
      saveVideoTimeRanges: vi.fn().mockResolvedValue(undefined),
      getTagMeta: vi.fn().mockImplementation((tag: string) => {
        if (tag === 'spinning') {
          return { tag: 'spinning', description: 'Spinning hands drills' };
        }
        return undefined;
      }),
      videos: {
        entries: signal([]),
      },
      myVideoGrants: {
        entries: signal<VideoGrant[]>([]),
      },
      mailSettings: signal(initMailSettings()),
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
    const titleSpy = vi.spyOn(component.titleLoaded, 'emit');
    await component.ngOnInit();
    expect(mockDataService.getVideoById).toHaveBeenCalledWith('v100');
    expect(mockDataService.getVideoPlaybackSession).toHaveBeenCalledWith('v100');
    expect(component.video()?.title).toBe('Mastering Zhong Xin Dao');
    expect(titleSpy).toHaveBeenCalledWith('Mastering Zhong Xin Dao');
    expect(component.sessionState()?.authorized).toBe(true);
    expect(component.isLoading()).toBe(false);
  });

  it('should sync progress when time is updated', async () => {
    await component.ngOnInit();
    component.onTimeUpdated(120);
    expect(mockDataService.saveVideoProgress).toHaveBeenCalledWith('v100', 120, 3600, false);
  });

  it('should generate correct access tier chips', () => {
    const video = {
      ...initVideoItem(),
      accessTiers: [VodAccessTier.MembersOnly, VodAccessTier.InstructorsOnly],
      isBuyable: true,
      priceCents: 1500,
    };
    const chips = component.getAccessTierChips(video);
    expect(chips.map(c => c.label)).toContain('Members Only');
    expect(chips.map(c => c.label)).toContain('Instructors Only');
    expect(chips.map(c => c.label)).toContain('Direct Buy ($15.00)');
  });

  it('should return correct tag tooltips', () => {
    expect(component.getTagTooltip('spinning')).toBe('#spinning: Spinning hands drills');
    expect(component.getTagTooltip('basics')).toBe('Filter catalog by #basics');
  });

  it('should format bytes correctly', () => {
    expect(component.formatBytes(0)).toBe('0 B');
    expect(component.formatBytes(1024)).toBe('1.0 KB');
    expect(component.formatBytes(1048576 * 15)).toBe('15.0 MB');
  });

  it('should return supported quality resolutions', () => {
    const videoWithRes = {
      ...initVideoItem(),
      resolutions: ['2160p (4K)', '1080p', '720p'],
    };
    expect(component.getVideoResolutions(videoWithRes)).toEqual(['2160p (4K)', '1080p', '720p']);

    const videoWithoutRes = {
      ...initVideoItem(),
      resolutions: [],
    };
    expect(component.getVideoResolutions(videoWithoutRes)).toEqual(['1080p', '720p', '480p', '360p']);
  });

  it('should detect active quality and delegate quality selection', () => {
    component.streamingStats.set({
      engine: 'HLS.js',
      currentPosition: 10,
      duration: 100,
      bufferAheadSeconds: 30,
      bufferedPercent: 40,
      totalBytesDownloaded: 100000,
      totalResolutionSizeBytes: 31250000,
      totalEstimatedSizeBytes: 31250000,
      totalWatchSessionBytes: 28225000,
      remainingWatchBytes: 28125000,
      bytesAheadCached: 20000,
      lastChunkBytes: 5000,
      lastChunkDurationMs: 200,
      currentBitrateMbps: 2.5,
      currentResolution: '720p',
      activeQualityLabel: '720p',
      droppedFrames: 0,
      totalFrames: 100,
      playerState: 'playing',
      url: 'https://example.com/manifest.m3u8',
      playedPercent: 10,
      resolutionLadder: [
        { id: 0, label: '360p', height: 360, bitrateMbps: 0.8, estimatedSizeBytes: 10000000 },
        { id: 1, label: '720p', height: 720, bitrateMbps: 2.5, estimatedSizeBytes: 31250000 },
      ],
    });

    expect(component.isQualityActive('720p')).toBe(true);
    expect(component.isQualityActive('1080p')).toBe(false);

    const playerSpy = vi.fn();
    component.videoPlayer = {
      selectQualityByLabel: playerSpy,
    } as any;

    component.onQualitySelected('1080p');
    expect(playerSpy).toHaveBeenCalledWith('1080p');
  });

  it('should return resolution size estimate from ladder or calculate from duration', () => {
    component.streamingStats.set({
      engine: 'HLS.js',
      currentPosition: 0,
      duration: 1000,
      bufferAheadSeconds: 0,
      bufferedPercent: 0,
      totalBytesDownloaded: 0,
      totalResolutionSizeBytes: 300000000,
      totalEstimatedSizeBytes: 300000000,
      totalWatchSessionBytes: 300000000,
      remainingWatchBytes: 300000000,
      bytesAheadCached: 0,
      lastChunkBytes: 0,
      lastChunkDurationMs: 0,
      currentBitrateMbps: 2.4,
      currentResolution: '720p',
      activeQualityLabel: '720p',
      droppedFrames: 0,
      totalFrames: 0,
      playerState: 'idle',
      url: '',
      playedPercent: 0,
      resolutionLadder: [
        { id: 0, label: '360p', height: 360, bitrateMbps: 0.8, estimatedSizeBytes: 100000000 },
        { id: 1, label: '720p', height: 720, bitrateMbps: 2.4, estimatedSizeBytes: 300000000 },
      ],
    });

    expect(component.getResolutionSizeEstimate('360p')).toBe('~95.4 MB');
    expect(component.getResolutionSizeEstimate('720p')).toBe('~286.1 MB');
  });

  it('should trigger offline storage download and clear cache', async () => {
    const makeSpy = vi.spyOn(component.offlineStorage, 'makeVideoAvailableOffline').mockResolvedValue();
    const clearSpy = vi.spyOn(component.offlineStorage, 'clearAllCache').mockResolvedValue();

    const video = { ...initVideoItem(), docId: 'v100', manifestUrl: 'https://example.com/stream.m3u8' };
    await component.toggleSaveOffline(video);
    expect(makeSpy).toHaveBeenCalledWith(video, 'https://example.com/stream.m3u8');

    await component.clearAllDeviceCache();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('should compute series playlist and episode navigation correctly', () => {
    const ep1: VideoItem = {
      ...initVideoItem(),
      docId: 'v100',
      title: 'Episode 1: Mechanics',
      seriesId: 'series-sticky-hands',
      seriesTitle: 'Sticky Hands Series',
      seriesPartIndex: 1,
      durationSeconds: 1800,
      isPublished: true,
    };
    const ep2: VideoItem = {
      ...initVideoItem(),
      docId: 'v101',
      title: 'Episode 2: Applications',
      seriesId: 'series-sticky-hands',
      seriesTitle: 'Sticky Hands Series',
      seriesPartIndex: 2,
      durationSeconds: 2400,
      isPublished: true,
    };

    mockDataService.videos.entries.set([ep1, ep2]);
    component.video.set(ep1);

    const series = component.series();
    expect(series).toBeTruthy();
    expect(series?.seriesId).toBe('series-sticky-hands');
    expect(series?.title).toBe('Sticky Hands Series');
    expect(series?.videos.length).toBe(2);
    expect(series?.totalDurationSeconds).toBe(4200);

    expect(component.currentEpisodeIndex()).toBe(0);
    expect(component.previousEpisode()).toBeNull();
    expect(component.nextEpisode()?.docId).toBe('v101');
  });

  it('should trigger series checkout when startSeriesPurchase is called', async () => {
    const ep1: VideoItem = {
      ...initVideoItem(),
      docId: 'v100',
      title: 'Episode 1',
      seriesId: 'series-1',
      seriesTitle: 'Complete Series',
      seriesStripePriceId: 'price_series_1',
      seriesPriceCents: 4999,
      isPublished: true,
    };
    const ep2: VideoItem = {
      ...initVideoItem(),
      docId: 'v101',
      title: 'Episode 2',
      seriesId: 'series-1',
      seriesTitle: 'Complete Series',
      seriesStripePriceId: 'price_series_1',
      seriesPriceCents: 4999,
      isPublished: true,
    };

    mockDataService.videos.entries.set([ep1, ep2]);
    component.video.set(ep1);

    await component.startSeriesPurchase();
    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_series_1',
      expect.any(String),
      1,
      expect.objectContaining({
        metadata: {
          seriesId: 'series-1',
          videoId: 'v100',
          orderType: 'vod',
        },
      }),
    );
  });

  it('should reload video when videoId signal changes', async () => {
    mockDataService.getVideoById.mockImplementation(async (id: string) => ({
      ...initVideoItem(),
      docId: id,
      title: id === 'v200' ? 'Part 2 Title' : 'Part 1 Title',
    }));

    mockRoutingService.signals.videoView.pathVars.videoId.set('v200');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockDataService.getVideoById).toHaveBeenCalledWith('v200');
    expect(component.video()?.title).toBe('Part 2 Title');
  });

  it('should seek and activate loop when onPlayTimeRange is called with loop=true', () => {
    const seekSpy = vi.fn();
    component.videoPlayer = {
      seek: seekSpy,
    } as any;

    const testRange: VideoTimeRange = {
      id: 'range-1',
      name: 'Spinning Hands Drill',
      description: 'Focus on rotation and relaxation',
      startSeconds: 65,
      endSeconds: 120,
    };

    component.onPlayTimeRange({ range: testRange, loop: true });

    expect(seekSpy).toHaveBeenCalledWith(65);
    expect(component.activeLoopRange()).toEqual({
      startSeconds: 65,
      endSeconds: 120,
      name: 'Spinning Hands Drill',
    });

    component.onStopLoop();
    expect(component.activeLoopRange()).toBeNull();
  });

  it('should seek and clear loop when onPlayTimeRange is called with loop=false', () => {
    const seekSpy = vi.fn();
    component.videoPlayer = {
      seek: seekSpy,
    } as any;

    component.activeLoopRange.set({
      startSeconds: 10,
      endSeconds: 20,
      name: 'Old Loop',
    });

    const testRange: VideoTimeRange = {
      id: 'range-2',
      name: 'Footwork Step',
      description: '',
      startSeconds: 200,
      endSeconds: 250,
    };

    component.onPlayTimeRange({ range: testRange, loop: false });

    expect(seekSpy).toHaveBeenCalledWith(200);
    expect(component.activeLoopRange()).toBeNull();
  });

  describe('VOD Gifting', () => {
    beforeEach(() => {
      const buyableVideo: VideoItem = {
        ...initVideoItem(),
        docId: 'v100',
        title: 'Mastering Zhong Xin Dao',
        isBuyable: true,
        stripePriceId: 'price_vod_100',
        priceCents: 2500,
        isPublished: true,
      };
      component.video.set(buyableVideo);
      component.isLoading.set(false);
    });

    it('should validate recipient email when purchasing as a gift', async () => {
      component.isGiftPurchase.set(true);
      component.giftRecipientEmail.set(''); // Empty email

      await component.startPurchase();

      expect(component.giftValidationError()).toBe('Please enter a valid recipient email address.');
      expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();

      // Invalid email without @
      component.giftRecipientEmail.set('invalid-email');
      await component.startPurchase();
      expect(component.giftValidationError()).toBe('Please enter a valid recipient email address.');
      expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('should initiate checkout with gift parameters for a single video', async () => {
      component.isGiftPurchase.set(true);
      component.giftRecipientEmail.set('friend@example.com');
      component.giftRecipientName.set('Jane Doe');
      component.giftMessage.set('Enjoy learning ZXD!');

      await component.startPurchase();

      expect(component.giftValidationError()).toBeNull();
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        'price_vod_100',
        expect.any(String),
        1,
        expect.objectContaining({
          isGift: true,
          recipientEmail: 'friend@example.com',
          recipientName: 'Jane Doe',
          giftMessage: 'Enjoy learning ZXD!',
          metadata: expect.objectContaining({
            videoId: 'v100',
            orderType: 'vod',
          }),
        }),
      );
    });

    it('should initiate checkout with gift parameters for a series via gift modal', async () => {
      const ep1: VideoItem = {
        ...initVideoItem(),
        docId: 'v100',
        title: 'Part 1',
        seriesId: 'series-gift-1',
        seriesTitle: 'Advanced Series',
        seriesStripePriceId: 'price_series_gift',
        seriesPriceCents: 6000,
        isPublished: true,
      };
      const ep2: VideoItem = {
        ...initVideoItem(),
        docId: 'v101',
        title: 'Part 2',
        seriesId: 'series-gift-1',
        seriesTitle: 'Advanced Series',
        seriesStripePriceId: 'price_series_gift',
        seriesPriceCents: 6000,
        isPublished: true,
      };

      mockDataService.videos.entries.set([ep1, ep2]);
      component.video.set(ep1);

      component.openGiftModal('series');
      expect(component.isGiftModalOpen()).toBe(true);
      expect(component.giftModalTarget()).toBe('series');

      component.giftRecipientEmail.set('student@example.com');
      component.giftRecipientName.set('Student Name');
      component.giftMessage.set('Congrats on grading!');

      await component.startGiftModalPurchase();

      expect(component.giftValidationError()).toBeNull();
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        'price_series_gift',
        expect.any(String),
        1,
        expect.objectContaining({
          isGift: true,
          recipientEmail: 'student@example.com',
          recipientName: 'Student Name',
          giftMessage: 'Congrats on grading!',
          metadata: expect.objectContaining({
            seriesId: 'series-gift-1',
            orderType: 'vod',
          }),
        }),
      );
    });

    it('should detect gift provenance when current user has received a video gift', async () => {
      await component.ngOnInit();
      await fixture.whenStable();

      const giftGrant: VideoGrant = {
        docId: 'grant_1',
        videoId: 'v100',
        memberDocId: 'mem_1',
        memberEmail: 'me@example.com',
        grantKind: VideoGrantKind.GiftPurchase,
        grantedAt: new Date().toISOString(),
        giftedByName: 'Master Instructor',
        giftedByEmail: 'master@ilc.com',
        giftMessage: 'Special gift for dedicated practice',
      };

      mockDataService.myVideoGrants.entries.set([giftGrant]);
      fixture.detectChanges();

      const provenance = component.giftProvenance();
      expect(provenance).toEqual({
        from: 'Master Instructor',
        message: 'Special gift for dedicated practice',
      });

      // Verify template renders the banner
      const compiled = fixture.nativeElement as HTMLElement;
      const banner = compiled.querySelector('.gift-provenance-banner');
      expect(banner).toBeTruthy();
      expect(banner?.textContent).toContain('Gifted to you by Master Instructor');
      expect(banner?.textContent).toContain('Special gift for dedicated practice');
    });

    it('should reset gift state when navigating to another video', async () => {
      component.isGiftPurchase.set(true);
      component.isGiftModalOpen.set(true);
      component.giftValidationError.set('Some previous error');

      mockDataService.getVideoById.mockResolvedValueOnce({
        ...initVideoItem(),
        docId: 'v200',
        title: 'Another Video',
      });

      await component.loadVideo('v200');

      expect(component.isGiftPurchase()).toBe(false);
      expect(component.isGiftModalOpen()).toBe(false);
      expect(component.giftValidationError()).toBeNull();
    });

    it('should display mail-off notice when email notifications are off', async () => {
      mockDataService.mailSettings.set({
        ...initMailSettings(),
        status: MailSendingStatus.Off,
      });

      mockDataService.getVideoById.mockResolvedValue({
        ...initVideoItem(),
        docId: 'v100',
        title: 'Paid Video',
        accessTier: VodAccessTier.DirectPurchase,
        isBuyable: true,
        priceCents: 2000,
        stripePriceId: 'price_paid_1',
      });
      mockDataService.getVideoPlaybackSession.mockResolvedValue({
        authorized: false,
        requiresPurchase: true,
        stripePriceId: 'price_paid_1',
      });

      await component.ngOnInit();
      component.isGiftPurchase.set(true);

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.isMailOff()).toBe(true);
      const compiled = fixture.nativeElement as HTMLElement;
      const notice = compiled.querySelector('.mail-off-notice');
      expect(notice).toBeTruthy();
      expect(notice?.textContent).toContain('Email notifications are currently turned off');

      // Open gift modal
      component.openGiftModal('video');
      fixture.detectChanges();
      await fixture.whenStable();

      const modalNotice = compiled.querySelector('.mail-off-modal-notice');
      expect(modalNotice).toBeTruthy();
      expect(modalNotice?.textContent).toContain('Gifts can only be sent to existing ILC member accounts');
    });

    it('should display giftValidationError if gift checkout fails', async () => {
      mockDataService.getVideoById.mockResolvedValueOnce({
        ...initVideoItem(),
        docId: 'v300',
        title: 'Paid Video',
        accessTier: VodAccessTier.DirectPurchase,
        isBuyable: true,
        priceCents: 2000,
        stripePriceId: 'price_paid_1',
      });
      await component.loadVideo('v300');

      mockStripeService.createCheckoutSession.mockRejectedValueOnce(
        new Error('Email notifications are currently turned off. Gifts can only be sent to existing member accounts.'),
      );

      component.giftRecipientEmail.set('nonmember@example.com');
      await component.startPurchase(true);

      expect(component.giftValidationError()).toBe(
        'Email notifications are currently turned off. Gifts can only be sent to existing member accounts.',
      );
    });
  });
});
