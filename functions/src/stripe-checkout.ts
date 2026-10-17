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
  listAllSessionLineItems,
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

export function requireAllowedOrigin(origin: unknown): string {
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
import { MailSettings, MailSendingStatus, TransactionalEmailKey, resolveNotificationStatus } from './data-model/mail';
import { Member } from './data-model/members';
import { normalizeEmail } from './data-model/email';

// Metadata keys that grading fulfillment trusts; only the server sets them.
const GRADING_METADATA_KEYS = ['gradingLevel', 'gradingLevels'];

/** The Stripe customer and member a checkout is for (all undefined for a guest). */
export type CheckoutCustomer = {
  customerId?: string;
  memberDocId?: string;
  memberId?: string;
};

// Resolves the signed-in caller's member record and Stripe customer (creating
// and caching the customer on first purchase). A caller with no member record,
// or no email, checks out as a guest.
export async function resolveCheckoutCustomer(
  stripe: Stripe,
  db: admin.firestore.Firestore,
  callerEmail: string | undefined,
): Promise<CheckoutCustomer> {
  if (!callerEmail) return {};
  try {
    const member = await getMemberByEmail(callerEmail, db);
    return {
      customerId: await stripeCustomerForMember(stripe, db, member, callerEmail),
      memberDocId: member.docId,
      memberId: member.memberId,
    };
  } catch {
    // If member lookup fails, continue as guest checkout
    return {};
  }
}

// The Stripe customer id for `member`: the cached one, else an existing Stripe
// customer with `email`, else a newly created one. Caches it on the member.
export async function stripeCustomerForMember(
  stripe: Stripe,
  db: admin.firestore.Firestore,
  member: Member,
  email: string,
): Promise<string> {
  if (member.stripeCustomerId) return member.stripeCustomerId;
  const existing = await stripe.customers.list({ email, limit: 1 });
  const customerId =
    existing.data.length > 0
      ? existing.data[0].id
      : (
          await stripe.customers.create({
            email,
            name: member.name || undefined,
            metadata: { memberDocId: member.docId, memberId: member.memberId },
          })
        ).id;
  await db.collection('members').doc(member.docId).update({
    stripeCustomerId: customerId,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  });
  return customerId;
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
    price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  } catch {
    throw new HttpsError('not-found', 'Unknown price.');
  }
  if (!price.active) {
    throw new HttpsError(
      'failed-precondition',
      'This item is not available for purchase.',
    );
  }
  // Grading fees are only sold through createGradingCheckoutSession, where the
  // server picks the prices from the member's progression. Refusing them here
  // means a browser can never choose which grading price it is charged.
  const product = price.product;
  const productName =
    product && typeof product !== 'string' && !('deleted' in product && product.deleted)
      ? (product as Stripe.Product).name
      : '';
  if (/\bgrading\b/i.test(productName)) {
    throw new HttpsError(
      'failed-precondition',
      'Gradings are purchased from the grading page.',
    );
  }

  const mode: Stripe.Checkout.SessionCreateParams.Mode =
    price.type === 'recurring' ? 'subscription' : 'payment';

  const db = admin.firestore();
  const { customerId, memberDocId, memberId } = await resolveCheckoutCustomer(
    stripe,
    db,
    request.auth?.token?.email,
  );

  let successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
  if (typeof request.data?.successUrl === 'string' && request.data.successUrl.trim()) {
    try {
      const parsed = new URL(request.data.successUrl, origin);
      if (allowedOrigins.includes(parsed.origin)) {
        successUrl = request.data.successUrl;
      }
    } catch {
      // Use default successUrl
    }
  }

  let cancelUrl = `${origin}/products`;
  if (typeof request.data?.cancelUrl === 'string' && request.data.cancelUrl.trim()) {
    try {
      const parsed = new URL(request.data.cancelUrl, origin);
      if (allowedOrigins.includes(parsed.origin)) {
        cancelUrl = request.data.cancelUrl;
      }
    } catch {
      // Use default cancelUrl
    }
  }

  // Client metadata is passed through, except the keys that drive grading
  // fulfillment: only createGradingCheckoutSession may set those.
  const customMetadata: Record<string, string> = {};
  if (request.data?.metadata && typeof request.data.metadata === 'object') {
    for (const [key, value] of Object.entries(request.data.metadata)) {
      if (GRADING_METADATA_KEYS.includes(key)) continue;
      if (key === 'orderType' && value === 'grading') continue;
      customMetadata[key] = value;
    }
  }

  const isGift = Boolean(request.data?.isGift);
  const giftMetadata: Record<string, string> = {};
  if (isGift) {
    const recipientEmail = normalizeEmail(request.data?.recipientEmail);
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new HttpsError('invalid-argument', 'A valid recipient email is required when purchasing as a gift.');
    }

    // When email notifications are turned off, gifts can only be sent to existing member accounts
    const mailSettingsSnap = await db.doc('system/mail-settings').get();
    const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
    const mailStatus: MailSendingStatus = resolveNotificationStatus(
      mailSettings,
      TransactionalEmailKey.VodGiftReceived,
    );

    if (mailStatus === MailSendingStatus.Off) {
      let recipientMember: Member | null = null;
      try {
        recipientMember = await getMemberByEmail(recipientEmail, db);
      } catch {
        // Not found
      }
      if (!recipientMember) {
        throw new HttpsError(
          'failed-precondition',
          'Email notifications are currently turned off. Gifts can only be sent to existing member accounts.',
        );
      }
    }

    giftMetadata.isGift = 'true';
    giftMetadata.recipientEmail = recipientEmail;
    if (request.data?.recipientName) {
      giftMetadata.recipientName = request.data.recipientName.trim();
    }
    if (request.data?.giftMessage) {
      giftMetadata.giftMessage = request.data.giftMessage.trim().slice(0, 1000);
    }
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode,
    line_items: [{ price: priceId, quantity }],
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      ...customMetadata,
      ...giftMetadata,
    },
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
      ...sessionParams.metadata,
      memberDocId,
      memberId: memberId || '',
    };
    if (mode === 'subscription') {
      sessionParams.subscription_data = {
        metadata: {
          ...customMetadata,
          memberDocId,
          memberId: memberId || '',
        },
      };
    }
  } else if (mode === 'subscription' && Object.keys(customMetadata).length > 0) {
    sessionParams.subscription_data = {
      metadata: {
        ...customMetadata,
      },
    };
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
  let items: Stripe.LineItem[];
  try {
    // All line items, paged: an expanded session only carries the first 10.
    [session, items] = await Promise.all([
      stripe.checkout.sessions.retrieve(sessionId),
      listAllSessionLineItems(stripe, sessionId),
    ]);
  } catch {
    throw new HttpsError('not-found', 'Unknown checkout session.');
  }

  const lineItems: CheckoutLineItem[] = items.map(
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
    metadata: (session.metadata as Record<string, string>) ?? {},
  };
});
