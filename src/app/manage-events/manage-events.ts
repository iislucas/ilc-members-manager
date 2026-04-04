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
} from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { IlcEvent, EventStatus, EventSourceKind } from '../../../functions/src/data-model';
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

  // Constants for template
  EventStatus = EventStatus;
  SortDirection = SortDirection;
  sortFieldOptions = EVENT_SORT_FIELD_LABELS;

  // State
  private allEvents = signal<IlcEvent[]>([]);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);
  statusFilterMenuOpen = signal(false);
  limit = signal(50);

  private unsubscribe: Unsubscribe | null = null;

  // URL-param backed state
  searchTerm = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match !== Views.ManageEvents) return '';
    return this.routingService.signals[Views.ManageEvents].urlParams.q() || '';
  });

  selectedStatuses = computed<Set<string>>(() => {
    const match = this.routingService.matchedPatternId();
    if (match !== Views.ManageEvents) return new Set([EventStatus.Proposed, EventStatus.Listed]);
    const raw = this.routingService.signals[Views.ManageEvents].urlParams.status() || '';
    if (raw) return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
    return new Set([EventStatus.Proposed, EventStatus.Listed]);
  });

  hasStatusFilter = computed(() => this.selectedStatuses().size > 0 && this.selectedStatuses().size < 4);

  sortField = computed<EventSortField>(() => {
    const match = this.routingService.matchedPatternId();
    if (match !== Views.ManageEvents) return EventSortField.Start;
    const val = this.routingService.signals[Views.ManageEvents].urlParams.sortBy() as EventSortField;
    if (Object.values(EventSortField).includes(val)) return val;
    return EventSortField.Start;
  });

  sortDirection = computed<SortDirection>(() => {
    const match = this.routingService.matchedPatternId();
    if (match !== Views.ManageEvents) return SortDirection.Desc;
    const val = this.routingService.signals[Views.ManageEvents].urlParams.sortDir();
    if (val === SortDirection.Asc || val === SortDirection.Desc) return val;
    return SortDirection.Desc;
  });

  // Filtered and sorted events
  private searchFiltered = computed(() => {
    const all = this.allEvents();
    const term = this.searchTerm().toLowerCase().trim();
    if (!term) return all;
    return all.filter(e =>
      e.title.toLowerCase().includes(term) ||
      e.location.toLowerCase().includes(term) ||
      (e.description || '').toLowerCase().includes(term) ||
      (e.ownerEmail || '').toLowerCase().includes(term)
    );
  });

  private statusFiltered = computed(() => {
    const all = this.searchFiltered();
    const statuses = this.selectedStatuses();
    if (statuses.size === 0) return all;
    return all.filter(e => statuses.has(e.status));
  });

  // Sort with proposed events prioritised at top
  events = computed(() => {
    const all = this.statusFiltered();
    const field = this.sortField();
    const dir = this.sortDirection();
    const mul = dir === SortDirection.Asc ? 1 : -1;

    const sorted = [...all].sort((a, b) => {
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

    return sorted.slice(0, this.limit());
  });

  totalFiltered = computed(() => this.statusFiltered().length);

  constructor() {
    this.subscribeToEvents();
  }

  ngOnDestroy() {
    this.unsubscribe?.();
  }

  private subscribeToEvents() {
    const colRef = collection(this.db, 'events');
    const q = query(colRef);

    this.isLoading.set(true);
    this.unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const events = snapshot.docs.map(
          (d) => ({ ...d.data(), docId: d.id } as IlcEvent)
        );
        this.allEvents.set(events);
        this.isLoading.set(false);
      },
      (error) => {
        console.error('Error fetching events:', error);
        this.errorMessage.set('Failed to load events.');
        this.isLoading.set(false);
      }
    );
  }

  // URL-param actions
  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.routingService.signals[Views.ManageEvents].urlParams.q.set(value);
    this.limit.set(50);
  }

  onSortFieldChange(value: EventSortField) {
    this.routingService.signals[Views.ManageEvents].urlParams.sortBy.set(value);
  }

  toggleSortDirection() {
    const next = this.sortDirection() === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc;
    this.routingService.signals[Views.ManageEvents].urlParams.sortDir.set(next);
  }

  isStatusSelected(status: string): boolean {
    return this.selectedStatuses().has(status);
  }

  onSelectStatus(status: string) {
    const current = new Set(this.selectedStatuses());
    if (current.has(status)) {
      current.delete(status);
    } else {
      current.add(status);
    }
    this.routingService.signals[Views.ManageEvents].urlParams.status.set([...current].join(','));
    this.limit.set(50);
  }

  clearStatusFilter() {
    this.routingService.signals[Views.ManageEvents].urlParams.status.set('');
    this.statusFilterMenuOpen.set(false);
    this.limit.set(50);
  }

  toggleStatusMenu() {
    this.statusFilterMenuOpen.update(v => !v);
  }

  showAll() {
    this.limit.set(Infinity);
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
    const id = event.sourceId || event.docId || '';
    return `#/events/${id}`;
  }
}
