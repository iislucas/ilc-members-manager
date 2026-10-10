/* Unit tests for the shared email normalisation helpers (data-model/email.ts). */
import { describe, it, expect } from 'vitest';
import { normalizeEmail, normalizeEmails, emailsMatch, emailListIncludes } from './email';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Mixed.Case@Example.COM ')).toBe('mixed.case@example.com');
  });
  it('leaves an already-normalised email unchanged', () => {
    expect(normalizeEmail('a@b.com')).toBe('a@b.com');
  });
  it('returns empty string for empty / missing input', () => {
    expect(normalizeEmail('')).toBe('');
    expect(normalizeEmail('   ')).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(null)).toBe('');
  });
  it('is idempotent', () => {
    const once = normalizeEmail(' Foo@Bar.Com');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('normalizeEmails', () => {
  it('normalises, drops empties and de-duplicates preserving first occurrence order', () => {
    expect(
      normalizeEmails(['Primary@X.com', 'other@y.com', ' primary@x.com ', '', null, undefined, 'OTHER@Y.COM']),
    ).toEqual(['primary@x.com', 'other@y.com']);
  });
  it('handles missing lists', () => {
    expect(normalizeEmails(undefined)).toEqual([]);
    expect(normalizeEmails(null)).toEqual([]);
    expect(normalizeEmails([])).toEqual([]);
  });
});

describe('emailsMatch', () => {
  it('matches ignoring case and whitespace', () => {
    expect(emailsMatch('A@B.com', ' a@b.COM ')).toBe(true);
  });
  it('does not match different addresses', () => {
    expect(emailsMatch('a@b.com', 'c@b.com')).toBe(false);
  });
  it('never matches empty values', () => {
    expect(emailsMatch('', '')).toBe(false);
    expect(emailsMatch(undefined, null)).toBe(false);
  });
});

describe('emailListIncludes', () => {
  it('finds an email case-insensitively', () => {
    expect(emailListIncludes(['Someone@Example.com'], 'someone@example.COM')).toBe(true);
  });
  it('returns false when absent or empty', () => {
    expect(emailListIncludes(['a@b.com'], 'x@b.com')).toBe(false);
    expect(emailListIncludes(['a@b.com'], '')).toBe(false);
    expect(emailListIncludes(undefined, 'a@b.com')).toBe(false);
  });
});
