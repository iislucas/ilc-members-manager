/* manage-events.ts
 *
 * Admin component for managing all events in the /events collection.
 * Provides search, status filtering, and links to edit individual events.
 * Follows the member-list filtering pattern with URL-param-backed state.
 * Proposed events are prioritised at the top of the list.
 */

import {
  Component,
  inject,
  signal,
  computed,
  OnDestroy,
  ChangeDetectionStrategy,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataManagerService } from '../data-manager.service';
import {
  getFirestore,
  collection,
  query,
  onSnapshot,
  Unsubscribe,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { FIREBASE_APP, Views } from '../app.config';
import { IlcEvent, EventStatus, EventSourceKind, initEvent } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';
import { EventItemComponent } from '../events-calendar/event-item/event-item';

export enum EventSortField {
  Start = 'start',
  CreatedAt = 'createdAt',
  LastUpdated = 'lastUpdated',
  Title = 'title',
}

export enum SortDirection {
  Asc = 'asc',
  Desc = 'desc',
}

export const EVENT_SORT_FIELD_LABELS: { value: EventSortField; label: string }[] = [
  { value: EventSortField.Start, label: 'Event Date' },
  { value: EventSortField.CreatedAt, label: 'Created' },
  { value: EventSortField.LastUpdated, label: 'Last Updated' },
  { value: EventSortField.Title, label: 'Title' },
];

@Component({
  selector: 'app-manage-events',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent, EventItemComponent],
  templateUrl: './manage-events.html',
  styleUrl: './manage-events.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageEventsComponent implements OnDestroy {
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);
  private dataService = inject(DataManagerService);

  // Constants for template
  EventStatus = EventStatus;
  SortDirection = SortDirection;
  sortFieldOptions = EVENT_SORT_FIELD_LABELS;
  // TODO: is there a more robust way to do this than hardcoding the status list?
  statusOptions = [
    EventStatus.Proposed,
    EventStatus.Listed,
    EventStatus.Rejected,
    EventStatus.Cancelled,
  ];

  // State
  public rawEvents = signal<IlcEvent[]>([]);
  public isLoading = signal(false);
  public errorMessage = signal<string | null>(null);
  public statusFilterMenuOpen = signal(false);
  public searched = signal(false);

  // URL-param backed state — defaults show upcoming/recent events (3 days ago → future).
  private defaultStartDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    return d.toISOString().split('T')[0];
  })();

  public searchMode = signal<'recent' | 'term' | 'date'>('date');
  public searchField = signal<'title' | 'location' | 'ownerEmails' | 'leadingInstructorId'>('title');
  public searchTerm = signal('');
  public startDate = signal<string>(this.defaultStartDate);
  public endDate = signal<string>('');

  public sortField = signal<EventSortField>(EventSortField.Start);
  public sortDirection = signal<SortDirection>(SortDirection.Asc);
  public statusFilter = signal<string>('');

  private eventSignals = this.routingService.signals[Views.ManageEvents];
  private initialised = false;

  // Filtered and sorted events
  events = computed(() => {
    const raw = this.rawEvents();
    const field = this.sortField();
    const dir = this.sortDirection();
    const mul = dir === SortDirection.Asc ? 1 : -1;

    const sorted = [...raw].sort((a, b) => {
      // Proposed events always at top
      if (a.status === EventStatus.Proposed && b.status !== EventStatus.Proposed) return -1;
      if (b.status === EventStatus.Proposed && a.status !== EventStatus.Proposed) return 1;

      switch (field) {
        case EventSortField.Start:
          return mul * (a.start || '').localeCompare(b.start || '');
        case EventSortField.CreatedAt:
          return mul * (a.createdAt || '').localeCompare(b.createdAt || '');
        case EventSortField.LastUpdated:
          return mul * (a.lastUpdated || '').localeCompare(b.lastUpdated || '');
        case EventSortField.Title:
          return mul * (a.title || '').localeCompare(b.title || '');
        default:
          return 0;
      }
    });

    return sorted;
  });

  constructor() {
    effect(() => {
      const urlMode = this.eventSignals.urlParams.searchMode() as 'recent' | 'term' | 'date';
      const urlField = this.eventSignals.urlParams.searchField();
      const urlQ = this.eventSignals.urlParams.q();
      const urlStart = this.eventSignals.urlParams.startDate();
      const urlEnd = this.eventSignals.urlParams.endDate();
      const urlSortBy = this.eventSignals.urlParams.sortBy();
      const urlSortDir = this.eventSignals.urlParams.sortDir();
      const urlStatus = this.eventSignals.urlParams.status();

      if (this.initialised) return;
      this.initialised = true;

      // Apply URL params with correct defaults for each field.
      const mode = (urlMode || 'date') as 'recent' | 'term' | 'date';
      this.searchMode.set(mode);
      this.searchField.set((urlField || 'title') as 'title' | 'location' | 'ownerEmails' | 'leadingInstructorId');
      this.searchTerm.set(urlQ || '');
      this.startDate.set(urlStart || this.defaultStartDate);
      this.endDate.set(urlEnd || '');
      this.sortField.set((urlSortBy as EventSortField) || EventSortField.Start);
      this.sortDirection.set((urlSortDir === 'asc' || urlSortDir === 'desc') ? urlSortDir as SortDirection : SortDirection.Asc);
      this.statusFilter.set(urlStatus || '');

      if (mode === 'term' && this.searchTerm()) {
        this.search();
      } else if (mode === 'date') {
        this.search();
      } else {
        this.loadRecentEvents();
      }
    });
  }

  ngOnDestroy() {
    // No unsubscribe needed as we use getDocs instead of onSnapshot
  }

  public syncUrlParams() {
    this.eventSignals.urlParams.searchMode.set(this.searchMode());
    this.eventSignals.urlParams.searchField.set(this.searchField());
    this.eventSignals.urlParams.q.set(this.searchTerm());
    this.eventSignals.urlParams.startDate.set(this.startDate());
    this.eventSignals.urlParams.endDate.set(this.endDate());
    this.eventSignals.urlParams.sortBy.set(this.sortField());
    this.eventSignals.urlParams.sortDir.set(this.sortDirection());
    this.eventSignals.urlParams.status.set(this.statusFilter());
  }

  async setSearchMode(mode: 'recent' | 'term' | 'date') {
    this.searchMode.set(mode);
    if (mode === 'recent') {
      this.searchTerm.set('');
      this.startDate.set('');
      this.endDate.set('');
      this.searched.set(false);
      this.syncUrlParams();
      await this.loadRecentEvents();
    } else if (mode === 'date') {
      this.syncUrlParams();
      await this.search();
    } else {
      this.syncUrlParams();
    }
  }

  async loadRecentEvents() {
    this.isLoading.set(true);
    try {
      const results = await this.dataService.getRecentEvents(100, this.statusFilter());
      this.rawEvents.set(results);
    } catch (e) {
      console.error(e);
      this.errorMessage.set('Failed to load events.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async search() {
    const mode = this.searchMode();
    const field = this.searchField();
    const term = this.searchTerm().trim();
    const start = this.startDate();
    const end = this.endDate();

    if (mode === 'recent') {
      this.searched.set(false);
      this.syncUrlParams();
      await this.loadRecentEvents();
      return;
    }
    if (mode === 'term' && !term) {
      this.searched.set(false);
      this.syncUrlParams();
      await this.loadRecentEvents();
      return;
    }

    this.isLoading.set(true);
    this.searched.set(true);
    this.syncUrlParams();
    try {
      let results: IlcEvent[] = [];
      if (mode === 'term') {
        results = await this.dataService.searchEvents({
          kind: 'term',
          searchField: field,
          term,
          statusFilter: this.statusFilter(),
        });
      } else {
        results = await this.dataService.searchEvents({
          kind: 'date',
          startDate: start,
          endDate: end,
          statusFilter: this.statusFilter(),
        });
      }
      this.rawEvents.set(results);
    } catch (e) {
      console.error(e);
      this.errorMessage.set('Failed to search events.');
    } finally {
      this.isLoading.set(false);
    }
  }

  onSortFieldChange(value: EventSortField) {
    this.sortField.set(value);
    this.syncUrlParams();
  }

  toggleSortDirection() {
    const next = this.sortDirection() === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc;
    this.sortDirection.set(next);
    this.syncUrlParams();
  }

  onFilterChange() {
    this.syncUrlParams();
    if (this.searchMode() === 'term' && this.searchTerm()) {
      this.search();
    } else if (this.searchMode() === 'date' && (this.startDate() || this.endDate())) {
      this.search();
    } else {
      this.loadRecentEvents();
    }
  }

  toggleStatusMenu() {
    this.statusFilterMenuOpen.update(v => !v);
  }

  clearStatusFilter() {
    this.statusFilter.set('');
    this.statusFilterMenuOpen.set(false);
    this.onFilterChange();
  }

  // Admin quick actions
  async setStatus(docId: string, status: EventStatus) {
    try {
      const docRef = doc(this.db, 'events', docId);
      await updateDoc(docRef, { status, lastUpdated: new Date().toISOString() });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error updating event status:', error);
      alert('Failed to update status: ' + message);
    }
  }

  editLink(event: IlcEvent): string {
    const id = event.docId || event.sourceId || '';
    return `#/events/${id}/edit`;
  }

  viewLink(event: IlcEvent): string {
    const id = event.docId || event.sourceId || '';
    return `#/manage-events/${id}`;
  }

  // Resolve the event owner to a "Name (MemberId)" chip label.
  ownerLabel(event: IlcEvent): string {
    if (!event.ownerDocId) return '';
    const member = this.dataService.getMemberByDocId(event.ownerDocId);
    if (member) {
      return `${member.name} (${member.memberId || event.ownerDocId})`;
    }
    // Fallback: show email if available, otherwise just the docId.
    if (event.ownerEmails?.length) {
      return `${event.ownerEmails[0]} (${event.ownerDocId})`;
    }
    return event.ownerDocId;
  }

  // Build a link to the member view for the event owner.
  ownerLink(event: IlcEvent): string {
    if (!event.ownerDocId) return '';
    return this.routingService.hrefForView(Views.ManageMemberView, {
      memberId: event.ownerDocId,
    });
  }

  // Resolve the leading instructor to a "Name (InstructorId)" chip label.
  instructorLabel(event: IlcEvent): string {
    const id = event.leadingInstructorId;
    if (!id) return '';
    const instructor = this.dataService.instructors.get(id);
    if (instructor) {
      return `${instructor.name} (${id})`;
    }
    return id;
  }

  // Build a link to the Find an Instructor view for the leading instructor.
  // instructorId is a URL param (not a path variable) on this route.
  instructorLink(event: IlcEvent): string {
    const id = event.leadingInstructorId;
    if (!id) return '';
    return this.routingService.hrefWithParams(
      `/find-an-instructor?instructorId=${encodeURIComponent(id)}`,
    );
  }
}
