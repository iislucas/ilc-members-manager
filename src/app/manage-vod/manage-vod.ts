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
  VodStatus,
  VodAccessTier,
  TagItem,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { TagInputComponent } from '../tag-input/tag-input';

@Component({
  selector: 'app-manage-vod',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
    TagInputComponent,
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
  selectedVideoIdParam = computed(() => this.viewSignals.urlParams.videoId() || '');
  editVideoIdParam = computed(() => this.viewSignals.urlParams.editVideoId() || '');
  selectedTagFilter = signal<string>('');
  selectedTagSearchTerm = signal<string>('');

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

  // Edit Modal State
  editingVideo = signal<VideoItem | null>(null);
  isSaving = signal(false);
  editTags = signal<string[]>([]);
  editAccessTiers = signal<VodAccessTier[]>([VodAccessTier.MembersOnly]);
  editIsBuyable = signal<boolean>(false);
  editStripePriceId = signal<string>('');
  priceDollars = signal<number | null>(null);

  readonly availableAccessTiers = [
    { value: VodAccessTier.Public, label: 'Public (Free to everyone)', description: 'Accessible to all visitors without logging in' },
    { value: VodAccessTier.MembersOnly, label: 'Members', description: 'Active annual and life members (instructors included)' },
    { value: VodAccessTier.InstructorsOnly, label: 'Instructors Only', description: 'Licensed ILC instructors' },
    { value: VodAccessTier.ClassVideoSubscribers, label: 'Class Video Subscribers', description: 'Active class video library subscribers' },
  ];

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
    const tagFilter = this.selectedTagFilter().toLowerCase().trim();

    let items = this.dataService.videos.entries();

    if (q) {
      items = items.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q) ||
          v.instructorName.toLowerCase().includes(q) ||
          (v.tags && v.tags.some((t) => t.toLowerCase().includes(q))),
      );
    }

    if (tagFilter) {
      items = items.filter(
        (v) =>
          v.tags &&
          v.tags.some((t) => t.toLowerCase() === tagFilter),
      );
    }

    if (status !== 'all') {
      if (status === 'draft') {
        items = items.filter((v) => !v.isPublished);
      } else {
        items = items.filter((v) => v.vodStatus === status);
      }
    }

    return [...items].sort((a, b) =>
      (b.lastUpdated || '').localeCompare(a.lastUpdated || ''),
    );
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
      const editId = this.editVideoIdParam();
      if (editId) {
        if (this.editingVideo()?.docId !== editId) {
          const v = this.dataService.videos.get(editId);
          if (v) {
            this.openEditModal(v, false);
          } else {
            this.dataService.getVideoById(editId).then((fetched) => {
              if (fetched && this.editVideoIdParam() === editId) {
                this.openEditModal(fetched, false);
              }
            });
          }
        }
      } else {
        if (this.editingVideo()) {
          this.closeEditModal(false);
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

  // Edit Metadata Modal Methods
  openEditModal(video: VideoItem, updateUrl = true): void {
    this.closeMenu();
    this.editingVideo.set({ ...video });
    this.priceDollars.set(
      video.priceCents ? video.priceCents / 100 : null,
    );
    this.editTags.set([...(video.tags || [])]);

    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);
    this.editAccessTiers.set([...tiers]);
    this.editIsBuyable.set(
      Boolean(
        video.isBuyable ||
        tiers.includes(VodAccessTier.DirectPurchase) ||
        (video.priceCents && video.priceCents > 0),
      ),
    );
    this.editStripePriceId.set(video.stripePriceId || '');
    if (updateUrl) {
      this.viewSignals.urlParams.editVideoId.set(video.docId);
    }
  }

  closeEditModal(updateUrl = true): void {
    this.editingVideo.set(null);
    if (updateUrl) {
      this.viewSignals.urlParams.editVideoId.set('');
    }
  }

  toggleAccessTier(tier: VodAccessTier): void {
    const current = this.editAccessTiers();
    if (current.includes(tier)) {
      this.editAccessTiers.set(current.filter((t) => t !== tier));
    } else {
      this.editAccessTiers.set([...current, tier]);
    }
  }

  isAccessTierSelected(tier: VodAccessTier): boolean {
    return this.editAccessTiers().includes(tier);
  }

  async saveVideoChanges(): Promise<void> {
    const v = this.editingVideo();
    if (!v) return;

    this.isSaving.set(true);
    try {
      const tags = this.editTags();
      const tiers = this.editAccessTiers();
      const isBuyable = this.editIsBuyable();

      const price = this.priceDollars();
      const priceCents = isBuyable && price ? Math.round(price * 100) : undefined;
      const stripePriceId = isBuyable && this.editStripePriceId().trim()
        ? this.editStripePriceId().trim()
        : undefined;

      const patch: Partial<VideoItem> = {
        title: v.title,
        description: v.description,
        accessTier: tiers[0] || VodAccessTier.MembersOnly,
        accessTiers: tiers,
        isBuyable,
        isPublished: v.isPublished,
        featured: v.featured,
        tags,
        priceCents,
        stripePriceId,
      };

      await this.dataService.updateVideoMetadata(v.docId, patch);
      this.closeEditModal(true);
    } catch (err: unknown) {
      console.error('Error saving video changes:', err);
      const msg = err instanceof Error ? err.message : 'Could not save video changes.';
      alert(msg);
    } finally {
      this.isSaving.set(false);
    }
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

    try {
      await this.dataService.deleteVideo(video.docId);
      if (this.drawerVideo()?.docId === video.docId) {
        this.closeDrawer(true);
      }
      if (this.editingVideo()?.docId === video.docId) {
        this.closeEditModal(true);
      }
    } catch (err: unknown) {
      console.error('Error deleting video:', err);
      const msg = err instanceof Error ? err.message : 'Failed to delete video.';
      alert(msg);
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
}

