import { inject, Injectable } from '@angular/core';
import { environment } from '../environments/environment';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirebaseStateService } from './firebase-state.service';
import {
  CalendarRequest,
  GoogleCalendarEventItem,
  GoogleCalendarResponse,
} from '../../functions/src/calendar.types';

@Injectable({
  providedIn: 'root',
})
export class CalendarService {
  private firebaseStateService = inject(FirebaseStateService);
  private functions = getFunctions(this.firebaseStateService.app);
  private calendarId = environment.googleCalendar.calendarId;

  /**
   * Fetches all events from the calendar.
   * @returns A promise of an array of calendar events.
   */
  getEvents(): Promise<GoogleCalendarEventItem[]> {
    return this.fetchEvents();
  }

  /**
   * Fetches the next 5 forthcoming classes.
   * @returns A promise of an array of the next 5 calendar events.
   */
  getForthcomingClasses(date?: string): Promise<GoogleCalendarEventItem[]> {
    const selectedDate = date ? new Date(date) : new Date();
    const timeMin = selectedDate.toISOString();
    return this.fetchEvents({ timeMin, maxResults: 5 });
  }

  /**
   * Fetches classes from the last 7 days up to today.
   * This method provides a list of past classes for a historical view.
   * @returns A promise of an array of calendar events from the last week.
   */
  getPreviousClasses(date?: string): Promise<GoogleCalendarEventItem[]> {
    const selectedDate = date ? new Date(date) : new Date();
    const timeMax = new Date(selectedDate.getTime()).toISOString();
    const sevenDaysAgo = new Date(
      selectedDate.getTime() - 7 * 24 * 60 * 60 * 1000
    );
    const timeMin = sevenDaysAgo.toISOString();

    return this.fetchEvents({ timeMin, timeMax });
  }

  /**
   * Private helper method to fetch events using the getCalendarEvents Firebase function.
   * This centralizes the logic for making the callable request and handling responses.
   * @param options - Optional parameters for the function request.
   * @returns A promise of an array of calendar events.
   */
  private async fetchEvents(
    options: {
      timeMin?: string;
      timeMax?: string;
      maxResults?: number;
    } = {}
  ): Promise<GoogleCalendarEventItem[]> {
    const getCalendarEvents = httpsCallable<
      CalendarRequest,
      GoogleCalendarResponse
    >(this.functions, 'getCalendarEvents');

    const requestData = {
      calendarId: this.calendarId,
      ...options,
    };

    try {
      const result = await getCalendarEvents(requestData);
      const data = result.data;
      return data.items || [];
    } catch (error) {
      console.error(
        'Error fetching Google Calendar events via Firebase Function:',
        error
      );
      throw error; // Re-throw the error to be handled by the caller.
    }
  }
}
