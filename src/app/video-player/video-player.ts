/* video-player.ts
 *
 * Standalone Angular video player component supporting Adaptive Bitrate (ABR)
 * HLS streaming via Hls.js with native Apple Safari HLS fallback.
 *
 * Features:
 * - Custom accessible UI controls (Play/Pause, Rewind/Fast-Forward 10s, Volume, Fullscreen, PiP)
 * - Timeline scrub bar with click-to-seek and buffer indicators
 * - Multi-resolution quality switcher (Auto, 1080p, 720p, 480p, 360p)
 * - Playback rate selector (0.25x, 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x)
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
  HostListener,
  signal,
  computed,
  ChangeDetectionStrategy,
  output,
} from '@angular/core';
import { CommonModule, NgStyle } from '@angular/common';
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

export interface ResolutionSizeEstimate {
  id: number;
  label: string;
  height: number;
  bitrateMbps: number;
  estimatedSizeBytes: number;
}

export interface StreamingStats {
  engine: 'HLS.js' | 'Native HLS' | 'Direct Progressive';
  currentPosition: number;
  duration: number;
  bufferAheadSeconds: number;
  bufferedPercent: number;
  totalBytesDownloaded: number; // Actual bytes downloaded so far this watch session
  totalResolutionSizeBytes: number; // Full video file size at current active resolution
  totalEstimatedSizeBytes: number; // Backward-compat alias for totalResolutionSizeBytes
  totalWatchSessionBytes: number; // Total expected download for this watch (downloaded + remaining)
  remainingWatchBytes: number; // Estimated remaining bytes to complete watching at current quality
  bytesAheadCached: number;
  lastChunkBytes: number;
  lastChunkDurationMs: number;
  currentBitrateMbps: number;
  currentResolution: string;
  activeQualityLabel: string;
  droppedFrames: number;
  totalFrames: number;
  playerState: 'playing' | 'paused' | 'buffering' | 'idle';
  url: string;
  playedPercent: number;
  resolutionLadder: ResolutionSizeEstimate[];
}

// Custom on-device CacheStorage Fragment Loader for instant offline replay and fast streaming
export class CachedHlsFragmentLoader extends (Hls.DefaultConfig.loader as any) {
  constructor(config: any) {
    super(config);
    const origLoad = (this as any)['load'].bind(this);
    (this as any)['load'] = async (context: any, cfg: any, callbacks: any) => {
      const url = context.url;
      const isSegment =
        url.includes('.ts') ||
        url.includes('.m4s') ||
        (url.includes('.mp4') && !url.includes('.m3u8'));

      if (typeof window !== 'undefined' && 'caches' in window && isSegment) {
        try {
          const cache = await caches.open('ilc-vod-segment-cache-v1');
          const match = await cache.match(url);
          if (match) {
            const buf = await match.arrayBuffer();
            const now = performance.now();
            const response = {
              url,
              data: buf,
            };
            const stats = {
              trequest: now - 2,
              tfirst: now - 1,
              tload: now,
              loaded: buf.byteLength,
              total: buf.byteLength,
              loading: { start: now - 2, first: now - 1, end: now },
              parsing: { start: now, end: now },
              buffering: { start: now, end: now },
            };
            callbacks.onSuccess(response, stats, context, null);
            return;
          }
        } catch {
          // Fall back to network load
        }
      }

      // Intercept network onSuccess to cache chunk in local device CacheStorage
      const origSuccess = callbacks.onSuccess;
      callbacks.onSuccess = (response: any, stats: any, ctx: any, networkDetails: any) => {
        if (typeof window !== 'undefined' && 'caches' in window && isSegment && response?.data) {
          caches.open('ilc-vod-segment-cache-v1').then(async (cache) => {
            try {
              const resToCache = new Response(response.data.slice(0), {
                headers: {
                  'Content-Type': 'video/MP2T',
                  'Cache-Control': 'public, max-age=31536000',
                },
              });
              await cache.put(url, resToCache);
            } catch {
              // Ignore cache write errors
            }
          }).catch(() => {});
        }
        origSuccess(response, stats, ctx, networkDetails);
      };

      origLoad(context, cfg, callbacks);
    };
  }
}

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule, NgStyle, IconComponent, SpinnerComponent],
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
    this.updateQualityLevels();
  }
  @Input() manifestUrl = '';
  @Input() posterUrl = '';
  @Input() initialPositionSeconds = 0;
  @Input() autoplay = false;

  // Outputs
  timeUpdated = output<number>();
  videoCompleted = output<void>();
  statsUpdated = output<StreamingStats>();

  private hls: Hls | null = null;
  private saveIntervalId: ReturnType<typeof setInterval> | null = null;
  private hideControlsTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingSeekPosition: number | null = null;
  private wasPlayingBeforeDrag = false;

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

  // Timeline Dragging & Thumbnail Preview Signals
  isDragging = signal(false);
  dragTime = signal<number | null>(null);
  hoverTime = signal<number | null>(null);
  hoverPixelX = signal<number>(0);
  showHoverPreview = signal(false);
  aspectRatio = signal<string>('16 / 9');

  // Streaming Stats Signals
  streamingEngine = signal<'HLS.js' | 'Native HLS' | 'Direct Progressive'>('HLS.js');
  totalBytesDownloaded = signal<number>(0);
  lastChunkBytes = signal<number>(0);
  lastChunkDurationMs = signal<number>(0);
  currentBitrateMbps = signal<number>(0);
  bufferAheadSeconds = signal<number>(0);
  droppedFrames = signal<number>(0);
  totalFrames = signal<number>(0);

  // Quality Levels
  availableQualities = signal<QualityLevel[]>([]);
  currentQualityId = signal<number>(-1); // -1 = Auto
  currentResolutionLabel = signal('Auto');

  // Menus
  showSettingsMenu = signal(false);
  showQualityMenu = signal(false);
  showSpeedMenu = signal(false);

  // Effective duration (falls back to Firestore metadata duration if video element is still loading)
  effectiveDuration = computed(() => {
    const d = this.duration();
    if (d > 0) return d;
    return this.vod()?.durationSeconds || 0;
  });

  // Computed Progress percentage for timeline bar (smoothly tracks thumb during drag)
  playedPercent = computed(() => {
    const dur = this.effectiveDuration();
    if (!dur || dur <= 0) return 0;
    const cur = this.isDragging() && this.dragTime() !== null ? this.dragTime()! : this.currentTime();
    return Math.min(100, Math.max(0, (cur / dur) * 100));
  });

  // Active Chapter computed for current hover/scrub position
  activeChapter = computed(() => {
    const time = this.hoverTime() !== null ? this.hoverTime()! : this.currentTime();
    const chapters = this.vod()?.chapters;
    if (!chapters || chapters.length === 0) return null;
    const sorted = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
    let matched = sorted[0];
    for (const ch of sorted) {
      if (ch.startSeconds <= time) {
        matched = ch;
      } else {
        break;
      }
    }
    return matched ? matched.title : null;
  });

  // Preview thumbnail styling (supporting sprite sheets or poster fallback)
  previewStyle = computed(() => {
    const video = this.vod();
    const time = this.hoverTime() || 0;
    if (!video) {
      return {};
    }
    if (video.spriteSheetUrl) {
      const interval = video.spriteIntervalSeconds || 5;
      const width = video.spriteWidth || 160;
      const height = video.spriteHeight || 90;
      const frameIdx = Math.floor(time / interval);
      const cols = 10;
      const col = frameIdx % cols;
      const row = Math.floor(frameIdx / cols);
      return {
        'background-image': `url(${video.spriteSheetUrl})`,
        'background-position': `-${col * width}px -${row * height}px`,
        'background-repeat': 'no-repeat',
        'width.px': width,
        'height.px': height,
      };
    }
    const poster = this.posterUrl || video.thumbnailUrl;
    if (poster) {
      return {
        'background-image': `url(${poster})`,
        'background-size': 'cover',
        'background-position': 'center',
        'width': '140px',
        'height': '78px',
      };
    }
    return {
      'background-color': '#18181b',
      'width': '120px',
      'height': '68px',
    };
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!this.containerRef?.nativeElement?.contains(target)) {
      this.closeAllMenus();
    }
  }

  closeAllMenus(): void {
    this.showSettingsMenu.set(false);
    this.showQualityMenu.set(false);
    this.showSpeedMenu.set(false);
  }

  toggleSettings(event: MouseEvent): void {
    event.stopPropagation();
    if (this.showSettingsMenu() || this.showQualityMenu() || this.showSpeedMenu()) {
      this.closeAllMenus();
    } else {
      this.showSettingsMenu.set(true);
    }
  }

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
      this.emitStreamingStats();
    }, 2000);
  }

  private updateQualityLevels(rawLevels?: any[]): void {
    const levelsList = rawLevels && rawLevels.length > 0 ? rawLevels : (this.hls?.levels || []);
    if (levelsList && levelsList.length > 1) {
      const levels: QualityLevel[] = [
        { id: -1, label: 'Auto', bitrate: 0, height: 0 },
        ...levelsList
          .map((lvl: any, index: number) => ({
            id: index,
            label: lvl.height ? `${lvl.height}p` : `Level ${index + 1}`,
            bitrate: lvl.bitrate || 0,
            height: lvl.height || 0,
          }))
          .reverse(),
      ];
      this.availableQualities.set(levels);
    } else {
      const vodRes = this.vod()?.resolutions;
      const resList =
        vodRes && vodRes.length > 0
          ? vodRes
          : ['1080p', '720p', '480p', '360p'];

      const parseHeight = (r: string): number => {
        const match = r.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const estimateBitrate = (h: number): number => {
        if (h >= 2160) return 12000000;
        if (h >= 1080) return 4500000;
        if (h >= 720) return 2200000;
        if (h >= 480) return 1200000;
        if (h >= 360) return 800000;
        return 500000;
      };

      const levels: QualityLevel[] = [
        { id: -1, label: 'Auto', bitrate: 0, height: 0 },
        ...resList.map((r, idx) => {
          const h = parseHeight(r);
          return {
            id: idx,
            label: r,
            bitrate: estimateBitrate(h),
            height: h,
          };
        }),
      ];
      this.availableQualities.set(levels);
    }

    // Restore user preferred quality from local storage if available
    try {
      if (typeof window !== 'undefined' && 'localStorage' in window) {
        const savedPref = localStorage.getItem('ilc_preferred_video_quality');
        if (savedPref && savedPref !== 'Auto') {
          const match = this.availableQualities().find(
            (l) => l.label === savedPref || `${l.height}p` === savedPref || (l.height > 0 && savedPref.includes(`${l.height}p`)),
          );
          if (match && match.id >= 0 && this.currentQualityId() === -1) {
            this.setQuality(match.id, false);
          }
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  private emitStreamingStats(): void {
    const video = this.videoRef?.nativeElement;
    const dur = this.effectiveDuration();
    const pos = this.currentTime() || 0;
    const playedPct = dur > 0 ? Math.min(100, Math.max(0, (pos / dur) * 100)) : 0;

    let dropped = this.droppedFrames();
    let totalF = this.totalFrames();
    if (video && 'getVideoPlaybackQuality' in video) {
      const q = (video as any).getVideoPlaybackQuality?.();
      if (q) {
        dropped = q.droppedVideoFrames || 0;
        totalF = q.totalVideoFrames || 0;
        this.droppedFrames.set(dropped);
        this.totalFrames.set(totalF);
      }
    }

    const state: 'playing' | 'paused' | 'buffering' | 'idle' = this.isBuffering()
      ? 'buffering'
      : this.isPlaying()
        ? 'playing'
        : pos > 0
          ? 'paused'
          : 'idle';

    const bufAhead = this.bufferAheadSeconds();
    let estBitrateBps = 0;
    if (this.currentQualityId() >= 0) {
      if (this.hls && this.hls.levels && this.hls.levels[this.currentQualityId()]) {
        estBitrateBps = this.hls.levels[this.currentQualityId()].bitrate || 0;
      }
      if (!estBitrateBps) {
        const q = this.availableQualities().find((item) => item.id === this.currentQualityId());
        estBitrateBps = q?.bitrate || 0;
      }
    } else {
      if (this.hls && this.hls.levels && this.hls.levels.length > 0) {
        const curLvlIndex = this.hls.currentLevel >= 0 ? this.hls.currentLevel : (this.hls.loadLevel >= 0 ? this.hls.loadLevel : 0);
        const lvl = this.hls.levels[curLvlIndex];
        if (lvl && lvl.bitrate) {
          estBitrateBps = lvl.bitrate;
        } else {
          const sum = this.hls.levels.reduce((acc, l) => acc + (l.bitrate || 0), 0);
          estBitrateBps = Math.round(sum / this.hls.levels.length);
        }
      }
    }

    if (!estBitrateBps && this.currentBitrateMbps() > 0) {
      estBitrateBps = this.currentBitrateMbps() * 1000000;
    }
    if (!estBitrateBps) {
      estBitrateBps = 2400000; // ~2.4 Mbps default
    }

    const remDur = Math.max(0, dur - pos);
    const totalResolutionSizeBytes = dur > 0 ? Math.round(dur * (estBitrateBps / 8)) : (this.vod()?.originalSize || 0);
    const remainingWatchBytes = remDur > 0 ? Math.round(remDur * (estBitrateBps / 8)) : 0;
    const totalWatchSessionBytes = this.totalBytesDownloaded() + remainingWatchBytes;
    const bytesAhead = Math.max(0, Math.round(bufAhead * (estBitrateBps / 8)));

    const activeQ = this.currentQualityId() === -1
      ? (this.currentResolutionLabel().includes('Auto') ? this.currentResolutionLabel() : `Auto (${this.currentResolutionLabel()})`)
      : this.currentResolutionLabel();

    const resolutionLadder: ResolutionSizeEstimate[] = this.availableQualities().map((q) => {
      let bBps = q.bitrate || 0;
      if (!bBps) {
        if (q.height >= 2160) bBps = 12000000;
        else if (q.height >= 1080) bBps = 4800000;
        else if (q.height >= 720) bBps = 2400000;
        else if (q.height >= 480) bBps = 1200000;
        else if (q.height >= 360) bBps = 800000;
        else bBps = estBitrateBps;
      }
      const estBytes = dur > 0 ? Math.round(dur * (bBps / 8)) : 0;
      return {
        id: q.id,
        label: q.label,
        height: q.height,
        bitrateMbps: bBps / 1000000,
        estimatedSizeBytes: estBytes,
      };
    });

    const stats: StreamingStats = {
      engine: this.streamingEngine(),
      currentPosition: pos,
      duration: dur,
      bufferAheadSeconds: bufAhead,
      bufferedPercent: this.bufferedPercent(),
      totalBytesDownloaded: this.totalBytesDownloaded(),
      totalResolutionSizeBytes,
      totalEstimatedSizeBytes: totalResolutionSizeBytes,
      totalWatchSessionBytes,
      remainingWatchBytes,
      bytesAheadCached: bytesAhead,
      lastChunkBytes: this.lastChunkBytes(),
      lastChunkDurationMs: this.lastChunkDurationMs(),
      currentBitrateMbps: this.currentBitrateMbps(),
      currentResolution: this.currentResolutionLabel(),
      activeQualityLabel: activeQ,
      droppedFrames: dropped,
      totalFrames: totalF,
      playerState: state,
      url: this.manifestUrl || this.vod()?.manifestUrl || '',
      playedPercent: playedPct,
      resolutionLadder,
    };
    this.statsUpdated.emit(stats);
  }

  private setupHls(src: string, video: HTMLVideoElement): void {
    const isHls =
      src.includes('.m3u8') ||
      (src.startsWith('blob:') && src.includes('m3u8'));

    if (isHls && Hls.isSupported()) {
      this.streamingEngine.set('HLS.js');
      this.hls = new Hls({
        fLoader: CachedHlsFragmentLoader as any,
        capLevelToPlayerSize: true,
        autoStartLoad: true,
        startPosition:
          this.initialPositionSeconds > 0 ? this.initialPositionSeconds : -1,
        // Mobile & cellular connection buffering & caching optimizations
        maxBufferLength: 60, // Keep buffering up to 60s ahead (default is only 30s)
        maxMaxBufferLength: 180, // Allow buffering up to 3 minutes ahead on stable connection
        maxBufferSize: 150 * 1000 * 1000, // 150MB buffer memory limit
        startFragPrefetch: true, // Prefetch first video chunk in parallel with manifest loading
        lowLatencyMode: false, // Ensure high-throughput VOD mode rather than low-latency live
        backBufferLength: 60, // Retain 60s behind playhead so scrubbing backwards is instant
        enableWorker: true, // Use Web Worker for TS demuxing to avoid UI thread lag on mobile
        abrEwmaDefaultEstimate: 2500000, // 2.5 Mbps starting estimate for immediate smooth playback
        abrBandWidthFactor: 0.9, // 90% bandwidth safety factor against cellular latency spikes
        abrBandWidthUpFactor: 0.7, // Conservative quality step-up to avoid switching churn
        fragLoadingTimeOut: 25000, // 25s timeout for mobile cell tower transitions
        fragLoadingMaxRetry: 6, // 6 retries for flaky cellular signal
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 64000,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 6,
      });

      this.hls.loadSource(src);
      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        this.updateQualityLevels(data.levels);
        if (this.pendingSeekPosition !== null) {
          video.currentTime = this.pendingSeekPosition;
          this.pendingSeekPosition = null;
        }
        if (this.autoplay) {
          video.play().catch(() => this.isPlaying.set(false));
        }
        this.emitStreamingStats();
      });

      this.hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
        if (this.availableQualities().length <= 1 && this.hls?.levels?.length) {
          this.updateQualityLevels(this.hls.levels);
        }
      });

      this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        const lvl = this.hls?.levels[data.level];
        if (lvl) {
          if (lvl.width && lvl.height) {
            this.aspectRatio.set(`${lvl.width} / ${lvl.height}`);
          }
          if (this.currentQualityId() === -1) {
            this.currentResolutionLabel.set(`Auto (${lvl.height}p)`);
          } else {
            this.currentResolutionLabel.set(`${lvl.height}p`);
          }
        }
        this.emitStreamingStats();
      });

      this.hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        const stats = (data as any).stats || data.frag?.stats;
        const rawPayload = (data as any).payload;
        const byteLength =
          (rawPayload instanceof ArrayBuffer ? rawPayload.byteLength : 0) ||
          (rawPayload && typeof rawPayload === 'object' && 'byteLength' in rawPayload ? (rawPayload as any).byteLength : 0) ||
          stats?.total ||
          stats?.loaded ||
          (data.frag as any)?.loaded ||
          (data.frag as any)?.byteLength ||
          (data.frag?.duration && stats?.bitrate ? Math.round(data.frag.duration * (stats.bitrate / 8)) : 0) ||
          0;

        const start = stats?.loading?.start || stats?.trequest || 0;
        const end = stats?.loading?.end || stats?.tload || performance.now();
        const loadTimeMs = end > start ? Math.round(end - start) : (stats?.tload && stats?.tfirst ? Math.round(stats.tload - stats.tfirst) : 50);

        if (byteLength > 0) {
          this.totalBytesDownloaded.update((prev) => prev + byteLength);
          this.lastChunkBytes.set(byteLength);
          this.lastChunkDurationMs.set(loadTimeMs);

          if (loadTimeMs > 0) {
            const mbps = (byteLength * 8) / (loadTimeMs / 1000) / 1000000;
            if (mbps > 0 && mbps < 1000) {
              this.currentBitrateMbps.set(mbps);
            }
          }
        }
        this.emitStreamingStats();
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
      this.streamingEngine.set('Native HLS');
      this.playDirect(src, video);
    } else {
      // Direct progressive video playback (e.g. MP4, WebM, or raw Cloud Storage download URL)
      this.streamingEngine.set('Direct Progressive');
      this.playDirect(src, video);
    }
  }

  private playDirect(src: string, video: HTMLVideoElement): void {
    video.src = src;
    // Assigning `src` resets the element's playbackRate to 1 per the HTML
    // media-load algorithm; reapply the user's chosen rate so it survives
    // reloads (e.g. the HLS.js fatal-error fallback mid-playback).
    video.playbackRate = this.playbackRate();
    this.updateQualityLevels();
    if (this.initialPositionSeconds > 0) {
      video.currentTime = this.initialPositionSeconds;
    }
    if (this.autoplay) {
      video.play().catch(() => this.isPlaying.set(false));
    }
  }

  private setupNativeEvents(video: HTMLVideoElement): void {
    let lastProgressTime = performance.now();
    let lastProgressBufferEnd = 0;

    const applyPendingSeek = () => {
      if (this.pendingSeekPosition !== null && video.readyState >= 1) {
        try {
          video.currentTime = this.pendingSeekPosition;
          this.pendingSeekPosition = null;
        } catch {
          // Retry on next state update
        }
      }
    };

    const updateBuffer = () => {
      const dur = this.effectiveDuration();
      if (!dur || dur <= 0 || !video.buffered) return;
      const current = video.currentTime;
      let activeEnd = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= current && current <= video.buffered.end(i)) {
          activeEnd = video.buffered.end(i);
          const pct = Math.min(100, Math.max(0, (activeEnd / dur) * 100));
          this.bufferedPercent.set(pct);
          this.bufferAheadSeconds.set(Math.max(0, activeEnd - current));
          break;
        }
      }

      // Track bytes from native buffer progress when HLS.js is not managing individual fragment events
      const totalBufferedSec = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0;
      if (this.totalBytesDownloaded() === 0 || this.streamingEngine() !== 'HLS.js') {
        const now = performance.now();
        const timeDeltaMs = Math.max(20, now - lastProgressTime);
        const estBitrateBps = this.currentBitrateMbps() > 0
          ? this.currentBitrateMbps() * 1000000
          : 2500000;

        if (totalBufferedSec > lastProgressBufferEnd) {
          const bufferDeltaSec = totalBufferedSec - lastProgressBufferEnd;
          const chunkBytes = Math.round(bufferDeltaSec * (estBitrateBps / 8));
          if (chunkBytes > 0) {
            this.totalBytesDownloaded.update((p) => p + chunkBytes);
            this.lastChunkBytes.set(chunkBytes);
            this.lastChunkDurationMs.set(Math.round(timeDeltaMs));
            const mbps = (chunkBytes * 8) / (timeDeltaMs / 1000) / 1000000;
            if (mbps > 0 && mbps < 1000) {
              this.currentBitrateMbps.set(mbps);
            }
          }
          lastProgressBufferEnd = totalBufferedSec;
          lastProgressTime = now;
        }
      }

      // Ensure HLS loader stays active if buffer ahead is under 60 seconds
      if (this.hls && this.bufferAheadSeconds() < 60) {
        this.hls.startLoad();
      }
    };

    const updateVideoDimensions = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        this.aspectRatio.set(`${video.videoWidth} / ${video.videoHeight}`);
      }
    };

    video.addEventListener('loadedmetadata', () => {
      this.duration.set(video.duration);
      updateVideoDimensions();
      applyPendingSeek();
      updateBuffer();
      this.emitStreamingStats();
    });
    video.addEventListener('canplay', () => {
      updateVideoDimensions();
      applyPendingSeek();
      updateBuffer();
    });
    video.addEventListener('play', () => {
      this.isPlaying.set(true);
      this.closeAllMenus();
      this.emitStreamingStats();
    });
    video.addEventListener('pause', () => {
      this.isPlaying.set(false);
      this.timeUpdated.emit(this.currentTime());
      this.emitStreamingStats();
    });
    video.addEventListener('waiting', () => {
      this.isBuffering.set(true);
      this.emitStreamingStats();
    });
    video.addEventListener('playing', () => {
      this.isBuffering.set(false);
      this.emitStreamingStats();
    });
    video.addEventListener('progress', () => {
      updateBuffer();
      this.emitStreamingStats();
    });
    video.addEventListener('timeupdate', () => {
      if (!this.isDragging()) {
        this.currentTime.set(video.currentTime);
      }
      updateBuffer();
      if (this.effectiveDuration() > 0 && video.currentTime / this.effectiveDuration() >= 0.95) {
        this.videoCompleted.emit();
      }
    });
    video.addEventListener('durationchange', () => {
      this.duration.set(video.duration);
      applyPendingSeek();
      updateBuffer();
      this.emitStreamingStats();
    });
    video.addEventListener('webkitbeginfullscreen', () => {
      this.isFullscreen.set(true);
    });
    video.addEventListener('webkitendfullscreen', () => {
      this.isFullscreen.set(false);
    });
    // Keep the signal in sync if the rate changes outside of setSpeed()
    // (e.g. reset by the browser on src reassignment, or changed via
    // native player controls), so the speed menu never gets stuck showing
    // a rate the video isn't actually playing at.
    video.addEventListener('ratechange', () => {
      if (video.playbackRate !== this.playbackRate()) {
        this.playbackRate.set(video.playbackRate);
      }
    });
  }

  @HostListener('document:fullscreenchange')
  @HostListener('document:webkitfullscreenchange')
  onFullscreenChange(): void {
    const container = this.containerRef?.nativeElement;
    const video = this.videoRef?.nativeElement;
    const doc = document as any;
    const isFull =
      Boolean(container && (doc.fullscreenElement === container || doc.webkitFullscreenElement === container)) ||
      Boolean(video && (doc.fullscreenElement === video || doc.webkitFullscreenElement === video));
    this.isFullscreen.set(isFull);
  }

  togglePlay(): void {
    this.closeAllMenus();
    const video = this.videoRef.nativeElement;
    if (video.paused) {
      video.play().catch(() => this.isPlaying.set(false));
    } else {
      video.pause();
    }
  }

  seek(seconds: number): void {
    this.closeAllMenus();
    const dur = this.effectiveDuration();
    const target = Math.max(0, Math.min(seconds, dur > 0 ? dur : seconds));
    this.currentTime.set(target);

    const video = this.videoRef?.nativeElement;
    if (!video) return;

    if (video.readyState >= 1) {
      try {
        video.currentTime = target;
        this.pendingSeekPosition = null;
      } catch {
        this.pendingSeekPosition = target;
      }
    } else {
      this.pendingSeekPosition = target;
    }
    this.emitStreamingStats();
  }

  onTimelinePointerDown(event: PointerEvent): void {
    this.closeAllMenus();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    this.isDragging.set(true);
    this.wasPlayingBeforeDrag = this.isPlaying();
    const video = this.videoRef?.nativeElement;
    if (video && !video.paused) {
      video.pause();
    }
    this.updateTimelinePosition(event, target, true);
  }

  onTimelinePointerMove(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    this.updateTimelinePosition(event, target, this.isDragging());
  }

  onTimelinePointerUp(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    if (this.isDragging()) {
      const targetTime = this.dragTime();
      this.isDragging.set(false);
      this.dragTime.set(null);
      if (targetTime !== null) {
        this.seek(targetTime);
      }
      if (this.wasPlayingBeforeDrag) {
        const video = this.videoRef?.nativeElement;
        video?.play().catch(() => this.isPlaying.set(false));
      }
    }
  }

  onTimelinePointerCancel(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    this.isDragging.set(false);
    this.dragTime.set(null);
    this.showHoverPreview.set(false);
  }

  onTimelinePointerLeave(event: PointerEvent): void {
    if (!this.isDragging()) {
      this.showHoverPreview.set(false);
    }
  }

  private updateTimelinePosition(event: PointerEvent | MouseEvent, target: HTMLElement, isDrag: boolean): void {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clampedX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const pct = clampedX / rect.width;
    const dur = this.effectiveDuration();
    const targetTime = pct * dur;

    this.hoverPixelX.set(clampedX);
    this.hoverTime.set(targetTime);
    this.showHoverPreview.set(true);

    if (isDrag) {
      this.dragTime.set(targetTime);
      this.currentTime.set(targetTime);
    }
  }

  onTimelineClick(event: MouseEvent): void {
    this.closeAllMenus();
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const pos = (event.clientX - rect.left) / rect.width;
    this.seek(pos * this.effectiveDuration());
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

  setQuality(levelId: number, savePreference = true): void {
    this.currentQualityId.set(levelId);
    if (levelId === -1) {
      if (this.hls) {
        this.hls.currentLevel = -1;
        this.hls.loadLevel = -1;
        this.hls.nextLevel = -1;
        this.hls.startLoad();
      }
      if (this.hls && this.hls.currentLevel >= 0 && this.hls.levels[this.hls.currentLevel]) {
        const lvl = this.hls.levels[this.hls.currentLevel];
        this.currentResolutionLabel.set(`Auto (${lvl.height}p)`);
      } else {
        this.currentResolutionLabel.set('Auto');
      }
      if (savePreference) {
        try {
          if (typeof window !== 'undefined' && 'localStorage' in window) {
            localStorage.setItem('ilc_preferred_video_quality', 'Auto');
          }
        } catch {}
      }
    } else {
      const q = this.availableQualities().find((item) => item.id === levelId);
      const label = q ? q.label : 'Auto';
      this.currentResolutionLabel.set(label);

      if (this.hls && this.hls.levels && this.hls.levels.length > 0) {
        let targetIndex = -1;
        if (q && q.height > 0) {
          targetIndex = this.hls.levels.findIndex((lvl) => lvl.height === q.height);
        }
        if (targetIndex === -1 && levelId >= 0 && levelId < this.hls.levels.length) {
          targetIndex = levelId;
        }
        if (targetIndex >= 0) {
          this.hls.currentLevel = targetIndex;
          this.hls.loadLevel = targetIndex;
          this.hls.nextLevel = targetIndex;
          this.hls.startLoad();
        }
      }

      if (savePreference && q) {
        try {
          if (typeof window !== 'undefined' && 'localStorage' in window) {
            localStorage.setItem('ilc_preferred_video_quality', q.label);
          }
        } catch {}
      }
    }
    this.showQualityMenu.set(false);
    this.showSettingsMenu.set(false);
    this.emitStreamingStats();
  }

  selectQualityByLabel(label: string): void {
    const cleaned = label.trim().toLowerCase();
    if (cleaned === 'auto') {
      this.setQuality(-1);
      return;
    }
    const match = this.availableQualities().find(
      (q) =>
        q.label.toLowerCase() === cleaned ||
        q.label.toLowerCase().replace(/[^0-9a-z]/g, '') === cleaned.replace(/[^0-9a-z]/g, '') ||
        (q.height > 0 && `${q.height}p` === cleaned),
    );
    if (match) {
      this.setQuality(match.id);
    }
  }

  setSpeed(rate: number): void {
    const video = this.videoRef.nativeElement;
    video.playbackRate = rate;
    this.playbackRate.set(rate);
    this.showSpeedMenu.set(false);
    this.showSettingsMenu.set(false);
  }

  toggleFullscreen(): void {
    const container = this.containerRef?.nativeElement;
    if (!container) return;
    const video = this.videoRef?.nativeElement;
    const doc = document as any;
    const isFull =
      Boolean(container && (doc.fullscreenElement === container || doc.webkitFullscreenElement === container)) ||
      Boolean(video && (doc.fullscreenElement === video || doc.webkitFullscreenElement === video));

    if (!isFull) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      } else if ((video as any)?.webkitEnterFullscreen) {
        (video as any).webkitEnterFullscreen();
      }
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
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
