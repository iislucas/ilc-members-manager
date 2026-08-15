/* videos-catalog.ts
 *
 * Public Video Catalog page for browsing, searching, and filtering
 * Video on Demand (VOD) recordings.
 *
 * Features:
 * - Search bar with instant fuzzy search
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
  VodAccessTier,
  VodStatus,
  VideoProgress,
  InstructorPublicData,
  TagItem,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';

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
  selectedTag = computed(() => this.viewSignals.urlParams.tag() || '');
  selectedInstructor = computed(() => this.viewSignals.urlParams.instructorId() || '');
  selectedTier = computed(() => this.viewSignals.urlParams.tier() || 'all');

  // Local state signals
  isLoading = signal(false);
  instructorSearchInput = signal('');
  tagSearchInput = signal('');
  continueWatchingList = signal<VideoProgress[]>([]);

  // Autocomplete display helper for tags
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

  setTag(tag: string): void {
    const current = this.selectedTag();
    this.viewSignals.urlParams.tag.set(current === tag ? '' : tag);
    this.tagSearchInput.set(current === tag ? '' : tag);
  }

  onTagSelected(item: TagItem): void {
    this.setTag(item.tag);
  }

  onTagTextUpdated(text: string): void {
    this.tagSearchInput.set(text);
    if (!text.trim()) {
      this.viewSignals.urlParams.tag.set('');
    }
  }

  clearTagFilter(): void {
    this.tagSearchInput.set('');
    this.viewSignals.urlParams.tag.set('');
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
    this.viewSignals.urlParams.tag.set('');
    this.viewSignals.urlParams.instructorId.set('');
    this.viewSignals.urlParams.tier.set('');
    this.instructorSearchInput.set('');
    this.tagSearchInput.set('');
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

  getAccessTiersSummary(video: VideoItem): string {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);

    const labels: string[] = [];
    if (tiers.includes(VodAccessTier.Public)) labels.push('Free');
    if (tiers.includes(VodAccessTier.MembersOnly)) labels.push('Members');
    if (tiers.includes(VodAccessTier.InstructorsOnly)) labels.push('Instructors');
    if (tiers.includes(VodAccessTier.ClassVideoSubscribers)) labels.push('Class Subs');

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

  getAccessTierBadge(video: VideoItem): {
    label: string;
    cssClass: string;
  } {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);

    if (tiers.includes(VodAccessTier.Public)) {
      return { label: this.getAccessTiersSummary(video), cssClass: 'badge-public' };
    }
    if (tiers.includes(VodAccessTier.MembersOnly)) {
      return { label: this.getAccessTiersSummary(video), cssClass: 'badge-members' };
    }
    if (tiers.includes(VodAccessTier.InstructorsOnly)) {
      return { label: this.getAccessTiersSummary(video), cssClass: 'badge-instructors' };
    }
    if (tiers.includes(VodAccessTier.ClassVideoSubscribers)) {
      return { label: this.getAccessTiersSummary(video), cssClass: 'badge-class' };
    }
    return { label: this.getAccessTiersSummary(video), cssClass: 'badge-purchase' };
  }

  userHasAccess(video: VideoItem): boolean {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);

    if (tiers.includes(VodAccessTier.Public) || video.accessTier === VodAccessTier.Public) {
      return true;
    }

    const user = this.firebaseState.user();
    if (!user) {
      return false;
    }
    if (user.isAdmin) return true;

    const member = user.member;
    if (!member) return false;

    const today = new Date().toISOString().split('T')[0];
    const isInstructor = Boolean(
      member.instructorLicenseExpires &&
      member.instructorLicenseExpires >= today,
    );
    const isMember = Boolean(
      (member.currentMembershipExpires && member.currentMembershipExpires >= today) ||
      isInstructor,
    );
    const isClassSubscriber = Boolean(
      member.classVideoLibrarySubscription &&
      member.classVideoLibraryExpirationDate &&
      member.classVideoLibraryExpirationDate >= today,
    );

    if (tiers.includes(VodAccessTier.MembersOnly) && isMember) return true;
    if (tiers.includes(VodAccessTier.InstructorsOnly) && isInstructor) return true;
    if (tiers.includes(VodAccessTier.ClassVideoSubscribers) && isClassSubscriber) return true;

    return false;
  }
}
