/**
 * Shared Stripe wiring for the cloud functions.
 *
 * The secret key is provided at runtime via the STRIPE_SECRET_KEY secret; the
 * (non-secret) API version is pinned in environment.ts. Every function that
 * talks to Stripe must list `stripeSecretKey` in its `secrets` option so the
 * value is available inside `getStripeClient()`.
 */

import Stripe from 'stripe';
import { defineSecret } from 'firebase-functions/params';
import { environment } from './environment/environment';

export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

// Signing secret for the Stripe webhook endpoint (from the Stripe Dashboard
// webhook settings, `whsec_...`). Used to verify incoming event signatures.
export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

// The Stripe SDK types `apiVersion` as a specific string-literal union. Our
// pinned version lives in config, so we cast to the constructor's expected type.
type StripeApiVersion = NonNullable<
  ConstructorParameters<typeof Stripe>[1]
>['apiVersion'];

export function getStripeClient(): Stripe {
  return new Stripe(stripeSecretKey.value(), {
    apiVersion: environment.stripe.apiVersion as StripeApiVersion,
  });
}

/**
 * Format a line item description to show the specific instance/level/variant.
 * E.g., for product "GRADING : Student Levels" and nickname "Student Level 8",
 * returns "GRADING : Student Level 8".
 */
export function formatLineItemDescription(
  productDescription: string,
  priceNickname: string | null | undefined,
): string {
  const desc = productDescription.trim();
  const nick = (priceNickname ?? '').trim();
  if (!nick || nick === desc) {
    return desc;
  }

  // If the product description has a category prefix like "GRADING : Student Levels"
  if (desc.includes(' : ')) {
    const [category] = desc.split(' : ');
    if (nick.startsWith(category + ' : ')) {
      return nick;
    }
    return `${category} : ${nick}`;
  }

  return `${desc} (${nick})`;
}

// Every line item of a Checkout Session, with prices and products expanded.
// Retrieving a session with `expand: ['line_items']` only returns the first
// page (10 items), so a large order would silently lose items; this pages
// through them all.
export async function listAllSessionLineItems(
  stripe: Stripe,
  sessionId: string,
): Promise<Stripe.LineItem[]> {
  return stripe.checkout.sessions
    .listLineItems(sessionId, { limit: 100, expand: ['data.price.product'] })
    .autoPagingToArray({ limit: 1000 });
}
