/**
 * Shared, dependency-free Stripe DTOs used by BOTH the cloud functions and the
 * Angular client. This file must not import the `stripe` package or any server
 * code — the client bundles it directly (mirroring data-model.ts). The string
 * unions below intentionally match the corresponding Stripe SDK types so the
 * server can assign Stripe values to them without casting.
 */

export type StripePriceType = 'one_time' | 'recurring';
export type StripeRecurringInterval = 'day' | 'week' | 'month' | 'year';
export type StripeCheckoutStatus = 'open' | 'complete' | 'expired';
export type StripeCheckoutPaymentStatus =
  | 'no_payment_required'
  | 'paid'
  | 'unpaid';

/** A single billing option (price) attached to a product. */
export interface StripeProductPrice {
  id: string;
  active: boolean;
  currency: string;
  /** Amount in the currency's minor unit (e.g. cents). Null for some prices. */
  unitAmount: number | null;
  /** 'one_time' for single charges, 'recurring' for subscriptions. */
  type: StripePriceType;
  /** Billing interval when `type` is 'recurring', otherwise null. */
  recurringInterval: StripeRecurringInterval | null;
  /** Number of intervals between charges (e.g. every 3 months), or null. */
  recurringIntervalCount: number | null;
  nickname: string | null;
  /** Unix timestamp (seconds) when the price was created. */
  created?: number;
}

/** A Stripe product with its associated prices. */
export interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  images: string[];
  metadata: Record<string, string>;
  /** Unix timestamps (seconds). */
  created: number;
  updated: number;
  /** The product's default price, if one is configured. */
  defaultPrice: StripeProductPrice | null;
  /** All prices attached to this product. */
  prices: StripeProductPrice[];
}

/** Response returned by the `listStripeProducts` callable. */
export interface ListStripeProductsResult {
  products: StripeProduct[];
}

export interface CreateCheckoutSessionRequest {
  /** The Stripe price the buyer selected (e.g. `price_...`). */
  priceId: string;
  /** The app origin to return the buyer to, e.g. `https://app.iliqchuan.com`. */
  origin: string;
  /** Optional quantity; defaults to 1. */
  quantity?: number;
}

export interface CreateCheckoutSessionResult {
  /** The hosted Stripe Checkout URL to redirect the buyer to. */
  checkoutUrl: string;
  /** The created Checkout Session id (also echoed back on the success URL). */
  sessionId: string;
}

export interface GetCheckoutSessionRequest {
  sessionId: string;
}

/** A line on the completed order, mapped from a Checkout Session line item. */
export interface CheckoutLineItem {
  description: string;
  quantity: number | null;
  /** Total for this line in the currency's minor unit (e.g. cents). */
  amountTotal: number;
  currency: string;
}

/** A trimmed, typed view of a Checkout Session for the confirmation page. */
export interface CheckoutSessionSummary {
  id: string;
  status: StripeCheckoutStatus | null;
  paymentStatus: StripeCheckoutPaymentStatus;
  customerEmail: string | null;
  /** Grand total in the currency's minor unit, or null if not yet known. */
  amountTotal: number | null;
  currency: string | null;
  lineItems: CheckoutLineItem[];
}
