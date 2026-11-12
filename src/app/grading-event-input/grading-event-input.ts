import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  linkedSignal,
  computed,
  output,
  signal,
} from '@angular/core';
import { IlcEvent } from '../../../functions/src/data-model/events';
import { DataManagerService, EventSearchCriteriaDateRange } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { IconComponent } from '../icons/icon.component';

export interface GradingEventDetails {
  gradingEvent: string;
  gradingEventDate: string;
  gradingEventDocId: string;
}

/**
 * Returns the YYYY-MM-DD date 3 calendar months prior to `now` (clamped to the
 * target month's length), used as the default lower bound for event search.
 */
export function defaultEventSearchStartDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() - 3;
  const day = now.getDate();
  const targetMonthLastDay = new Date(year, month + 1, 0).getDate();
  const clamped = new Date(year, month, Math.min(day, targetMonthLastDay));
  const y = clamped.getFullYear();
  const m = String(clamped.getMonth() + 1).padStart(2, '0');
  const d = String(clamped.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-grading-event-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AutocompleteComponent, IconComponent],
  templateUrl: './grading-event-input.html',
  styleUrl: './grading-event-input.scss',
  host: {
    '(document:keydown.escape)': 'closeMenu()',
  },
})
export class GradingEventInputComponent {
  private dataService = inject(DataManagerService);
  private routingService = inject(RoutingService<AppPathPatterns>);

  gradingEvent = input<string>('');
  gradingEventDate = input<string>('');
  gradingEventDocId = input<string>('');

  gradingEventChange = output<GradingEventDetails>();

  // Local editable signals, seeded from inputs.
  editEvent = linkedSignal(() => this.gradingEvent());
  editDate = linkedSignal(() => this.gradingEventDate());
  editDocId = linkedSignal(() => this.gradingEventDocId());

  // Whether the grading was at a listed workshop/event. When checked, the event
  // search is shown so an event can be linked; otherwise only the date is
  // recorded (no event name/link). Seeded from the incoming data — a linked
  // event OR pre-existing free-text event info means it WAS at a listed event —
  // then user-controlled via the checkbox and preserved across re-renders.
  // Seeding checked for legacy free-text-without-link surfaces the search and
  // the "isn't a linked ILC event" warning, so the user can link it or untick.
  atListedEvent = linkedSignal<{ docId: string; event: string }, boolean>({
    source: () => ({ docId: this.gradingEventDocId(), event: this.gradingEvent() }),
    computation: (src, prev) => {
      if (prev) return prev.value;
      return !!src.docId || src.event.trim() !== '';
    },
  });

  // Event search. Defaults to events from 3 months ago onwards (no upper limit
  // on future events) so old historical events don't clutter the picker. The
  // 3-dots menu reveals the date range controls when searching other dates.
  eventsSet = new SearchableSet<'docId', IlcEvent>(['title', 'location', 'start'], 'docId');
  eventRangeFrom = signal<string>(defaultEventSearchStartDate());
  eventRangeTo = signal<string>('');
  showDateRange = signal<boolean>(false);
  menuOpen = signal<boolean>(false);
  eventsLoaded = signal<boolean>(false);
  private fetchedLinkedEvent = signal<IlcEvent | undefined>(undefined);

  _loadEvents = effect(() => {
    const criteria: EventSearchCriteriaDateRange = {
      kind: 'date',
      startDate: this.eventRangeFrom() || undefined,
      endDate: this.eventRangeTo() || undefined,
      statusFilter: 'listed',
    };
    this.dataService.searchEvents(criteria).then((events) => {
      this.eventsSet.setEntries(events);
      this.eventsLoaded.set(true);
    });
  });

  // Resolve a linked event by docId even if it falls outside the 3-month search window.
  _loadLinkedEventById = effect(() => {
    const docId = this.editDocId();
    if (!docId) {
      this.fetchedLinkedEvent.set(undefined);
      return;
    }
    const inSet = this.eventsSet.get(docId);
    if (inSet) {
      this.fetchedLinkedEvent.set(inSet);
      return;
    }
    this.dataService.getEventById(docId).then((ev) => {
      if (this.editDocId() === docId) {
        this.fetchedLinkedEvent.set(ev);
      }
    });
  });

  eventDisplayFns = {
    toChipId: (e: IlcEvent) => e.docId,
    toName: (e: IlcEvent) => `${e.start.substring(0, 10)} — ${e.title}`,
  };

  // The display name of the currently linked event, or '' if none / not loaded.
  linkedEventName = computed(() => {
    const docId = this.editDocId();
    if (!docId) return '';
    const event = this.eventsSet.get(docId) ?? this.fetchedLinkedEvent();
    return event ? `${event.start.substring(0, 10)} — ${event.title}` : '';
  });

  // True when the date range filter is visible and the linked event isn't in the loaded range.
  linkedEventOutOfRange = computed(() => {
    const docId = this.editDocId();
    if (!docId || !this.showDateRange() || !this.eventsLoaded()) return false;
    return !this.eventsSet.get(docId);
  });

  // True when there is free-text event info that isn't linked to a listed event
  // and the user hasn't ticked "not at a listed workshop/event". This is an
  // invalid, ambiguous state: the grading must either link a real event or be
  // marked as not-at-a-listed-event (date only). Parents disable saving while so.
  isUnlinkedText = computed(
    () => this.atListedEvent() && !this.editDocId() && this.editEvent().trim() !== '',
  );

  linkedEventHref = computed(() => {
    const docId = this.editDocId();
    if (!docId) return '';
    return this.routingService.hrefForView(Views.EventView, { eventId: docId });
  });

  // Toggle "at a listed event". When checked, the event search appears so an
  // event can be linked. When unchecked, the grading is date-only: clear any
  // event name/link and keep just the date (the date is preserved either way).
  setAtListedEvent(checked: boolean) {
    this.atListedEvent.set(checked);
    if (!checked) {
      this.editEvent.set('');
      this.editDocId.set('');
      this.emit();
    }
  }

  onEventSelected(event: IlcEvent) {
    const location = event.location ? ` — ${event.location}` : '';
    this.editEvent.set(`${event.title}${location}`);
    this.editDate.set(event.start.substring(0, 10));
    this.editDocId.set(event.docId);
    this.emit();
  }

  // The date is always shown, even when an event is linked. Editing it just
  // updates the grading date; it does not detach a linked event.
  onDateInput(e: Event) {
    this.editDate.set((e.target as HTMLInputElement).value);
    this.emit();
  }

  asDateStr(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  toggleMenu(e: Event) {
    e.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  closeMenu() {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
    }
  }

  openOtherDatesSearch() {
    this.showDateRange.set(true);
    this.menuOpen.set(false);
  }

  hideOtherDatesSearch() {
    this.showDateRange.set(false);
    this.eventRangeFrom.set(defaultEventSearchStartDate());
    this.eventRangeTo.set('');
    this.menuOpen.set(false);
  }

  private emit() {
    this.gradingEventChange.emit({
      gradingEvent: this.editEvent(),
      gradingEventDate: this.editDate(),
      gradingEventDocId: this.editDocId(),
    });
  }
}
