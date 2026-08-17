/* video-view.ts
 *
 * Dedicated Video on Demand (VOD) watch and detail page.
 *
 * Features:
 * - Entitlement-gated playback session resolution
 * - Seamless integration with <app-video-player> for authorized sessions
 * - Informative lock screen with contextual purchase/subscription actions
 * - Resume playback from last saved timestamp
 * - Chapters navigation list
 * - Instructor details with link to instructor profile
 * - Related video recommendations
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  VideoItem,
  VodAccessTier,
  VodStatus,
  VideoProgress,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { StripeService } from '../stripe.service';
import { VideoPlayerComponent, StreamingStats } from '../video-player/video-player';
import { IconComponent, IconName } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { VodOfflineStorageService } from '../vod-offline-storage.service';

export interface PlaybackSessionState {
  authorized: boolean;
  manifestUrl?: string;
  title?: string;
  durationSeconds?: number;
  reason?:
    | 'unauthenticated'
    | 'subscription_required'
    | 'instructor_required'
    | 'class_sub_required'
    | 'purchase_required';
  priceCents?: number;
  stripePriceId?: string;
  trailerVideoId?: string;
  trailerManifestUrl?: string;
}

@Component({
  selector: 'app-video-view',
  standalone: true,
  imports: [VideoPlayerComponent, IconComponent, SpinnerComponent],
  templateUrl: './video-view.html',
  styleUrl: './video-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoViewComponent implements OnInit {
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  public stripeService = inject(StripeService);
  public offlineStorage = inject(VodOfflineStorageService);

  private viewSignals = this.routingService.signals[Views.VideoView];

  // Path Variable
  videoId = computed(() => this.viewSignals.pathVars.videoId());

  // State Signals
  video = signal<VideoItem | null>(null);
  trailerVideo = signal<VideoItem | null>(null);
  sessionState = signal<PlaybackSessionState | null>(null);
  trailerSessionState = signal<PlaybackSessionState | null>(null);
  isPlayingTrailer = signal(false);
  isLoading = signal(true);
  isPurchasing = signal(false);
  initialPositionSeconds = signal(0);
  errorMessage = signal<string | null>(null);

  // Streaming Diagnostics
  streamingStats = signal<StreamingStats | null>(null);
  showDebugDetails = signal(false);

  // Computed Active Video & Manifest
  hasTrailer = computed(() => {
    const v = this.video();
    const s = this.sessionState();
    return Boolean(v?.trailerVideoId || v?.trailerUrl || s?.trailerVideoId || s?.trailerManifestUrl);
  });

  activeManifestUrl = computed(() => {
    if (this.isPlayingTrailer()) {
      return (
        this.trailerSessionState()?.manifestUrl ||
        this.sessionState()?.trailerManifestUrl ||
        this.trailerVideo()?.manifestUrl ||
        ''
      );
    }
    return this.sessionState()?.manifestUrl || '';
  });

  activeVideoData = computed<VideoItem | null>(() => {
    if (this.isPlayingTrailer() && this.trailerVideo()) {
      return this.trailerVideo();
    }
    return this.video();
  });

  activePosterUrl = computed(() => {
    if (this.isPlayingTrailer() && this.trailerVideo()?.thumbnailUrl) {
      return this.trailerVideo()!.thumbnailUrl;
    }
    return this.video()?.thumbnailUrl || '';
  });

  canStreamActiveVideo = computed(() => {
    if (this.isPlayingTrailer()) {
      return Boolean(this.activeManifestUrl());
    }
    return Boolean(this.sessionState()?.authorized && this.sessionState()?.manifestUrl);
  });

  // Related Videos
  relatedVideos = computed<VideoItem[]>(() => {
    const curr = this.video();
    if (!curr) return [];
    return this.dataService.videos
      .entries()
      .filter((v) => v.isPublished && !v.isTrailer && v.docId !== curr.docId)
      .slice(0, 4);
  });

  async ngOnInit(): Promise<void> {
    const id = this.videoId();
    if (!id) {
      this.errorMessage.set('No video ID provided.');
      this.isLoading.set(false);
      return;
    }

    await this.loadVideo(id);
  }

  async loadVideo(id: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.trailerVideo.set(null);
    this.trailerSessionState.set(null);

    try {
      // 1. Fetch Video Metadata
      const videoData = await this.dataService.getVideoById(id);
      if (!videoData) {
        this.errorMessage.set('Video not found in catalog.');
        this.isLoading.set(false);
        return;
      }
      this.video.set(videoData);

      // 2. Fetch Saved Progress
      try {
        const savedProgress = await this.dataService.getVideoProgress(id);
        if (
          savedProgress &&
          !savedProgress.completed &&
          savedProgress.lastPositionSeconds > 5
        ) {
          this.initialPositionSeconds.set(savedProgress.lastPositionSeconds);
        }
      } catch {
        // Progress lookup is optional
      }

      // 3. Request Playback Session
      const session = await this.dataService.getVideoPlaybackSession(id);
      this.sessionState.set(session);

      // 4. Load Trailer Metadata & Session if present
      const trailerId = videoData.trailerVideoId || session.trailerVideoId;
      if (trailerId) {
        try {
          const [tVideo, tSession] = await Promise.all([
            this.dataService.getVideoById(trailerId),
            this.dataService.getVideoPlaybackSession(trailerId),
          ]);
          this.trailerVideo.set(tVideo);
          this.trailerSessionState.set(tSession);
        } catch (tErr) {
          console.warn('Could not load trailer session:', tErr);
        }
      }

      // 5. Initial Playback State
      if (!session.authorized && (trailerId || session.trailerManifestUrl)) {
        this.isPlayingTrailer.set(true);
      } else {
        this.isPlayingTrailer.set(false);
      }
    } catch (err: any) {
      console.error('Failed to load video or playback session:', err);
      this.errorMessage.set(
        err.message || 'Could not load video playback session.',
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  playTrailer(): void {
    this.isPlayingTrailer.set(true);
  }

  playFullVideo(): void {
    this.isPlayingTrailer.set(false);
  }

  onTimeUpdated(currentSeconds: number): void {
    const v = this.video();
    if (!v) return;
    this.dataService
      .saveVideoProgress(v.docId, currentSeconds, v.durationSeconds, false)
      .catch((err) => console.warn('Could not sync video progress:', err));
  }

  onVideoCompleted(): void {
    const v = this.video();
    if (!v) return;
    this.dataService
      .saveVideoProgress(v.docId, v.durationSeconds, v.durationSeconds, true)
      .catch((err) => console.warn('Could not sync video completion:', err));
  }

  async startPurchase(): Promise<void> {
    const v = this.video();
    const session = this.sessionState();
    const priceId = session?.stripePriceId || v?.stripePriceId;
    if (!priceId) {
      alert('This video is not currently available for individual purchase.');
      return;
    }

    this.isPurchasing.set(true);
    try {
      const origin = window.location.origin;
      const checkout = await this.stripeService.createCheckoutSession(
        priceId,
        origin,
        1,
        {
          metadata: {
            videoId: v?.docId || '',
            orderType: 'vod',
          },
          successUrl: `${origin}/videos/${v?.docId}`,
          cancelUrl: `${origin}/videos/${v?.docId}`,
        },
      );
      if (checkout.checkoutUrl) {
        window.location.href = checkout.checkoutUrl;
      } else {
        alert('Could not initialize checkout. Please try again.');
      }
    } catch (err: any) {
      console.error('Purchase error:', err);
      alert(err.message || 'Payment initiation failed.');
    } finally {
      this.isPurchasing.set(false);
    }
  }

  getAccessSummary(video: VideoItem): string {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);

    const labels: string[] = [];
    if (tiers.includes(VodAccessTier.Public)) labels.push('Free / Public');
    if (tiers.includes(VodAccessTier.MembersOnly)) labels.push('Members');
    if (tiers.includes(VodAccessTier.InstructorsOnly)) labels.push('Instructors');
    if (tiers.includes(VodAccessTier.ClassVideoSubscribers)) labels.push('Class Subscribers');

    const isBuyable = Boolean(
      video.isBuyable ||
      tiers.includes(VodAccessTier.DirectPurchase) ||
      (video.priceCents && video.priceCents > 0),
    );
    if (isBuyable) {
      const priceStr = video.priceCents ? `$${(video.priceCents / 100).toFixed(2)}` : 'Paid';
      labels.push(`Buy (${priceStr})`);
    }

    return labels.length > 0 ? labels.join(' • ') : 'Members Only';
  }

  isBuyable(video: VideoItem): boolean {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);
    return Boolean(
      video.isBuyable ||
      tiers.includes(VodAccessTier.DirectPurchase) ||
      (video.priceCents && video.priceCents > 0),
    );
  }

  formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0 min';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  }

  getVideoHref(video: VideoItem): string {
    return this.routingService.hrefForView(Views.VideoView, {
      videoId: video.docId,
    });
  }

  isClassLibraryVideo = computed(() => {
    const v = this.video();
    if (!v) return false;
    return (
      v.accessTier === VodAccessTier.ClassVideoSubscribers ||
      (Array.isArray(v.accessTiers) && v.accessTiers.includes(VodAccessTier.ClassVideoSubscribers))
    );
  });

  getCatalogHref(): string {
    if (this.isClassLibraryVideo()) {
      return this.routingService.hrefForView(Views.ClassVideoLibrary);
    }
    return this.routingService.hrefForView(Views.Videos);
  }

  getCatalogLabel(): string {
    if (this.isClassLibraryVideo()) {
      return 'Back to Class Video Library';
    }
    return 'Back to Video Catalog';
  }

  getLoginHref(): string {
    return this.routingService.hrefForView(Views.Login, {});
  }

  getMembershipHref(): string {
    if (this.isClassLibraryVideo()) {
      return this.routingService.hrefForView(Views.ClassVideoLibraryPurchase);
    }
    return this.routingService.hrefForView(Views.MyOrders, {});
  }

  getAccessTierChips(video: VideoItem): { label: string; icon: IconName }[] {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);

    const chips: { label: string; icon: IconName }[] = [];
    if (tiers.includes(VodAccessTier.Public)) {
      chips.push({ label: 'Public (Free)', icon: 'public' });
    }
    if (tiers.includes(VodAccessTier.MembersOnly)) {
      chips.push({ label: 'Members Only', icon: 'person' });
    }
    if (tiers.includes(VodAccessTier.InstructorsOnly)) {
      chips.push({ label: 'Instructors Only', icon: 'military_tech' });
    }
    if (tiers.includes(VodAccessTier.ClassVideoSubscribers)) {
      chips.push({ label: 'Class Subscribers', icon: 'video_library' });
    }

    const isBuyable = Boolean(
      video.isBuyable ||
      tiers.includes(VodAccessTier.DirectPurchase) ||
      (video.priceCents && video.priceCents > 0),
    );
    if (isBuyable) {
      const priceStr = video.priceCents ? `$${(video.priceCents / 100).toFixed(2)}` : 'Paid';
      chips.push({ label: `Direct Buy (${priceStr})`, icon: 'shopping_cart' });
    }

    if (chips.length === 0) {
      chips.push({ label: 'Members Only', icon: 'person' });
    }
    return chips;
  }

  @ViewChild(VideoPlayerComponent) videoPlayer?: VideoPlayerComponent;

  getVideoResolutions(video: VideoItem): string[] {
    if (video.resolutions && video.resolutions.length > 0) {
      return video.resolutions;
    }
    return ['1080p', '720p', '480p', '360p'];
  }

  isQualityActive(res: string): boolean {
    const stats = this.streamingStats();
    if (!stats) return false;
    const active = (stats.activeQualityLabel || stats.currentResolution || '').toLowerCase().replace(/[^0-9a-z]/g, '');
    const target = res.toLowerCase().replace(/[^0-9a-z]/g, '');
    return active.includes(target);
  }

  onQualitySelected(res: string): void {
    this.videoPlayer?.selectQualityByLabel(res);
  }

  getResolutionSizeEstimate(res: string): string {
    const stats = this.streamingStats();
    if (stats?.resolutionLadder && stats.resolutionLadder.length > 0) {
      const cleaned = res.toLowerCase().replace(/[^0-9a-z]/g, '');
      const match = stats.resolutionLadder.find((lvl) => {
        const lvlCleaned = lvl.label.toLowerCase().replace(/[^0-9a-z]/g, '');
        return lvlCleaned === cleaned || (lvl.height > 0 && `${lvl.height}p` === cleaned);
      });
      if (match && match.estimatedSizeBytes > 0) {
        return `~${this.formatBytes(match.estimatedSizeBytes)}`;
      }
    }

    const dur = this.video()?.durationSeconds || stats?.duration || 0;
    if (!dur || dur <= 0) return '';
    const h = parseInt(res.replace(/[^0-9]/g, ''), 10) || 0;
    let bitrateBps = 2400000;
    if (h >= 2160) bitrateBps = 12000000;
    else if (h >= 1080) bitrateBps = 4800000;
    else if (h >= 720) bitrateBps = 2400000;
    else if (h >= 480) bitrateBps = 1200000;
    else if (h >= 360) bitrateBps = 800000;
    else if (h > 0) bitrateBps = 500000;

    return `~${this.formatBytes(Math.round(dur * (bitrateBps / 8)))}`;
  }

  getTagTooltip(tag: string): string {
    const meta = this.dataService.getTagMeta(tag);
    if (meta && meta.description) {
      return `#${tag}: ${meta.description}`;
    }
    return `Filter catalog by #${tag}`;
  }

  getCatalogHrefForTag(tag: string): string {
    return `${this.getCatalogHref()}?tag=${encodeURIComponent(tag)}`;
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0 || isNaN(bytes)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i] || 'B'}`;
  }

  getInstructorHref(): string {
    const v = this.video();
    if (!v || (!v.instructorDocId && !v.instructorId)) return '#';
    return this.routingService.hrefForView(Views.InstructorView, {
      instructorId: v.instructorId || v.instructorDocId,
    });
  }

  async toggleSaveOffline(video: VideoItem): Promise<void> {
    if (this.offlineStorage.isVideoSavedOffline(video.docId)) {
      await this.offlineStorage.removeVideoFromOffline(video.docId);
    } else {
      const url = this.sessionState()?.manifestUrl || video.manifestUrl;
      await this.offlineStorage.makeVideoAvailableOffline(video, url);
    }
  }

  cancelOfflineDownload(videoId: string): void {
    this.offlineStorage.cancelOfflineDownload(videoId);
  }

  async clearAllDeviceCache(): Promise<void> {
    await this.offlineStorage.clearAllCache();
  }

  formatVideoDate(video: VideoItem): string {
    const raw = video.recordedDate || video.createdAt || video.publishedAt || '';
    if (!raw) return '';
    const dateStr = raw.split('T')[0];
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }
    }
    return dateStr;
  }
}
