/**
 * Stripe webhook endpoint.
 *
 * Stripe POSTs events here whenever an order-relevant thing happens. We verify
 * the event signature against the STRIPE_WEBHOOK_SECRET, translate the event
 * into a durable `StripeOrder` record, and upsert it into the `orders`
 * collection. This function only RECORDS orders — it does not fulfil them
 * (mapping Stripe products to memberships/gradings is a separate concern).
 *
 * Events handled:
 *  - checkout.session.completed / async_payment_succeeded → 'checkout' order
 *  - invoice.paid (subscription renewals)                 → 'renewal' order
 *  - customer.subscription.deleted                        → 'cancellation' order
 *
 * Unlike the Stripe callables, this must be an `onRequest` HTTP function: Stripe
 * signature verification needs the raw request body, which Firebase exposes on
 * `req.rawBody`. Idempotency: every record carries a `stripeObjectId` (the id of
 * the source Stripe object); redelivered events upsert the same document rather
 * than creating duplicates.
 */

import Stripe from 'stripe';
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import {
  StripeOrder,
  StripeOrderLineItem,
} from './data-model';
import {
  formatLineItemDescription,
  getStripeClient,
  stripeSecretKey,
  stripeWebhookSecret,
} from './stripe-common';

function unixSecondsToIso(seconds: number | null | undefined): string {
  return new Date((seconds ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
}

function getObjectId(
  value: string | { id: string } | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  return typeof value === 'string' ? value : value.id;
}

function metadataToRecord(
  metadata: Stripe.Metadata | null | undefined,
): Record<string, string> | undefined {
  if (!metadata) {
    return undefined;
  }
  const entries = Object.entries(metadata).filter(
    ([, value]) => value != null,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function mapSessionLineItems(
  session: Stripe.Checkout.Session,
): StripeOrderLineItem[] {
  const items = session.line_items?.data ?? [];
  return items.map((item) => {
    const price = item.price ?? null;
    const product = price?.product;
    return {
      productId: getObjectId(product) ?? null,
      priceId: price?.id ?? null,
      description: formatLineItemDescription(
        item.description ?? '',
        price?.nickname,
      ),
      quantity: item.quantity,
      amountTotal: item.amount_total,
      currency: item.currency,
    };
  });
}

function mapInvoiceLineItems(invoice: Stripe.Invoice): StripeOrderLineItem[] {
  const lines = invoice.lines?.data ?? [];
  return lines.map((line) => {
    const priceDetails = line.pricing?.price_details;
    const price = (line as unknown as { price?: Stripe.Price }).price;
    return {
      productId: priceDetails?.product ?? null,
      priceId: priceDetails?.price ?? null,
      description: formatLineItemDescription(
        line.description ?? '',
        price?.nickname,
      ),
      quantity: line.quantity ?? null,
      amountTotal: line.amount,
      currency: line.currency,
    };
  });
}

function mapSubscriptionLineItems(
  subscription: Stripe.Subscription,
): StripeOrderLineItem[] {
  return (subscription.items?.data ?? []).map((item) => {
    const price = item.price;
    return {
      productId: getObjectId(price?.product) ?? null,
      priceId: price?.id ?? null,
      description: price?.nickname ?? '',
      quantity: item.quantity ?? null,
      amountTotal: price?.unit_amount ?? 0,
      currency: price?.currency ?? subscription.currency,
    };
  });
}

/** Builds a 'checkout' order from a completed Checkout Session. */
export function sessionToStripeOrder(
  session: Stripe.Checkout.Session,
): StripeOrder {
  const created = unixSecondsToIso(session.created);
  const address = session.customer_details?.address ?? undefined;
  return {
    docId: '',
    lastUpdated: created,
    ilcAppOrderKind: 'stripe',
    stripeOrderType: 'checkout',
    stripeObjectId: session.id,
    checkoutSessionId: session.id,
    paymentIntentId: getObjectId(session.payment_intent),
    subscriptionId: getObjectId(session.subscription),
    stripeCustomerId: getObjectId(session.customer),
    mode: session.mode === 'subscription' ? 'subscription' : 'payment',
    status: session.status ?? undefined,
    paymentStatus: session.payment_status ?? null,
    customerEmail: session.customer_details?.email ?? undefined,
    customerName: session.customer_details?.name ?? undefined,
    billingAddress: address
      ? {
          line1: address.line1 ?? undefined,
          line2: address.line2 ?? undefined,
          city: address.city ?? undefined,
          state: address.state ?? undefined,
          postalCode: address.postal_code ?? undefined,
          country: address.country ?? undefined,
        }
      : undefined,
    amountTotal: session.amount_total,
    currency: session.currency,
    created,
    metadata: metadataToRecord(session.metadata),
    clientReferenceId: session.client_reference_id ?? null,
    lineItems: mapSessionLineItems(session),
  };
}

/** Builds a 'renewal' order from a paid subscription-cycle invoice. */
export function invoiceToStripeOrder(invoice: Stripe.Invoice): StripeOrder {
  const created = unixSecondsToIso(invoice.created);
  const subscriptionId = getObjectId(
    invoice.parent?.subscription_details?.subscription,
  );
  return {
    docId: '',
    lastUpdated: created,
    ilcAppOrderKind: 'stripe',
    stripeOrderType: 'renewal',
    stripeObjectId: invoice.id ?? '',
    invoiceId: invoice.id ?? undefined,
    paymentIntentId: getObjectId(
      (invoice as unknown as { payment_intent?: string | { id: string } })
        .payment_intent,
    ),
    subscriptionId,
    stripeCustomerId: getObjectId(invoice.customer),
    mode: 'subscription',
    status: invoice.status ?? undefined,
    paymentStatus: invoice.status === 'paid' ? 'paid' : 'unpaid',
    customerEmail: invoice.customer_email ?? undefined,
    customerName: invoice.customer_name ?? undefined,
    amountTotal: invoice.amount_paid,
    currency: invoice.currency,
    created,
    metadata: metadataToRecord(
      invoice.parent?.subscription_details?.metadata ?? invoice.metadata,
    ),
    clientReferenceId: null,
    lineItems: mapInvoiceLineItems(invoice),
  };
}

/** Builds a 'cancellation' order from a deleted subscription. */
export function subscriptionToCancellationOrder(
  subscription: Stripe.Subscription,
): StripeOrder {
  const canceledAt = unixSecondsToIso(
    subscription.canceled_at ?? subscription.ended_at,
  );
  return {
    docId: '',
    lastUpdated: canceledAt,
    ilcAppOrderKind: 'stripe',
    stripeOrderType: 'cancellation',
    stripeObjectId: subscription.id,
    subscriptionId: subscription.id,
    stripeCustomerId: getObjectId(subscription.customer),
    mode: 'subscription',
    status: subscription.status,
    paymentStatus: null,
    amountTotal: null,
    currency: subscription.currency,
    created: canceledAt,
    metadata: metadataToRecord(subscription.metadata),
    clientReferenceId: null,
    lineItems: mapSubscriptionLineItems(subscription),
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof admin.firestore.Timestamp)
      ) {
        result[key] = stripUndefined(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
  }
  return result as Partial<T>;
}

/**
 * Idempotently writes a StripeOrder: if a doc with the same `stripeObjectId`
 * already exists, it is updated in place; otherwise a new doc is created.
 * Any admin-set processing fields on an existing doc are preserved.
 */
async function upsertStripeOrder(
  db: admin.firestore.Firestore,
  order: StripeOrder,
): Promise<void> {
  const { docId, lastUpdated, ...rest } = order;
  const rawData = {
    ...rest,
    lastUpdated: admin.firestore.Timestamp.fromDate(new Date(lastUpdated)),
  };
  const docData = stripUndefined(rawData);

  const existing = await db
    .collection('orders')
    .where('stripeObjectId', '==', order.stripeObjectId)
    .limit(1)
    .get();

  if (!existing.empty) {
    await existing.docs[0].ref.set(docData, { merge: true });
    logger.info('Stripe webhook updated existing order', {
      stripeObjectId: order.stripeObjectId,
      stripeOrderType: order.stripeOrderType,
    });
    return;
  }

  await db.collection('orders').add({
    ...docData,
    ilcAppOrderStatus: 'needs-manual-processing',
  });
  logger.info('Stripe webhook created new order', {
    stripeObjectId: order.stripeObjectId,
    stripeOrderType: order.stripeOrderType,
  });
}

async function handleCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  db: admin.firestore.Firestore,
): Promise<void> {
  // Re-retrieve so we have expanded line items and product ids, which are not
  // present on the object delivered in the event payload.
  const full = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ['line_items.data.price.product'],
  });
  await upsertStripeOrder(db, sessionToStripeOrder(full));
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  db: admin.firestore.Firestore,
): Promise<void> {
  // Only subscription renewals become their own order. The very first invoice
  // (`subscription_create`) is already captured by checkout.session.completed,
  // and non-subscription invoices are not part of the order flow.
  if (invoice.billing_reason !== 'subscription_cycle') {
    return;
  }
  await upsertStripeOrder(db, invoiceToStripeOrder(invoice));
}

export const stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const signature = req.header('stripe-signature');
    if (!signature) {
      res.status(400).send('Missing Stripe signature');
      return;
    }

    const stripe = getStripeClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        stripeWebhookSecret.value(),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Invalid Stripe webhook';
      logger.warn('Stripe webhook signature verification failed', { message });
      res.status(400).send(message);
      return;
    }

    const db = admin.firestore();

    try {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          await handleCheckoutSession(
            stripe,
            event.data.object as Stripe.Checkout.Session,
            db,
          );
          break;
        case 'invoice.paid':
          await handleInvoicePaid(event.data.object as Stripe.Invoice, db);
          break;
        case 'customer.subscription.deleted':
          await upsertStripeOrder(
            db,
            subscriptionToCancellationOrder(
              event.data.object as Stripe.Subscription,
            ),
          );
          break;
        default:
          // Acknowledge unhandled events so Stripe stops retrying them.
          break;
      }
      res.json({ received: true });
    } catch (error) {
      // Return 500 so Stripe retries with backoff.
      const message =
        error instanceof Error ? error.stack || error.message : String(error);
      logger.error('Stripe webhook handler failed', {
        eventType: event.type,
        error: message,
      });
      res.status(500).send(message);
    }
  },
);
