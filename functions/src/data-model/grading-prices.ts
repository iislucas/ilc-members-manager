/* grading-prices.ts
 *
 * The single rule for which Stripe price charges for a grading level. Shared
 * by the purchase page (to show fees) and by `createGradingCheckoutSession`
 * (which is authoritative: the server always picks the prices it charges —
 * the browser only says which levels it wants).
 *
 * A grading price is an active, one-time price on an active product whose
 * name contains "grading" (e.g. 'GRADING : Student Levels'), whose nickname
 * reads — exactly, see `toGradingLevel` — as the level ('Student Level 4',
 * 'Entry Level', 'Application Level 1', …). Nothing else is ever matched, so
 * a free-text nickname can never be mistaken for a level.
 */

import { StripePriceType, StripeProduct, StripeProductPrice } from '../stripe-types';
import { GradingLevel, toGradingLevel } from './curriculum';

/** A grading level's fee: the Stripe price and the product it belongs to. */
export type GradingPrice = { product: StripeProduct; price: StripeProductPrice };

// True for a catalogue product that carries grading fees.
export function isGradingProduct(product: StripeProduct): boolean {
  return product.active && /\bgrading\b/i.test(product.name);
}

// True for a price that can be charged now as a one-off fee.
export function isSellableOneTimePrice(price: StripeProductPrice): boolean {
  return price.active && price.unitAmount !== null && price.type === StripePriceType.OneTime;
}

// The Stripe price for grading `level` (any spelling), or null when the
// catalogue has none. When several active prices exist for one level, the most
// recently created wins (changing a fee in Stripe creates a new price).
export function findGradingPrice(
  products: readonly StripeProduct[],
  level: string,
): GradingPrice | null {
  const wanted: GradingLevel | null = toGradingLevel(level);
  if (!wanted) return null;
  let best: GradingPrice | null = null;
  for (const product of products.filter(isGradingProduct)) {
    for (const price of product.prices) {
      if (!isSellableOneTimePrice(price) || toGradingLevel(price.nickname) !== wanted) continue;
      if (!best || (price.created ?? 0) > (best.price.created ?? 0)) {
        best = { product, price };
      }
    }
  }
  return best;
}
