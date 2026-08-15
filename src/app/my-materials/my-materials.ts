/* my-materials.ts
 *
 * Dedicated materials management page for instructors.
 * Allows uploading, previewing, organizing (date, location, event link, notes),
 * filtering, searching, and deleting private materials (videos, photos, files).
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  UploadItem,
  UploadItemSource,
  IlcEvent,
  VodStatus,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views, FIREBASE_APP } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { TagInputComponent } from '../tag-input/tag-input';
import { SearchableSet } from '../searchable-set';
import { makeThumbnail } from '../utils';

export type MediaTypeFilter = 'all' | 'video' | 'image' | 'other';
export type SortOption = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc' | 'size_desc';

@Component({
  selector: 'app-my-materials',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
    TagInputComponent,
  ],
  templateUrl: './my-materials.html',
  styleUrl: './my-materials.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyMaterialsComponent implements OnInit {
  private firebaseApp = inject(FIREBASE_APP);
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  private viewSignals = this.routingService.signals[Views.MyMaterials];

  readonly MAX_PREVIEW_DIM = 320;

  // State signals
  materials = signal<UploadItem[]>([]);
  isLoading = signal(true);
  isUploading = signal(false);
  uploadCount = signal(0);
  uploadTotal = signal(0);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Search & Filter signals (backed by URL params for shareability)
  searchQuery = computed(() => this.viewSignals.urlParams.q());
  selectedTagFilter = computed(() => this.viewSignals.urlParams.tag());
  selectedDateFilter = computed(() => this.viewSignals.urlParams.date());
  selectedEventFilter = computed(() => this.viewSignals.urlParams.eventId());
  selectedMediaType = computed<MediaTypeFilter>(
    () => (this.viewSignals.urlParams.type() as MediaTypeFilter) || 'all',
  );
  sortOption = signal<SortOption>('date_desc');
  viewMode = signal<'grid' | 'list'>('grid');

  // Input states for event autocomplete
  eventSearchInput = signal('');

  selectedEventFilterSearchTerm = computed(() => {
    const id = this.selectedEventFilter();
    if (!id) return this.eventSearchInput();
    const ev = this.availableEvents().find((e) => e.docId === id);
    return this.eventSearchInput() || (ev ? ev.title : id);
  });

  // Pre-fill upload defaults (for batch uploads)
  defaultUploadDate = signal(new Date().toISOString().split('T')[0]);
  defaultUploadLocation = signal('');
  defaultUploadEventDocId = signal('');
  defaultUploadEventTitle = signal('');
  defaultUploadEventSearchTerm = signal('');
  defaultUploadTags = signal<string[]>([]);
  defaultUploadTagsInput = signal('');

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

  // Searchable set for event autocomplete
  eventsSet = new SearchableSet<'docId', IlcEvent>(['title', 'location', 'start'], 'docId');
  eventDisplayFns: DisplayFns<IlcEvent> = {
    toChipId: (e) => e.docId,
    toName: (e) => `${e.title}${e.start ? ' (' + e.start.split('T')[0] + ')' : ''}`,
  };

  // Current user's member details
  userMemberDocId = computed(() => this.firebaseState.user()?.member?.docId || '');
  userMember = computed(() => this.firebaseState.user()?.member);

  // Available events for linking
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
    const eventFilter = this.selectedEventFilter();
    const dateFilter = this.selectedDateFilter().trim();
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
          const matchTags = (m.tags || []).some((t) => t.toLowerCase().includes(query));
          if (!matchName && !matchEvent && !matchLocation && !matchNotes && !matchTags) {
            return false;
          }
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
    this.loadMaterials();
    this.loadEvents();
  }

  async loadEvents() {
    try {
      const events = await this.dataService.searchEvents({ kind: 'date' });
      events.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
      this.availableEvents.set(events);
      this.eventsSet.setEntries(events);
    } catch (err) {
      console.warn('Could not load events list for materials:', err);
    }
  }

  getEventById(eventDocId: string): IlcEvent | undefined {
    return this.eventsSet.get(eventDocId) || this.availableEvents().find((e) => e.docId === eventDocId);
  }

  async loadMaterials() {
    const memberDocId = this.userMemberDocId();
    if (!memberDocId) {
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const items = await this.dataService.getMemberUploads(memberDocId);
      this.materials.set(items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error loading materials:', err);
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

  setMediaType(type: MediaTypeFilter) {
    this.viewSignals.urlParams.type.set(type === 'all' ? '' : type);
  }

  addUploadTag(tag: string) {
    const t = tag.trim().replace(/^#/, '');
    if (t && !this.defaultUploadTags().includes(t)) {
      this.defaultUploadTags.update((list) => [...list, t]);
      this.defaultUploadTagsInput.set('');
    }
  }

  removeUploadTag(tag: string) {
    this.defaultUploadTags.update((list) => list.filter((t) => t !== tag));
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

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files && files.length > 0) {
      this.uploadFiles(Array.from(files));
    }
    input.value = '';
  }

  async uploadFiles(files: FileList | File[]) {
    const memberDocId = this.userMemberDocId();
    const member = this.userMember();
    if (!memberDocId || !member) {
      this.errorMessage.set('You must be signed in to upload files.');
      return;
    }

    if (!files || files.length === 0) return;

    this.isUploading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.uploadCount.set(0);
    this.uploadTotal.set(files.length);

    const storage = getStorage(this.firebaseApp);
    const failures: string[] = [];
    const newItems: UploadItem[] = [];

    // Find linked event title if event is selected
    const selectedEvId = this.defaultUploadEventDocId();
    const linkedEvent = selectedEvId ? this.getEventById(selectedEvId) : undefined;
    const eventTitle = linkedEvent?.title || '';
    const uploadDate = this.defaultUploadDate() || new Date().toISOString().split('T')[0];
    const uploadLocation = this.defaultUploadLocation() || linkedEvent?.location || '';
    const uploadTags = [...this.defaultUploadTags()];

    for (const file of files) {
      const itemId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const storagePath = `members/${memberDocId}/materials/originals/${itemId}/original`;
      const previewStoragePath = `members/${memberDocId}/materials/previews/${itemId}.jpg`;

      try {
        // 1. Upload original
        const originalRef = ref(storage, storagePath);
        await uploadBytes(originalRef, file, {
          contentType: file.type || 'application/octet-stream',
          customMetadata: { name: file.name },
        });
        const url = await getDownloadURL(originalRef);

        // 2. Generate and upload preview thumbnail (best effort)
        let previewUrl = '';
        try {
          const thumbBlob = await makeThumbnail(file, this.MAX_PREVIEW_DIM);
          const previewRef = ref(storage, previewStoragePath);
          await uploadBytes(previewRef, thumbBlob, { contentType: 'image/jpeg' });
          previewUrl = await getDownloadURL(previewRef);
        } catch (previewErr) {
          console.warn(`Could not generate thumbnail for "${file.name}":`, previewErr);
        }

        // 3. Create Firestore metadata record
        const uploadItemPayload: Omit<UploadItem, 'docId'> = {
          memberDocId,
          memberId: member.memberId || '',
          memberName: member.name || '',
          instructorId: member.instructorId || '',
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          url,
          previewUrl,
          storagePath,
          previewStoragePath: previewUrl ? previewStoragePath : '',
          date: uploadDate,
          location: uploadLocation,
          eventDocId: selectedEvId,
          eventTitle,
          notes: '',
          tags: uploadTags,
          source: UploadItemSource.Direct,
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        };

        const docId = await this.dataService.createUploadItem(uploadItemPayload);
        const fullItem: UploadItem = { ...uploadItemPayload, docId };
        newItems.push(fullItem);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Error uploading "${file.name}":`, err);
        failures.push(`${file.name}: ${msg}`);
      } finally {
        this.uploadCount.update((n) => n + 1);
      }
    }

    if (newItems.length > 0) {
      this.materials.update((current) => [...newItems, ...current]);
      this.successMessage.set(`Successfully uploaded ${newItems.length} file(s).`);
    }

    if (failures.length > 0) {
      this.errorMessage.set(`Failed to upload ${failures.length} file(s): ` + failures.join('; '));
    }

    this.isUploading.set(false);
  }

  onDefaultEventSelected(event: IlcEvent) {
    this.defaultUploadEventDocId.set(event.docId);
    this.defaultUploadEventTitle.set(event.title);
    this.defaultUploadEventSearchTerm.set(event.title);
    if (!this.defaultUploadLocation() && event.location) {
      this.defaultUploadLocation.set(event.location);
    }
    if (event.start) {
      this.defaultUploadDate.set(event.start.split('T')[0]);
    }
  }

  onDefaultEventTextUpdated(text: string) {
    this.defaultUploadEventSearchTerm.set(text);
    if (!text.trim()) {
      this.defaultUploadEventDocId.set('');
      this.defaultUploadEventTitle.set('');
    }
  }

  clearDefaultEvent() {
    this.defaultUploadEventDocId.set('');
    this.defaultUploadEventTitle.set('');
    this.defaultUploadEventSearchTerm.set('');
  }

  openEditModal(upload: UploadItem) {
    this.editingUpload.set(upload);
    this.editName.set(upload.name);
    this.editDate.set(upload.date || '');
    this.editLocation.set(upload.location || '');
    this.editEventDocId.set(upload.eventDocId || '');
    this.editNotes.set(upload.notes || '');
    this.editTags.set([...(upload.tags || [])]);
    this.editTagsInput.set('');

    let title = upload.eventTitle || '';
    if (upload.eventDocId && !title) {
      const ev = this.getEventById(upload.eventDocId);
      if (ev) {
        title = ev.title;
      }
    }
    this.editEventTitle.set(title);
    this.editEventSearchTerm.set(title);
  }

  closeEditModal() {
    this.editingUpload.set(null);
    this.editTags.set([]);
    this.editTagsInput.set('');
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
      console.error('Error saving upload metadata:', err);
      this.errorMessage.set('Failed to save metadata: ' + msg);
    } finally {
      this.isSavingEdit.set(false);
    }
  }

  async deleteUpload(upload: UploadItem) {
    if (
      !confirm(
        `Are you sure you want to permanently delete "${upload.name}"? This removes the file and thumbnail.`,
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

  VodStatus = VodStatus;

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
}
