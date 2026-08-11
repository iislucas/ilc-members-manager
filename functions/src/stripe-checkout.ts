/**
 * Stripe Checkout callables backing the public `/products` purchase flow.
 *
 * - `createStripeCheckoutSession` turns a Stripe price into a hosted Checkout
 *   Session and returns its URL, which the client redirects the buyer to.
 * - `getStripeCheckoutSession` reads back a completed session so the
 *   "thanks for your order" page can confirm what was purchased.
 *
 * Both are intentionally callable WITHOUT authentication: the purchase flow is
 * open to anyone (Stripe collects the customer's email and payment details on
 * its own hosted page). The success/cancel URLs are built from a client-
 * supplied origin that we validate against our allow-list to avoid being used
 * as an open redirect.
 */

import Stripe from 'stripe';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { allowedOrigins } from './common';
import { getStripeClient, stripeSecretKey } from './stripe-common';
import {
  CheckoutLineItem,
  CheckoutSessionSummary,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResult,
  GetCheckoutSessionRequest,
} from './stripe-types';

// Re-export the shared DTOs so existing importers of this module keep working.
export {
  CheckoutLineItem,
  CheckoutSessionSummary,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResult,
  GetCheckoutSessionRequest,
} from './stripe-types';

function requireAllowedOrigin(origin: unknown): string {
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
    throw new HttpsError(
      'invalid-argument',
      'A recognised app origin is required.',
    );
  }
  return origin;
}

export const createStripeCheckoutSession = onCall<
  CreateCheckoutSessionRequest,
  Promise<CreateCheckoutSessionResult>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  const priceId = request.data?.priceId;
  if (typeof priceId !== 'string' || !priceId.startsWith('price_')) {
    throw new HttpsError('invalid-argument', 'A valid priceId is required.');
  }

  const origin = requireAllowedOrigin(request.data?.origin);

  const rawQuantity = request.data?.quantity ?? 1;
  const quantity =
    Number.isInteger(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;

  const stripe = getStripeClient();

  // Look up the price server-side so we can (a) reject inactive/unknown prices
  // and (b) derive the correct Checkout mode rather than trusting the client.
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch {
    throw new HttpsError('not-found', 'Unknown price.');
  }
  if (!price.active) {
    throw new HttpsError(
      'failed-precondition',
      'This item is not available for purchase.',
    );
  }

  const mode: Stripe.Checkout.SessionCreateParams.Mode =
    price.type === 'recurring' ? 'subscription' : 'payment';

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: [{ price: priceId, quantity }],
    allow_promotion_codes: true,
    success_url: `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/products`,
  });

  if (!session.url) {
    throw new HttpsError('internal', 'Stripe did not return a checkout URL.');
  }

  logger.info('createStripeCheckoutSession created session', {
    sessionId: session.id,
    priceId,
    mode,
  });

  return { checkoutUrl: session.url, sessionId: session.id };
});

export const getStripeCheckoutSession = onCall<
  GetCheckoutSessionRequest,
  Promise<CheckoutSessionSummary>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  const sessionId = request.data?.sessionId;
  if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    throw new HttpsError('invalid-argument', 'A valid sessionId is required.');
  }

  const stripe = getStripeClient();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items'],
    });
  } catch {
    throw new HttpsError('not-found', 'Unknown checkout session.');
  }

  const lineItems: CheckoutLineItem[] = (session.line_items?.data ?? []).map(
    (item) => ({
      description: item.description ?? '',
      quantity: item.quantity,
      amountTotal: item.amount_total,
      currency: item.currency,
    }),
  );

  return {
    id: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    customerEmail: session.customer_details?.email ?? null,
    amountTotal: session.amount_total,
    currency: session.currency,
    lineItems,
  };
});
