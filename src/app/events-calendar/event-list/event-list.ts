import {
  Component,
  signal,
  inject,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
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
} from 'firebase/firestore';
import { FIREBASE_APP } from '../../app.config';
import { CalendarEvent } from '../event.model';
import { CachedCalendarEvent } from '../../../../functions/src/data-model';
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
type SearchableCalendarEvent = CachedCalendarEvent & { id: string };

@Component({
  selector: 'app-event-list',
  standalone: true,
  imports: [FormsModule, EventItemComponent, IconComponent, SpinnerComponent],
  templateUrl: './event-list.html',
  styleUrl: './event-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventListComponent implements OnDestroy {
  // --- Component State Signals ---
  errorMessage = signal<string | null>(null);
  inputCalendarId = signal('');

  // This signal is bound to the search input field and updates on every keystroke.
  searchInput = signal('');

  // --- Component Inputs ---
  calendarId = input<string>(environment.googleCalendar.calendarId);
  showBackButton = input<boolean>(false);
  backLabel = input<string>('Back');
  backUrl = input<string>('');


  // --- Firestore direct subscription ---
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  private unsubscribe: Unsubscribe | null = null;
  private cachedEvents = signal<CachedCalendarEvent[]>([]);
  readonly isLoading = signal(true);

  // --- Full-text Search Implementation ---
  private miniSearch: MiniSearch<SearchableCalendarEvent>;

  // Map cached events to the SearchableCalendarEvent format (adds an `id` field).
  private allEvents = computed<SearchableCalendarEvent[]>(() => {
    return this.cachedEvents().map((event, index) => ({
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
    return this.allEvents().length > 0 || this.errorMessage() !== null;
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

    // Subscribe to /events collection on init.
    this.subscribeToEvents();

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
    const eventsCollection = collection(this.db, 'events');
    const q = query(eventsCollection);

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const events = snapshot.docs.map(
          (doc) => doc.data() as CachedCalendarEvent,
        );
        this.cachedEvents.set(events);
        this.isLoading.set(false);
      },
      (error) => {
        console.error('Error subscribing to cached events:', error);
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
