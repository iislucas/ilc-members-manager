/* video-player.ts
 *
 * Standalone Angular video player component supporting Adaptive Bitrate (ABR)
 * HLS streaming via Hls.js with native Apple Safari HLS fallback.
 *
 * Features:
 * - Custom accessible UI controls (Play/Pause, Rewind/Fast-Forward 10s, Volume, Fullscreen, PiP)
 * - Timeline scrub bar with click-to-seek and buffer indicators
 * - Multi-resolution quality switcher (Auto, 1080p, 720p, 480p, 360p)
 * - Playback rate selector (0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x)
 * - Keyboard shortcuts (Space/K for play/pause, F for fullscreen, M for mute, Left/Right for seek)
 * - Emits periodic time updates for server-side progress syncing
 */

import {
  Component,
  ElementRef,
  Input,
  OnInit,
  OnDestroy,
  ViewChild,
  signal,
  computed,
  ChangeDetectionStrategy,
  output,
} from '@angular/core';
import Hls from 'hls.js';
import { VideoItem } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

export interface QualityLevel {
  id: number; // -1 for Auto, 0..N for explicit levels
  label: string; // 'Auto', '1080p', '720p', '480p', '360p'
  bitrate: number;
  height: number;
}

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [IconComponent, SpinnerComponent],
  templateUrl: './video-player.html',
  styleUrl: './video-player.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement', { static: true })
  videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('playerContainer', { static: true })
  containerRef!: ElementRef<HTMLDivElement>;

  // Inputs
  vod = signal<VideoItem | null>(null);
  @Input() set videoData(val: VideoItem | null) {
    this.vod.set(val);
  }
  @Input() manifestUrl = '';
  @Input() posterUrl = '';
  @Input() initialPositionSeconds = 0;
  @Input() autoplay = false;

  // Outputs
  timeUpdated = output<number>();
  videoCompleted = output<void>();

  private hls: Hls | null = null;
  private saveIntervalId: ReturnType<typeof setInterval> | null = null;
  private hideControlsTimeout: ReturnType<typeof setTimeout> | null = null;

  // Player State Signals
  isPlaying = signal(false);
  isBuffering = signal(false);
  currentTime = signal(0);
  duration = signal(0);
  bufferedPercent = signal(0);
  volume = signal(1);
  isMuted = signal(false);
  playbackRate = signal(1);
  isFullscreen = signal(false);
  controlsVisible = signal(true);

  // Quality Levels
  availableQualities = signal<QualityLevel[]>([]);
  currentQualityId = signal<number>(-1); // -1 = Auto
  currentResolutionLabel = signal('Auto');

  // Menus
  showSettingsMenu = signal(false);
  showQualityMenu = signal(false);
  showSpeedMenu = signal(false);

  // Computed Progress percentage for timeline bar
  playedPercent = computed(() => {
    const dur = this.duration();
    if (!dur || dur <= 0) return 0;
    return Math.min(100, Math.max(0, (this.currentTime() / dur) * 100));
  });

  ngOnInit(): void {
    const video = this.videoRef.nativeElement;
    const streamUrl = this.manifestUrl || this.vod()?.manifestUrl || '';

    if (streamUrl) {
      this.setupHls(streamUrl, video);
    }
    this.setupNativeEvents(video);

    // Sync progress periodically
    this.saveIntervalId = setInterval(() => {
      if (this.isPlaying()) {
        this.timeUpdated.emit(this.currentTime());
      }
    }, 5000);
  }

  private setupHls(src: string, video: HTMLVideoElement): void {
    const isHls =
      src.includes('.m3u8') ||
      (src.startsWith('blob:') && src.includes('m3u8'));

    if (isHls && Hls.isSupported()) {
      this.hls = new Hls({
        capLevelToPlayerSize: true,
        autoStartLoad: true,
        startPosition:
          this.initialPositionSeconds > 0 ? this.initialPositionSeconds : -1,
      });

      this.hls.loadSource(src);
      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        const levels: QualityLevel[] = [
          { id: -1, label: 'Auto', bitrate: 0, height: 0 },
          ...data.levels
            .map((lvl, index) => ({
              id: index,
              label: `${lvl.height}p`,
              bitrate: lvl.bitrate,
              height: lvl.height,
            }))
            .reverse(),
        ];
        this.availableQualities.set(levels);

        if (this.autoplay) {
          video.play().catch(() => this.isPlaying.set(false));
        }
      });

      this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        const lvl = this.hls?.levels[data.level];
        if (lvl && this.currentQualityId() === -1) {
          this.currentResolutionLabel.set(`Auto (${lvl.height}p)`);
        }
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              this.hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              this.hls?.recoverMediaError();
              break;
            default:
              this.hls?.destroy();
              this.hls = null;
              this.playDirect(src, video);
              break;
          }
        }
      });
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple Safari HLS
      this.playDirect(src, video);
    } else {
      // Direct progressive video playback (e.g. MP4, WebM, or raw Cloud Storage download URL)
      this.playDirect(src, video);
    }
  }

  private playDirect(src: string, video: HTMLVideoElement): void {
    video.src = src;
    if (this.initialPositionSeconds > 0) {
      video.currentTime = this.initialPositionSeconds;
    }
    if (this.autoplay) {
      video.play().catch(() => this.isPlaying.set(false));
    }
  }

  private setupNativeEvents(video: HTMLVideoElement): void {
    const updateBuffer = () => {
      const dur = video.duration;
      if (!dur || dur <= 0 || !video.buffered) return;
      const current = video.currentTime;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= current && current <= video.buffered.end(i)) {
          const pct = Math.min(100, Math.max(0, (video.buffered.end(i) / dur) * 100));
          this.bufferedPercent.set(pct);
          return;
        }
      }
    };

    video.addEventListener('play', () => this.isPlaying.set(true));
    video.addEventListener('pause', () => {
      this.isPlaying.set(false);
      this.timeUpdated.emit(this.currentTime());
    });
    video.addEventListener('waiting', () => this.isBuffering.set(true));
    video.addEventListener('playing', () => this.isBuffering.set(false));
    video.addEventListener('progress', updateBuffer);
    video.addEventListener('timeupdate', () => {
      this.currentTime.set(video.currentTime);
      updateBuffer();
      if (this.duration() > 0 && video.currentTime / this.duration() >= 0.95) {
        this.videoCompleted.emit();
      }
    });
    video.addEventListener('durationchange', () => {
      this.duration.set(video.duration);
      updateBuffer();
    });
  }

  togglePlay(): void {
    const video = this.videoRef.nativeElement;
    if (video.paused) {
      video.play().catch(() => this.isPlaying.set(false));
    } else {
      video.pause();
    }
  }

  seek(seconds: number): void {
    const video = this.videoRef.nativeElement;
    video.currentTime = Math.max(0, Math.min(seconds, this.duration() || 0));
    this.currentTime.set(video.currentTime);
  }

  onTimelineClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const pos = (event.clientX - rect.left) / rect.width;
    this.seek(pos * this.duration());
  }

  skip(secondsDelta: number): void {
    this.seek(this.currentTime() + secondsDelta);
  }

  setVolume(vol: number): void {
    const video = this.videoRef.nativeElement;
    video.volume = Math.max(0, Math.min(vol, 1));
    this.volume.set(video.volume);
    this.isMuted.set(video.volume === 0);
  }

  toggleMute(): void {
    const video = this.videoRef.nativeElement;
    video.muted = !video.muted;
    this.isMuted.set(video.muted);
  }

  setQuality(levelId: number): void {
    if (!this.hls) return;
    this.currentQualityId.set(levelId);
    this.hls.currentLevel = levelId;
    if (levelId === -1) {
      this.currentResolutionLabel.set('Auto');
    } else {
      const q = this.availableQualities().find((item) => item.id === levelId);
      this.currentResolutionLabel.set(q ? q.label : 'Auto');
    }
    this.showQualityMenu.set(false);
    this.showSettingsMenu.set(false);
  }

  setSpeed(rate: number): void {
    const video = this.videoRef.nativeElement;
    video.playbackRate = rate;
    this.playbackRate.set(rate);
    this.showSpeedMenu.set(false);
    this.showSettingsMenu.set(false);
  }

  toggleFullscreen(): void {
    const container = this.containerRef.nativeElement;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => this.isFullscreen.set(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => this.isFullscreen.set(false)).catch(() => {});
    }
  }

  async togglePictureInPicture(): Promise<void> {
    const video = this.videoRef.nativeElement;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
    } else if (document.pictureInPictureEnabled) {
      await video.requestPictureInPicture().catch(() => {});
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    switch (event.key.toLowerCase()) {
      case ' ':
      case 'k':
        event.preventDefault();
        this.togglePlay();
        break;
      case 'f':
        event.preventDefault();
        this.toggleFullscreen();
        break;
      case 'm':
        event.preventDefault();
        this.toggleMute();
        break;
      case 'arrowleft':
      case 'j':
        event.preventDefault();
        this.skip(-10);
        break;
      case 'arrowright':
      case 'l':
        event.preventDefault();
        this.skip(10);
        break;
      case 'arrowup':
        event.preventDefault();
        this.setVolume(this.volume() + 0.1);
        break;
      case 'arrowdown':
        event.preventDefault();
        this.setVolume(this.volume() - 0.1);
        break;
    }
  }

  onMouseMove(): void {
    this.controlsVisible.set(true);
    if (this.hideControlsTimeout) clearTimeout(this.hideControlsTimeout);
    if (this.isPlaying()) {
      this.hideControlsTimeout = setTimeout(() => {
        this.controlsVisible.set(false);
        this.showSettingsMenu.set(false);
      }, 3000);
    }
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }

  ngOnDestroy(): void {
    if (this.saveIntervalId) clearInterval(this.saveIntervalId);
    if (this.hideControlsTimeout) clearTimeout(this.hideControlsTimeout);
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }
}
