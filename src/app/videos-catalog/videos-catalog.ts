/* videos-catalog.ts
 *
 * Public Video Catalog page for browsing, searching, and filtering
 * Video on Demand (VOD) recordings.
 *
 * Features:
 * - Search bar with instant fuzzy search
 * - Category filter tabs (Seminars, Techniques, Grading Prep, Form Demos, Workshops, etc.)
 * - Tag filter chips
 * - Instructor filter autocomplete
 * - Hero spotlight for featured video
 * - "Continue Watching" carousel for logged-in members
 * - Responsive card grid with dynamic entitlement badges
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
  VodCategory,
  VodAccessTier,
  VodStatus,
  VideoProgress,
  InstructorPublicData,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';

export interface CategoryOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-videos-catalog',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    AutocompleteComponent,
  ],
  templateUrl: './videos-catalog.html',
  styleUrl: './videos-catalog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideosCatalogComponent implements OnInit {
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  private viewSignals = this.routingService.signals[Views.Videos];

  // URL Parameter Signals
  searchQuery = computed(() => this.viewSignals.urlParams.q() || '');
  selectedCategory = computed(() => this.viewSignals.urlParams.category() || 'all');
  selectedTag = computed(() => this.viewSignals.urlParams.tag() || '');
  selectedInstructor = computed(() => this.viewSignals.urlParams.instructorId() || '');
  selectedTier = computed(() => this.viewSignals.urlParams.tier() || 'all');

  // Local state signals
  isLoading = signal(false);
  instructorSearchInput = signal('');
  continueWatchingList = signal<VideoProgress[]>([]);

  // Categories list for filter tabs
  readonly categories: CategoryOption[] = [
    { value: 'all', label: 'All Videos' },
    { value: VodCategory.SeminarRecording, label: 'Seminar Recordings' },
    { value: VodCategory.TechniqueBreakdown, label: 'Technique Breakdowns' },
    { value: VodCategory.GradingSyllabus, label: 'Grading Syllabus' },
    { value: VodCategory.FormDemonstration, label: 'Form Demonstrations' },
    { value: VodCategory.InstructorTraining, label: 'Instructor Training' },
    { value: VodCategory.Workshop, label: 'Workshops' },
    { value: VodCategory.HistoricalArchive, label: 'Historical Archives' },
  ];

  // Autocomplete display helper for instructors
  instructorDisplayFns: DisplayFns<InstructorPublicData> = {
    toChipId: (inst) => inst.docId,
    toName: (inst) =>
      `${inst.name || 'Unknown'}${inst.instructorId ? ' [' + inst.instructorId + ']' : ''}`,
  };

  selectedInstructorDisplay = computed(() => {
    const id = this.selectedInstructor();
    if (!id) return this.instructorSearchInput();
    const inst = this.dataService.instructors
      .entries()
      .find((i) => i.docId === id || i.instructorId === id);
    return (
      this.instructorSearchInput() ||
      (inst ? this.instructorDisplayFns.toName(inst) : id)
    );
  });

  // Featured video in the hero banner
  featuredVideo = computed<VideoItem | null>(() => {
    const list = this.dataService.videos.entries().filter((v) => v.isPublished);
    const featured = list.find((v) => v.featured);
    return featured || list[0] || null;
  });

  // Unique tags across all published videos
  availableTags = computed<string[]>(() => {
    const tagSet = new Set<string>();
    for (const v of this.dataService.videos.entries()) {
      if (v.isPublished && Array.isArray(v.tags)) {
        for (const t of v.tags) {
          if (t) tagSet.add(t);
        }
      }
    }
    return Array.from(tagSet).sort();
  });

  // Filtered catalog
  filteredVideos = computed<VideoItem[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const cat = this.selectedCategory();
    const tag = this.selectedTag().toLowerCase().trim();
    const instId = this.selectedInstructor();
    const tier = this.selectedTier();

    let items = this.dataService.videos.entries().filter((v) => v.isPublished);

    if (q) {
      const matchItems = this.dataService.videos.search(q);
      const matchIds = new Set(matchItems.map((item) => item.docId));
      items = items.filter(
        (v) =>
          matchIds.has(v.docId) ||
          v.title.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q) ||
          v.instructorName.toLowerCase().includes(q) ||
          (v.tags && v.tags.some((t) => t.toLowerCase().includes(q))),
      );
    }

    if (cat && cat !== 'all') {
      items = items.filter((v) => v.category === cat);
    }

    if (tag) {
      items = items.filter(
        (v) => v.tags && v.tags.some((t) => t.toLowerCase() === tag),
      );
    }

    if (instId) {
      items = items.filter(
        (v) =>
          v.instructorDocId === instId ||
          v.instructorId === instId ||
          v.sourceMemberDocId === instId,
      );
    }

    if (tier && tier !== 'all') {
      items = items.filter((v) => v.accessTier === tier);
    }

    return items;
  });

  async ngOnInit(): Promise<void> {
    if (this.firebaseState.user()?.member?.docId) {
      try {
        const progress = await this.dataService.getMyVideoProgressList();
        this.continueWatchingList.set(progress);
      } catch {
        // Continue watching is non-blocking
      }
    }
  }

  setSearchQuery(q: string): void {
    this.viewSignals.urlParams.q.set(q || '');
  }

  setCategory(cat: string): void {
    this.viewSignals.urlParams.category.set(cat === 'all' ? '' : cat);
  }

  setTag(tag: string): void {
    const current = this.selectedTag();
    this.viewSignals.urlParams.tag.set(current === tag ? '' : tag);
  }

  onInstructorSelected(inst: InstructorPublicData | null): void {
    this.instructorSearchInput.set('');
    this.viewSignals.urlParams.instructorId.set(inst ? inst.docId : '');
  }

  onInstructorTextUpdated(text: string): void {
    this.instructorSearchInput.set(text);
  }

  clearInstructorFilter(): void {
    this.instructorSearchInput.set('');
    this.viewSignals.urlParams.instructorId.set('');
  }

  clearAllFilters(): void {
    this.viewSignals.urlParams.q.set('');
    this.viewSignals.urlParams.category.set('');
    this.viewSignals.urlParams.tag.set('');
    this.viewSignals.urlParams.instructorId.set('');
    this.viewSignals.urlParams.tier.set('');
    this.instructorSearchInput.set('');
  }

  getVideoHref(video: VideoItem): string {
    return this.routingService.hrefForView(Views.VideoView, {
      videoId: video.docId,
    });
  }

  getInstructorHref(video: VideoItem): string {
    if (!video.instructorDocId && !video.instructorId) return '#';
    return this.routingService.hrefForView(Views.InstructorView, {
      instructorId: video.instructorId || video.instructorDocId,
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

  getCategoryLabel(category: VodCategory | string): string {
    const match = this.categories.find((c) => c.value === category);
    return match ? match.label : category;
  }

  getAccessTierBadge(tier: VodAccessTier | string): {
    label: string;
    cssClass: string;
  } {
    switch (tier) {
      case VodAccessTier.Public:
        return { label: 'Free / Public', cssClass: 'badge-public' };
      case VodAccessTier.MembersOnly:
        return { label: 'Members Only', cssClass: 'badge-members' };
      case VodAccessTier.InstructorsOnly:
        return { label: 'Instructors Only', cssClass: 'badge-instructors' };
      case VodAccessTier.ClassVideoSubscribers:
        return { label: 'Class Subscribers', cssClass: 'badge-class' };
      case VodAccessTier.DirectPurchase:
        return { label: 'Purchasable', cssClass: 'badge-purchase' };
      default:
        return { label: 'Protected', cssClass: 'badge-default' };
    }
  }

  userHasAccess(video: VideoItem): boolean {
    const user = this.firebaseState.user();
    if (!user) {
      return video.accessTier === VodAccessTier.Public;
    }
    if (user.isAdmin) return true;
    if (video.accessTier === VodAccessTier.Public) return true;

    const member = user.member;
    if (!member) return false;

    const today = new Date().toISOString().split('T')[0];
    if (
      video.accessTier === VodAccessTier.MembersOnly &&
      member.currentMembershipExpires &&
      member.currentMembershipExpires >= today
    ) {
      return true;
    }
    if (
      video.accessTier === VodAccessTier.InstructorsOnly &&
      member.instructorLicenseExpires &&
      member.instructorLicenseExpires >= today
    ) {
      return true;
    }
    if (
      video.accessTier === VodAccessTier.ClassVideoSubscribers &&
      member.classVideoLibrarySubscription &&
      member.classVideoLibraryExpirationDate &&
      member.classVideoLibraryExpirationDate >= today
    ) {
      return true;
    }
    return false;
  }
}
