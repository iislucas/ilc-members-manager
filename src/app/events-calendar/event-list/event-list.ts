import {
  Component,
  signal,
  inject,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
  linkedSignal,
  effect,
  OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  collection,
  onSnapshot,
  query,
  getFirestore,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { AppPathPatterns, FIREBASE_APP, Views } from '../../app.config';
import { RoutingService } from '../../routing.service';
import { CalendarEvent } from '../event.model';
import { IlcEvent, EventStatus, initEvent } from '../../../../functions/src/data-model';
import MiniSearch from 'minisearch';
import { EventItemComponent } from '../event-item/event-item';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { environment } from '../../../environments/environment';


function quotedFilter(result: CalendarEvent, quoted: string[]): boolean {
  if (quoted.length === 0) {
    return true;
  }

  const title = result.title.toLowerCase();
  const location = result.location?.toLowerCase() || '';
  const start = result.start?.toLowerCase() || '';
  const end = result.end?.toLowerCase() || '';
  return quoted.every((q) => {
    return (
      start.includes(q) ||
      end.includes(q) ||
      title.includes(q) ||
      location.includes(q)
    );
  });
}

// A type representing a calendar event that can be indexed by MiniSearch.
// It includes a string `id` field required by the library.
type SearchableCalendarEvent = IlcEvent & { id: string };

@Component({
  selector: 'app-event-list',
  standalone: true,
  imports: [FormsModule, EventItemComponent, IconComponent, SpinnerComponent],
  templateUrl: './event-list.html',
  styleUrl: './event-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventListComponent implements OnDestroy {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);
  protected Views = Views;

  // --- Component State Signals ---
  errorMessage = signal<string | null>(null);
  inputCalendarId = signal('');
  optionsMenuOpen = signal(false);
  showFromDateFilter = signal(false);

  // The default "from" date used when no custom date is set (3 days ago).
  private readonly defaultFromDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0];
  })();

  // Optional initial search query. When provided (e.g. via the web component
  // attribute), the search field is pre-populated with this value.
  initialQuery = input<string>('');

  // The URL `q` parameter for the current events view, or empty when on a
  // view that does not support URL params (e.g. the standalone web component).
  private urlSearchQuery = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.EventsCalendar) {
      return this.routingService.signals[Views.EventsCalendar].urlParams.q();
    }
    if (match === Views.MyEvents) {
      return this.routingService.signals[Views.MyEvents].urlParams.q();
    }
    return '';
  });

  // The URL `fromDate` parameter — controls the Firestore query start date.
  private urlFromDate = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.EventsCalendar) {
      return this.routingService.signals[Views.EventsCalendar].urlParams.fromDate();
    }
    if (match === Views.MyEvents) {
      return this.routingService.signals[Views.MyEvents].urlParams.fromDate();
    }
    return '';
  });

  // This signal is bound to the search input field and updates on every keystroke.
  // It is seeded from the URL `q` param (if present) or `initialQuery` (for the
  // web component), and can still be freely edited by the user.
  searchInput = linkedSignal(() => this.urlSearchQuery() || this.initialQuery());

  // The date picker input value (UI-only, does not trigger Firestore re-query).
  fromDateInput = linkedSignal(() => this.urlFromDate() || '');

  // The committed "from" date that actually drives the Firestore query.
  // Only updated when the user clicks "Search" or when restoring from URL.
  activeFromDate = linkedSignal(() => this.urlFromDate() || '');

  // True when the date picker differs from the committed query date.
  fromDateDirty = computed(() => this.fromDateInput() !== this.activeFromDate());

  // --- Component Inputs ---
  calendarId = input<string>(environment.googleCalendar.calendarId);
  showBackButton = input<boolean>(false);
  backLabel = input<string>('Back');
  backUrl = input<string>('');

  // The Firestore collection path to load events from.
  // Defaults to 'events' for the public events list.
  collectionPath = input<string>('events');

  // Optional prefix for event detail links. When empty (default), the
  // component uses hash-based routes relative to the current page
  // (e.g. '#/events/'). When set (e.g. 'https://app.iliqchuan.com/#/events/'),
  // links point to an external domain — useful for the standalone WC.
  eventLinkPrefix = input<string>('');

  // Optional prefix for instructor profile links. When empty (default),
  // uses the in-app hash route. When set (e.g. by the standalone WC),
  // instructor links point to the specified external URL.
  instructorLinkPrefix = input<string>('');

  // Resolved link prefix: uses the explicit input if provided, otherwise
  // falls back to the default hash-based route for the current collection.
  protected resolvedEventLinkPrefix = computed(() => {
    const explicit = this.eventLinkPrefix();
    if (explicit) return explicit;
    return this.collectionPath() === 'events' ? '#/events/' : '#/my-events/';
  });
  private events = signal<IlcEvent[]>([]);

  // --- Firestore direct subscription ---
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  private unsubscribe: Unsubscribe | null = null;
  readonly isLoading = signal(true);

  // --- Full-text Search Implementation ---
  private miniSearch: MiniSearch<SearchableCalendarEvent>;

  // Map cached events to the SearchableCalendarEvent format (adds an `id` field).
  private allEvents = computed<SearchableCalendarEvent[]>(() => {
    const isPublicEvents = this.collectionPath() === 'events';
    const baseEvents = this.events();
    const filteredEvents = isPublicEvents
      ? baseEvents.filter(e => e.status === EventStatus.Listed || !e.status)
      : baseEvents;

    const sortedEvents = [...filteredEvents]
      .sort((a, b) => a.start.localeCompare(b.start));
    return sortedEvents.map((event, index) => ({
      ...event,
      id: `${index}`,
      googleCalEventLink: event.googleCalEventLink,
    }));
  });

  // A computed signal that reactively filters events based on the submitted search term.
  readonly searchResults = computed(() => {
    const term = this.searchInput().trim();
    const events = this.allEvents();

    if (!term) {
      return { matched: events, unmatched: [] };
    }

    const { quoted, nonQuoted } = this.parseSearchTerm(term);

    if (!nonQuoted && quoted.length === 0) {
      return { matched: events, unmatched: [] };
    }

    let matchedIds: Set<string>;

    if (nonQuoted.trim() === '') {
      matchedIds = new Set(
        events
          .filter((result) => quotedFilter(result, quoted))
          .map((event) => event.id),
      );
    } else {
      const results = this.miniSearch.search(nonQuoted, {
        prefix: true,
        fuzzy: 0.01,
        filter: (result) =>
          quotedFilter(result as unknown as CalendarEvent, quoted),
      });
      matchedIds = new Set(results.map((r) => r.id));
    }
    const matched = events.filter((event) => matchedIds.has(event.id));
    const unmatched = events.filter((event) => !matchedIds.has(event.id));
    return { matched, unmatched };
  });

  // Whether events have been loaded at least once.
  readonly hasLoaded = computed(() => {
    return !this.isLoading();
  });

  constructor() {
    this.miniSearch = new MiniSearch<SearchableCalendarEvent>({
      fields: ['title', 'location', 'start', 'end'],
      storeFields: [
        'id',
        'title',
        'start',
        'end',
        'location',
        'description',
        'googleMapsUrl',
        'htmlLink',
      ],
      idField: 'id',
    });

    // Re-subscribe whenever the collection path or the *committed* fromDate changes.
    effect(() => {
      this.unsubscribe?.();
      this.subscribeToEvents(this.collectionPath(), this.activeFromDate());
    });

    // Rebuild the MiniSearch index whenever the cache data changes.
    effect(() => {
      const events = this.allEvents();
      this.miniSearch.removeAll();
      if (events.length > 0) {
        this.miniSearch.addAll(events);
      }
    });

    // Set the calendar link when the input is provided.
    effect(() => {
      const calendarId = this.calendarId();
      if (calendarId) {
        this.inputCalendarId.set(calendarId);
      }
    });

    // Restore the from-date filter visibility from URL params.
    effect(() => {
      const fd = this.urlFromDate();
      if (fd) {
        this.showFromDateFilter.set(true);
      }
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  private subscribeToEvents(path: string, fromDateValue: string): void {
    console.info(`Subscribing to events at path: ${path}, fromDate: ${fromDateValue || '(default)'}`);
    const eventsCollection = collection(this.db, path);

    let q = query(eventsCollection);
    if (path === 'events') {
      // Use the committed fromDate if set, otherwise default to 3 days ago.
      const startDateStr = fromDateValue || this.defaultFromDate;
      q = query(eventsCollection, where('end', '>=', startDateStr));
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const events = snapshot.docs.map(
          (doc) => ({ ...initEvent(), ...doc.data(), docId: doc.id } as IlcEvent),
        );
        this.events.set(events);
        this.isLoading.set(false);
      },
      (error) => {
        console.error(`Error subscribing to events at ${path}:`, error);
        this.errorMessage.set('Failed to load events. Please try again later.');
        this.isLoading.set(false);
      },
    );
  }

  private parseSearchTerm(term: string): {
    quoted: string[];
    nonQuoted: string;
  } {
    const parts = term.split('"');
    const quoted: string[] = [];
    const nonQuotedParts: string[] = [];

    const hasUnterminatedQuote = parts.length % 2 === 0;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      if (i % 2 === 1 && !(hasUnterminatedQuote && i === parts.length - 1)) {
        quoted.push(part.toLowerCase());
      } else {
        nonQuotedParts.push(part);
      }
    }

    const nonQuoted = nonQuotedParts.join(' ').trim().toLowerCase();
    return { quoted, nonQuoted };
  }

  onSearchInputChange(value: string): void {
    this.searchInput.set(value);

    // Sync the search term back to the URL for shareable links.
    const match = this.routingService.matchedPatternId();
    if (match === Views.EventsCalendar) {
      this.routingService.signals[Views.EventsCalendar].urlParams.q.set(value);
    } else if (match === Views.MyEvents) {
      this.routingService.signals[Views.MyEvents].urlParams.q.set(value);
    }
  }

  // Toggle the "Find events from date" filter and sync state to URL.
  toggleFromDateFilter(): void {
    const show = !this.showFromDateFilter();
    this.showFromDateFilter.set(show);
    this.optionsMenuOpen.set(false);
    if (show) {
      // Pre-fill with the current default date so the user sees the baseline.
      if (!this.fromDateInput()) {
        this.fromDateInput.set(this.defaultFromDate);
      }
    } else {
      // Clear both input and active date, resetting to default query.
      this.fromDateInput.set('');
      this.activeFromDate.set('');
      this.syncFromDateToUrl('');
    }
  }

  // Called when the user edits the date picker (UI only, no query).
  onFromDateChange(value: string): void {
    this.fromDateInput.set(value);
  }

  // Commit the date input to the active query and sync to URL.
  searchFromDate(): void {
    const value = this.fromDateInput();
    this.activeFromDate.set(value);
    this.syncFromDateToUrl(value);
  }

  private syncFromDateToUrl(value: string): void {
    const match = this.routingService.matchedPatternId();
    if (match === Views.EventsCalendar) {
      this.routingService.signals[Views.EventsCalendar].urlParams.fromDate.set(value);
    } else if (match === Views.MyEvents) {
      this.routingService.signals[Views.MyEvents].urlParams.fromDate.set(value);
    }
  }
}
