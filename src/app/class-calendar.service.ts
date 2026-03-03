import { inject, Injectable } from '@angular/core';
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
export class ClassCalendarService {
  private firebaseStateService = inject(FirebaseStateService);
  private functions = getFunctions(this.firebaseStateService.app);

  /**
   * Fetches all events from a calendar.
   * @param calendarId The Google Calendar ID to fetch events from.
   * @returns A promise of an array of calendar events.
   */
  getEvents(calendarId: string): Promise<GoogleCalendarEventItem[]> {
    return this.fetchEvents(calendarId);
  }

  /**
   * Fetches the next 5 forthcoming classes.
   * @param calendarId The Google Calendar ID to fetch events from.
   * @param date Optional date string to start from.
   * @returns A promise of an array of the next 5 calendar events.
   */
  getForthcomingEvents(calendarId: string, date?: string): Promise<GoogleCalendarEventItem[]> {
    const selectedDate = date ? new Date(date) : new Date();
    const timeMin = selectedDate.toISOString();
    return this.fetchEvents(calendarId, { timeMin, maxResults: 5 });
  }

  /**
   * Fetches classes from the last 7 days up to today.
   * This method provides a list of past classes for a historical view.
   * @param calendarId The Google Calendar ID to fetch events from.
   * @param date Optional date string to search backwards from.
   * @returns A promise of an array of calendar events from the last week.
   */
  getPreviousEvents(calendarId: string, date?: string): Promise<GoogleCalendarEventItem[]> {
    const selectedDate = date ? new Date(date) : new Date();
    const timeMax = new Date(selectedDate.getTime()).toISOString();
    const sevenDaysAgo = new Date(
      selectedDate.getTime() - 7 * 24 * 60 * 60 * 1000
    );
    const timeMin = sevenDaysAgo.toISOString();

    return this.fetchEvents(calendarId, { timeMin, timeMax });
  }

  /**
   * Private helper method to fetch events using the getCalendarEvents Firebase function.
   * This centralizes the logic for making the callable request and handling responses.
   * @param calendarId The Google Calendar ID.
   * @param options - Optional parameters for the function request.
   * @returns A promise of an array of calendar events.
   */
  private async fetchEvents(
    calendarId: string,
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
      calendarId,
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
