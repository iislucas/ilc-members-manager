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
import {
  formatLineItemDescription,
  getStripeClient,
  stripeSecretKey,
} from './stripe-common';
import {
  CheckoutLineItem,
  CheckoutSessionSummary,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResult,
  GetCheckoutSessionRequest,
  StripeCheckoutStatus,
  StripeCheckoutPaymentStatus,
} from './stripe-types';

// Re-export the shared DTOs so existing importers of this module keep working.
export {
  CheckoutLineItem,
  CheckoutSessionSummary,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResult,
  GetCheckoutSessionRequest,
  StripeCheckoutStatus,
  StripeCheckoutPaymentStatus,
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

import * as admin from 'firebase-admin';
import { getMemberByEmail } from './common';

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

  const db = admin.firestore();
  let customerId: string | undefined;
  let memberDocId: string | undefined;
  let memberId: string | undefined;

  const callerEmail = request.auth?.token?.email;
  if (callerEmail) {
    try {
      const member = await getMemberByEmail(callerEmail, db);
      memberDocId = member.docId;
      memberId = member.memberId;

      if (member.stripeCustomerId) {
        customerId = member.stripeCustomerId;
      } else {
        const existing = await stripe.customers.list({
          email: callerEmail,
          limit: 1,
        });
        if (existing.data.length > 0) {
          customerId = existing.data[0].id;
        } else {
          const created = await stripe.customers.create({
            email: callerEmail,
            name: member.name || undefined,
            metadata: {
              memberDocId: member.docId,
              memberId: member.memberId,
            },
          });
          customerId = created.id;
        }
        await db.collection('members').doc(member.docId).update({
          stripeCustomerId: customerId,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch {
      // If member lookup fails, continue as guest checkout
    }
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode,
    line_items: [{ price: priceId, quantity }],
    allow_promotion_codes: true,
    success_url: `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/products`,
  };

  if (customerId) {
    sessionParams.customer = customerId;
    sessionParams.customer_update = {
      address: 'auto',
      name: 'auto',
    };
  }

  if (memberDocId) {
    sessionParams.client_reference_id = memberDocId;
    sessionParams.metadata = {
      memberDocId,
      memberId: memberId || '',
    };
    if (mode === 'subscription') {
      sessionParams.subscription_data = {
        metadata: {
          memberDocId,
          memberId: memberId || '',
        },
      };
    }
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) {
    throw new HttpsError('internal', 'Stripe did not return a checkout URL.');
  }

  logger.info('createStripeCheckoutSession created session', {
    sessionId: session.id,
    priceId,
    mode,
    customerId,
    memberDocId,
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
      expand: ['line_items.data.price'],
    });
  } catch {
    throw new HttpsError('not-found', 'Unknown checkout session.');
  }

  const lineItems: CheckoutLineItem[] = (session.line_items?.data ?? []).map(
    (item) => ({
      description: formatLineItemDescription(
        item.description ?? '',
        item.price?.nickname,
      ),
      quantity: item.quantity,
      amountTotal: item.amount_total,
      currency: item.currency,
    }),
  );

  return {
    id: session.id,
    status: (session.status as StripeCheckoutStatus) ?? null,
    paymentStatus: session.payment_status as StripeCheckoutPaymentStatus,
    customerEmail: session.customer_details?.email ?? null,
    amountTotal: session.amount_total,
    currency: session.currency,
    lineItems,
  };
});
