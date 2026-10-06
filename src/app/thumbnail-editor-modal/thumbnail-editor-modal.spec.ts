/* thumbnail-editor-modal.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThumbnailEditorModalComponent } from './thumbnail-editor-modal';
import * as utils from '../utils';

describe('ThumbnailEditorModalComponent', () => {
  let component: ThumbnailEditorModalComponent;
  let fixture: ComponentFixture<ThumbnailEditorModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ThumbnailEditorModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ThumbnailEditorModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
    expect(component.isOpen()).toBe(false);
  });

  it('should switch tabs between video_frame and upload_image', () => {
    expect(component.activeTab()).toBe('video_frame');
    component.activeTab.set('upload_image');
    expect(component.activeTab()).toBe('upload_image');
  });

  it('should format time correctly in formatTime', () => {
    expect(component.formatTime(0)).toBe('00:00.0');
    expect(component.formatTime(5.4)).toBe('00:05.4');
    expect(component.formatTime(75.8)).toBe('01:15.8');
    expect(component.formatTime(NaN)).toBe('00:00.0');
  });

  it('should emit closed output on close()', () => {
    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);
    component.close();
    expect(closedSpy).toHaveBeenCalled();
  });

  it('should process image files and update capturedBlob and preview', async () => {
    const dummyBlob = new Blob(['mock-thumb-bytes'], { type: 'image/jpeg' });
    vi.spyOn(utils, 'createThumbnailFromImage').mockResolvedValue({
      blob: dummyBlob,
      width: 1280,
      height: 720,
    });

    const file = new File(['mock-image-data'], 'test.png', { type: 'image/png' });
    await component.processImageFile(file);

    expect(component.capturedBlob()).toBe(dummyBlob);
    expect(component.capturedDimensions()).toEqual({ w: 1280, h: 720 });
    expect(component.aspectRatioText()).toBe('16:9');
  });

  it('should emit thumbnailSelected event when applyThumbnail is called', () => {
    const selectedSpy = vi.fn();
    component.thumbnailSelected.subscribe(selectedSpy);

    const dummyBlob = new Blob(['test-blob'], { type: 'image/jpeg' });
    component.capturedBlob.set(dummyBlob);
    component.capturedPreviewUrl.set('blob:http://localhost/test');
    component.capturedDimensions.set({ w: 960, h: 720 });

    component.applyThumbnail();

    expect(selectedSpy).toHaveBeenCalledWith({
      blob: dummyBlob,
      previewUrl: 'blob:http://localhost/test',
      width: 960,
      height: 720,
    });
  });

  it('should use initialDurationSeconds as fallback for effectiveDuration', () => {
    fixture.componentRef.setInput('initialDurationSeconds', 120);
    fixture.detectChanges();

    expect(component.effectiveDuration()).toBe(120);

    // If videoDuration is detected from stream, videoDuration takes precedence
    component.videoDuration.set(300);
    expect(component.effectiveDuration()).toBe(300);
  });

  it('should compute quickJumpPresets based on effectiveDuration', () => {
    fixture.componentRef.setInput('initialDurationSeconds', 200);
    fixture.detectChanges();

    const presets = component.quickJumpPresets();
    expect(presets.length).toBe(5);
    expect(presets[0]).toEqual({ label: '10%', seconds: 20 });
    expect(presets[1]).toEqual({ label: '25%', seconds: 50 });
    expect(presets[2]).toEqual({ label: '50% (Mid)', seconds: 100 });
    expect(presets[3]).toEqual({ label: '75%', seconds: 150 });
    expect(presets[4]).toEqual({ label: '90%', seconds: 180 });
  });

  it('should compute timelineSnapshots when spriteSheetUrl and duration are available', () => {
    fixture.componentRef.setInput('initialDurationSeconds', 100);
    fixture.componentRef.setInput('spriteSheetUrl', 'https://example.com/sprite.jpg');
    fixture.componentRef.setInput('spriteIntervalSeconds', 5);
    fixture.componentRef.setInput('spriteWidth', 160);
    fixture.componentRef.setInput('spriteHeight', 90);
    fixture.componentRef.setInput('spriteColumnCount', 5);
    fixture.componentRef.setInput('spriteRowCount', 5);
    fixture.detectChanges();

    const snapshots = component.timelineSnapshots();
    expect(snapshots.length).toBe(6);
    expect(snapshots[0].time).toBe(8); // 8% of 100s
    expect(snapshots[0].spriteW).toBe(160);
    expect(snapshots[0].spriteH).toBe(90);
  });

  function createMockVideo(props: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
    return {
      videoWidth: 1920,
      videoHeight: 1080,
      currentTime: 0,
      paused: true,
      play: vi.fn().mockReturnValue(Promise.resolve()),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
      ...props,
    } as unknown as HTMLVideoElement;
  }

  it('should clamp seekTo correctly when duration is available', () => {
    const mockVideo = createMockVideo();
    component.videoRef = { nativeElement: mockVideo };
    component.videoDuration.set(60);

    component.seekTo(25);
    expect(mockVideo.currentTime).toBe(25);
    expect(component.currentVideoTime()).toBe(25);

    // Over maximum clamps to duration
    component.seekTo(100);
    expect(mockVideo.currentTime).toBe(60);
    expect(component.currentVideoTime()).toBe(60);

    // Negative clamps to 0
    component.seekTo(-10);
    expect(mockVideo.currentTime).toBe(0);
    expect(component.currentVideoTime()).toBe(0);
  });

  it('should allow seeking without locking to 0 when duration is not yet available', () => {
    const mockVideo = createMockVideo();
    component.videoRef = { nativeElement: mockVideo };
    component.videoDuration.set(0);

    component.seekTo(15);
    expect(mockVideo.currentTime).toBe(15);
    expect(component.currentVideoTime()).toBe(15);
  });

  it('should handle keyboard shortcuts for play/pause and nudge', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const mockVideo = createMockVideo();
    component.videoRef = { nativeElement: mockVideo };

    const toggleSpy = vi.spyOn(component, 'togglePlay');
    const nudgeSpy = vi.spyOn(component, 'nudge');

    // Space key triggers togglePlay
    const spaceEvent = new KeyboardEvent('keydown', { code: 'Space' });
    component.onWindowKeyDown(spaceEvent);
    expect(toggleSpy).toHaveBeenCalled();

    // ArrowLeft nudges -1s (or -5s with shift)
    const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
    component.onWindowKeyDown(leftEvent);
    expect(nudgeSpy).toHaveBeenCalledWith(-1);

    const shiftLeftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true });
    component.onWindowKeyDown(shiftLeftEvent);
    expect(nudgeSpy).toHaveBeenCalledWith(-5);

    // ArrowRight nudges +1s (or +5s with shift)
    const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    component.onWindowKeyDown(rightEvent);
    expect(nudgeSpy).toHaveBeenCalledWith(1);

    const shiftRightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true });
    component.onWindowKeyDown(shiftRightEvent);
    expect(nudgeSpy).toHaveBeenCalledWith(5);

    // Escape closes modal
    const closeSpy = vi.spyOn(component, 'close');
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    component.onWindowKeyDown(escEvent);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('should fall back to captureSpriteFrame if captureVideoFrame throws CORS restriction', async () => {
    const mockVideo = createMockVideo({
      videoWidth: 1920,
      videoHeight: 1080,
      currentTime: 12.5,
    });
    component.videoRef = { nativeElement: mockVideo };

    fixture.componentRef.setInput('spriteSheetUrl', 'https://example.com/sprite.jpg');
    fixture.detectChanges();

    vi.spyOn(utils, 'captureVideoFrame').mockRejectedValue(new Error('SecurityError: Tainted canvas'));

    const spriteBlob = new Blob(['sprite-thumb'], { type: 'image/jpeg' });
    const spriteCaptureSpy = vi.spyOn(utils, 'captureSpriteFrame').mockResolvedValue({
      blob: spriteBlob,
      width: 1280,
      height: 720,
    });

    await component.captureCurrentFrame();

    expect(spriteCaptureSpy).toHaveBeenCalledWith(
      'https://example.com/sprite.jpg',
      12.5,
      5,
      160,
      90,
      5,
      5,
    );
    expect(component.capturedBlob()).toBe(spriteBlob);
    expect(component.capturedAtTimestamp()).toBe(12.5);
  });
});

describe('fixFirebaseHlsUrl', () => {
  it('should leave non-Firebase Storage URLs unchanged', () => {
    const parent = 'https://storage.googleapis.com/bucket/vod/123/manifest.m3u8';
    expect(utils.fixFirebaseHlsUrl('https://storage.googleapis.com/bucket/vod/123/hd.m3u8', parent))
      .toBe('https://storage.googleapis.com/bucket/vod/123/hd.m3u8');
  });

  it('should restore folder path, alt=media, and token for Firebase Storage child playlists', () => {
    const parent = 'https://firebasestorage.googleapis.com/v0/b/mybucket.appspot.com/o/vod%2Fpart1%2Fmanifest.m3u8?alt=media&token=sec_abc123';
    const mangledChild = new URL('hd.m3u8', parent).href;

    // Standard URL resolution strips folder to /o/hd.m3u8
    expect(mangledChild).toBe('https://firebasestorage.googleapis.com/v0/b/mybucket.appspot.com/o/hd.m3u8');

    // fixFirebaseHlsUrl restores vod%2Fpart1%2Fhd.m3u8 and query params
    const fixed = utils.fixFirebaseHlsUrl(mangledChild, parent);
    expect(fixed).toBe('https://firebasestorage.googleapis.com/v0/b/mybucket.appspot.com/o/vod%2Fpart1%2Fhd.m3u8?alt=media&token=sec_abc123');
  });

  it('should restore folder path, alt=media, and token for Firebase Storage video chunks', () => {
    const parent = 'https://firebasestorage.googleapis.com/v0/b/mybucket.appspot.com/o/vod%2Fpart1%2Fmanifest.m3u8?alt=media&token=sec_abc123';
    const mangledChunk = 'https://firebasestorage.googleapis.com/v0/b/mybucket.appspot.com/o/hd_00001.ts';

    const fixed = utils.fixFirebaseHlsUrl(mangledChunk, parent);
    expect(fixed).toBe('https://firebasestorage.googleapis.com/v0/b/mybucket.appspot.com/o/vod%2Fpart1%2Fhd_00001.ts?alt=media&token=sec_abc123');
  });
});
