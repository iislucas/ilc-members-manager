/* thumbnail-editor-modal.ts
 *
 * Dedicated modal dialog for selecting or customizing a video thumbnail.
 * Allows admins to:
 * 1. Scrub through any frame in the video (via local file or HLS/video stream)
 *    with frame-accurate step buttons (-0.1s, +0.1s, -1s, +1s) and capture it.
 * 2. Upload a custom image file (JPG, PNG, WebP) with aspect-ratio preservation.
 * 3. Preview dimensions and aspect ratio (e.g. 16:9, 4:3, 9:16) before applying.
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

  // Outputs
  thumbnailSelected = output<ThumbnailSelectedEvent>();
  closed = output<void>();

  // State
  activeTab = signal<'video_frame' | 'upload_image'>('video_frame');
  isLoadingVideo = signal<boolean>(false);
  isPlaying = signal<boolean>(false);
  currentVideoTime = signal<number>(0);
  videoDuration = signal<number>(0);
  videoError = signal<string | null>(null);

  capturedBlob = signal<Blob | null>(null);
  capturedPreviewUrl = signal<string | null>(null);
  capturedDimensions = signal<{ w: number; h: number } | null>(null);
  aspectRatioText = computed(() => {
    const dim = this.capturedDimensions();
    return dim ? getAspectRatioLabel(dim.w, dim.h) : '';
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
        // Initialize video source after next macrotask
        setTimeout(() => this.initializeVideo(), 50);
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

  private resetState(): void {
    this.cleanupVideo();
    this.videoError.set(null);
    this.isLoadingVideo.set(false);
    this.isPlaying.set(false);
    this.currentVideoTime.set(0);
    this.videoDuration.set(0);
    this.activeTab.set('video_frame');
    this.chosenLocalVideoFile.set(null);
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
      video.pause();
      video.removeAttribute('src');
      video.load();
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
        this.hls = new Hls({ enableWorker: true });
        this.hls.loadSource(url);
        this.hls.attachMedia(video);
        this.hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.warn('HLS stream fatal error:', data);
            this.videoError.set(
              'Could not load remote stream. You can select the video file directly from your computer.',
            );
            this.isLoadingVideo.set(false);
          }
        });
      } else {
        video.src = url;
        video.load();
      }
      return;
    }

    // No source provided yet
    this.isLoadingVideo.set(false);
  }

  onVideoMetadataLoaded(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    this.isLoadingVideo.set(false);
    this.videoDuration.set(video.duration || 0);

    // Initial nudge into video so we don't start on an empty black frame
    const target = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(Math.max(0.5, video.duration * 0.05), 5)
      : 0;

    if (target > 0) {
      try {
        video.currentTime = target;
      } catch {
        // ignore
      }
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
    this.videoError.set(
      'Could not play video stream directly. You can select the local video file from your computer or upload an image.',
    );
  }

  togglePlay(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  seekTo(seconds: number): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    const dur = this.videoDuration();
    const clamped = Math.max(0, Math.min(dur || 0, seconds));
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
      this.videoError.set('Video frame is not ready. Please wait for video to load.');
      return;
    }

    video.pause();
    this.isProcessing.set(true);
    this.videoError.set(null);

    try {
      const { blob, width, height } = await captureVideoFrame(video, 1280, 0.9);
      if (this.capturedObjectUrl) {
        URL.revokeObjectURL(this.capturedObjectUrl);
      }
      this.capturedObjectUrl = URL.createObjectURL(blob);
      this.capturedBlob.set(blob);
      this.capturedPreviewUrl.set(this.capturedObjectUrl);
      this.capturedDimensions.set({ w: width, h: height });
    } catch (err: unknown) {
      console.error('Capture frame failed:', err);
      this.videoError.set(
        'Frame capture restricted by browser security (CORS) on remote stream. Please select the video file directly from your computer.',
      );
    } finally {
      this.isProcessing.set(false);
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
      if (this.capturedObjectUrl) {
        URL.revokeObjectURL(this.capturedObjectUrl);
      }
      this.capturedObjectUrl = URL.createObjectURL(blob);
      this.capturedBlob.set(blob);
      this.capturedPreviewUrl.set(this.capturedObjectUrl);
      this.capturedDimensions.set({ w: width, h: height });
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

