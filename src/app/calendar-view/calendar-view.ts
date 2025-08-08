import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  WritableSignal,
} from '@angular/core';
import { CalendarService } from '../calendar.service';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';
import {
  CalendarRequest,
  GoogleCalendarEventItem,
} from '../../../functions/src/calendar.types';

/**
 * Represents the state of calendar entries, which can be loading,
 * successfully loaded, or in an error state.
 *
 */
export type CalendarEntriesState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'loaded'; data: GoogleCalendarEventItem[] };

@Component({
  selector: 'app-calendar-view',
  imports: [CommonModule, IconComponent],
  templateUrl: './calendar-view.html',
  styleUrl: './calendar-view.scss',
})
export class CalendarView implements OnInit {
  private calendarService = inject(CalendarService);

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
   * This implementation is more readable and less prone to timezone conversion
   * issues by manually constructing the 'yyyy-MM-dd' string.
   */
  selectedDateString = computed(() => {
    const date = this.selectedDate();
    const year = date.getFullYear();
    // padStart ensures the month and day are always two digits (e.g., 07 for July).
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  ngOnInit() {
    this.refreshCalendar(this.selectedDate());
  }

  onDateChange(event: Event) {
    const newDateString = (event.target as HTMLInputElement).value;
    // The input provides a string like '2024-07-06'. We need to parse it as UTC
    // to avoid timezone issues where it might become the previous day.
    this.selectedDate.set(new Date(newDateString + 'T00:00:00Z'));
    this.refreshCalendar(this.selectedDate());
  }

  refreshCalendar(date: Date) {
    const dateString = date.toISOString();

    this.loadCalendarData(
      this.forthcomingClasses,
      this.calendarService.getForthcomingClasses(dateString)
    );
    this.loadCalendarData(
      this.previousClasses,
      this.calendarService.getPreviousClasses(dateString)
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

  /**
   * A private helper to determine if two Date objects represent the same calendar day.
   * This centralizes the logic, improving maintainability and reducing code duplication.
   * @param d1 The first date.
   * @param d2 The second date.
   * @returns True if they are the same day, false otherwise.
   */
  private _isSameDay(d1: Date, d2: Date): boolean {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  }

  // TODO: update this to be isNextDayEvent, meaning that from the current
  // moment in time, this is a class on the next day.
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
