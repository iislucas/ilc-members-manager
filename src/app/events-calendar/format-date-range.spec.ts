/* Tests for the formatDateRange utility function. */

import { describe, it, expect } from 'vitest';
import { formatDateRange } from './format-date-range';

describe('formatDateRange', () => {
  it('should format a single date when start and end are the same', () => {
    expect(formatDateRange('2026-05-03', '2026-05-03')).toBe('3 May 2026');
  });

  it('should format a single date when end is empty', () => {
    expect(formatDateRange('2026-05-03', '')).toBe('3 May 2026');
  });

  it('should return empty string when start is empty', () => {
    expect(formatDateRange('', '')).toBe('');
  });

  it('should compress dates in the same month and year', () => {
    expect(formatDateRange('2026-05-03', '2026-05-07')).toBe('3–7 May 2026');
  });

  it('should format dates in the same year but different months', () => {
    expect(formatDateRange('2026-05-03', '2026-06-07')).toBe('3 May – 7 Jun 2026');
  });

  it('should format dates spanning different years', () => {
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027');
  });

  it('should handle single-digit and double-digit days', () => {
    expect(formatDateRange('2026-01-01', '2026-01-15')).toBe('1–15 Jan 2026');
  });

  it('should handle month boundaries within the same month', () => {
    expect(formatDateRange('2026-03-30', '2026-03-31')).toBe('30–31 Mar 2026');
  });

  it('should handle January to December span in the same year', () => {
    expect(formatDateRange('2026-01-15', '2026-12-20')).toBe('15 Jan – 20 Dec 2026');
  });
});
