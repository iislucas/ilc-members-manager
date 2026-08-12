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
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  VideoItem,
  VodAccessTier,
  VodCategory,
  VodStatus,
  VideoProgress,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { StripeService } from '../stripe.service';
import { VideoPlayerComponent } from '../video-player/video-player';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

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

  private viewSignals = this.routingService.signals[Views.VideoView];

  // Path Variable
  videoId = computed(() => this.viewSignals.pathVars.videoId());

  // State Signals
  video = signal<VideoItem | null>(null);
  sessionState = signal<PlaybackSessionState | null>(null);
  isLoading = signal(true);
  isPurchasing = signal(false);
  initialPositionSeconds = signal(0);
  errorMessage = signal<string | null>(null);

  // Related Videos
  relatedVideos = computed<VideoItem[]>(() => {
    const curr = this.video();
    if (!curr) return [];
    return this.dataService.videos
      .entries()
      .filter((v) => v.isPublished && v.docId !== curr.docId)
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
    } catch (err: any) {
      console.error('Failed to load video or playback session:', err);
      this.errorMessage.set(
        err.message || 'Could not load video playback session.',
      );
    } finally {
      this.isLoading.set(false);
    }
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
    const session = this.sessionState();
    const priceId = session?.stripePriceId || this.video()?.stripePriceId;
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

  getCatalogHref(): string {
    return this.routingService.hrefForView(Views.Videos, {});
  }

  getLoginHref(): string {
    return this.routingService.hrefForView(Views.Login, {});
  }

  getMembershipHref(): string {
    return this.routingService.hrefForView(Views.MyOrders, {});
  }

  getInstructorHref(): string {
    const v = this.video();
    if (!v || (!v.instructorDocId && !v.instructorId)) return '#';
    return this.routingService.hrefForView(Views.InstructorView, {
      instructorId: v.instructorId || v.instructorDocId,
    });
  }
}
