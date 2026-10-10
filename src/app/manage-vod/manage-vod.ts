/* manage-vod.ts
 *
 * Administrator console for managing the Video on Demand (VOD) catalog,
 * monitoring transcoding pipelines with live polling in a job details drawer,
 * configuring pricing and access tiers, and publishing curated videos.
 */

import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  VideoItem,
  VideoSeries,
  VodStatus,
  VodAccessTier,
  TagItem,
  getVodFreeAccessTier,
  hasClassVideoSubscriberAccess,
  getVodFreeAccessLabel,
} from '../../../functions/src/data-model/vod';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { SearchableSet } from '../searchable-set';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  ThumbnailEditorModalComponent,
  ThumbnailSelectedEvent,
} from '../thumbnail-editor-modal/thumbnail-editor-modal';

@Component({
  selector: 'app-manage-vod',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
    ThumbnailEditorModalComponent,
  ],
  templateUrl: './manage-vod.html',
  styleUrl: './manage-vod.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageVodComponent implements OnInit, OnDestroy {
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  readonly Views = Views;

  private viewSignals = this.routingService.signals[Views.ManageVod];

  // URL Parameter Signals
  searchQuery = computed(() => this.viewSignals.urlParams.q() || '');
  selectedStatus = computed(() => this.viewSignals.urlParams.status() || 'all');
  selectedFeatured = computed(() => this.viewSignals.urlParams.featured() || 'all');
  selectedAccessTier = computed(() => this.viewSignals.urlParams.accessTier() || 'all');
  selectedListing = computed(() => this.viewSignals.urlParams.listing() || 'all');
  selectedYear = computed(() => this.viewSignals.urlParams.year() || 'all');
  selectedVideoIdParam = computed(() => this.viewSignals.urlParams.videoId() || '');
  tabParam = computed(() => this.viewSignals.urlParams.tab() || 'series_collections');
  selectedTagFilter = signal<string>('');
  selectedTagSearchTerm = signal<string>('');

  availableYears = computed<string[]>(() => {
    const all = this.dataService.videos.entries();
    const years = new Set<string>();
    for (const v of all) {
      if (v.recordedDate) {
        const match = v.recordedDate.match(/^(\d{4})/);
        if (match) {
          years.add(match[1]);
        }
      }
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  });

  // Series & View Mode Signals
  viewMode = signal<'all_videos' | 'series_collections'>('series_collections');
  selectedSeriesFilter = signal<string>('all');
  selectedSeriesSearchTerm = signal<string>('');
  allSeries = computed<VideoSeries[]>(() => this.dataService.getVideoSeriesList());
  standaloneVideoCount = computed(
    () => this.dataService.videos.entries().filter((v) => !v.seriesId && !v.forVodPageId).length,
  );

  seriesFilterSet = new SearchableSet<'seriesId', VideoSeries>(
    ['title', 'description', 'instructorName', 'seriesId'],
    'seriesId',
  );

  seriesFilterDisplayFns: DisplayFns<VideoSeries> = {
    toChipId: (s) => s.seriesId,
    toName: (s) => {
      if (s.seriesId === 'no_series') {
        return `Standalone Only (No Series) (${s.videoCount})`;
      }
      return `${s.title} (${s.videoCount} part${s.videoCount === 1 ? '' : 's'})`;
    },
  };

  setViewMode(mode: 'all_videos' | 'series_collections'): void {
    this.viewMode.set(mode);
    this.viewSignals.urlParams.tab.set(mode);
  }

  // Tag autocomplete display helper
  tagDisplayFns: DisplayFns<TagItem> = {
    toChipId: (t) => t.tag,
    toName: (t) => (t.description ? `#${t.tag} (${t.description})` : '#' + t.tag),
  };

  getTagTooltip(tag: string): string {
    const meta = this.dataService.getTagMeta(tag);
    if (meta?.description) {
      return `#${tag}: ${meta.description}`;
    }
    return `Filter by #${tag}`;
  }

  // 3-Dots Action Menu state
  activeMenuVideoId = signal<string | null>(null);
  deletingVideoIds = signal<Set<string>>(new Set());

  isDeleting(videoId?: string): boolean {
    if (!videoId) return false;
    return this.deletingVideoIds().has(videoId);
  }

  // Job Details Drawer state
  drawerVideo = signal<VideoItem | null>(null);
  isCheckingJobStatus = signal(false);
  isTranscoding = signal(false);
  copyFeedback = signal<string | null>(null);
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  // Quality & Transcoding Ladder options
  selectedQualityPreset = signal<'full' | '4k' | 'hd' | 'light' | 'custom'>('full');
  selectedResolutions = signal<string[]>(['1080p', '720p', '480p', '360p']);

  readonly qualityPresets: {
    id: 'full' | '4k' | 'hd' | 'light' | 'custom';
    label: string;
    resolutions: string[];
    description: string;
  }[] = [
    {
      id: 'full',
      label: 'Full ABR Ladder (Recommended)',
      resolutions: ['1080p', '720p', '480p', '360p'],
      description: '1080p FHD, 720p HD, 480p SD, 360p Mobile. Optimal for all devices.',
    },
    {
      id: '4k',
      label: '4K Ultra Ladder',
      resolutions: ['2160p (4K)', '1080p', '720p', '480p'],
      description: 'Ultra-high definition for large 4K displays + HD stream fallback.',
    },
    {
      id: 'hd',
      label: 'HD Only',
      resolutions: ['1080p', '720p'],
      description: 'High-definition only (1080p and 720p). Saves encoding storage.',
    },
    {
      id: 'light',
      label: 'Lightweight / Mobile',
      resolutions: ['720p', '480p', '360p'],
      description: 'Standard definition and mobile-optimized streams.',
    },
    {
      id: 'custom',
      label: 'Custom Ladder',
      resolutions: [],
      description: 'Select custom target rendition resolutions below.',
    },
  ];

  readonly availableResolutions = [
    '2160p (4K)',
    '1080p',
    '720p',
    '480p',
    '360p',
    '240p',
  ];

  // Stats Folddown toggle
  showStatsFold = signal(false);

  VodAccessTier = VodAccessTier;

  // Status Counts
  stats = computed(() => {
    const all = this.dataService.videos.entries();
    const ready = all.filter((v) => v.vodStatus === VodStatus.Ready).length;
    const processing = all.filter(
      (v) =>
        v.vodStatus === VodStatus.Transcoding ||
        v.vodStatus === VodStatus.Queued,
    ).length;
    const published = all.filter((v) => v.isPublished).length;
    const totalSeconds = all.reduce((sum, v) => sum + (v.durationSeconds || 0), 0);
    return {
      total: all.length,
      published,
      ready,
      processing,
      totalHours: (totalSeconds / 3600).toFixed(1),
    };
  });

  // Filtered List
  filteredVideos = computed<VideoItem[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const status = this.selectedStatus();
    const listing = this.selectedListing();
    const featured = this.selectedFeatured();
    const accessTier = this.selectedAccessTier();
    const tagFilter = this.selectedTagFilter().toLowerCase().trim();

    let items = this.dataService.videos.entries();

    if (q) {
      const isSearchUnlisted = q === 'unlisted' || q === 'unpublished';
      const isSearchListed = q === 'listed' || q === 'published';
      items = items.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q) ||
          v.instructorName.toLowerCase().includes(q) ||
          (v.recordedDate && v.recordedDate.toLowerCase().includes(q)) ||
          (v.location && v.location.toLowerCase().includes(q)) ||
          (v.featured && ('featured'.includes(q) || 'spotlight'.includes(q))) ||
          (isSearchUnlisted && !v.isPublished) ||
          (isSearchListed && v.isPublished) ||
          (v.tags && v.tags.some((t) => t.toLowerCase().includes(q))),
      );
    }

    const year = this.selectedYear();
    if (year !== 'all') {
      items = items.filter((v) => Boolean(v.recordedDate && v.recordedDate.startsWith(year)));
    }

    if (tagFilter) {
      items = items.filter(
        (v) =>
          v.tags &&
          v.tags.some((t) => t.toLowerCase() === tagFilter),
      );
    }

    const seriesFilter = this.selectedSeriesFilter();
    if (seriesFilter !== 'all') {
      if (seriesFilter === 'no_series') {
        items = items.filter((v) => !v.seriesId && !v.forVodPageId);
      } else {
        items = items.filter(
          (v) => v.seriesId === seriesFilter || v.forVodPageId === seriesFilter,
        );
      }
    }

    if (featured !== 'all') {
      if (featured === 'featured') {
        items = items.filter((v) => Boolean(v.featured));
      } else if (featured === 'not_featured') {
        items = items.filter((v) => !v.featured);
      }
    }

    if (listing !== 'all') {
      if (listing === 'listed') {
        items = items.filter((v) => Boolean(v.isPublished));
      } else if (listing === 'unlisted') {
        items = items.filter((v) => !v.isPublished);
      }
    }

    if (accessTier !== 'all') {
      items = items.filter((v) => {
        const tiers = Array.isArray(v.accessTiers) && v.accessTiers.length > 0
          ? v.accessTiers
          : (v.accessTier ? [v.accessTier] : []);

        switch (accessTier) {
          case 'class_library':
          case VodAccessTier.ClassVideoSubscribers:
            return tiers.includes(VodAccessTier.ClassVideoSubscribers) || v.accessTier === VodAccessTier.ClassVideoSubscribers;
          case 'members':
          case VodAccessTier.MembersOnly:
            return tiers.includes(VodAccessTier.MembersOnly) || v.accessTier === VodAccessTier.MembersOnly;
          case 'instructors':
          case VodAccessTier.InstructorsOnly:
            return tiers.includes(VodAccessTier.InstructorsOnly) || v.accessTier === VodAccessTier.InstructorsOnly;
          case 'public':
          case VodAccessTier.Public:
            return tiers.includes(VodAccessTier.Public) || v.accessTier === VodAccessTier.Public;
          case 'direct_purchase':
          case VodAccessTier.DirectPurchase:
            return (
              tiers.includes(VodAccessTier.DirectPurchase) ||
              v.accessTier === VodAccessTier.DirectPurchase ||
              Boolean(v.isBuyable) ||
              Boolean(v.priceCents && v.priceCents > 0)
            );
          case 'admin_only':
          case VodAccessTier.AdminOnly:
            return tiers.includes(VodAccessTier.AdminOnly) || v.accessTier === VodAccessTier.AdminOnly;
          default:
            return true;
        }
      });
    }

    if (status !== 'all') {
      if (status === 'draft' || status === 'unlisted') {
        items = items.filter((v) => !v.isPublished);
      } else if (status === 'listed') {
        items = items.filter((v) => Boolean(v.isPublished));
      } else {
        items = items.filter((v) => v.vodStatus === status);
      }
    }

    return [...items].sort((a, b) =>
      (b.lastUpdated || '').localeCompare(a.lastUpdated || ''),
    );
  });

  filteredSeries = computed<VideoSeries[]>(() => {
    let list = this.allSeries();
    const q = this.searchQuery().trim().toLowerCase();
    const tagFilter = this.selectedTagFilter().trim().toLowerCase();
    const status = this.selectedStatus();
    const listing = this.selectedListing();
    const accessTier = this.selectedAccessTier();
    const seriesFilter = this.selectedSeriesFilter();
    const year = this.selectedYear();

    if (q) {
      const isSearchUnlisted = q === 'unlisted' || q === 'unpublished';
      const isSearchListed = q === 'listed' || q === 'published';
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.instructorName && s.instructorName.toLowerCase().includes(q)) ||
          (s.recordedDate && s.recordedDate.toLowerCase().includes(q)) ||
          (s.location && s.location.toLowerCase().includes(q)) ||
          (isSearchUnlisted && !s.isPublished) ||
          (isSearchListed && s.isPublished) ||
          (s.tags && s.tags.some((t) => t.toLowerCase().includes(q))) ||
          s.videos.some(
            (v) =>
              v.title.toLowerCase().includes(q) ||
              (v.recordedDate && v.recordedDate.toLowerCase().includes(q)),
          ),
      );
    }

    if (year !== 'all') {
      list = list.filter((s) =>
        Boolean(
          (s.recordedDate && s.recordedDate.startsWith(year)) ||
          s.videos.some((v) => v.recordedDate && v.recordedDate.startsWith(year)),
        ),
      );
    }

    if (tagFilter) {
      list = list.filter((s) => s.tags && s.tags.some((t) => t.toLowerCase() === tagFilter));
    }

    if (seriesFilter !== 'all') {
      if (seriesFilter === 'no_series') {
        list = [];
      } else {
        list = list.filter((s) => s.seriesId === seriesFilter);
      }
    }

    if (listing !== 'all') {
      if (listing === 'listed') {
        list = list.filter((s) => Boolean(s.isPublished));
      } else if (listing === 'unlisted') {
        list = list.filter((s) => !s.isPublished);
      }
    }

    if (accessTier !== 'all') {
      list = list.filter((s) => {
        const matchesTier = (t: VodAccessTier[], at?: VodAccessTier, isBuyable?: boolean, priceCents?: number) => {
          switch (accessTier) {
            case 'class_library':
            case VodAccessTier.ClassVideoSubscribers:
              return t.includes(VodAccessTier.ClassVideoSubscribers) || at === VodAccessTier.ClassVideoSubscribers;
            case 'members':
            case VodAccessTier.MembersOnly:
              return t.includes(VodAccessTier.MembersOnly) || at === VodAccessTier.MembersOnly;
            case 'instructors':
            case VodAccessTier.InstructorsOnly:
              return t.includes(VodAccessTier.InstructorsOnly) || at === VodAccessTier.InstructorsOnly;
            case 'public':
            case VodAccessTier.Public:
              return t.includes(VodAccessTier.Public) || at === VodAccessTier.Public;
            case 'direct_purchase':
            case VodAccessTier.DirectPurchase:
              return (
                t.includes(VodAccessTier.DirectPurchase) ||
                at === VodAccessTier.DirectPurchase ||
                Boolean(isBuyable) ||
                Boolean(priceCents && priceCents > 0)
              );
            case 'admin_only':
            case VodAccessTier.AdminOnly:
              return t.includes(VodAccessTier.AdminOnly) || at === VodAccessTier.AdminOnly;
            default:
              return true;
          }
        };

        const sTiers = Array.isArray(s.accessTiers) && s.accessTiers.length > 0
          ? s.accessTiers
          : (s.accessTier ? [s.accessTier] : []);

        if (matchesTier(sTiers, s.accessTier, Boolean(s.stripePriceId || s.priceCents), s.priceCents)) {
          return true;
        }

        return s.videos.some((v) => {
          const vTiers = Array.isArray(v.accessTiers) && v.accessTiers.length > 0
            ? v.accessTiers
            : (v.accessTier ? [v.accessTier] : []);
          return matchesTier(vTiers, v.accessTier, v.isBuyable, v.priceCents);
        });
      });
    }

    if (status === 'draft' || status === 'unlisted') {
      list = list.filter((s) => !s.isPublished);
    } else if (status === 'listed') {
      list = list.filter((s) => Boolean(s.isPublished));
    } else if (status === 'ready') {
      list = list.filter((s) => s.videos.every((v) => v.vodStatus === VodStatus.Ready));
    }

    return list;
  });

  readonly accessTiers = [
    { value: VodAccessTier.Public, label: 'Public / Free' },
    { value: VodAccessTier.MembersOnly, label: 'Members Only' },
    { value: VodAccessTier.InstructorsOnly, label: 'Instructors Only' },
    {
      value: VodAccessTier.ClassVideoSubscribers,
      label: 'Class Video Subscribers',
    },
    { value: VodAccessTier.DirectPurchase, label: 'Direct Purchase' },
    { value: VodAccessTier.AdminOnly, label: 'Admin Only' },
  ];

  VodStatus = VodStatus;

  constructor() {
    effect(() => {
      const seriesList = this.allSeries();
      const standaloneCount = this.standaloneVideoCount();
      const standaloneEntry: VideoSeries = {
        seriesId: 'no_series',
        title: 'Standalone Only (No Series)',
        description: 'Standalone videos that are not part of any series',
        tags: [],
        videoCount: standaloneCount,
        totalDurationSeconds: 0,
        videos: [],
      };
      this.seriesFilterSet.setEntries([standaloneEntry, ...seriesList]);
    });
    effect(() => {
      const vid = this.selectedVideoIdParam();
      if (vid) {
        if (this.drawerVideo()?.docId !== vid) {
          const v = this.dataService.videos.get(vid);
          if (v) {
            this.openDrawer(v, false);
          } else {
            this.dataService.getVideoById(vid).then((fetched) => {
              if (fetched && this.selectedVideoIdParam() === vid) {
                this.openDrawer(fetched, false);
              }
            });
          }
        }
      } else {
        if (this.drawerVideo()) {
          this.closeDrawer(false);
        }
      }
    });

    effect(() => {
      const tab = this.tabParam();
      if (tab === 'all_videos' || tab === 'series_collections') {
        if (this.viewMode() !== tab) {
          this.viewMode.set(tab);
        }
      }
    });

  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.stopPolling();
  }

  setSearchQuery(q: string): void {
    this.viewSignals.urlParams.q.set(q || '');
  }

  setStatus(status: string): void {
    this.viewSignals.urlParams.status.set(status === 'all' ? '' : status);
  }

  setFeaturedFilter(featured: string): void {
    this.viewSignals.urlParams.featured.set(featured === 'all' ? '' : featured);
  }

  setAccessTierFilter(tier: string): void {
    this.viewSignals.urlParams.accessTier.set(tier === 'all' ? '' : tier);
  }

  setListingFilter(listing: string): void {
    this.viewSignals.urlParams.listing.set(listing === 'all' ? '' : listing);
  }

  setYearFilter(year: string): void {
    this.viewSignals.urlParams.year.set(year === 'all' ? '' : year);
  }

  clearAllFilters(): void {
    this.viewSignals.urlParams.q.set('');
    this.viewSignals.urlParams.status.set('');
    this.viewSignals.urlParams.featured.set('');
    this.viewSignals.urlParams.accessTier.set('');
    this.viewSignals.urlParams.listing.set('');
    this.viewSignals.urlParams.year.set('');
    this.selectedSeriesFilter.set('all');
    this.selectedTagFilter.set('');
    this.selectedTagSearchTerm.set('');
    this.clearSeriesFilter();
  }

  setSeriesFilter(seriesId: string): void {
    this.selectedSeriesFilter.set(seriesId);
    if (!seriesId || seriesId === 'all') {
      this.selectedSeriesSearchTerm.set('');
    } else if (seriesId === 'no_series') {
      this.selectedSeriesSearchTerm.set(
        `Standalone Only (No Series) (${this.standaloneVideoCount()})`,
      );
    } else {
      const s = this.allSeries().find((x) => x.seriesId === seriesId);
      this.selectedSeriesSearchTerm.set(s ? this.seriesFilterDisplayFns.toName(s) : seriesId);
    }
  }

  onSeriesFilterSelected(item: VideoSeries): void {
    this.setSeriesFilter(item.seriesId);
  }

  onSeriesFilterTextUpdated(text: string): void {
    this.selectedSeriesSearchTerm.set(text);
    if (!text.trim()) {
      this.selectedSeriesFilter.set('all');
    }
  }

  clearSeriesFilter(): void {
    this.setSeriesFilter('all');
  }

  onTagSelected(item: TagItem): void {
    this.selectedTagFilter.set(item.tag);
    this.selectedTagSearchTerm.set(item.tag);
  }

  onTagTextUpdated(text: string): void {
    this.selectedTagSearchTerm.set(text);
    if (!text.trim()) {
      this.selectedTagFilter.set('');
    }
  }

  clearTagFilter(): void {
    this.selectedTagFilter.set('');
    this.selectedTagSearchTerm.set('');
  }

  // 3-Dots Menu Methods
  toggleMenu(videoId: string, event: Event): void {
    event.stopPropagation();
    this.activeMenuVideoId.update((curr) => (curr === videoId ? null : videoId));
  }

  closeMenu(): void {
    this.activeMenuVideoId.set(null);
  }

  async togglePublished(video: VideoItem): Promise<void> {
    this.closeMenu();
    try {
      const newPublished = !video.isPublished;
      await this.dataService.updateVideoMetadata(video.docId, {
        isPublished: newPublished,
      });
      if (this.drawerVideo()?.docId === video.docId) {
        this.drawerVideo.update((prev) => (prev ? { ...prev, isPublished: newPublished } : prev));
      }
    } catch (err: unknown) {
      console.error('Error toggling published status:', err);
      const msg = err instanceof Error ? err.message : 'Failed to update publication status.';
      alert(msg);
    }
  }

  async toggleFeatured(video: VideoItem): Promise<void> {
    try {
      const newFeatured = !video.featured;
      await this.dataService.updateVideoMetadata(video.docId, {
        featured: newFeatured,
      });
      if (this.drawerVideo()?.docId === video.docId) {
        this.drawerVideo.update((prev) => (prev ? { ...prev, featured: newFeatured } : prev));
      }
    } catch (err: unknown) {
      console.error('Error toggling featured status:', err);
      const msg = err instanceof Error ? err.message : 'Failed to update featured status.';
      alert(msg);
    }
  }

  // Job Details Drawer Methods

  /** Opens the drawer from the title cell, unless the click was on a link
   * inside it (link clicks must still bubble to the document-level SPA
   * link handler, so we can't stopPropagation on the anchor itself). */
  onMetaCellClick(video: VideoItem, event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('a')) return;
    this.openDrawer(video);
  }

  openDrawer(video: VideoItem, updateUrl = true): void {
    this.closeMenu();
    this.drawerVideo.set(video);
    if (updateUrl) {
      this.viewSignals.urlParams.videoId.set(video.docId);
    }

    const res =
      video.resolutions && video.resolutions.length > 0
        ? [...video.resolutions]
        : ['1080p', '720p', '480p', '360p'];
    this.selectedResolutions.set(res);

    const match = this.qualityPresets.find(
      (p) =>
        p.id !== 'custom' &&
        p.resolutions.length === res.length &&
        p.resolutions.every((r) => res.includes(r)),
    );
    this.selectedQualityPreset.set(match ? match.id : 'custom');

    if (
      video.vodStatus === VodStatus.Transcoding ||
      video.vodStatus === VodStatus.Queued
    ) {
      this.startPolling(video.docId);
    }
  }

  closeDrawer(updateUrl = true): void {
    this.stopPolling();
    this.drawerVideo.set(null);
    if (updateUrl) {
      this.viewSignals.urlParams.videoId.set('');
    }
  }

  applyQualityPreset(presetId: 'full' | '4k' | 'hd' | 'light' | 'custom'): void {
    this.selectedQualityPreset.set(presetId);
    const preset = this.qualityPresets.find((p) => p.id === presetId);
    if (preset && preset.id !== 'custom') {
      this.selectedResolutions.set([...preset.resolutions]);
    }
  }

  toggleResolution(res: string): void {
    const current = this.selectedResolutions();
    let updated: string[];
    if (current.includes(res)) {
      if (current.length === 1) {
        return; // Keep at least one resolution
      }
      updated = current.filter((r) => r !== res);
    } else {
      updated = [...current, res];
    }
    this.selectedResolutions.set(updated);

    const match = this.qualityPresets.find(
      (p) =>
        p.id !== 'custom' &&
        p.resolutions.length === updated.length &&
        p.resolutions.every((r) => updated.includes(r)),
    );
    this.selectedQualityPreset.set(match ? match.id : 'custom');
  }

  isResolutionSelected(res: string): boolean {
    return this.selectedResolutions().includes(res);
  }

  async transcodeAtQuality(video: VideoItem): Promise<void> {
    const resolutions = this.selectedResolutions();
    if (resolutions.length === 0) {
      alert('Please select at least one target resolution.');
      return;
    }

    const resList = resolutions.join(', ');
    if (
      !confirm(
        `Are you sure you want to trigger transcoding for "${video.title}" at quality: ${resList}?`,
      )
    ) {
      return;
    }

    this.isTranscoding.set(true);
    try {
      const res = await this.dataService.transcodeVideoForVod(
        video.sourceUploadDocId,
        video.sourceMemberDocId,
        {
          ...video,
          resolutions,
        },
      );
      if (this.drawerVideo()?.docId === video.docId) {
        this.drawerVideo.update((prev) =>
          prev
            ? {
                ...prev,
                vodStatus: res.vodStatus || VodStatus.Queued,
                resolutions,
              }
            : prev,
        );
        this.startPolling(video.docId);
      }
      alert(`Transcoding job queued successfully with target renditions: ${resList}`);
    } catch (err: unknown) {
      console.error('Error starting transcoding at quality:', err);
      const msg = err instanceof Error ? err.message : 'Failed to start transcoding.';
      alert(msg);
    } finally {
      this.isTranscoding.set(false);
    }
  }

  copyToClipboard(text: string, label: string): void {
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => {
        this.copyFeedback.set(`${label} copied!`);
        setTimeout(() => this.copyFeedback.set(null), 2500);
      },
      (err) => {
        console.warn('Could not copy to clipboard:', err);
      },
    );
  }

  private startPolling(videoId: string): void {
    this.stopPolling();
    // Immediate check
    this.checkJobStatus(videoId);
    // Poll every 4 seconds while drawer is open
    this.pollingTimer = setInterval(() => {
      const current = this.drawerVideo();
      if (!current || current.docId !== videoId) {
        this.stopPolling();
        return;
      }
      if (
        current.vodStatus === VodStatus.Ready ||
        current.vodStatus === VodStatus.Failed
      ) {
        this.stopPolling();
        return;
      }
      this.checkJobStatus(videoId);
    }, 4000);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  async checkJobStatus(videoId: string): Promise<void> {
    this.isCheckingJobStatus.set(true);
    try {
      const res = await this.dataService.checkVodJobStatus(videoId);
      if (this.drawerVideo()?.docId === videoId) {
        const latest = this.dataService.videos.get(videoId);
        if (latest) {
          this.drawerVideo.set(latest);
        } else if (res) {
          this.drawerVideo.update((prev) =>
            prev
              ? {
                  ...prev,
                  vodStatus: res.vodStatus,
                  vodJobId: res.vodJobId || prev.vodJobId,
                  vodError: res.vodError,
                }
              : prev,
          );
        }
      }
    } catch (err: unknown) {
      console.warn('Could not check job status:', err);
    } finally {
      this.isCheckingJobStatus.set(false);
    }
  }

  // --- Thumbnail Customization Modal State ---
  thumbnailModalVideo = signal<VideoItem | null>(null);
  isSavingThumbnail = signal<boolean>(false);

  openThumbnailModalForVideo(video: VideoItem): void {
    this.thumbnailModalVideo.set(video);
  }

  closeThumbnailModal(): void {
    this.thumbnailModalVideo.set(null);
  }

  async onVideoThumbnailSelected(result: ThumbnailSelectedEvent): Promise<void> {
    const video = this.thumbnailModalVideo();
    if (!video) return;

    this.isSavingThumbnail.set(true);
    try {
      const storage = getStorage(this.firebaseState.app);
      const storagePath = `vod/${video.docId}/preview_${Date.now()}.jpg`;
      const previewRef = ref(storage, storagePath);
      await uploadBytes(previewRef, result.blob, { contentType: 'image/jpeg' });
      const newUrl = await getDownloadURL(previewRef);

      await this.dataService.updateVideoMetadata(video.docId, {
        thumbnailUrl: newUrl,
      });

      if (this.drawerVideo()?.docId === video.docId) {
        this.drawerVideo.update((v) => (v ? { ...v, thumbnailUrl: newUrl } : null));
      }

      this.closeThumbnailModal();
    } catch (err: unknown) {
      console.error('Failed to update video thumbnail:', err);
      alert('Failed to update thumbnail: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.isSavingThumbnail.set(false);
    }
  }

  async toggleSeriesPublished(series: VideoSeries): Promise<void> {
    try {
      const newPublished = !series.isPublished;
      const orderedIds = series.videos.map((v) => v.docId);
      await this.dataService.updateVideoSeries(
        series.seriesId,
        {
          isPublished: newPublished,
        },
        orderedIds,
      );
    } catch (err: unknown) {
      console.error('Error toggling series publication status:', err);
      const msg = err instanceof Error ? err.message : 'Failed to update publication status.';
      alert(msg);
    }
  }

  getFreeAccessTier(item: { accessTiers?: VodAccessTier[]; accessTier?: VodAccessTier }): VodAccessTier {
    return getVodFreeAccessTier(item);
  }

  hasFreeAccess(item: { accessTiers?: VodAccessTier[]; accessTier?: VodAccessTier }): boolean {
    return getVodFreeAccessTier(item) !== VodAccessTier.AdminOnly;
  }

  getFreeAccessLabel(item: { accessTiers?: VodAccessTier[]; accessTier?: VodAccessTier }): string {
    const tier = getVodFreeAccessTier(item);
    return getVodFreeAccessLabel(tier);
  }

  hasClassSubscription(item: { accessTiers?: VodAccessTier[]; accessTier?: VodAccessTier }): boolean {
    return hasClassVideoSubscriberAccess(item);
  }

  isVideoBuyable(video: VideoItem): boolean {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : []);
    return Boolean(
      video.isBuyable ||
      tiers.includes(VodAccessTier.DirectPurchase) ||
      (video.priceCents && video.priceCents > 0),
    );
  }

  getBuyPriceLabel(video: VideoItem): string {
    return video.priceCents ? `$${(video.priceCents / 100).toFixed(2)}` : 'Paid';
  }

  async retryTranscoding(video: VideoItem): Promise<void> {
    this.closeMenu();
    if (
      !confirm(
        `Are you sure you want to re-trigger transcoding for "${video.title}"?`,
      )
    ) {
      return;
    }

    try {
      await this.dataService.transcodeVideoForVod(
        video.sourceUploadDocId,
        video.sourceMemberDocId,
        video,
      );
      if (this.drawerVideo()?.docId === video.docId) {
        this.startPolling(video.docId);
      }
      alert('Transcoding job queued successfully.');
    } catch (err: unknown) {
      console.error('Error starting transcoding:', err);
      const msg = err instanceof Error ? err.message : 'Failed to start transcoding.';
      alert(msg);
    }
  }

  async deleteVideo(video: VideoItem): Promise<void> {
    this.closeMenu();
    if (
      !confirm(
        `Are you sure you want to remove "${video.title}" from the VOD catalog?`,
      )
    ) {
      return;
    }

    this.deletingVideoIds.update((s) => {
      const next = new Set(s);
      next.add(video.docId);
      return next;
    });

    try {
      await this.dataService.deleteVideo(video.docId);
      if (this.drawerVideo()?.docId === video.docId) {
        this.closeDrawer(true);
      }
    } catch (err: unknown) {
      console.error('Error deleting video:', err);
      const msg = err instanceof Error ? err.message : 'Failed to delete video.';
      alert(msg);
    } finally {
      this.deletingVideoIds.update((s) => {
        const next = new Set(s);
        next.delete(video.docId);
        return next;
      });
    }
  }

  getVideoHref(video: VideoItem): string {
    return this.routingService.hrefForView(Views.VideoView, {
      videoId: video.docId,
    });
  }

  getAccessTiersSummary(video: VideoItem): string {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);

    const labels: string[] = [];
    if (tiers.includes(VodAccessTier.Public)) labels.push('Public (Free)');
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

  getAccessTierLabel(tier: VodAccessTier, priceCents?: number): string {
    switch (tier) {
      case VodAccessTier.Public:
        return 'Public (Free)';
      case VodAccessTier.MembersOnly:
        return 'Members Only';
      case VodAccessTier.InstructorsOnly:
        return 'Instructors Only';
      case VodAccessTier.ClassVideoSubscribers:
        return 'Class Video Subscribers';
      case VodAccessTier.DirectPurchase:
        return `Direct Purchase (${priceCents ? '$' + (priceCents / 100).toFixed(2) : 'Paid'})`;
      case VodAccessTier.AdminOnly:
        return 'Admin Only';
      default:
        return tier;
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

  formatBytes(bytes?: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getStatusClass(status: VodStatus): string {
    switch (status) {
      case VodStatus.Ready:
        return 'status-ready';
      case VodStatus.Transcoding:
        return 'status-transcoding';
      case VodStatus.Queued:
        return 'status-queued';
      case VodStatus.Failed:
        return 'status-failed';
      default:
        return 'status-draft';
    }
  }

  formatAddedDate(video: VideoItem): string {
    const raw = video.createdAt || video.publishedAt || video.lastUpdated || '';
    if (!raw) return '';
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) {
        return raw.split('T')[0];
      }
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return raw.split('T')[0];
    }
  }
}

