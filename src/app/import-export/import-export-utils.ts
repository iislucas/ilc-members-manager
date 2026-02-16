import { parse, isValid, format } from 'date-fns';

export type ParsedRow = Record<string, string>;

export type ImportStage =
  | 'SELECT'
  | 'MAPPING'
  | 'ANALYZING'
  | 'PREVIEW'
  | 'IMPORTING'
  | 'COMPLETED';

export type FilterStatus = 'NEW' | 'UPDATE' | 'ISSUE' | 'UNCHANGED';

// Handy format for UI to be able to display changes
export interface ProposedChange<T> {
  status: FilterStatus;
  key: string;
  newItem: T;
  oldItem?: T;
  diffs: { field: string; oldVal: string; newVal: string }[];
  issues?: string[];
}

// A set of changes to be applied to the database
export type ImportDelta<T> = {
  issues: ProposedChange<T>[];
  updates: ProposedChange<T>[];
  unchanged: ProposedChange<T>[];
  new: Map<string, ProposedChange<T>>;
  // We need to keep track of seenIds as well as newMembersBeingConsidered
  // because we need to handle the case where we find duplicates; in this 
  // case all duplicates are removed from newMembersBeingConsidered, but 
  // the we need to remember seenIds, just in case we find more duplicates
  // later on.
  seenIds: Set<string>;
}

export type MappingResult<T> =
  | { success: true; value: T }
  | { success: false; issue: string };

export function parseDate(value: string): MappingResult<string> {
    if (!value) return { success: true, value: '' };

    // Normalize separators and trim
    let normalizedValue = value.trim();

    // Specific fix for dd-MMM-yy / d-MMM-yy format (e.g. 23-Feb-23)
    // Assume 20{yy} for these cases.
    const twoDigitYearMmmPattern = /^(\d{1,2})[-/]([a-zA-Z]{3})[-/](\d{2})$/;
    const mmmMatch = normalizedValue.match(twoDigitYearMmmPattern);
    if (mmmMatch) {
      const [, day, month, year] = mmmMatch;
      // Reconstruct as dd-MMM-yyyy (e.g. 23-Feb-2023)
      normalizedValue = `${day}-${month}-20${year}`;
    }

    // Check for year only (e.g. "1953")
    if (/^\d{4}$/.test(normalizedValue)) {
      const year = parseInt(normalizedValue, 10);
      // Basic sanity check for year range if needed, e.g. 1900-2100
      if (year > 1800 && year < 2200) {
        return { success: true, value: `${year}-01-01` };
      }
    }

    // List of supported formats to try
    // date-fns 2.x/3.x/4.x uses 'yyyy' for year, 'dd' for day, 'MM' for month, 'MMM' for short month name
    // We try multiple formats to be flexible.
    const formats = [
      'yyyy-MM-dd',    // ISO, e.g. 2023-12-31
      'dd/MM/yyyy',    // UK, e.g. 31/12/2023
      // 'd/K/yyyy' removed as K is hour
      'd/M/yyyy',      // single digits, e.g. 1/2/2023
      'yyyy/MM/dd',    // Japan, e.g. 2023/12/31
      'dd-MMM-yyyy',   // e.g. 23-Feb-1953
      'd-MMM-yyyy',    // e.g. 1-Feb-1953
      'dd-MM-yyyy',    // e.g. 23-02-1953
      'd-M-yyyy',      // e.g. 1-2-1953
    ];

    // Attempt to parse with each format
    for (const fmt of formats) {
      // parse(dateString, formatString, referenceDate)
      const parsedDate = parse(normalizedValue, fmt, new Date());
      
      // isValid() checks if the date is valid (e.g. not February 30th)
      if (isValid(parsedDate)) {
        // Additional sanity check: 
        // sometimes simplistic formats can match unexpectedly. 
        // But date-fns is usually good if the format aligns.
        // We format it to standard YYYY-MM-DD
        return { success: true, value: format(parsedDate, 'yyyy-MM-dd') };
      }
    }

    return {
      success: false,
      issue: `Invalid date format: "${value}". Expected YYYY-MM-DD, DD/MM/YYYY, or DD-Mon-YYYY.`,
    };
}

export function getDifferences(
  newItem: any,
  oldItem: any,
): { field: string; oldVal: string; newVal: string }[] {
  const diffs: { field: string; oldVal: string; newVal: string }[] = [];
  for (const key in newItem) {
    const newVal = newItem[key];
    const oldVal = oldItem[key];

    if (newVal === undefined || newVal === null) continue;

    let isDiff = false;
    if (Array.isArray(newVal) && Array.isArray(oldVal)) {
      const newSorted = [...newVal].sort().join(',');
      const oldSorted = [...oldVal].sort().join(',');
      if (newSorted !== oldSorted) isDiff = true;
    } else if (newVal !== oldVal) {
      isDiff = true;
    }

    if (isDiff) {
      diffs.push({
        field: key,
        oldVal: String(oldVal),
        newVal: String(newVal),
      });
    }
  }
  return diffs;
}

/**
 * Returns the later of two dates. Assumes YYYY-MM-DD or comparable string format.
 * If newDate is undefined/empty, returns oldDate.
 * If oldDate is undefined/empty, returns newDate.
 * If newDate > oldDate, returns newDate.
 * Otherwise returns oldDate.
 */
export function ensureLaterDate(oldDate: string | undefined | null, newDate: string | undefined | null): string | undefined {
  if (!newDate) return oldDate || undefined;
  if (!oldDate) return newDate;

  if (newDate > oldDate) {
    return newDate;
  }
  return oldDate;
}
