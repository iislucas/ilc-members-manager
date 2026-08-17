/* videos-catalog.ts
 *
 * Unified Video Catalog component supporting:
 * 1. Video on Demand (VOD) Catalog:
 *    - Top-level pill bar: "Search & Buy" vs "My Videos"
 *    - Filtered to purchasable VOD items (excluding standalone trailers)
 * 2. Class Video Library:
 *    - Filtered to Class Video Library subscribers
 *    - Chronological sorting (newest classes first)
 *    - Subscriber status and subscription callout banner
 * 3. Search, tag filters, instructor autocomplete, sorting, and responsive cards.
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  input,
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

export type CatalogMode = 'vod' | 'class_library' | 'auto';

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

  readonly Views = Views;

  // Optional mode input (defaults to 'auto' which resolves from route)
  mode = input<CatalogMode>('auto');

  isClassLibrary = computed(() => {
    const m = this.mode();
    if (m === 'class_library') return true;
    if (m === 'vod') return false;
    const match = typeof this.routingService?.matchedPatternId === 'function'
      ? this.routingService.matchedPatternId()
      : undefined;
    return match === Views.ClassVideoLibrary;
  });

  // Dynamic route signals dispatch
  private viewSignals = computed(() => {
    const match = typeof this.routingService?.matchedPatternId === 'function'
      ? this.routingService.matchedPatternId()
      : undefined;
    if (match === Views.ClassVideoLibrary && this.routingService?.signals?.[Views.ClassVideoLibrary]) {
      return this.routingService.signals[Views.ClassVideoLibrary];
    }
    return (
      this.routingService?.signals?.[Views.Videos] ||
      this.routingService?.signals?.[Views.ClassVideoLibrary] || {
        urlParams: {
          tab: signal('all'),
          q: signal(''),
          tag: signal(''),
          instructorId: signal(''),
          sortBy: signal('recordedDate'),
          sortDir: signal('desc'),
        },
      }
    );
  });

  // URL Parameter Signals
  activeTab = computed(() => {
    if (this.isClassLibrary()) return 'all';
    return this.routingService?.signals?.[Views.Videos]?.urlParams?.tab?.() || 'all';
  });

  searchQuery = computed(() => this.viewSignals()?.urlParams?.q?.() || '');
  selectedTag = computed(() => this.viewSignals()?.urlParams?.tag?.() || '');
  selectedInstructor = computed(() => this.viewSignals()?.urlParams?.instructorId?.() || '');
  sortField = computed(() => this.viewSignals()?.urlParams?.sortBy?.() || 'recordedDate');
  sortDirection = computed(() => this.viewSignals()?.urlParams?.sortDir?.() || 'desc');

  // Local state signals
  isLoading = signal(false);
  instructorSearchInput = signal('');
  tagSearchInput = signal('');
  continueWatchingList = signal<VideoProgress[]>([]);
  myVideoGrantIds = signal<Set<string>>(new Set());

  // Subscription state for Class Video Library
  todayDateString = new Date().toISOString().split('T')[0];

  isClassSubscriber = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    if (user.isAdmin) return true;
    const m = user.member;
    if (!m) return false;
    return Boolean(
      m.classVideoLibrarySubscription &&
      (!m.classVideoLibraryExpirationDate || m.classVideoLibraryExpirationDate >= this.todayDateString),
    );
  });

  classSubscriptionExpiry = computed(() => {
    const m = this.firebaseState.user()?.member;
    return m?.classVideoLibraryExpirationDate || '';
  });

  // Autocomplete display helper for tags
  tagDisplayFns: DisplayFns<TagItem> = {
    toChipId: (t) => t.tag,
    toName: (t) => (t.description ? `#${t.tag} (${t.description})` : '#' + t.tag),
  };

  getTagTooltip(tag: string): string {
    const meta = this.dataService?.getTagMeta?.(tag);
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
    const inst = (this.dataService?.instructors?.entries?.() || []).find(
      (i) => i.docId === id || i.instructorId === id,
    );
    return (
      this.instructorSearchInput() ||
      (inst ? this.instructorDisplayFns.toName(inst) : id)
    );
  });

  private getVideosList(): VideoItem[] {
    return this.dataService?.videos?.entries?.() || [];
  }

  // Unique tags across relevant published videos
  availableTags = computed<string[]>(() => {
    const tagSet = new Set<string>();
    const isClass = this.isClassLibrary();

    for (const v of this.getVideosList()) {
      if (!v.isPublished || v.isTrailer) continue;
      if (isClass) {
        const isClassVideo =
          v.accessTier === VodAccessTier.ClassVideoSubscribers ||
          (Array.isArray(v.accessTiers) && v.accessTiers.includes(VodAccessTier.ClassVideoSubscribers));
        if (!isClassVideo) continue;
      }
      if (Array.isArray(v.tags)) {
        for (const t of v.tags) {
          if (t) tagSet.add(t);
        }
      }
    }
    return Array.from(tagSet).sort();
  });

  // Counts for tabs
  allBuyableCount = computed(() => {
    return this.getVideosList().filter(
      (v) =>
        v.isPublished &&
        !v.isTrailer &&
        (v.isBuyable ||
          (v.priceCents && v.priceCents > 0) ||
          (Array.isArray(v.accessTiers) && v.accessTiers.includes(VodAccessTier.DirectPurchase))),
    ).length;
  });

  isPurchasedVideo(video: VideoItem): boolean {
    if (!this.myVideoGrantIds().has(video.docId)) {
      return false;
    }
    // Exclude pure class video library videos
    const isClassOnly =
      (video.accessTier === VodAccessTier.ClassVideoSubscribers ||
        (Array.isArray(video.accessTiers) &&
          video.accessTiers.includes(VodAccessTier.ClassVideoSubscribers))) &&
      !video.isBuyable &&
      (!video.priceCents || video.priceCents <= 0);
    return !isClassOnly;
  }

  myPurchasedVideosCount = computed(() => {
    return this.getVideosList().filter(
      (v) => v.isPublished && !v.isTrailer && this.isPurchasedVideo(v),
    ).length;
  });

  myVideosTabLabel = computed(() => {
    const count = this.myPurchasedVideosCount();
    return count > 0 ? `My Videos (${count})` : 'My Videos';
  });

  classVideosCount = computed(() => {
    return this.getVideosList().filter(
      (v) =>
        v.isPublished &&
        !v.isTrailer &&
        (v.accessTier === VodAccessTier.ClassVideoSubscribers ||
          (Array.isArray(v.accessTiers) && v.accessTiers.includes(VodAccessTier.ClassVideoSubscribers))),
    ).length;
  });

  // Filtered & Sorted catalog
  filteredVideos = computed<VideoItem[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tag = this.selectedTag().toLowerCase().trim();
    const instId = this.selectedInstructor();
    const isClass = this.isClassLibrary();
    const tab = this.activeTab();
    const sort = this.sortField();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

    let items = this.getVideosList().filter((v) => v.isPublished && !v.isTrailer);

    // 1. Base Scope Filter
    if (isClass) {
      items = items.filter(
        (v) =>
          v.accessTier === VodAccessTier.ClassVideoSubscribers ||
          (Array.isArray(v.accessTiers) && v.accessTiers.includes(VodAccessTier.ClassVideoSubscribers)),
      );
    } else {
      if (tab === 'my-videos') {
        items = items.filter((v) => this.isPurchasedVideo(v));
      } else {
        // "Search & Buy"
        items = items.filter(
          (v) =>
            v.isBuyable ||
            (v.priceCents && v.priceCents > 0) ||
            (Array.isArray(v.accessTiers) && v.accessTiers.includes(VodAccessTier.DirectPurchase)),
        );
      }
    }

    // 2. Search Text
    if (q) {
      const matchItems = typeof this.dataService?.videos?.search === 'function'
        ? this.dataService.videos.search(q)
        : [];
      const matchIds = new Set(matchItems.map((item) => item.docId));
      items = items.filter(
        (v) =>
          matchIds.has(v.docId) ||
          v.title.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q) ||
          v.instructorName.toLowerCase().includes(q) ||
          (v.location && v.location.toLowerCase().includes(q)) ||
          (v.tags && v.tags.some((t) => t.toLowerCase().includes(q))),
      );
    }

    // 3. Tag Filter
    if (tag) {
      items = items.filter(
        (v) => v.tags && v.tags.some((t) => t.toLowerCase() === tag),
      );
    }

    // 4. Instructor Filter
    if (instId) {
      items = items.filter(
        (v) =>
          v.instructorDocId === instId ||
          v.instructorId === instId ||
          v.sourceMemberDocId === instId,
      );
    }

    // 5. Sorting
    return items.sort((a, b) => {
      if (sort === 'title') {
        return dir * a.title.localeCompare(b.title);
      }
      if (sort === 'duration') {
        return dir * ((a.durationSeconds || 0) - (b.durationSeconds || 0));
      }
      if (sort === 'price') {
        return dir * ((a.priceCents || 0) - (b.priceCents || 0));
      }
      // Default: 'recordedDate'
      const dateA = a.recordedDate || a.createdAt || '';
      const dateB = b.recordedDate || b.createdAt || '';
      if (dateA !== dateB) {
        return dir * dateA.localeCompare(dateB);
      }
      return dir * (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  });

  // Featured video in the hero banner (only shown if a video is explicitly marked as featured)
  featuredVideo = computed<VideoItem | null>(() => {
    const list = this.filteredVideos();
    const featured = list.find((v) => Boolean(v.featured));
    return featured || null;
  });

  async ngOnInit(): Promise<void> {
    if (this.firebaseState.user()?.member?.docId) {
      try {
        const [progress, grants] = await Promise.all([
          this.dataService.getMyVideoProgressList(),
          this.dataService.getMyVideoGrants(),
        ]);
        this.continueWatchingList.set(progress);
        const grantSet = new Set(grants.map((g) => g.videoId || g.docId));
        this.myVideoGrantIds.set(grantSet);
      } catch {
        // Non-blocking
      }
    }
  }

  setTab(tab: 'all' | 'my-videos'): void {
    if (this.routingService.matchedPatternId() === Views.Videos) {
      this.routingService.signals[Views.Videos].urlParams.tab.set(tab);
    }
  }

  setSearchQuery(q: string): void {
    this.viewSignals().urlParams.q.set(q || '');
  }

  setTag(tag: string): void {
    const current = this.selectedTag();
    this.viewSignals().urlParams.tag.set(current === tag ? '' : tag);
    this.tagSearchInput.set(current === tag ? '' : tag);
  }

  onTagSelected(item: TagItem): void {
    this.setTag(item.tag);
  }

  onTagTextUpdated(text: string): void {
    this.tagSearchInput.set(text);
    if (!text.trim()) {
      this.viewSignals().urlParams.tag.set('');
    }
  }

  clearTagFilter(): void {
    this.tagSearchInput.set('');
    this.viewSignals().urlParams.tag.set('');
  }

  onInstructorSelected(inst: InstructorPublicData | null): void {
    this.instructorSearchInput.set('');
    this.viewSignals().urlParams.instructorId.set(inst ? inst.docId : '');
  }

  onInstructorTextUpdated(text: string): void {
    this.instructorSearchInput.set(text);
  }

  clearInstructorFilter(): void {
    this.instructorSearchInput.set('');
    this.viewSignals().urlParams.instructorId.set('');
  }

  setSortField(field: string): void {
    this.viewSignals().urlParams.sortBy.set(field);
  }

  toggleSortDirection(): void {
    const current = this.sortDirection();
    this.viewSignals().urlParams.sortDir.set(current === 'asc' ? 'desc' : 'asc');
  }

  clearAllFilters(): void {
    this.viewSignals().urlParams.q.set('');
    this.viewSignals().urlParams.tag.set('');
    this.viewSignals().urlParams.instructorId.set('');
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
    const isMyVideosTab = this.activeTab() === 'my-videos';
    const hasAccess = this.userHasAccess(video);

    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);

    const labels: string[] = [];
    if (tiers.includes(VodAccessTier.Public)) labels.push('Free');
    if (tiers.includes(VodAccessTier.MembersOnly)) labels.push('Members');
    if (tiers.includes(VodAccessTier.InstructorsOnly)) labels.push('Instructors');
    if (tiers.includes(VodAccessTier.ClassVideoSubscribers)) labels.push('Class Subs');

    if (isMyVideosTab || hasAccess) {
      if (labels.length === 0 || isMyVideosTab) {
        labels.unshift('Purchased');
      }
    } else {
      const isBuyable = Boolean(
        video.isBuyable ||
        tiers.includes(VodAccessTier.DirectPurchase) ||
        (video.priceCents && video.priceCents > 0),
      );
      if (isBuyable) {
        const priceStr = video.priceCents ? `$${(video.priceCents / 100).toFixed(2)}` : 'Paid';
        labels.push(`Buy (${priceStr})`);
      }
    }

    return labels.length > 0 ? labels.join(' • ') : 'Members Only';
  }

  getTopAccessTierBadge(video: VideoItem): {
    label: string;
    cssClass: string;
  } | null {
    const tiers = Array.isArray(video.accessTiers) && video.accessTiers.length > 0
      ? video.accessTiers
      : (video.accessTier ? [video.accessTier] : [VodAccessTier.MembersOnly]);

    if (tiers.includes(VodAccessTier.Public)) {
      return { label: 'Free', cssClass: 'badge-public' };
    }
    if (tiers.includes(VodAccessTier.ClassVideoSubscribers)) {
      return { label: 'Class Subs', cssClass: 'badge-class' };
    }
    if (tiers.includes(VodAccessTier.MembersOnly)) {
      return { label: 'Members', cssClass: 'badge-members' };
    }
    if (tiers.includes(VodAccessTier.InstructorsOnly)) {
      return { label: 'Instructors', cssClass: 'badge-instructors' };
    }
    return null;
  }

  getAccessTierBadge(video: VideoItem): {
    label: string;
    cssClass: string;
  } {
    const topBadge = this.getTopAccessTierBadge(video);
    if (topBadge) return topBadge;
    if (this.userHasAccess(video) || this.activeTab() === 'my-videos') {
      return { label: 'Purchased', cssClass: 'badge-purchased' };
    }
    return { label: 'Paid', cssClass: 'badge-default' };
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

    // Check individual purchased video grant
    if (this.myVideoGrantIds().has(video.docId)) {
      return true;
    }

    const member = user.member;
    if (!member) return false;

    const today = this.todayDateString;
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
      (!member.classVideoLibraryExpirationDate || member.classVideoLibraryExpirationDate >= today),
    );

    if (tiers.includes(VodAccessTier.MembersOnly) && isMember) return true;
    if (tiers.includes(VodAccessTier.InstructorsOnly) && isInstructor) return true;
    if (tiers.includes(VodAccessTier.ClassVideoSubscribers) && isClassSubscriber) return true;

    return false;
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
