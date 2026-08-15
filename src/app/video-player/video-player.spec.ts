/* video-player.spec.ts
 *
 * Unit tests for VideoPlayerComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VideoPlayerComponent } from './video-player';
import { initVideoItem, VodAccessTier, VodCategory, VodStatus } from '../../../functions/src/data-model';

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
      category: VodCategory.SeminarRecording,
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
});
