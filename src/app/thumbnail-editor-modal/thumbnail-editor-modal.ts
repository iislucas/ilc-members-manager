/* thumbnail-editor-modal.ts
 *
 * Dedicated modal dialog for selecting or customizing a video thumbnail.
 * Allows admins to:
 * 1. Scrub through any frame in the video (via local file or HLS/video stream)
 *    with frame-accurate step buttons (-0.1s, +0.1s, -1s, +1s) and capture it.
 * 2. Click visual timeline snapshots or quick percentage jumps (10%, 25%, 50%, 75%).
 * 3. Upload a custom image file (JPG, PNG, WebP) with aspect-ratio preservation.
 * 4. Preview dimensions and aspect ratio (e.g. 16:9, 4:3, 9:16) before applying.
 */

import {
  Component,
  ElementRef,
  ViewChild,
  input,
  output,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Hls from 'hls.js';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  fitWithin,
  captureVideoFrame,
  captureSpriteFrame,
  fixFirebaseHlsUrl,
  createThumbnailFromImage,
  getAspectRatioLabel,
} from '../utils';

export interface ThumbnailSelectedEvent {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
}

@Component({
  selector: 'app-thumbnail-editor-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './thumbnail-editor-modal.html',
  styleUrl: './thumbnail-editor-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'onWindowKeyDown($event)',
  },
})
export class ThumbnailEditorModalComponent implements OnDestroy {
  @ViewChild('videoEl') videoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('imageInput') imageInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('videoFileInput') videoFileInputRef?: ElementRef<HTMLInputElement>;

  // Inputs
  isOpen = input<boolean>(false);
  title = input<string>('Change Thumbnail');
  initialThumbnailUrl = input<string | null>(null);
  videoFile = input<File | null>(null);
  videoUrl = input<string | null>(null);
  initialDurationSeconds = input<number | null>(null);
  spriteSheetUrl = input<string | null>(null);
  spriteIntervalSeconds = input<number>(5);
  spriteWidth = input<number>(160);
  spriteHeight = input<number>(90);
  spriteColumnCount = input<number>(5);
  spriteRowCount = input<number>(5);
  spriteFrameCount = input<number>(25);

  // Outputs
  thumbnailSelected = output<ThumbnailSelectedEvent>();
  closed = output<void>();

  // State
  activeTab = signal<'video_frame' | 'upload_image'>('video_frame');
  isLoadingVideo = signal<boolean>(false);
  isBuffering = signal<boolean>(false);
  isPlaying = signal<boolean>(false);
  currentVideoTime = signal<number>(0);
  videoDuration = signal<number>(0);
  videoError = signal<string | null>(null);

  capturedBlob = signal<Blob | null>(null);
  capturedPreviewUrl = signal<string | null>(null);
  capturedDimensions = signal<{ w: number; h: number } | null>(null);
  capturedAtTimestamp = signal<number | null>(null);

  effectiveDuration = computed(() => {
    const dur = this.videoDuration();
    if (dur > 0 && Number.isFinite(dur)) return dur;
    const init = this.initialDurationSeconds();
    if (init && init > 0) return init;
    return 0;
  });

  aspectRatioText = computed(() => {
    const dim = this.capturedDimensions();
    return dim ? getAspectRatioLabel(dim.w, dim.h) : '';
  });

  quickJumpPresets = computed(() => {
    const dur = this.effectiveDuration();
    if (dur <= 0) {
      return [
        { label: 'Start', seconds: 0 },
        { label: '10s', seconds: 10 },
        { label: '30s', seconds: 30 },
        { label: '1m', seconds: 60 },
      ];
    }
    return [
      { label: '10%', seconds: Math.round(dur * 0.1) },
      { label: '25%', seconds: Math.round(dur * 0.25) },
      { label: '50% (Mid)', seconds: Math.round(dur * 0.5) },
      { label: '75%', seconds: Math.round(dur * 0.75) },
      { label: '90%', seconds: Math.round(dur * 0.9) },
    ];
  });

  timelineSnapshots = computed(() => {
    const spriteUrl = this.spriteSheetUrl();
    if (!spriteUrl) return [];

    const dur = this.effectiveDuration();
    if (dur <= 0) return [];

    const interval = this.spriteIntervalSeconds() || 5;
    const cols = this.spriteColumnCount() || 5;
    const rows = this.spriteRowCount() || 5;
    const spriteW = this.spriteWidth() || 160;
    const spriteH = this.spriteHeight() || 90;
    const maxFrames = this.spriteFrameCount() || cols * rows;

    const samplePercentages = [0.08, 0.22, 0.38, 0.52, 0.68, 0.85];
    return samplePercentages.map((pct) => {
      const time = Math.round(dur * pct * 10) / 10;
      const frameIndex = Math.min(maxFrames - 1, Math.max(0, Math.floor(time / interval)));
      const col = frameIndex % cols;
      const row = Math.floor(frameIndex / cols) % rows;
      return {
        time,
        timeFormatted: this.formatTime(time),
        pctLabel: `${Math.round(pct * 100)}%`,
        bgX: -col * spriteW,
        bgY: -row * spriteH,
        spriteW,
        spriteH,
      };
    });
  });

  chosenLocalVideoFile = signal<File | null>(null);
  isDraggingImage = signal<boolean>(false);
  isProcessing = signal<boolean>(false);

  private hls: Hls | null = null;
  private currentObjectUrl: string | null = null;
  private capturedObjectUrl: string | null = null;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open) {
        this.resetState();
        // Setup initial preview if available
        const initUrl = this.initialThumbnailUrl();
        if (initUrl) {
          this.capturedPreviewUrl.set(initUrl);
        }
        const initDur = this.initialDurationSeconds();
        if (initDur && initDur > 0) {
          this.videoDuration.set(initDur);
        }
        // Initialize video source on microtask
        queueMicrotask(() => this.initializeVideo());
      } else {
        this.cleanupVideo();
      }
    });
  }

  ngOnDestroy(): void {
    this.cleanupVideo();
    if (this.capturedObjectUrl) {
      URL.revokeObjectURL(this.capturedObjectUrl);
      this.capturedObjectUrl = null;
    }
  }

  onWindowKeyDown(event: KeyboardEvent): void {
    if (!this.isOpen()) return;

    // Do not intercept if user is typing in an input
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    if (event.key === 'Escape') {
      this.close();
      return;
    }

    if (this.activeTab() === 'video_frame') {
      if (event.code === 'Space') {
        event.preventDefault();
        this.togglePlay();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.nudge(event.shiftKey ? -5 : -1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.nudge(event.shiftKey ? 5 : 1);
      }
    }
  }

  private resetState(): void {
    this.cleanupVideo();
    this.videoError.set(null);
    this.isLoadingVideo.set(false);
    this.isBuffering.set(false);
    this.isPlaying.set(false);
    this.currentVideoTime.set(0);
    this.videoDuration.set(this.initialDurationSeconds() || 0);
    this.activeTab.set('video_frame');
    this.chosenLocalVideoFile.set(null);
    this.capturedAtTimestamp.set(null);
    if (this.capturedObjectUrl) {
      URL.revokeObjectURL(this.capturedObjectUrl);
      this.capturedObjectUrl = null;
    }
    this.capturedBlob.set(null);
    this.capturedPreviewUrl.set(null);
    this.capturedDimensions.set(null);
  }

  private cleanupVideo(): void {
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {
        // ignore
      }
      this.hls = null;
    }
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    const video = this.videoRef?.nativeElement;
    if (video) {
      try {
        if (typeof video.pause === 'function') {
          video.pause();
        }
        if (typeof video.removeAttribute === 'function') {
          video.removeAttribute('src');
        }
        if (typeof video.load === 'function') {
          video.load();
        }
      } catch {
        // ignore
      }
    }
  }

  initializeVideo(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    this.cleanupVideo();
    this.videoError.set(null);

    const file = this.chosenLocalVideoFile() || this.videoFile();
    const url = this.videoUrl();

    if (file) {
      this.isLoadingVideo.set(true);
      this.currentObjectUrl = URL.createObjectURL(file);
      video.src = this.currentObjectUrl;
      video.load();
      return;
    }

    if (url) {
      this.isLoadingVideo.set(true);
      const isHls = url.includes('.m3u8');
      if (isHls && Hls.isSupported()) {
        const rootUrl = url;
        class FirebaseHlsCustomLoader extends (Hls.DefaultConfig.loader as any) {
          constructor(cfg: any) {
            super(cfg);
            const origLoad = (this as any)['load'].bind(this);
            (this as any)['load'] = (context: any, loadCfg: any, callbacks: any) => {
              if (context?.url) {
                context.url = fixFirebaseHlsUrl(context.url, rootUrl);
              }
              origLoad(context, loadCfg, callbacks);
            };
          }
        }

        this.hls = new Hls({
          loader: FirebaseHlsCustomLoader as any,
          enableWorker: true,
          capLevelToPlayerSize: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(video);

        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
          this.isLoadingVideo.set(false);
          this.isBuffering.set(false);
        });

        this.hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
          if (data.details?.totalduration && data.details.totalduration > 0) {
            this.videoDuration.set(data.details.totalduration);
          }
        });

        this.hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.warn('HLS stream fatal error:', data);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                try {
                  this.hls?.startLoad();
                  return;
                } catch {
                  // Fall through
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                try {
                  this.hls?.recoverMediaError();
                  return;
                } catch {
                  // Fall through
                }
                break;
            }
            this.videoError.set(
              'Could not load remote stream directly. You can pick an image or select the video file directly.',
            );
            this.isLoadingVideo.set(false);
            this.isBuffering.set(false);
          }
        });
      } else {
        video.src = url;
        video.load();
      }
      return;
    }

    this.isLoadingVideo.set(false);
  }

  onVideoMetadataLoaded(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    this.isLoadingVideo.set(false);
    this.isBuffering.set(false);

    if (Number.isFinite(video.duration) && video.duration > 0) {
      this.videoDuration.set(video.duration);
    }

    const dur = this.effectiveDuration();
    const target = dur > 0 ? Math.min(Math.max(0.5, dur * 0.05), 5) : 0;
    if (target > 0) {
      try {
        video.currentTime = target;
      } catch {
        // ignore
      }
    }
  }

  onVideoDurationChange(): void {
    const video = this.videoRef?.nativeElement;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      this.videoDuration.set(video.duration);
    }
  }

  onTimeUpdate(): void {
    const video = this.videoRef?.nativeElement;
    if (video) {
      this.currentVideoTime.set(video.currentTime);
    }
  }

  onVideoError(event: Event): void {
    console.warn('Video element error in thumbnail editor:', event);
    this.isLoadingVideo.set(false);
    this.isBuffering.set(false);
    this.videoError.set(
      'Could not play video stream directly. You can select the local video file or upload an image.',
    );
  }

  togglePlay(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    if (video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } else {
      video.pause();
    }
  }

  seekTo(seconds: number): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    const dur = this.effectiveDuration();
    const clamped = dur > 0 ? Math.max(0, Math.min(dur, seconds)) : Math.max(0, seconds);
    video.currentTime = clamped;
    this.currentVideoTime.set(clamped);
  }

  nudge(secondsDelta: number): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    video.pause();
    this.seekTo(video.currentTime + secondsDelta);
  }

  onSliderInput(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.seekTo(val);
  }

  async captureCurrentFrame(): Promise<void> {
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    if (!video.videoWidth || !video.videoHeight) {
      this.videoError.set('Video frame is not ready yet. Please wait for video to buffer.');
      return;
    }

    video.pause();
    this.isProcessing.set(true);
    this.videoError.set(null);

    try {
      const { blob, width, height } = await captureVideoFrame(video, 1280, 0.9);
      this.setCapturedFrame(blob, width, height, video.currentTime);
    } catch (err: unknown) {
      console.warn('Capture frame via canvas failed, testing sprite fallback:', err);
      const spriteUrl = this.spriteSheetUrl();
      if (spriteUrl) {
        try {
          const { blob, width, height } = await captureSpriteFrame(
            spriteUrl,
            video.currentTime,
            this.spriteIntervalSeconds(),
            this.spriteWidth(),
            this.spriteHeight(),
            this.spriteColumnCount(),
            this.spriteRowCount(),
          );
          this.setCapturedFrame(blob, width, height, video.currentTime);
          return;
        } catch (sErr) {
          console.warn('Sprite capture also failed:', sErr);
        }
      }
      this.videoError.set(
        'Frame capture restricted by browser security (CORS) on remote stream. Please upload an image directly.',
      );
    } finally {
      this.isProcessing.set(false);
    }
  }

  async captureFromSnapshot(snapshotTime: number): Promise<void> {
    this.seekTo(snapshotTime);
    const spriteUrl = this.spriteSheetUrl();
    if (spriteUrl) {
      this.isProcessing.set(true);
      this.videoError.set(null);
      try {
        const { blob, width, height } = await captureSpriteFrame(
          spriteUrl,
          snapshotTime,
          this.spriteIntervalSeconds(),
          this.spriteWidth(),
          this.spriteHeight(),
          this.spriteColumnCount(),
          this.spriteRowCount(),
        );
        this.setCapturedFrame(blob, width, height, snapshotTime);
      } catch (err) {
        console.warn('Could not extract sprite frame directly:', err);
        await this.captureCurrentFrame();
      } finally {
        this.isProcessing.set(false);
      }
    } else {
      await this.captureCurrentFrame();
    }
  }

  private setCapturedFrame(blob: Blob, width: number, height: number, timestamp?: number): void {
    if (this.capturedObjectUrl) {
      URL.revokeObjectURL(this.capturedObjectUrl);
    }
    this.capturedObjectUrl = URL.createObjectURL(blob);
    this.capturedBlob.set(blob);
    this.capturedPreviewUrl.set(this.capturedObjectUrl);
    this.capturedDimensions.set({ w: width, h: height });
    if (typeof timestamp === 'number') {
      this.capturedAtTimestamp.set(timestamp);
    }
  }

  // --- Local Video File Selection ---
  onSelectLocalVideoFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.chosenLocalVideoFile.set(input.files[0]);
      this.initializeVideo();
      input.value = '';
    }
  }

  // --- Image Upload Handlers ---
  onImageDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingImage.set(true);
  }

  onImageDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingImage.set(false);
  }

  onImageDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingImage.set(false);
    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      this.processImageFile(event.dataTransfer.files[0]);
    }
  }

  onImageInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.processImageFile(input.files[0]);
      input.value = '';
    }
  }

  async processImageFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPEG, PNG, WebP).');
      return;
    }

    this.isProcessing.set(true);
    try {
      const { blob, width, height } = await createThumbnailFromImage(file, 1280, 0.9);
      this.setCapturedFrame(blob, width, height);
      this.capturedAtTimestamp.set(null);
    } catch (err: unknown) {
      console.error('Error processing image:', err);
      alert('Failed to process image: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.isProcessing.set(false);
    }
  }

  applyThumbnail(): void {
    const blob = this.capturedBlob();
    const previewUrl = this.capturedPreviewUrl();
    const dims = this.capturedDimensions() || { w: 1280, h: 720 };
    if (!blob || !previewUrl) return;

    this.thumbnailSelected.emit({
      blob,
      previewUrl,
      width: dims.w,
      height: dims.h,
    });
    this.close();
  }

  close(): void {
    this.cleanupVideo();
    this.closed.emit();
  }

  formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00.0';
    const m = Math.floor(seconds / 60);
    const totalSecRem = seconds % 60;
    const s = Math.floor(totalSecRem);
    const ms = Math.floor(Math.round((totalSecRem - s) * 10) % 10);
    const mm = m < 10 ? `0${m}` : `${m}`;
    const ss = s < 10 ? `0${s}` : `${s}`;
    return `${mm}:${ss}.${ms}`;
  }
}
