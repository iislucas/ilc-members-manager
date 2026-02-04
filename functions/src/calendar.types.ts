export type CalendarRequest = { calendarId: string } & Partial<{
  q: string;
  singleEvents: boolean;
  orderBy: string;
  timeMin: string;
  timeMax: string;
  maxResults: number;
}>;

// Define interfaces for the Google Calendar API response
export type GoogleCalendarEventItem = {
  id: string;
  summary?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
  description?: string;
  location?: string;
  htmlLink: string;
};
export type GoogleCalendarResponse = {
  items?: GoogleCalendarEventItem[];
};
