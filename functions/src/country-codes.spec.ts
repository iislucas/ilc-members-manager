import { describe, it, expect } from 'vitest';
import { resolveCountryCode, resolveCountryName } from './country-codes';

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

describe('resolveCountryName', () => {
  it('should resolve country names to their canonical form', () => {
    expect(resolveCountryName('france')).toBe('France');
    expect(resolveCountryName('FRANCE')).toBe('France');
    expect(resolveCountryName('united states')).toBe('United States');
    expect(resolveCountryName('Slovenia')).toBe('Slovenia');
  });

  it('should resolve country codes to country names', () => {
    expect(resolveCountryName('FR')).toBe('France');
    expect(resolveCountryName('US')).toBe('United States');
    expect(resolveCountryName('SL')).toBe('Slovenia');
    expect(resolveCountryName('DE')).toBe('Germany');
  });

  it('should be case-insensitive', () => {
    expect(resolveCountryName('fr')).toBe('France');
    expect(resolveCountryName('us')).toBe('United States');
  });

  it('should return the input as-is for unrecognized countries', () => {
    expect(resolveCountryName('Narnia')).toBe('Narnia');
    expect(resolveCountryName('ZZZ')).toBe('ZZZ');
    expect(resolveCountryName('Slovinia')).toBe('Slovinia');
  });

  it('should return empty string for empty input', () => {
    expect(resolveCountryName('')).toBe('');
  });
});
