/* calendar.types.ts
 *
 * Shared types and Google Calendar ID / link normalization helpers used by both
 * the Cloud Function (functions/src/calendar.ts) and the Angular frontend.
 */

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

const DECODED_CALENDAR_ID_PATTERN = /^[a-zA-Z0-9._+#%-]+@[a-zA-Z0-9.-]+$/;

function tryDecodeBase64CalendarId(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLen);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    if (DECODED_CALENDAR_ID_PATTERN.test(decoded)) {
      return decoded;
    }
  } catch {
    // Not valid base64 UTF-8; fall through.
  }
  return null;
}

/* Extracts a canonical Google Calendar ID from either a raw calendar ID
 * (e.g. "abc123@group.calendar.google.com") or a pasted Google Calendar URL /
 * embed snippet (e.g. ?src=..., ?cid=... plain or base64, /calendar/ical/...,
 * or <iframe src="...">).
 */
export function extractGoogleCalendarId(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  let candidate = input.trim();
  if (!candidate) {
    return '';
  }

  // Handle pasted HTML <iframe src="..."> embed snippets.
  if (/^<iframe\b/i.test(candidate)) {
    const srcMatch = candidate.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch?.[1]) {
      candidate = srcMatch[1].replace(/&amp;/gi, '&').trim();
    }
  }

  // Allow scheme-less Google Calendar links like "calendar.google.com/calendar/embed?src=...".
  const withScheme = /^(?:calendar\.google\.com|www\.google\.com\/calendar|www\.googleapis\.com\/calendar)\b/i.test(
    candidate,
  )
    ? `https://${candidate}`
    : candidate;

  if (/^https?:\/\//i.test(withScheme)) {
    try {
      const url = new URL(withScheme);
      const host = url.hostname.toLowerCase();
      if (
        host === 'calendar.google.com' ||
        host === 'www.google.com' ||
        host === 'google.com' ||
        host === 'www.googleapis.com'
      ) {
        const srcParam = url.searchParams.get('src')?.trim();
        if (srcParam) {
          return srcParam;
        }

        const cidParam = url.searchParams.get('cid')?.trim();
        if (cidParam) {
          if (cidParam.includes('@')) {
            return cidParam;
          }
          return tryDecodeBase64CalendarId(cidParam) ?? cidParam;
        }

        const icalMatch = url.pathname.match(/\/calendar\/ical\/([^/]+)/i);
        if (icalMatch?.[1]) {
          return decodeURIComponent(icalMatch[1]).trim();
        }

        const apiMatch = url.pathname.match(/\/calendars\/([^/]+)/i);
        if (apiMatch?.[1]) {
          return decodeURIComponent(apiMatch[1]).trim();
        }
      }
    } catch {
      // Fall back to returning the trimmed input if URL parsing fails.
    }
  }

  return candidate;
}
