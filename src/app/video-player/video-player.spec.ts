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

  it('should update playback speed', () => {
    component.setSpeed(1.5);
    expect(component.playbackRate()).toBe(1.5);
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

  it('should fallback to default quality level if no HLS levels available', () => {
    (component as any).updateQualityLevels([]);
    const q = component.availableQualities();
    expect(q.length).toBe(1);
    expect(q[0].label).toBe('Auto (Original)');
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
});
