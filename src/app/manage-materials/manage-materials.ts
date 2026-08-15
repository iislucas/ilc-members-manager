/* manage-materials.ts
 *
 * Admin management page for viewing, filtering, editing metadata, and deleting
 * all uploaded materials across all instructors using a collection group query.
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  UploadItem,
  IlcEvent,
  InstructorPublicData,
  VodCategory,
  VodAccessTier,
  VodStatus,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { TagInputComponent } from '../tag-input/tag-input';
import { SearchableSet } from '../searchable-set';
import { MediaTypeFilter, SortOption } from '../my-materials/my-materials';

@Component({
  selector: 'app-manage-materials',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
    TagInputComponent,
  ],
  templateUrl: './manage-materials.html',
  styleUrl: './manage-materials.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageMaterialsComponent implements OnInit {
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  private viewSignals = this.routingService.signals[Views.ManageMaterials];

  constructor() {
    effect(() => {
      const startDate = this.selectedStartDate().trim();
      const endDate = this.selectedEndDate().trim();
      const date = this.selectedDateFilter().trim();
      const eventDocId = this.selectedEventFilter().trim();
      const instructorId = this.selectedInstructorFilter().trim();

      this.loadAllMaterials({
        startDate,
        endDate,
        date,
        eventDocId,
        instructorId,
      });
    });
  }

  // State signals
  materials = signal<UploadItem[]>([]);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Search & Filter signals (backed by URL params for shareability)
  searchQuery = computed(() => this.viewSignals.urlParams.q());
  selectedTagFilter = computed(() => this.viewSignals.urlParams.tag());
  selectedDateFilter = computed(() => this.viewSignals.urlParams.date());
  selectedStartDate = computed(() => this.viewSignals.urlParams.startDate());
  selectedEndDate = computed(() => this.viewSignals.urlParams.endDate());
  selectedEventFilter = computed(() => this.viewSignals.urlParams.eventId());
  selectedInstructorFilter = computed(
    () =>
      this.viewSignals.urlParams.instructorId() ||
      this.viewSignals.urlParams.memberDocId() ||
      this.viewSignals.urlParams.memberId(),
  );
  selectedMediaType = computed<MediaTypeFilter>(
    () => (this.viewSignals.urlParams.type() as MediaTypeFilter) || 'all',
  );
  sortOption = signal<SortOption>('date_desc');
  viewMode = signal<'grid' | 'list'>('grid');

  // Input states for autocompletes
  instructorSearchInput = signal('');
  eventSearchInput = signal('');

  selectedInstructorSearchTerm = computed(() => {
    const id = this.selectedInstructorFilter();
    if (!id) return this.instructorSearchInput();
    const inst = this.availableInstructors().find(
      (i) => i.docId === id || i.instructorId === id || i.memberId === id,
    );
    return this.instructorSearchInput() || (inst ? this.instructorDisplayFns.toName(inst) : id);
  });

  selectedEventFilterSearchTerm = computed(() => {
    const id = this.selectedEventFilter();
    if (!id) return this.eventSearchInput();
    const ev = this.availableEvents().find((e) => e.docId === id);
    return this.eventSearchInput() || (ev ? ev.title : id);
  });

  // Edit metadata modal state
  editingUpload = signal<UploadItem | null>(null);
  isSavingEdit = signal(false);
  editName = signal('');
  editDate = signal('');
  editLocation = signal('');
  editEventDocId = signal('');
  editEventTitle = signal('');
  editEventSearchTerm = signal('');
  editNotes = signal('');
  editTags = signal<string[]>([]);
  editTagsInput = signal('');

  // Searchable set and display functions for autocomplete
  eventsSet = new SearchableSet<'docId', IlcEvent>(['title', 'location', 'start'], 'docId');
  eventDisplayFns: DisplayFns<IlcEvent> = {
    toChipId: (e) => e.docId,
    toName: (e) => `${e.title}${e.start ? ' (' + e.start.split('T')[0] + ')' : ''}`,
  };

  instructorDisplayFns: DisplayFns<InstructorPublicData> = {
    toChipId: (i) => i.instructorId,
    toName: (i) => (i.instructorId ? `${i.name} [${i.instructorId}]` : i.name),
  };

  // Available instructors from DataManagerService
  availableInstructors = computed<InstructorPublicData[]>(() => {
    return this.dataService.instructors.entries().sort((a, b) => a.name.localeCompare(b.name));
  });

  // Available events for linking and filtering
  availableEvents = signal<IlcEvent[]>([]);

  // Distinct tags collected across all uploaded materials
  availableTags = computed<string[]>(() => {
    const tags = new Set<string>();
    for (const m of this.materials()) {
      for (const t of m.tags || []) {
        if (t && t.trim()) tags.add(t.trim());
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  });

  // Filtered and sorted materials list
  filteredMaterials = computed<UploadItem[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const instructorFilter = this.selectedInstructorFilter();
    const eventFilter = this.selectedEventFilter();
    const dateFilter = this.selectedDateFilter().trim();
    const startDateFilter = this.selectedStartDate().trim();
    const endDateFilter = this.selectedEndDate().trim();
    const tagFilter = this.selectedTagFilter().trim().toLowerCase();
    const mediaType = this.selectedMediaType();
    const sort = this.sortOption();

    return this.materials()
      .filter((m) => {
        // Text search across all relevant fields
        if (query) {
          const matchName = (m.name || '').toLowerCase().includes(query);
          const matchEvent = (m.eventTitle || '').toLowerCase().includes(query);
          const matchLocation = (m.location || '').toLowerCase().includes(query);
          const matchNotes = (m.notes || '').toLowerCase().includes(query);
          const matchUploader = (m.memberName || m.memberId || '').toLowerCase().includes(query);
          const matchTags = (m.tags || []).some((t) => t.toLowerCase().includes(query));
          if (!matchName && !matchEvent && !matchLocation && !matchNotes && !matchUploader && !matchTags) {
            return false;
          }
        }

        // Instructor filter (by memberDocId or instructorId)
        if (
          instructorFilter &&
          m.memberDocId !== instructorFilter &&
          m.instructorId !== instructorFilter &&
          m.memberId !== instructorFilter
        ) {
          return false;
        }

        // Event filter
        if (eventFilter && m.eventDocId !== eventFilter) {
          return false;
        }

        // Date prefix filter (e.g. '2026', '2026-05', '2026-05-10')
        if (dateFilter) {
          const itemDate = m.date || (m.createdAt ? m.createdAt.split('T')[0] : '');
          if (!itemDate.startsWith(dateFilter)) {
            return false;
          }
        }

        // Start date filter (inclusive)
        if (startDateFilter) {
          const itemDate = m.createdAt || m.date || '';
          if (itemDate < startDateFilter) {
            return false;
          }
        }

        // End date filter (inclusive)
        if (endDateFilter) {
          const itemDate = m.createdAt || m.date || '';
          const endBoundary =
            endDateFilter.length === 10 ? `${endDateFilter}T23:59:59.999Z` : endDateFilter;
          if (itemDate > endBoundary) {
            return false;
          }
        }

        // Tag filter
        if (tagFilter) {
          const matchTag = (m.tags || []).some((t) => t.toLowerCase() === tagFilter);
          if (!matchTag) {
            return false;
          }
        }

        // Media type filter
        if (mediaType === 'video' && !m.contentType.startsWith('video/')) {
          return false;
        }
        if (mediaType === 'image' && !m.contentType.startsWith('image/')) {
          return false;
        }
        if (
          mediaType === 'other' &&
          (m.contentType.startsWith('video/') || m.contentType.startsWith('image/'))
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        switch (sort) {
          case 'date_desc':
            return (b.date || b.createdAt).localeCompare(a.date || a.createdAt);
          case 'date_asc':
            return (a.date || a.createdAt).localeCompare(b.date || b.createdAt);
          case 'name_asc':
            return (a.name || '').localeCompare(b.name || '');
          case 'name_desc':
            return (b.name || '').localeCompare(a.name || '');
          case 'size_desc':
            return (b.size || 0) - (a.size || 0);
          default:
            return 0;
        }
      });
  });

  ngOnInit() {
    this.loadEvents();
  }

  async loadEvents() {
    try {
      const events = await this.dataService.searchEvents({ kind: 'date' });
      events.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
      this.availableEvents.set(events);
      this.eventsSet.setEntries(events);
    } catch (err) {
      console.warn('Could not load events list for admin materials:', err);
    }
  }

  getEventById(eventDocId: string): IlcEvent | undefined {
    return this.eventsSet.get(eventDocId) || this.availableEvents().find((e) => e.docId === eventDocId);
  }

  async loadAllMaterials(options?: {
    startDate?: string;
    endDate?: string;
    date?: string;
    eventDocId?: string;
    instructorId?: string;
  }) {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const items = await this.dataService.getAllUploads(options);
      this.materials.set(items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error loading all materials:', err);
      this.errorMessage.set('Failed to load materials: ' + msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  setSearchQuery(q: string) {
    this.viewSignals.urlParams.q.set(q);
  }

  setTagFilter(tag: string) {
    this.viewSignals.urlParams.tag.set(tag);
  }

  setDateFilter(date: string) {
    this.viewSignals.urlParams.date.set(date);
  }

  setDateRange(startDate: string, endDate: string) {
    this.viewSignals.urlParams.startDate.set(startDate);
    this.viewSignals.urlParams.endDate.set(endDate);
  }

  clearDateRange() {
    this.viewSignals.urlParams.startDate.set('');
    this.viewSignals.urlParams.endDate.set('');
  }

  setMediaType(type: MediaTypeFilter) {
    this.viewSignals.urlParams.type.set(type === 'all' ? '' : type);
  }

  openEditModal(item: UploadItem) {
    this.editingUpload.set(item);
    this.editName.set(item.name);
    this.editDate.set(item.date || '');
    this.editLocation.set(item.location || '');
    this.editEventDocId.set(item.eventDocId || '');
    this.editEventTitle.set(item.eventTitle || '');
    this.editEventSearchTerm.set(item.eventTitle || '');
    this.editNotes.set(item.notes || '');
    this.editTags.set([...(item.tags || [])]);
    this.editTagsInput.set('');
  }

  closeEditModal() {
    this.editingUpload.set(null);
    this.editTags.set([]);
    this.editTagsInput.set('');
  }

  addEditTag(tag: string) {
    const t = tag.trim().replace(/^#/, '');
    if (t && !this.editTags().includes(t)) {
      this.editTags.update((list) => [...list, t]);
      this.editTagsInput.set('');
    }
  }

  removeEditTag(tag: string) {
    this.editTags.update((list) => list.filter((t) => t !== tag));
  }

  onInstructorFilterSelected(inst: InstructorPublicData) {
    this.viewSignals.urlParams.instructorId.set(inst.docId);
    this.instructorSearchInput.set(this.instructorDisplayFns.toName(inst));
  }

  onInstructorFilterTextUpdated(text: string) {
    this.instructorSearchInput.set(text);
    if (!text.trim()) {
      this.viewSignals.urlParams.instructorId.set('');
      this.viewSignals.urlParams.memberId.set('');
    }
  }

  clearInstructorFilter() {
    this.viewSignals.urlParams.instructorId.set('');
    this.viewSignals.urlParams.memberId.set('');
    this.instructorSearchInput.set('');
  }

  onEventFilterSelected(event: IlcEvent) {
    this.viewSignals.urlParams.eventId.set(event.docId);
    this.eventSearchInput.set(event.title);
  }

  onEventFilterTextUpdated(text: string) {
    this.eventSearchInput.set(text);
    if (!text.trim()) {
      this.viewSignals.urlParams.eventId.set('');
    }
  }

  clearEventFilter() {
    this.viewSignals.urlParams.eventId.set('');
    this.eventSearchInput.set('');
  }

  onEditEventSelected(event: IlcEvent) {
    this.editEventDocId.set(event.docId);
    this.editEventTitle.set(event.title);
    this.editEventSearchTerm.set(event.title);
    if (!this.editDate() && event.start) {
      this.editDate.set(event.start.split('T')[0]);
    }
    if (!this.editLocation() && event.location) {
      this.editLocation.set(event.location);
    }
  }

  onEditEventTextUpdated(text: string) {
    this.editEventSearchTerm.set(text);
    if (!text.trim()) {
      this.editEventDocId.set('');
      this.editEventTitle.set('');
    }
  }

  clearEditEvent() {
    this.editEventDocId.set('');
    this.editEventTitle.set('');
    this.editEventSearchTerm.set('');
  }

  async saveEdit() {
    const item = this.editingUpload();
    if (!item) return;

    this.isSavingEdit.set(true);
    const selectedEvId = this.editEventDocId();
    let eventTitle = this.editEventTitle();
    if (selectedEvId && !eventTitle) {
      const linkedEvent = this.getEventById(selectedEvId);
      eventTitle = linkedEvent?.title || '';
    }

    const patch: Partial<UploadItem> = {
      name: this.editName().trim() || item.name,
      date: this.editDate(),
      location: this.editLocation().trim(),
      eventDocId: selectedEvId,
      eventTitle: selectedEvId ? eventTitle : '',
      notes: this.editNotes().trim(),
      tags: this.editTags(),
    };

    try {
      await this.dataService.updateUploadMetadata(item.memberDocId, item.docId, patch);
      this.materials.update((list) =>
        list.map((m) => (m.docId === item.docId ? { ...m, ...patch } : m)),
      );
      this.successMessage.set(`Updated metadata for "${patch.name}".`);
      this.closeEditModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error updating upload metadata:', err);
      this.errorMessage.set('Failed to save metadata: ' + msg);
    } finally {
      this.isSavingEdit.set(false);
    }
  }

  async deleteUpload(upload: UploadItem) {
    if (
      !confirm(
        `Are you sure you want to permanently delete "${upload.name}" uploaded by ${upload.memberName || 'member'}? This cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await this.dataService.deleteUploadItem(upload);
      this.materials.update((list) => list.filter((m) => m.docId !== upload.docId));
      this.successMessage.set(`Deleted "${upload.name}".`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error deleting upload:', err);
      this.errorMessage.set('Failed to delete upload: ' + msg);
    }
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getInstructorDisplay(mat: UploadItem): string {
    const name = mat.memberName || 'Instructor';
    const id = mat.instructorId || mat.memberId;
    return id ? `${name} [${id}]` : name;
  }

  getInstructorHref(mat: UploadItem): string {
    if (mat.instructorId) {
      return this.routingService.hrefForView(Views.InstructorView, {
        instructorId: mat.instructorId,
      });
    }
    if (mat.memberName) {
      return this.routingService.hrefForView(Views.FindAnInstructor, {
        q: mat.memberName,
      });
    }
    return this.routingService.hrefForView(Views.FindAnInstructor);
  }

  getEventHref(mat: UploadItem): string {
    if (mat.eventDocId) {
      return this.routingService.hrefForView(Views.EventView, {
        eventId: mat.eventDocId,
      });
    }
    if (mat.eventTitle) {
      return this.routingService.hrefForView(Views.EventsCalendar, {
        q: mat.eventTitle,
      });
    }
    return this.routingService.hrefForView(Views.EventsCalendar);
  }

  getDateHref(date?: string): string {
    if (date) {
      return this.routingService.hrefForView(Views.EventsCalendar, {
        q: date,
      });
    }
    return this.routingService.hrefForView(Views.EventsCalendar);
  }

  getLocationHref(location?: string): string {
    if (location) {
      return this.routingService.hrefForView(Views.FindSchool, {
        q: location,
      });
    }
    return this.routingService.hrefForView(Views.FindSchool);
  }

  filterByInstructor(mat: UploadItem) {
    if (mat.memberDocId) {
      this.viewSignals.urlParams.instructorId.set(mat.memberDocId);
    } else {
      this.setSearchQuery(mat.memberName || '');
    }
  }

  filterByEvent(mat: UploadItem) {
    if (mat.eventDocId) {
      this.viewSignals.urlParams.eventId.set(mat.eventDocId);
    } else if (mat.eventTitle) {
      this.setSearchQuery(mat.eventTitle);
    }
  }

  filterByDate(date?: string) {
    if (date) {
      const current = this.selectedDateFilter();
      this.setDateFilter(current === date ? '' : date);
    }
  }

  filterByLocation(location?: string) {
    if (location) {
      this.setSearchQuery(location);
    }
  }

  filterByTag(tag: string) {
    const current = this.selectedTagFilter();
    this.setTagFilter(current === tag ? '' : tag);
  }

  // Publish to VOD state
  vodPublishItem = signal<UploadItem | null>(null);
  isPublishingVod = signal(false);
  vodTitle = signal('');
  vodDescription = signal('');
  vodCategory = signal<VodCategory>(VodCategory.SeminarRecording);
  vodAccessTier = signal<VodAccessTier>(VodAccessTier.MembersOnly);
  vodPriceDollars = signal<number | null>(null);
  vodTags = signal<string[]>([]);

  readonly vodCategories = [
    { value: VodCategory.SeminarRecording, label: 'Seminar Recording' },
    { value: VodCategory.TechniqueBreakdown, label: 'Technique Breakdown' },
    { value: VodCategory.GradingSyllabus, label: 'Grading Syllabus' },
    { value: VodCategory.FormDemonstration, label: 'Form Demonstration' },
    { value: VodCategory.InstructorTraining, label: 'Instructor Training' },
    { value: VodCategory.Workshop, label: 'Workshop' },
    { value: VodCategory.HistoricalArchive, label: 'Historical Archive' },
  ];

  readonly vodAccessTiers = [
    { value: VodAccessTier.Public, label: 'Public / Free' },
    { value: VodAccessTier.MembersOnly, label: 'Members Only' },
    { value: VodAccessTier.InstructorsOnly, label: 'Instructors Only' },
    {
      value: VodAccessTier.ClassVideoSubscribers,
      label: 'Class Video Subscribers',
    },
    { value: VodAccessTier.DirectPurchase, label: 'Direct Purchase' },
  ];

  VodStatus = VodStatus;
  Views = Views;

  getVodStatusLabel(mat: UploadItem): string {
    switch (mat.vodStatus) {
      case VodStatus.Ready:
        return 'In VOD';
      case VodStatus.Transcoding:
        return 'Transcoding...';
      case VodStatus.Queued:
        return 'VOD Queued';
      case VodStatus.Failed:
        return 'VOD Failed';
      default:
        return '';
    }
  }

  getVodViewHref(mat: UploadItem): string {
    const videoId = mat.vodVideoId || mat.docId;
    return this.routingService.hrefForView(Views.VideoView, { videoId });
  }

  getManageVodHref(mat: UploadItem): string {
    const videoId = mat.vodVideoId || mat.docId;
    return this.routingService.hrefForView(Views.ManageVod, { q: videoId });
  }

  openPublishVodModal(mat: UploadItem) {
    this.vodPublishItem.set(mat);
    this.vodTitle.set(mat.name || 'Untitled Video');
    this.vodDescription.set(mat.notes || '');
    this.vodCategory.set(VodCategory.SeminarRecording);
    this.vodAccessTier.set(VodAccessTier.MembersOnly);
    this.vodPriceDollars.set(null);
    this.vodTags.set([...(mat.tags || [])]);
  }

  closePublishVodModal() {
    this.vodPublishItem.set(null);
  }

  async submitPublishVod() {
    const item = this.vodPublishItem();
    if (!item) return;

    this.isPublishingVod.set(true);
    try {
      const tags = this.vodTags();

      const price = this.vodPriceDollars();
      const priceCents = price ? Math.round(price * 100) : undefined;

      const res = await this.dataService.transcodeVideoForVod(
        item.docId,
        item.memberDocId,
        {
          title: this.vodTitle(),
          description: this.vodDescription(),
          category: this.vodCategory(),
          accessTier: this.vodAccessTier(),
          tags,
          priceCents,
          instructorDocId: item.memberDocId,
          instructorName: item.memberName,
          instructorId: item.instructorId,
          eventDocId: item.eventDocId,
          eventTitle: item.eventTitle,
          recordedDate: item.date,
          location: item.location,
        },
      );

      const newStatus = res?.vodStatus || VodStatus.Transcoding;
      this.materials.update((list) =>
        list.map((m) =>
          m.docId === item.docId
            ? {
                ...m,
                vodStatus: newStatus,
                vodVideoId: item.docId,
                vodPublishedAt: new Date().toISOString(),
              }
            : m,
        ),
      );

      this.successMessage.set(
        `"${this.vodTitle()}" has been queued for VOD transcoding and catalog publication.`,
      );
      this.closePublishVodModal();
    } catch (err: unknown) {
      console.error('Error publishing to VOD:', err);
      const msg = err instanceof Error ? err.message : 'Failed to trigger VOD transcoding.';
      alert(msg);
    } finally {
      this.isPublishingVod.set(false);
    }
  }
}
