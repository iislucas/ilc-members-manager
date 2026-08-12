import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { OrderKind } from './data-model';
import {
  sessionToStripeOrder,
  invoiceToStripeOrder,
  subscriptionToCancellationOrder,
} from './stripe-webhook';

// A minimal but realistic completed one-time Checkout Session. Only the fields
// the mapper reads are populated; the rest are cast away.
const session = {
  id: 'cs_test_123',
  object: 'checkout.session',
  created: 1751731200, // 2025-07-05T16:00:00Z
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  amount_total: 5500,
  currency: 'usd',
  customer: 'cus_abc',
  payment_intent: 'pi_abc',
  subscription: null,
  client_reference_id: 'member-FR102',
  metadata: { memberId: 'FR102' },
  customer_details: {
    email: 'buyer@example.com',
    name: 'Jane Buyer',
    address: {
      line1: '1 Rue de la Paix',
      line2: null,
      city: 'Paris',
      state: null,
      postal_code: '75002',
      country: 'FR',
    },
  },
  line_items: {
    object: 'list',
    data: [
      {
        id: 'li_1',
        description: 'Annual Membership',
        quantity: 1,
        amount_total: 5500,
        currency: 'usd',
        price: {
          id: 'price_annual',
          product: 'prod_membership',
        },
      },
    ],
  },
} as unknown as Stripe.Checkout.Session;

const renewalInvoice = {
  id: 'in_test_456',
  object: 'invoice',
  created: 1754323200,
  status: 'paid',
  billing_reason: 'subscription_cycle',
  amount_paid: 5500,
  currency: 'usd',
  customer: 'cus_abc',
  customer_email: 'buyer@example.com',
  customer_name: 'Jane Buyer',
  parent: {
    type: 'subscription_details',
    subscription_details: {
      subscription: 'sub_xyz',
      metadata: { memberId: 'FR102' },
    },
  },
  lines: {
    object: 'list',
    data: [
      {
        description: 'Annual Membership',
        quantity: 1,
        amount: 5500,
        currency: 'usd',
        pricing: {
          price_details: { price: 'price_annual', product: 'prod_membership' },
        },
      },
    ],
  },
} as unknown as Stripe.Invoice;

const canceledSubscription = {
  id: 'sub_xyz',
  object: 'subscription',
  status: 'canceled',
  canceled_at: 1756000000,
  ended_at: 1756000000,
  currency: 'usd',
  customer: 'cus_abc',
  metadata: { memberId: 'FR102' },
  items: {
    object: 'list',
    data: [
      {
        quantity: 1,
        price: {
          id: 'price_annual',
          product: 'prod_membership',
          nickname: 'Annual Membership',
          unit_amount: 5500,
          currency: 'usd',
        },
      },
    ],
  },
} as unknown as Stripe.Subscription;

describe('sessionToStripeOrder', () => {
  it('maps a completed checkout session to a checkout order', () => {
    const order = sessionToStripeOrder(session);
    expect(order.ilcAppOrderKind).toBe(OrderKind.Stripe);
    expect(order.stripeOrderType).toBe('checkout');
    // Dedup identity is the session id.
    expect(order.stripeObjectId).toBe('cs_test_123');
    expect(order.checkoutSessionId).toBe('cs_test_123');
    expect(order.paymentIntentId).toBe('pi_abc');
    expect(order.stripeCustomerId).toBe('cus_abc');
    expect(order.mode).toBe('payment');
    expect(order.paymentStatus).toBe('paid');
    expect(order.amountTotal).toBe(5500);
    expect(order.currency).toBe('usd');
    expect(order.customerEmail).toBe('buyer@example.com');
    expect(order.customerName).toBe('Jane Buyer');
    expect(order.billingAddress?.country).toBe('FR');
    expect(order.clientReferenceId).toBe('member-FR102');
    expect(order.metadata).toEqual({ memberId: 'FR102' });
    expect(order.created).toBe('2025-07-05T16:00:00.000Z');
    expect(order.lineItems).toEqual([
      {
        productId: 'prod_membership',
        priceId: 'price_annual',
        description: 'Annual Membership',
        quantity: 1,
        amountTotal: 5500,
        currency: 'usd',
      },
    ]);
  });

  it('formats specific variant instance in line item description', () => {
    const gradingSession = {
      ...session,
      id: 'cs_test_grading',
      line_items: {
        object: 'list',
        data: [
          {
            id: 'li_grading',
            description: 'GRADING : Student Levels',
            quantity: 1,
            amount_total: 30000,
            currency: 'usd',
            price: {
              id: 'price_stu8',
              product: 'prod_grading_student',
              nickname: 'Student Level 8',
            },
          },
        ],
      },
    } as unknown as Stripe.Checkout.Session;

    const order = sessionToStripeOrder(gradingSession);
    expect(order.lineItems[0].description).toBe('GRADING : Student Level 8');
  });
});

describe('invoiceToStripeOrder', () => {
  it('maps a subscription-cycle invoice to a renewal order', () => {
    const order = invoiceToStripeOrder(renewalInvoice);
    expect(order.stripeOrderType).toBe('renewal');
    expect(order.stripeObjectId).toBe('in_test_456');
    expect(order.invoiceId).toBe('in_test_456');
    expect(order.subscriptionId).toBe('sub_xyz');
    expect(order.mode).toBe('subscription');
    expect(order.paymentStatus).toBe('paid');
    expect(order.amountTotal).toBe(5500);
    expect(order.metadata).toEqual({ memberId: 'FR102' });
    expect(order.lineItems[0]).toEqual({
      productId: 'prod_membership',
      priceId: 'price_annual',
      description: 'Annual Membership',
      quantity: 1,
      amountTotal: 5500,
      currency: 'usd',
    });
  });
});

describe('subscriptionToCancellationOrder', () => {
  it('maps a deleted subscription to a cancellation order', () => {
    const order = subscriptionToCancellationOrder(canceledSubscription);
    expect(order.stripeOrderType).toBe('cancellation');
    expect(order.stripeObjectId).toBe('sub_xyz');
    expect(order.subscriptionId).toBe('sub_xyz');
    expect(order.status).toBe('canceled');
    expect(order.paymentStatus).toBeNull();
    expect(order.amountTotal).toBeNull();
    expect(order.lineItems[0].productId).toBe('prod_membership');
  });
});
