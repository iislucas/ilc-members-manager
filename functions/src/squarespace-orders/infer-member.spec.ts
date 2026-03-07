import { describe, it, expect } from 'vitest';
import { normalizeDateOfBirth } from './infer-member';

describe('normalizeDateOfBirth', () => {
  it('should pass through YYYY-MM-DD format unchanged', () => {
    expect(normalizeDateOfBirth('1979-11-23')).toBe('1979-11-23');
  });

  it('should convert MM/DD/YYYY to YYYY-MM-DD', () => {
    expect(normalizeDateOfBirth('11/23/1979')).toBe('1979-11-23');
  });

  it('should convert M/D/YYYY (no leading zeros) to YYYY-MM-DD', () => {
    expect(normalizeDateOfBirth('1/5/2000')).toBe('2000-01-05');
  });

  it('should handle DD-MM-YYYY format', () => {
    expect(normalizeDateOfBirth('23-11-1979')).toBe('1979-11-23');
  });

  it('should handle DD.MM.YYYY format', () => {
    expect(normalizeDateOfBirth('23.11.1979')).toBe('1979-11-23');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeDateOfBirth('')).toBe('');
  });

  it('should trim whitespace', () => {
    expect(normalizeDateOfBirth('  11/23/1979  ')).toBe('1979-11-23');
  });

  it('should return unparseable strings as-is', () => {
    expect(normalizeDateOfBirth('unknown')).toBe('unknown');
  });
});
