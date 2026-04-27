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
import { FIREBASE_APP, Views } from '../../app.config';
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
  protected routingService = inject(RoutingService);
  protected Views = Views;

  // --- Component State Signals ---
  errorMessage = signal<string | null>(null);
  inputCalendarId = signal('');

  // Optional initial search query. When provided (e.g. via the web component
  // attribute), the search field is pre-populated with this value.
  initialQuery = input<string>('');

  // This signal is bound to the search input field and updates on every keystroke.
  // It is seeded from `initialQuery` via linkedSignal so it re-derives if the
  // parent changes the attribute, but can still be freely edited by the user.
  searchInput = linkedSignal(() => this.initialQuery());

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

    // Re-subscribe whenever the collection path changes.
    effect(() => {
      this.unsubscribe?.();
      this.subscribeToEvents();
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
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  private subscribeToEvents(): void {
    const path = this.collectionPath();
    console.info(`Subscribing to events at path: ${path}`);
    const eventsCollection = collection(this.db, path);
    
    let q = query(eventsCollection);
    if (path === 'events') {
      const date = new Date();
      date.setDate(date.getDate() - 3);
      date.setHours(0, 0, 0, 0);
      const threeDaysAgoStr = date.toISOString().split('T')[0];
      q = query(eventsCollection, where('end', '>=', threeDaysAgoStr));
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
  }
}
