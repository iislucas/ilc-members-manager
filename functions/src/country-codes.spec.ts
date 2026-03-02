import { describe, it, expect } from 'vitest';
import { resolveCountryCode } from './country-codes';

describe('resolveCountryCode', () => {
  it('should resolve country names to codes', () => {
    expect(resolveCountryCode('France')).toBe('FR');
    expect(resolveCountryCode('United States')).toBe('US');
    expect(resolveCountryCode('Germany')).toBe('DE');
    expect(resolveCountryCode('Australia')).toBe('AUS');
    expect(resolveCountryCode('United Kingdom')).toBe('UK');
  });

  it('should resolve country codes directly', () => {
    expect(resolveCountryCode('FR')).toBe('FR');
    expect(resolveCountryCode('US')).toBe('US');
    expect(resolveCountryCode('DE')).toBe('DE');
    expect(resolveCountryCode('uk')).toBe('UK');
  });

  it('should be case-insensitive', () => {
    expect(resolveCountryCode('france')).toBe('FR');
    expect(resolveCountryCode('FRANCE')).toBe('FR');
    expect(resolveCountryCode('united states')).toBe('US');
  });

  it('should return null for unrecognized countries', () => {
    expect(resolveCountryCode('')).toBe(null);
    expect(resolveCountryCode('Narnia')).toBe(null);
    expect(resolveCountryCode('ZZZ')).toBe(null);
  });
});
