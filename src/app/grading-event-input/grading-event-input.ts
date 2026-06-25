import { Component, effect, inject, input, linkedSignal, computed, output } from '@angular/core';
import { IlcEvent } from '../../../functions/src/data-model';
import { DataManagerService, EventSearchCriteriaDateRange } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { IconComponent } from '../icons/icon.component';

function oneMonthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().substring(0, 10);
}

// Shift a YYYY-MM-DD date string by a number of days, returning YYYY-MM-DD.
function shiftDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
}

export interface GradingEventDetails {
  gradingEvent: string;
  gradingEventDate: string;
  gradingEventDocId: string;
}

@Component({
  selector: 'app-grading-event-input',
  standalone: true,
  imports: [AutocompleteComponent, IconComponent],
  templateUrl: './grading-event-input.html',
  styleUrl: './grading-event-input.scss',
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

  // Whether the grading was NOT at a listed workshop/event. When checked, only
  // the date is recorded (no event name/link). Seeded from the incoming data —
  // a linked event means it WAS at a listed event — then user-controlled via the
  // checkbox and preserved across re-renders.
  notListed = linkedSignal<{ docId: string }, boolean>({
    source: () => ({ docId: this.gradingEventDocId() }),
    computation: (src, prev) => {
      if (prev) return prev.value;
      return false;
    },
  });

  // Event search. When the grading already has a date, default the search to a
  // fortnight either side of it so the matching event is easy to find; otherwise
  // fall back to the last month onwards. These stay user-editable via the date
  // inputs (re-seeded only if the grading date itself changes).
  eventsSet = new SearchableSet<'docId', IlcEvent>(['title', 'location', 'start'], 'docId');
  eventRangeFrom = linkedSignal(() => {
    const date = this.gradingEventDate();
    return date ? shiftDays(date, -15) : oneMonthAgo();
  });
  eventRangeTo = linkedSignal(() => {
    const date = this.gradingEventDate();
    return date ? shiftDays(date, 15) : '';
  });

  _loadEvents = effect(() => {
    const criteria: EventSearchCriteriaDateRange = {
      kind: 'date',
      startDate: this.eventRangeFrom() || undefined,
      endDate: this.eventRangeTo() || undefined,
      statusFilter: 'listed',
    };
    this.dataService.searchEvents(criteria).then((events) => {
      this.eventsSet.setEntries(events);
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
    const event = this.eventsSet.get(docId);
    return event ? `${event.start.substring(0, 10)} — ${event.title}` : '';
  });

  // True when an event is linked but isn't in the currently loaded date range.
  linkedEventOutOfRange = computed(() => {
    const docId = this.editDocId();
    if (!docId) return false;
    return !this.eventsSet.get(docId);
  });

  linkedEventHref = computed(() => {
    const docId = this.editDocId();
    if (!docId) return '';
    return this.routingService.hrefForView(Views.EventView, { eventId: docId });
  });

  // Toggle "not at a listed event". When checked, the grading is date-only:
  // clear any event name/link and keep just the date. When unchecked, the event
  // search reappears (the date is preserved either way).
  setNotListed(checked: boolean) {
    this.notListed.set(checked);
    if (checked) {
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

  private emit() {
    this.gradingEventChange.emit({
      gradingEvent: this.editEvent(),
      gradingEventDate: this.editDate(),
      gradingEventDocId: this.editDocId(),
    });
  }
}
