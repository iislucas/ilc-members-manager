import {
  Component,
  signal,
  inject,
  ChangeDetectionStrategy,
  computed,
  input,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClassCalendarService } from '../../class-calendar.service';
import { CalendarEvent } from '../event.model';
import MiniSearch from 'minisearch';
import { EventItemComponent } from '../event-item/event-item';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';

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

/**
 * A type representing a calendar event that can be indexed by MiniSearch.
 * It includes a string `id` field required by the library.
 */
type SearchableCalendarEvent = CalendarEvent & { id: string };

@Component({
  selector: 'app-event-list',
  standalone: true,
  imports: [FormsModule, EventItemComponent, IconComponent, SpinnerComponent],
  templateUrl: './event-list.html',
  styleUrl: './event-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventListComponent {
  // --- Component State Signals ---
  private allEvents = signal<SearchableCalendarEvent[]>([]);
  errorMessage = signal<string | null>(null);
  isLoading = signal(false);
  inputCalendarId = signal('');

  // This signal is bound to the search input field and updates on every keystroke.
  searchInput = signal('');

  // --- Injected Dependencies ---
  private calendarService = inject(ClassCalendarService);

  // --- Component Inputs ---
  calendarId = input<string>();

  // --- Full-text Search Implementation ---
  private miniSearch: MiniSearch<SearchableCalendarEvent>;

  /**
   * A computed signal that reactively filters events based on the submitted search term.
   * It separates the events into two lists: those that match the search query
   * and those that do not.
   */
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
          .map((event) => event.id)
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

  /** Whether events have been loaded at least once. */
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

    effect(() => {
      const calendarId = this.calendarId();
      if (calendarId && calendarId !== this.inputCalendarId()) {
        this.inputCalendarId.set(calendarId);
        this.fetchEvents(calendarId);
      }
    });
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

  async fetchEvents(calendarId: string): Promise<void> {
    this.errorMessage.set(null);
    this.isLoading.set(true);
    try {
      const events = await this.calendarService.getEventsForViewer(calendarId);
      const eventsWithId = events.map((event, index) => ({
        ...event,
        id: `${index}`,
      }));
      this.allEvents.set(eventsWithId);

      this.miniSearch.removeAll();
      this.miniSearch.addAll(eventsWithId);
    } catch (err) {
      console.error('Error fetching calendar events:', err);
      this.errorMessage.set(
        'Error fetching calendar events. Please check the console for more details.'
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  onSearchInputChange(value: string): void {
    this.searchInput.set(value);
  }
}
