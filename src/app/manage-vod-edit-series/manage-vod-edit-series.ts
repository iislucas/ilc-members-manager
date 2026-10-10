/* manage-vod-edit-series.ts
 *
 * Editable "Details" form for a VOD series: title/description, series-wide
 * access tiers & bundle pricing, visibility, and episode membership/ordering.
 * Embedded as the Details tab of the admin series page
 * (/manage-vod/series/:seriesId?tab=details).
 */

import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { SearchableSet } from '../searchable-set';
import {
  VideoItem,
  VideoSeries,
  VodAccessTier,
  VodStatus,
} from '../../../functions/src/data-model/vod';


@Component({
  selector: 'app-manage-vod-edit-series',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
  ],
  templateUrl: './manage-vod-edit-series.html',
  styleUrl: './manage-vod-edit-series.scss',
})
export class ManageVodEditSeriesComponent {
  protected routingService = inject(RoutingService);
  protected dataService = inject(DataManagerService);

  readonly Views = Views;
  readonly VodAccessTier = VodAccessTier;
  readonly VodStatus = VodStatus;

  /** Identifier of the series being edited. */
  seriesId = input.required<string>();

  // Catalog data
  allSeries = computed(() => this.dataService.getVideoSeriesList());
  series = computed<VideoSeries | null>(() => {
    const sId = this.seriesId();
    if (!sId) return null;
    return this.allSeries().find((s) => s.seriesId === sId) ?? null;
  });

  // Track if form has been initialized with the current series
  private lastInitializedSeriesId = signal<string>('');

  // Form Signals
  seriesTitle = signal<string>('');
  seriesDescription = signal<string>('');
  seriesFreeAccessTier = signal<VodAccessTier>(VodAccessTier.MembersOnly);
  seriesHasClassSub = signal<boolean>(false);
  seriesIsBuyable = signal<boolean>(false);
  seriesPriceDollars = signal<number | null>(null);
  seriesStripePriceId = signal<string>('');
  seriesIsPublished = signal<boolean>(true);
  seriesVideos = signal<VideoItem[]>([]);

  // Search & Add Video
  selectedVideoToAdd = signal<VideoItem | null>(null);
  addVideoSearchTerm = signal<string>('');
  uploadDateFilterOption = signal<'1_month' | '3_months' | '6_months' | '1_year' | 'all' | 'custom'>('1_month');
  customUploadDate = signal<string>('');
  availableVideosCount = signal<number>(0);

  availableVideosForSeries = new SearchableSet<
    'docId',
    VideoItem
  >(
    ['title', 'instructorName', 'tags', 'docId', 'location'],
    'docId',
    [],
  );

  // Status & Feedback
  isSaving = signal<boolean>(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  readonly freeAccessTierOptions = [
    { value: VodAccessTier.Public, label: 'Public', description: 'Free to everyone (visitors & unauthenticated)' },
    { value: VodAccessTier.MembersOnly, label: 'Members', description: 'Active members & licensed instructors' },
    { value: VodAccessTier.InstructorsOnly, label: 'Instructors', description: 'Licensed instructors only' },
    { value: VodAccessTier.AdminOnly, label: 'Admin only', description: 'No free access (administrators only)' },
  ];

  seriesAddVideoDisplayFns: DisplayFns<VideoItem> = {
    toChipId: (v) => v.docId,
    toName: (v) => {
      const parts = [v.title];
      if (v.seriesTitle) {
        parts.push(`[In Series: ${v.seriesTitle}]`);
      } else {
        parts.push('[Standalone]');
      }
      if (v.instructorName) {
        parts.push(`(${v.instructorName})`);
      }
      const dateStr = v.recordedDate || (v.createdAt ? v.createdAt.slice(0, 10) : '');
      if (dateStr) {
        parts.push(`[${dateStr}]`);
      }
      if (v.durationSeconds) {
        parts.push(`- ${this.formatDuration(v.durationSeconds)}`);
      }
      return parts.join(' ');
    },
  };

  constructor() {
    // Populate form fields whenever the loaded series resolves
    effect(() => {
      const s = this.series();
      if (!s) return;
      if (this.lastInitializedSeriesId() === s.seriesId) return;

      this.lastInitializedSeriesId.set(s.seriesId);
      this.seriesTitle.set(s.title);
      this.seriesDescription.set(s.description || '');
      this.seriesPriceDollars.set(
        typeof s.priceCents === 'number' && s.priceCents > 0
          ? s.priceCents / 100
          : null,
      );
      this.seriesFreeAccessTier.set(this.getFreeAccessTier(s));
      this.seriesHasClassSub.set(this.hasClassSubscription(s));
      this.seriesIsBuyable.set(
        Boolean(
          (Array.isArray(s.accessTiers) && s.accessTiers.includes(VodAccessTier.DirectPurchase)) ||
          s.accessTier === VodAccessTier.DirectPurchase ||
          (s.priceCents && s.priceCents > 0) ||
          s.stripePriceId,
        ),
      );
      this.seriesStripePriceId.set(s.stripePriceId || '');
      this.seriesIsPublished.set(s.isPublished !== false);
      this.seriesVideos.set([...s.videos]);
      this.selectedVideoToAdd.set(null);
      this.addVideoSearchTerm.set('');
    });

    // Keep availableVideosForSeries up-to-date, excluding currently attached videos and applying upload date filter
    effect(() => {
      const currentDocIds = new Set(this.seriesVideos().map((v) => v.docId));
      const all = this.dataService.videos.entries();
      const cutoff = this.getUploadCutoffDate(this.uploadDateFilterOption(), this.customUploadDate());
      const available = all.filter((v) => !currentDocIds.has(v.docId) && this.matchesUploadCutoff(v, cutoff));
      this.availableVideosForSeries.setEntries(available);
      this.availableVideosCount.set(available.length);
    });
  }

  getUploadCutoffDate(option: string, customDateStr?: string): Date | null {
    const now = new Date();
    switch (option) {
      case '1_month': {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 1);
        return d;
      }
      case '3_months': {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 3);
        return d;
      }
      case '6_months': {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 6);
        return d;
      }
      case '1_year': {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - 1);
        return d;
      }
      case 'custom': {
        if (!customDateStr) return null;
        const d = new Date(customDateStr);
        return isNaN(d.getTime()) ? null : d;
      }
      case 'all':
      default:
        return null;
    }
  }

  matchesUploadCutoff(v: VideoItem, cutoff: Date | null): boolean {
    if (!cutoff) return true;
    const raw = v.createdAt || v.publishedAt || v.lastUpdated || v.recordedDate;
    if (!raw) return true; // Keep items with no timestamp metadata
    const d = new Date(raw);
    if (isNaN(d.getTime())) return true;
    return d.getTime() >= cutoff.getTime();
  }

  setUploadDateFilterOption(option: '1_month' | '3_months' | '6_months' | '1_year' | 'all' | 'custom'): void {
    this.uploadDateFilterOption.set(option);
  }

  setCustomUploadDate(dateStr: string): void {
    this.customUploadDate.set(dateStr);
  }

  getFreeAccessTier(series: VideoSeries): VodAccessTier {
    const tiers = Array.isArray(series.accessTiers) && series.accessTiers.length > 0
      ? series.accessTiers
      : (series.accessTier ? [series.accessTier] : []);
    if (tiers.includes(VodAccessTier.Public)) return VodAccessTier.Public;
    if (tiers.includes(VodAccessTier.MembersOnly)) return VodAccessTier.MembersOnly;
    if (tiers.includes(VodAccessTier.InstructorsOnly)) return VodAccessTier.InstructorsOnly;
    return VodAccessTier.AdminOnly;
  }

  hasClassSubscription(series: VideoSeries): boolean {
    const tiers = Array.isArray(series.accessTiers) && series.accessTiers.length > 0
      ? series.accessTiers
      : (series.accessTier ? [series.accessTier] : []);
    return tiers.includes(VodAccessTier.ClassVideoSubscribers);
  }

  onVideoSelectedToAdd(video: VideoItem): void {
    this.selectedVideoToAdd.set(video);
  }

  onVideoSearchTextChange(text: string): void {
    this.addVideoSearchTerm.set(text);
    if (!text.trim()) {
      this.selectedVideoToAdd.set(null);
    }
  }

  addSelectedVideoToSeries(): void {
    const video = this.selectedVideoToAdd();
    if (!video) return;
    if (this.seriesVideos().some((v) => v.docId === video.docId)) {
      this.selectedVideoToAdd.set(null);
      this.addVideoSearchTerm.set('');
      return;
    }
    this.seriesVideos.update((list) => [...list, video]);
    this.selectedVideoToAdd.set(null);
    this.addVideoSearchTerm.set('');
  }

  removeSeriesVideo(index: number): void {
    this.seriesVideos.update((list) => list.filter((_, idx) => idx !== index));
  }

  moveSeriesVideoUp(index: number): void {
    if (index <= 0) return;
    this.seriesVideos.update((list) => {
      const copy = [...list];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  }

  moveSeriesVideoDown(index: number): void {
    if (index >= this.seriesVideos().length - 1) return;
    this.seriesVideos.update((list) => {
      const copy = [...list];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  }

  getVideoHref(video: VideoItem): string {
    return this.routingService.hrefForView(Views.VideoView, { videoId: video.docId });
  }

  formatDuration(seconds?: number): string {
    if (!seconds || seconds <= 0) return '0 min';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  }

  async saveSeriesChanges(): Promise<void> {
    const sId = this.seriesId();
    if (!sId) return;

    const title = this.seriesTitle().trim();
    if (!title) {
      this.errorMessage.set('Series title cannot be empty.');
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const orderedIds = this.seriesVideos().map((v) => v.docId);
      const freeTier = this.seriesFreeAccessTier();
      const hasClassSub = this.seriesHasClassSub();
      const isBuyable = this.seriesIsBuyable();
      const price = this.seriesPriceDollars();
      const priceCents = isBuyable && price !== null && price > 0
        ? Math.round(price * 100)
        : 0;
      const stripePriceId = isBuyable ? this.seriesStripePriceId().trim() : '';
      const isPublished = this.seriesIsPublished();

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

      await this.dataService.updateVideoSeries(
        sId,
        {
          title,
          description: this.seriesDescription().trim(),
          priceCents,
          stripePriceId,
          accessTier: primaryTier,
          accessTiers: finalTiers,
          isPublished,
        },
        orderedIds,
      );

      this.successMessage.set('Series details saved.');
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Discard unsaved edits by re-populating the form from the stored series. */
  discardChanges(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.lastInitializedSeriesId.set('');
  }
}
