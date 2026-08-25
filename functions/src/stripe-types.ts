/**
 * Shared, dependency-free Stripe DTOs used by BOTH the cloud functions and the
 * Angular client. This file must not import the `stripe` package or any server
 * code — the client bundles it directly (mirroring data-model.ts). The string
 * unions below intentionally match the corresponding Stripe SDK types so the
 * server can assign Stripe values to them without casting.
 */

export enum StripePriceType {
  OneTime = 'one_time',
  Recurring = 'recurring',
}

export enum StripeRecurringInterval {
  Day = 'day',
  Week = 'week',
  Month = 'month',
  Year = 'year',
}

export enum StripeCheckoutStatus {
  Open = 'open',
  Complete = 'complete',
  Expired = 'expired',
}

export enum StripeCheckoutPaymentStatus {
  NoPaymentRequired = 'no_payment_required',
  Paid = 'paid',
  Unpaid = 'unpaid',
}

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

/** The mapped catalogue returned by `fetchStripeProducts`. */
export interface ListStripeProductsResult {
  products: StripeProduct[];
}

/** What triggered a refresh of the cached catalogue. */
export enum StripeCacheSource {
  Schedule = 'schedule',
  Webhook = 'webhook',
  Manual = 'manual',
}

/**
 * The Stripe catalogue as cached at /system/stripe-products.
 *
 * The purchase pages read their price structure from here, so prices render
 * for signed-out visitors without a Stripe round trip — and no endpoint hands
 * out the catalogue on demand. Refreshed on a schedule and whenever Stripe
 * reports a product or price change.
 */
export interface CachedStripeProducts {
  products: StripeProduct[];
  /** ISO date-time of the refresh that produced this snapshot. */
  lastRefreshed: string;
  source: StripeCacheSource;
}

export interface CreateCheckoutSessionRequest {
  /** The Stripe price the buyer selected (e.g. `price_...`). */
  priceId: string;
  /** The app origin to return the buyer to, e.g. `https://app.iliqchuan.com`. */
  origin: string;
  /** Optional quantity; defaults to 1. */
  quantity?: number;
  /** Optional custom success return URL. Must match an allowed origin. */
  successUrl?: string;
  /** Optional custom cancel return URL. Must match an allowed origin. */
  cancelUrl?: string;
  /** Optional metadata to attach to the Stripe Checkout session. */
  metadata?: Record<string, string>;
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
  metadata?: Record<string, string>;
}

export interface CancelSubscriptionRenewalRequest {
  subscriptionId: string;
}

export interface CancelSubscriptionRenewalResult {
  success: boolean;
  periodEnd: string; // YYYY-MM-DD
}

export interface ResumeSubscriptionRenewalRequest {
  subscriptionId: string;
}

export interface ResumeSubscriptionRenewalResult {
  success: boolean;
  nextAutoRenewDate: string; // YYYY-MM-DD
}

export interface CreateCustomerPortalSessionRequest {
  returnUrl: string;
}

export interface CreateCustomerPortalSessionResult {
  url: string;
}

