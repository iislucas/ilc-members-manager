import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  WritableSignal,
} from '@angular/core';
import { ClassCalendarService } from '../class-calendar.service';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';
import {
  GoogleCalendarEventItem,
} from '../../../functions/src/calendar.types';
import { FindInstructorsService } from '../find-instructors.service';

/**
 * Represents the state of calendar entries, which can be loading,
 * successfully loaded, or in an error state.
 */
export type CalendarEntriesState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'loaded'; data: GoogleCalendarEventItem[] };

import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-class-calendar',
  imports: [CommonModule, IconComponent, SpinnerComponent],
  templateUrl: './class-calendar.html',
  styleUrl: './class-calendar.scss',
})
export class ClassCalendarComponent {
  private calendarService = inject(ClassCalendarService);
  private findInstructorsService = inject(FindInstructorsService);

  /** The instructor ID whose public class calendar to display. */
  instructorId = input.required<string>();

  /** Resolved Google Calendar ID from the instructor's public profile. */
  calendarId = computed(() => {
    const id = this.instructorId();
    if (!id) return '';
    const instructor = this.findInstructorsService.instructors.entriesMap().get(id);
    return instructor?.publicClassGoogleCalendarId || '';
  });

  /** The instructor's name for display. */
  instructorName = computed(() => {
    const id = this.instructorId();
    if (!id) return '';
    const instructor = this.findInstructorsService.instructors.entriesMap().get(id);
    return instructor?.name || '';
  });

  // The "card" styling from app.scss is used for the selected day's entries
  // in the forthcoming classes list.
  forthcomingClasses = signal<CalendarEntriesState>({ status: 'loading' });
  previousClasses = signal<CalendarEntriesState>({ status: 'loading' });

  // The default date is set to the start of today.
  selectedDate = signal(new Date(new Date().setHours(0, 0, 0, 0)));

  // A computed signal to check if the selected date is today
  isToday = computed(() => this._isSameDay(this.selectedDate(), new Date()));

  /**
   * A computed signal to format the selected date for the input[type=date] value.
   */
  selectedDateString = computed(() => {
    const date = this.selectedDate();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  constructor() {
    // Use an effect to react to calendarId changes and refresh the calendar.
    effect(() => {
      const cid = this.calendarId();
      if (cid) {
        this.refreshCalendar(this.selectedDate());
      }
    });
  }

  onDateChange(event: Event) {
    const newDateString = (event.target as HTMLInputElement).value;
    this.selectedDate.set(new Date(newDateString + 'T00:00:00Z'));
    this.refreshCalendar(this.selectedDate());
  }

  refreshCalendar(date: Date) {
    const calendarId = this.calendarId();
    if (!calendarId) return;
    const dateString = date.toISOString();

    this.loadCalendarData(
      this.forthcomingClasses,
      this.calendarService.getForthcomingEvents(calendarId, dateString)
    );
    this.loadCalendarData(
      this.previousClasses,
      this.calendarService.getPreviousEvents(calendarId, dateString)
    );
  }

  private async loadCalendarData(
    stateSignal: WritableSignal<CalendarEntriesState>,
    dataPromise: Promise<GoogleCalendarEventItem[]>
  ) {
    stateSignal.set({ status: 'loading' });
    try {
      const data = await dataPromise;
      stateSignal.set({ status: 'loaded', data });
    } catch (error) {
      console.error('Error loading calendar data:', error);
      const errorMessage = this.getErrorMessage(error);
      stateSignal.set({ status: 'error', error: errorMessage });
    }
  }

  private getErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return (error as { message: string }).message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'An unknown error occurred.';
  }

  private _isSameDay(d1: Date, d2: Date): boolean {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  }

  isEventToday(event: GoogleCalendarEventItem): boolean {
    if (!event.start?.dateTime) {
      return false;
    }
    const eventDate = new Date(event.start.dateTime);
    return this._isSameDay(eventDate, new Date());
  }

  getGoogleMapsLink(location: string | undefined): string {
    if (!location) {
      return '';
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      location
    )}`;
  }
}
