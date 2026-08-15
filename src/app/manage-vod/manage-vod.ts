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
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  // Stats Folddown toggle
  showStatsFold = signal(false);

  // Edit Modal State
  editingVideo = signal<VideoItem | null>(null);
  isSaving = signal(false);
  editTags = signal<string[]>([]);
  priceDollars = signal<number | null>(null);

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

    return items.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
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
  VodAccessTier = VodAccessTier;

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
      await this.dataService.updateVideoMetadata(video.docId, {
        isPublished: !video.isPublished,
      });
    } catch (err: unknown) {
      console.error('Error toggling published status:', err);
      const msg = err instanceof Error ? err.message : 'Failed to update publication status.';
      alert(msg);
    }
  }

  // Job Details Drawer Methods
  openDrawer(video: VideoItem): void {
    this.closeMenu();
    this.drawerVideo.set(video);
    if (
      video.vodStatus === VodStatus.Transcoding ||
      video.vodStatus === VodStatus.Queued
    ) {
      this.startPolling(video.docId);
    }
  }

  closeDrawer(): void {
    this.stopPolling();
    this.drawerVideo.set(null);
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
  openEditModal(video: VideoItem): void {
    this.closeMenu();
    this.editingVideo.set({ ...video });
    this.priceDollars.set(
      video.priceCents ? video.priceCents / 100 : null,
    );
    this.editTags.set([...(video.tags || [])]);
  }

  closeEditModal(): void {
    this.editingVideo.set(null);
  }

  async saveVideoChanges(): Promise<void> {
    const v = this.editingVideo();
    if (!v) return;

    this.isSaving.set(true);
    try {
      const tags = this.editTags();

      const price = this.priceDollars();
      const priceCents = price ? Math.round(price * 100) : undefined;

      const patch: Partial<VideoItem> = {
        title: v.title,
        description: v.description,
        accessTier: v.accessTier,
        isPublished: v.isPublished,
        featured: v.featured,
        tags,
        priceCents,
      };

      await this.dataService.updateVideoMetadata(v.docId, patch);
      this.closeEditModal();
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
        this.closeDrawer();
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

