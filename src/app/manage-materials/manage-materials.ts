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
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  UploadItem,
  IlcEvent,
  InstructorPublicData,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { BackLinkComponent } from '../back-link/back-link';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
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
    BackLinkComponent,
    AutocompleteComponent,
  ],
  templateUrl: './manage-materials.html',
  styleUrl: './manage-materials.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageMaterialsComponent implements OnInit {
  public dataService = inject(DataManagerService);
  public firebaseState = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  // State signals
  materials = signal<UploadItem[]>([]);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Search & Filter signals
  searchQuery = signal('');
  selectedInstructorFilter = signal('');
  selectedEventFilter = signal('');
  selectedYearFilter = signal('all');
  selectedMediaType = signal<MediaTypeFilter>('all');
  sortOption = signal<SortOption>('date_desc');
  viewMode = signal<'grid' | 'list'>('grid');

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

  // Searchable set for event autocomplete
  eventsSet = new SearchableSet<'docId', IlcEvent>(['title', 'location', 'start'], 'docId');
  eventDisplayFns: DisplayFns<IlcEvent> = {
    toChipId: (e) => e.docId,
    toName: (e) => `${e.title}${e.start ? ' (' + e.start.split('T')[0] + ')' : ''}`,
  };

  // Available instructors from DataManagerService for filter dropdown
  availableInstructors = computed<InstructorPublicData[]>(() => {
    return this.dataService.instructors.entries().sort((a, b) => a.name.localeCompare(b.name));
  });

  // Available events for linking and filtering
  availableEvents = signal<IlcEvent[]>([]);

  // Extract distinct years from materials for filter dropdown
  availableYears = computed<string[]>(() => {
    const years = new Set<string>();
    for (const m of this.materials()) {
      const year = (m.date || m.createdAt).slice(0, 4);
      if (year && !isNaN(Number(year))) {
        years.add(year);
      }
    }
    return Array.from(years).sort().reverse();
  });

  // Filtered and sorted materials list
  filteredMaterials = computed<UploadItem[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const instructorFilter = this.selectedInstructorFilter();
    const eventFilter = this.selectedEventFilter();
    const yearFilter = this.selectedYearFilter();
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
          if (!matchName && !matchEvent && !matchLocation && !matchNotes && !matchUploader) {
            return false;
          }
        }

        // Instructor filter (by memberDocId)
        if (instructorFilter && m.memberDocId !== instructorFilter) {
          return false;
        }

        // Event filter
        if (eventFilter && m.eventDocId !== eventFilter) {
          return false;
        }

        // Year filter
        if (yearFilter !== 'all') {
          const itemYear = (m.date || m.createdAt).slice(0, 4);
          if (itemYear !== yearFilter) {
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
    this.loadAllMaterials();
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

  async loadAllMaterials() {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const items = await this.dataService.getAllUploads();
      this.materials.set(items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error loading all materials:', err);
      this.errorMessage.set('Failed to load materials: ' + msg);
    } finally {
      this.isLoading.set(false);
    }
  }

  openEditModal(upload: UploadItem) {
    this.editingUpload.set(upload);
    this.editName.set(upload.name);
    this.editDate.set(upload.date || '');
    this.editLocation.set(upload.location || '');
    this.editEventDocId.set(upload.eventDocId || '');
    this.editNotes.set(upload.notes || '');

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
    if (!confirm(`Are you sure you want to permanently delete "${upload.name}" uploaded by ${upload.memberName || 'member'}? This cannot be undone.`)) {
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
}
