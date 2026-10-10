import { describe, it, expect } from 'vitest';
import { isEmailCaseOnlyChange } from './order-change';

describe('isEmailCaseOnlyChange', () => {
  const base = {
    docId: 'o1',
    customerEmail: 'Foo.Bar@Example.com',
    billingAddress: { email: 'Foo.Bar@Example.com', firstName: 'Foo' },
    lineItems: [{ id: 'li1', sku: 'MEM-YEAR-1' }],
    lastUpdated: '2026-01-01T00:00:00Z',
  };

  it('is true when only email casing changes (top-level and nested)', () => {
    const after = {
      ...base,
      customerEmail: 'foo.bar@example.com',
      billingAddress: { ...base.billingAddress, email: 'foo.bar@example.com' },
    };
    expect(isEmailCaseOnlyChange(base, after)).toBe(true);
  });

  it('is true regardless of key order', () => {
    const after = {
      lastUpdated: base.lastUpdated,
      lineItems: base.lineItems,
      billingAddress: { firstName: 'Foo', email: 'foo.bar@example.com' },
      customerEmail: ' foo.bar@example.com ',
      docId: 'o1',
    };
    expect(isEmailCaseOnlyChange(base, after)).toBe(true);
  });

  it('is false when nothing changed (identical rewrite keeps old behaviour)', () => {
    expect(isEmailCaseOnlyChange(base, { ...base })).toBe(false);
  });

  it('is false when another field also changes', () => {
    expect(
      isEmailCaseOnlyChange(base, { ...base, customerEmail: 'foo.bar@example.com', lastUpdated: '2026-02-01' }),
    ).toBe(false);
    expect(
      isEmailCaseOnlyChange(base, { ...base, lineItems: [{ id: 'li1', sku: 'MEM-LIFE-1' }] }),
    ).toBe(false);
  });

  it('is false when an email changes to a different address', () => {
    expect(isEmailCaseOnlyChange(base, { ...base, customerEmail: 'other@example.com' })).toBe(false);
  });

  it('is false for non-email strings that only change case', () => {
    expect(
      isEmailCaseOnlyChange(base, { ...base, billingAddress: { ...base.billingAddress, firstName: 'FOO' } }),
    ).toBe(false);
  });

  it('is false for creates and deletes', () => {
    expect(isEmailCaseOnlyChange(undefined, base)).toBe(false);
    expect(isEmailCaseOnlyChange(base, undefined)).toBe(false);
  });
});
