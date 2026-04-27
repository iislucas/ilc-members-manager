/* Utility for formatting event date ranges into natural, compressed strings.
 *
 * Accepts ISO date strings (e.g. '2026-05-03') and produces human-friendly
 * output like:
 *   - Single day:          "3 May 2026"
 *   - Same month:          "3–7 May 2026"
 *   - Same year:           "3 May – 7 Jun 2026"
 *   - Different years:     "28 Dec 2026 – 3 Jan 2027"
 */

// Month names used for formatting.
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Parse an ISO date string (YYYY-MM-DD) into day, month index, and year,
// treating it as a local date rather than UTC.
function parseLocalDate(iso: string): { day: number; month: number; year: number } {
  const [yearStr, monthStr, dayStr] = iso.split('-');
  return {
    day: parseInt(dayStr, 10),
    month: parseInt(monthStr, 10) - 1, // 0-indexed
    year: parseInt(yearStr, 10),
  };
}

// Format a date range into a compressed, natural string.
// `start` and `end` are ISO date strings (YYYY-MM-DD).
export function formatDateRange(start: string, end: string): string {
  if (!start) return '';

  const s = parseLocalDate(start);

  // No end date, or same date → single date.
  if (!end || start === end) {
    return `${s.day} ${MONTHS[s.month]} ${s.year}`;
  }

  const e = parseLocalDate(end);

  if (s.year === e.year && s.month === e.month) {
    // Same month & year: "3–7 May 2026"
    return `${s.day}–${e.day} ${MONTHS[s.month]} ${s.year}`;
  }

  if (s.year === e.year) {
    // Same year, different months: "3 May – 7 Jun 2026"
    return `${s.day} ${MONTHS[s.month]} – ${e.day} ${MONTHS[e.month]} ${s.year}`;
  }

  // Different years: "28 Dec 2026 – 3 Jan 2027"
  return `${s.day} ${MONTHS[s.month]} ${s.year} – ${e.day} ${MONTHS[e.month]} ${e.year}`;
}
