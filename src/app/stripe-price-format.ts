/* stripe-price-format.ts
 *
 * Formatting helpers shared by every page that shows a Stripe price.
 *
 * The catalogue namespaces its names with a colon — products are called
 * "MEMBERSHIP : Annual" and "GRADING : Student Levels", and their prices are
 * nicknamed "Annual : 65+ Senior" or "Student Level 1". The prefix is useful
 * for finding things in the Stripe dashboard but only repeats context the page
 * already gives the reader, so `tidyStripeLabel` drops it for display.
 */

import { StripeProductPrice } from '../../functions/src/stripe-types';

/**
 * Format a price as an amount plus its billing period, e.g. "$85.00/year" or
 * "$850.00 one-time". Returns '' for a price with no amount, so callers can
 * skip it rather than render a stray currency symbol.
 */
export function formatStripePrice(
  price: StripeProductPrice | null | undefined,
): string {
  if (!price || price.unitAmount === null || price.unitAmount === undefined) {
    return '';
  }

  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (price.currency || 'usd').toUpperCase(),
  }).format(price.unitAmount / 100);

  if (price.type === 'recurring' && price.recurringInterval) {
    const count = price.recurringIntervalCount ?? 1;
    const interval =
      count > 1
        ? `${count} ${price.recurringInterval}s`
        : price.recurringInterval;
    return `${amount}/${interval}`;
  }
  return `${amount} one-time`;
}

/**
 * Format a bare amount with no billing period, for callers that supply the
 * period themselves (e.g. "$90.00 / year" laid out in the template).
 */
export function formatStripeAmount(
  unitAmount?: number | null,
  currency?: string | null,
): string {
  if (unitAmount === null || unitAmount === undefined) return '';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(unitAmount / 100);
}

/**
 * Strip the catalogue's namespace prefix: "MEMBERSHIP : Annual" becomes
 * "Annual", and "Annual : 65+ Senior" becomes "65+ Senior". Names without a
 * " : " separator are returned unchanged.
 */
export function tidyStripeLabel(label: string | null | undefined): string {
  if (!label) return '';
  const parts = label.split(' : ');
  return (parts[parts.length - 1] || '').trim() || label.trim();
}
