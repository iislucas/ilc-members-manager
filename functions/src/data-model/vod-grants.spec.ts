import { describe, expect, it } from 'vitest';
import { fillGrantMessagePlaceholders, isVideoGrantActive, normalizeGrantExpiry } from './vod';

describe('normalizeGrantExpiry', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it('returns undefined for no expiry', () => {
    expect(normalizeGrantExpiry(undefined, now)).toBeUndefined();
    expect(normalizeGrantExpiry('  ', now)).toBeUndefined();
  });

  it('treats a date-only value as the end of that day (UTC)', () => {
    expect(normalizeGrantExpiry('2026-10-11', now)).toBe('2026-10-11T23:59:59.999Z');
  });

  it('accepts a future ISO timestamp and normalises it', () => {
    expect(normalizeGrantExpiry('2026-10-10T13:00:00+00:00', now)).toBe('2026-10-10T13:00:00.000Z');
  });

  it('accepts today (expires at the end of the day)', () => {
    expect(normalizeGrantExpiry('2026-10-10', now)).toBe('2026-10-10T23:59:59.999Z');
  });

  it('rejects past and unparseable values', () => {
    expect(() => normalizeGrantExpiry('2026-10-09', now)).toThrow('must be in the future');
    expect(() => normalizeGrantExpiry('2026-10-10T11:59:59Z', now)).toThrow('must be in the future');
    expect(() => normalizeGrantExpiry('soon', now)).toThrow('not a valid date');
  });
});

describe('isVideoGrantActive', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it('is active with no expiry or a future expiry', () => {
    expect(isVideoGrantActive({}, now)).toBe(true);
    expect(isVideoGrantActive({ expiresAt: '2026-10-10T12:00:01Z' }, now)).toBe(true);
  });

  it('is inactive once expired, and fails closed on an unparseable expiry', () => {
    expect(isVideoGrantActive({ expiresAt: '2026-10-10T11:59:59Z' }, now)).toBe(false);
    expect(isVideoGrantActive({ expiresAt: 'garbage' }, now)).toBe(false);
  });
});

describe('fillGrantMessagePlaceholders', () => {
  it('replaces every occurrence of {title} and {name}', () => {
    expect(fillGrantMessagePlaceholders('{name}: {title} / {title}', { title: 'T', name: 'N' })).toBe('N: T / T');
  });
});
