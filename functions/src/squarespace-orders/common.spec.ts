import { describe, it, expect } from 'vitest';
import { computeRenewalAndExpiration } from './common';

describe('computeRenewalAndExpiration', () => {
  it('should extend from current expiration when renewed early (before expiry)', () => {
    // Member expires 2027-06-15, order placed 2027-03-01.
    // Renewal should start from the expiration.
    const result = computeRenewalAndExpiration('2027-06-15', '2027-03-01');
    expect(result.renewalDate).toBe('2027-06-15');
    expect(result.expirationDate).toBe('2028-06-15');
  });

  it('should use order date when renewed after expiration (lapsed)', () => {
    // Member expired 2026-01-01, order placed 2026-05-10.
    // Renewal should start from the order date since they lapsed.
    const result = computeRenewalAndExpiration('2026-01-01', '2026-05-10');
    expect(result.renewalDate).toBe('2026-05-10');
    expect(result.expirationDate).toBe('2027-05-10');
  });

  it('should use order date when there is no prior expiration', () => {
    const result = computeRenewalAndExpiration('', '2026-02-27');
    expect(result.renewalDate).toBe('2026-02-27');
    expect(result.expirationDate).toBe('2027-02-27');
  });

  it('should handle leap day renewals correctly', () => {
    // Renewal on Feb 29 of a leap year → expiration shifts to Mar 1 in non-leap year.
    const result = computeRenewalAndExpiration('', '2024-02-29');
    expect(result.renewalDate).toBe('2024-02-29');
    expect(result.expirationDate).toBe('2025-03-01');
  });

  it('should use order date when expiration equals order date', () => {
    // Edge case: renewal right on the expiry day.
    const result = computeRenewalAndExpiration('2026-03-15', '2026-03-15');
    expect(result.renewalDate).toBe('2026-03-15');
    expect(result.expirationDate).toBe('2027-03-15');
  });
});
