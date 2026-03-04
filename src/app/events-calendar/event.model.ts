export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
  description: string;
  location?: string;
  googleMapsUrl?: string;
  googleCalEventLink?: string;
}
