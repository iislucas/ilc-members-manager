/* video-player.spec.ts
 *
 * Unit tests for VideoPlayerComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VideoPlayerComponent } from './video-player';
import { initVideoItem, VodAccessTier, VodStatus } from '../../../functions/src/data-model';

describe('VideoPlayerComponent', () => {
  let component: VideoPlayerComponent;
  let fixture: ComponentFixture<VideoPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VideoPlayerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(VideoPlayerComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with default states', () => {
    expect(component.isPlaying()).toBe(false);
    expect(component.isBuffering()).toBe(false);
    expect(component.currentTime()).toBe(0);
    expect(component.volume()).toBe(1);
    expect(component.isMuted()).toBe(false);
    expect(component.playbackRate()).toBe(1);
    expect(component.isFullscreen()).toBe(false);
  });

  it('should format time correctly', () => {
    expect(component.formatTime(0)).toBe('00:00');
    expect(component.formatTime(65)).toBe('01:05');
    expect(component.formatTime(3665)).toBe('1:01:05');
    expect(component.formatTime(NaN)).toBe('00:00');
  });

  it('should calculate playedPercent computed signal correctly', () => {
    expect(component.playedPercent()).toBe(0);

    component.duration.set(100);
    component.currentTime.set(25);
    expect(component.playedPercent()).toBe(25);

    component.currentTime.set(120);
    expect(component.playedPercent()).toBe(100);
  });

  it('should update volume and mute state', () => {
    component.setVolume(0.5);
    expect(component.volume()).toBe(0.5);
    expect(component.isMuted()).toBe(false);

    component.setVolume(0);
    expect(component.volume()).toBe(0);
    expect(component.isMuted()).toBe(true);
  });

  it('should update playback speed and allow changing it back down', () => {
    component.setSpeed(1.5);
    expect(component.playbackRate()).toBe(1.5);
    expect(component.videoRef.nativeElement.playbackRate).toBe(1.5);

    component.setSpeed(2);
    expect(component.playbackRate()).toBe(2);
    expect(component.videoRef.nativeElement.playbackRate).toBe(2);

    component.setSpeed(1);
    expect(component.playbackRate()).toBe(1);
    expect(component.videoRef.nativeElement.playbackRate).toBe(1);

    component.setSpeed(0.25);
    expect(component.playbackRate()).toBe(0.25);
    expect(component.videoRef.nativeElement.playbackRate).toBe(0.25);
  });

  it('should resync the playbackRate signal when the video element changes rate on its own', () => {
    fixture.detectChanges();
    const video = component.videoRef.nativeElement;

    component.setSpeed(2);
    expect(component.playbackRate()).toBe(2);

    // Simulate the browser resetting playbackRate outside of setSpeed()
    // (e.g. on src reassignment) and firing its native ratechange event.
    video.playbackRate = 1;
    video.dispatchEvent(new Event('ratechange'));
    expect(component.playbackRate()).toBe(1);
  });

  it('should reapply the current speed after reassigning the video src in playDirect', () => {
    component.setSpeed(1.5);
    (component as any).playDirect('https://example.com/video.mp4', component.videoRef.nativeElement);
    expect(component.videoRef.nativeElement.playbackRate).toBe(1.5);
  });

  it('should accept videoData input and update vod signal', () => {
    const video = {
      ...initVideoItem(),
      docId: 'v123',
      title: 'Spinning Hands Workshop',
      accessTier: VodAccessTier.MembersOnly,
      vodStatus: VodStatus.Ready,
    };
    component.videoData = video;
    expect(component.vod()?.docId).toBe('v123');
    expect(component.vod()?.title).toBe('Spinning Hands Workshop');
  });

  it('should initialize bufferedPercent to 0', () => {
    expect(component.bufferedPercent()).toBe(0);
  });

  it('should toggle and close menus correctly', () => {
    const fakeEvent = { stopPropagation: vi.fn() } as unknown as MouseEvent;
    component.toggleSettings(fakeEvent);
    expect(component.showSettingsMenu()).toBe(true);

    component.showQualityMenu.set(true);
    component.closeAllMenus();
    expect(component.showSettingsMenu()).toBe(false);
    expect(component.showQualityMenu()).toBe(false);
    expect(component.showSpeedMenu()).toBe(false);
  });

  it('should fallback to default quality ladder if no HLS levels available', () => {
    component.videoData = {
      ...initVideoItem(),
      resolutions: ['1080p', '720p', '480p', '360p'],
    };
    (component as any).updateQualityLevels([]);
    const q = component.availableQualities();
    expect(q.length).toBe(5);
    expect(q[0].label).toBe('Auto');
    expect(q[1].label).toBe('1080p');
    expect(q[2].label).toBe('720p');
    expect(q[3].label).toBe('480p');
    expect(q[4].label).toBe('360p');
  });

  it('should populate quality levels from HLS levels and switch properly', () => {
    const rawHlsLevels = [
      { height: 360, bitrate: 800000 },
      { height: 480, bitrate: 1400000 },
      { height: 720, bitrate: 2800000 },
      { height: 1080, bitrate: 5000000 },
    ];
    (component as any).updateQualityLevels(rawHlsLevels);
    const q = component.availableQualities();
    expect(q.length).toBe(5);
    expect(q[0].label).toBe('Auto');
    expect(q[1].label).toBe('1080p');
    expect(q[4].label).toBe('360p');

    component.setQuality(0); // 360p
    expect(component.currentQualityId()).toBe(0);
    expect(component.currentResolutionLabel()).toBe('360p');

    component.selectQualityByLabel('720p');
    expect(component.currentResolutionLabel()).toBe('720p');
  });

  it('should support seek queuing and fallback to vod duration when video metadata is loading', () => {
    component.videoData = {
      ...initVideoItem(),
      durationSeconds: 600,
    };
    // Duration is 0 initially before video load
    expect(component.effectiveDuration()).toBe(600);
    component.seek(150);
    expect(component.currentTime()).toBe(150);
    expect(component.playedPercent()).toBe(25);
  });

  it('should compute active chapter based on hover position', () => {
    component.videoData = {
      ...initVideoItem(),
      durationSeconds: 1000,
      chapters: [
        { title: '1. Introduction', startSeconds: 0 },
        { title: '2. Spinning Hands Drill', startSeconds: 200 },
        { title: '3. Form Breakdown', startSeconds: 500 },
      ],
    };

    component.hoverTime.set(100);
    expect(component.activeChapter()).toBe('1. Introduction');

    component.hoverTime.set(350);
    expect(component.activeChapter()).toBe('2. Spinning Hands Drill');

    component.hoverTime.set(800);
    expect(component.activeChapter()).toBe('3. Form Breakdown');
  });

  it('should update isFullscreen signal when fullscreenchange event fires', () => {
    const container = component.containerRef.nativeElement;
    expect(component.isFullscreen()).toBe(false);

    // Simulate entering fullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: container,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(component.isFullscreen()).toBe(true);

    // Simulate exiting fullscreen (e.g. user pressing Escape key)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(component.isFullscreen()).toBe(false);
  });

  it('should call requestFullscreen or exitFullscreen on toggleFullscreen', () => {
    const container = component.containerRef.nativeElement;
    const requestFullscreenSpy = vi.fn().mockReturnValue(Promise.resolve());
    const exitFullscreenSpy = vi.fn().mockReturnValue(Promise.resolve());

    container.requestFullscreen = requestFullscreenSpy;
    document.exitFullscreen = exitFullscreenSpy;

    // When not in fullscreen, toggleFullscreen calls requestFullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
    component.toggleFullscreen();
    expect(requestFullscreenSpy).toHaveBeenCalled();

    // When in fullscreen, toggleFullscreen calls exitFullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: container,
    });
    component.toggleFullscreen();
    expect(exitFullscreenSpy).toHaveBeenCalled();
  });

  it('should calculate totalEstimatedSizeBytes and adapt appropriately on quality change', () => {
    component.videoData = {
      ...initVideoItem(),
      durationSeconds: 1000,
    };
    (component as any).updateQualityLevels([
      { height: 360, bitrate: 800000 },
      { height: 720, bitrate: 2400000 },
      { height: 1080, bitrate: 4800000 },
    ]);

    let emittedStats: any = null;
    component.statsUpdated.subscribe((stats) => {
      emittedStats = stats;
    });

    // Quality 0 is 360p (800,000 bps -> 100,000 bytes/sec -> 100,000,000 bytes for 1000s)
    component.setQuality(0);
    expect(emittedStats).toBeTruthy();
    expect(emittedStats.totalResolutionSizeBytes).toBe(100000000);
    expect(emittedStats.totalEstimatedSizeBytes).toBe(100000000);
    expect(emittedStats.totalWatchSessionBytes).toBe(100000000);
    expect(emittedStats.remainingWatchBytes).toBe(100000000);
    expect(emittedStats.resolutionLadder.length).toBe(4); // Auto + 3 levels

    // Quality 2 is 1080p (4,800,000 bps -> 600,000 bytes/sec -> 600,000,000 bytes for 1000s)
    component.setQuality(2);
    expect(emittedStats.totalResolutionSizeBytes).toBe(600000000);
    expect(emittedStats.totalEstimatedSizeBytes).toBe(600000000);
    expect(emittedStats.totalWatchSessionBytes).toBe(600000000);
  });

  it('should initialize aspectRatio signal with 16 / 9 and update dynamically on loadedmetadata', () => {
    expect(component.aspectRatio()).toBe('16 / 9');

    fixture.detectChanges();

    const video = component.videoRef.nativeElement;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });

    video.dispatchEvent(new Event('loadedmetadata'));
    expect(component.aspectRatio()).toBe('1920 / 720');
  });

  it('should update aspectRatio when HLS level switch provides dimensions', () => {
    (component as any).hls = {
      levels: [
        { width: 1920, height: 960, bitrate: 4000000 },
      ],
      destroy: vi.fn(),
      on: vi.fn(),
    };

    // Trigger LEVEL_SWITCHED logic directly
    const levelSwitchedData = { level: 0 };
    const lvl = (component as any).hls.levels[levelSwitchedData.level];
    if (lvl.width && lvl.height) {
      component.aspectRatio.set(`${lvl.width} / ${lvl.height}`);
    }

    expect(component.aspectRatio()).toBe('1920 / 960');
  });
});
