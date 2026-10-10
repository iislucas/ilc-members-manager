/* manage-vod-edit-video.ts
 *
 * Editable "Details" form for a single VOD video: metadata, thumbnail, access
 * tiers & pricing, series linkage, and catalog visibility. Embedded as the
 * Details tab of the admin video page (/manage-vod/video/:videoId?tab=details).
 */

import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { TagInputComponent } from '../tag-input/tag-input';
import {
  ThumbnailEditorModalComponent,
  ThumbnailSelectedEvent,
} from '../thumbnail-editor-modal/thumbnail-editor-modal';
import {
  VideoItem,
  VideoSeries,
  VodAccessTier,
  VodStatus,
  findSeriesForVideo,
} from '../../../functions/src/data-model/vod';

@Component({
  selector: 'app-manage-vod-edit-video',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SpinnerComponent,
    TagInputComponent,
    ThumbnailEditorModalComponent,
  ],
  templateUrl: './manage-vod-edit-video.html',
  styleUrl: './manage-vod-edit-video.scss',
})
export class ManageVodEditVideoComponent {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);
  protected dataService = inject(DataManagerService);
  protected firebaseState = inject(FirebaseStateService);

  readonly Views = Views;
  readonly VodAccessTier = VodAccessTier;
  readonly VodStatus = VodStatus;

  /** Firestore docId of the video being edited. */
  videoId = input.required<string>();

  // Catalog video
  private fetchedDirectVideo = signal<VideoItem | null>(null);
  video = computed<VideoItem | null>(() => {
    const vId = this.videoId();
    if (!vId) return null;
    const fetched = this.fetchedDirectVideo();
    return this.dataService.videos.get(vId) ?? (fetched?.docId === vId ? fetched : null);
  });

  // Track if form has been initialized with the current video
  private lastInitializedVideoId = signal<string>('');

  // Form Signals
  title = signal<string>('');
  description = signal<string>('');
  recordedDate = signal<string>('');
  tags = signal<string[]>([]);
  thumbnailUrl = signal<string>('');

  // Series linkage
  seriesId = signal<string>('');
  seriesTitle = signal<string>('');
  seriesDescription = signal<string>('');
  seriesPartIndex = signal<number | null>(null);

  // Access & Pricing (for standalone or custom override)
  freeAccessTier = signal<VodAccessTier>(VodAccessTier.MembersOnly);
  hasClassSub = signal<boolean>(false);
  isBuyable = signal<boolean>(false);
  priceDollars = signal<number | null>(null);
  stripePriceId = signal<string>('');

  // Visibility & Spotlight
  isPublished = signal<boolean>(true);
  featured = signal<boolean>(false);

  // Status & Feedback
  isSaving = signal<boolean>(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Thumbnail Editor Modal State
  thumbnailModalOpen = signal<boolean>(false);
  isSavingThumbnail = signal<boolean>(false);

  // Associated Series Resolution
  allSeries = computed(() => this.dataService.getVideoSeriesList());
  associatedSeries = computed<VideoSeries | null>(() => {
    const v = this.video();
    if (!v) return null;
    // Prefer the series id currently typed into the form, then the stored linkage.
    const formSeriesId = this.seriesId().trim();
    const fromForm = formSeriesId ? this.allSeries().find((s) => s.seriesId === formSeriesId) : undefined;
    return fromForm ?? findSeriesForVideo(this.allSeries(), v);
  });

  isInSeries = computed(() => {
    return Boolean(
      this.seriesId().trim() ||
      this.seriesTitle().trim() ||
      this.associatedSeries(),
    );
  });

  readonly freeAccessTierOptions = [
    { value: VodAccessTier.Public, label: 'Public', description: 'Free to everyone (visitors & unauthenticated)' },
    { value: VodAccessTier.MembersOnly, label: 'Members', description: 'Active members & licensed instructors' },
    { value: VodAccessTier.InstructorsOnly, label: 'Instructors', description: 'Licensed instructors only' },
    { value: VodAccessTier.AdminOnly, label: 'Admin only', description: 'No free access (administrators only)' },
  ];

  constructor() {
    // If video not in cache, fetch directly by ID
    effect(() => {
      const vId = this.videoId();
      if (!vId) return;
      if (!this.dataService.videos.get(vId) && this.fetchedDirectVideo()?.docId !== vId) {
        this.dataService.getVideoById(vId).then((v) => {
          if (v) this.fetchedDirectVideo.set(v);
        }).catch((err) => {
          console.error('Failed to load video by ID:', err);
        });
      }
    });

    // Populate form fields whenever the loaded video resolves
    effect(() => {
      const v = this.video();
      if (!v) return;
      if (this.lastInitializedVideoId() === v.docId) return;

      this.lastInitializedVideoId.set(v.docId);
      // Don't carry feedback or an open dialog over from a previously shown video.
      this.errorMessage.set(null);
      this.successMessage.set(null);
      this.thumbnailModalOpen.set(false);
      this.title.set(v.title || '');
      this.description.set(v.description || '');
      this.recordedDate.set(v.recordedDate || '');
      this.tags.set([...(v.tags || [])]);
      this.thumbnailUrl.set(v.thumbnailUrl || '');

      this.seriesId.set(v.seriesId || v.forVodPageId || '');
      this.seriesTitle.set(v.seriesTitle || v.forVodSeriesTitle || '');
      this.seriesDescription.set(v.seriesDescription || '');
      this.seriesPartIndex.set(typeof v.seriesPartIndex === 'number' ? v.seriesPartIndex : null);

      this.freeAccessTier.set(this.getFreeAccessTier(v));
      this.hasClassSub.set(this.hasClassSubscription(v));
      this.isBuyable.set(
        Boolean(
          v.isBuyable ||
          (Array.isArray(v.accessTiers) && v.accessTiers.includes(VodAccessTier.DirectPurchase)) ||
          v.accessTier === VodAccessTier.DirectPurchase ||
          (v.priceCents && v.priceCents > 0) ||
          (v.seriesPriceCents && v.seriesPriceCents > 0),
        ),
      );
      this.priceDollars.set(v.priceCents ? v.priceCents / 100 : null);
      this.stripePriceId.set(v.stripePriceId || '');

      this.isPublished.set(v.isPublished !== false);
      this.featured.set(Boolean(v.featured));
    });
  }

  getFreeAccessTier(video: VideoItem): VodAccessTier {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : []);
    if (tiers.includes(VodAccessTier.Public)) return VodAccessTier.Public;
    if (tiers.includes(VodAccessTier.MembersOnly)) return VodAccessTier.MembersOnly;
    if (tiers.includes(VodAccessTier.InstructorsOnly)) return VodAccessTier.InstructorsOnly;
    return VodAccessTier.AdminOnly;
  }

  hasClassSubscription(video: VideoItem): boolean {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : []);
    return tiers.includes(VodAccessTier.ClassVideoSubscribers);
  }

  getSeriesHref(tab: 'overview' | 'details' = 'details'): string | null {
    const s = this.associatedSeries();
    const sId = s?.seriesId || this.seriesId().trim();
    if (!sId) return null;
    return this.routingService.hrefForView(Views.ManageVodSeries, { seriesId: sId }, { tab });
  }

  openThumbnailModal(): void {
    this.thumbnailModalOpen.set(true);
  }

  closeThumbnailModal(): void {
    this.thumbnailModalOpen.set(false);
  }

  async onVideoThumbnailSelected(result: ThumbnailSelectedEvent): Promise<void> {
    const v = this.video();
    if (!v) return;

    this.isSavingThumbnail.set(true);
    try {
      const storage = getStorage(this.firebaseState.app);
      const storagePath = `vod/${v.docId}/preview_${Date.now()}.jpg`;
      const previewRef = ref(storage, storagePath);
      await uploadBytes(previewRef, result.blob, { contentType: 'image/jpeg' });
      const newUrl = await getDownloadURL(previewRef);

      await this.dataService.updateVideoMetadata(v.docId, {
        thumbnailUrl: newUrl,
      });

      this.thumbnailUrl.set(newUrl);
      this.closeThumbnailModal();
    } catch (err: unknown) {
      console.error('Failed to update video thumbnail:', err);
      this.errorMessage.set('Failed to update thumbnail: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.isSavingThumbnail.set(false);
    }
  }

  async saveVideoChanges(): Promise<void> {
    const v = this.video();
    if (!v) return;

    const titleVal = this.title().trim();
    if (!titleVal) {
      this.errorMessage.set('Video title cannot be empty.');
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const tags = this.tags();
      const seriesId = this.seriesId().trim();
      const seriesTitle = this.seriesTitle().trim();
      const seriesDescription = this.seriesDescription().trim();
      const seriesPartIndex = this.seriesPartIndex();
      const isSeriesVideo = Boolean(seriesId || seriesTitle);

      const patch: Partial<VideoItem> = {
        title: titleVal,
        description: this.description().trim(),
        recordedDate: this.recordedDate().trim(),
        featured: this.featured(),
        isPublished: this.isPublished(),
        tags,
      };

      if (isSeriesVideo) {
        patch.seriesId = seriesId || undefined;
        patch.seriesTitle = seriesTitle || undefined;
        patch.seriesDescription = seriesDescription || undefined;
        patch.seriesPartIndex = seriesPartIndex !== null ? seriesPartIndex : undefined;
      } else {
        const freeTier = this.freeAccessTier();
        const hasClassSub = this.hasClassSub();
        const isBuyable = this.isBuyable();
        const price = this.priceDollars();
        const priceCents = isBuyable && price ? Math.round(price * 100) : undefined;
        const stripePriceId = isBuyable && this.stripePriceId().trim()
          ? this.stripePriceId().trim()
          : undefined;

        const finalTiers: VodAccessTier[] = [];
        if (freeTier !== VodAccessTier.AdminOnly) {
          finalTiers.push(freeTier);
        }
        if (hasClassSub) {
          finalTiers.push(VodAccessTier.ClassVideoSubscribers);
        }
        if (isBuyable) {
          finalTiers.push(VodAccessTier.DirectPurchase);
        }
        if (finalTiers.length === 0) {
          finalTiers.push(VodAccessTier.AdminOnly);
        }

        const primaryTier = freeTier !== VodAccessTier.AdminOnly
          ? freeTier
          : (hasClassSub ? VodAccessTier.ClassVideoSubscribers : (isBuyable ? VodAccessTier.DirectPurchase : VodAccessTier.AdminOnly));

        patch.accessTier = primaryTier;
        patch.accessTiers = finalTiers;
        patch.isBuyable = isBuyable;
        patch.priceCents = priceCents;
        patch.stripePriceId = stripePriceId;
        patch.seriesId = undefined;
        patch.seriesTitle = undefined;
        patch.seriesDescription = undefined;
        patch.seriesPartIndex = undefined;
        patch.seriesPriceCents = undefined;
        patch.seriesStripePriceId = undefined;
      }

      await this.dataService.updateVideoMetadata(v.docId, patch);

      this.successMessage.set('Video details saved.');
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Discard unsaved edits by re-populating the form from the stored video. */
  discardChanges(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.lastInitializedVideoId.set('');
  }
}
