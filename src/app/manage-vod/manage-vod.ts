/* manage-vod.ts
 *
 * Administrator console for managing the Video on Demand (VOD) catalog,
 * monitoring transcoding pipelines, configuring pricing and access tiers,
 * and publishing curated videos.
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  VideoItem,
  VodStatus,
  VodAccessTier,
  VodCategory,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-manage-vod',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './manage-vod.html',
  styleUrl: './manage-vod.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageVodComponent implements OnInit {
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  private viewSignals = this.routingService.signals[Views.ManageVod];

  // URL Parameter Signals
  searchQuery = computed(() => this.viewSignals.urlParams.q() || '');
  selectedStatus = computed(() => this.viewSignals.urlParams.status() || 'all');
  selectedCategory = computed(() => this.viewSignals.urlParams.category() || 'all');

  // Edit Modal State
  editingVideo = signal<VideoItem | null>(null);
  isSaving = signal(false);
  editTagInput = signal('');
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
    const cat = this.selectedCategory();

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

    if (status !== 'all') {
      items = items.filter((v) => v.vodStatus === status);
    }

    if (cat !== 'all') {
      items = items.filter((v) => v.category === cat);
    }

    return items.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  });

  readonly categories = [
    { value: VodCategory.SeminarRecording, label: 'Seminar Recording' },
    { value: VodCategory.TechniqueBreakdown, label: 'Technique Breakdown' },
    { value: VodCategory.GradingSyllabus, label: 'Grading Syllabus' },
    { value: VodCategory.FormDemonstration, label: 'Form Demonstration' },
    { value: VodCategory.InstructorTraining, label: 'Instructor Training' },
    { value: VodCategory.Workshop, label: 'Workshop' },
    { value: VodCategory.HistoricalArchive, label: 'Historical Archive' },
  ];

  readonly accessTiers = [
    { value: VodAccessTier.Public, label: 'Public / Free' },
    { value: VodAccessTier.MembersOnly, label: 'Members Only' },
    { value: VodAccessTier.InstructorsOnly, label: 'Instructors Only' },
    {
      value: VodAccessTier.ClassVideoSubscribers,
      label: 'Class Video Subscribers',
    },
    { value: VodAccessTier.DirectPurchase, label: 'Direct Purchase' },
  ];

  ngOnInit(): void {}

  setSearchQuery(q: string): void {
    this.viewSignals.urlParams.q.set(q || '');
  }

  setStatus(status: string): void {
    this.viewSignals.urlParams.status.set(status === 'all' ? '' : status);
  }

  setCategory(cat: string): void {
    this.viewSignals.urlParams.category.set(cat === 'all' ? '' : cat);
  }

  openEditModal(video: VideoItem): void {
    this.editingVideo.set({ ...video });
    this.priceDollars.set(
      video.priceCents ? video.priceCents / 100 : null,
    );
    this.editTagInput.set((video.tags || []).join(', '));
  }

  closeEditModal(): void {
    this.editingVideo.set(null);
  }

  async saveVideoChanges(): Promise<void> {
    const v = this.editingVideo();
    if (!v) return;

    this.isSaving.set(true);
    try {
      const tags = this.editTagInput()
        .split(',')
        .map((t) => t.trim())
        .filter((t) => !!t);

      const price = this.priceDollars();
      const priceCents = price ? Math.round(price * 100) : undefined;

      const updated: VideoItem = {
        ...v,
        tags,
        priceCents,
        lastUpdated: new Date().toISOString(),
      };

      await this.dataService.saveVideo(updated);
      this.closeEditModal();
    } catch (err: any) {
      console.error('Error saving video changes:', err);
      alert(err.message || 'Could not save video changes.');
    } finally {
      this.isSaving.set(false);
    }
  }

  async retryTranscoding(video: VideoItem): Promise<void> {
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
      alert('Transcoding job queued successfully.');
    } catch (err: any) {
      console.error('Error starting transcoding:', err);
      alert(err.message || 'Failed to start transcoding.');
    }
  }

  async deleteVideo(video: VideoItem): Promise<void> {
    if (
      !confirm(
        `Are you sure you want to remove "${video.title}" from the VOD catalog?`,
      )
    ) {
      return;
    }

    try {
      await this.dataService.deleteVideo(video.docId);
    } catch (err: any) {
      console.error('Error deleting video:', err);
      alert(err.message || 'Failed to delete video.');
    }
  }

  getVideoHref(video: VideoItem): string {
    return this.routingService.hrefForView(Views.VideoView, {
      videoId: video.docId,
    });
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
