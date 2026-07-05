export type OrderStatus =
  | "pending_checkout"
  | "checkout_created"
  | "customer_returned_from_checkout"
  | "checkout_completed_pending_invoice_confirmation"
  | "active"
  | "expired"
  | "canceling_at_period_end"
  | "payment_failed_grace_period"
  | "payment_failed_access_revoked"
  | "canceled";

export type Order = {
  externalOrderId: string;
  status: OrderStatus;
  checkoutUrl: string | null;
  stripeCheckoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StripeWebhookEventRecord = {
  stripeEventId: string;
  eventType: string;
  processingStatus: "processing" | "processed" | "failed";
  processedAt: Date | null;
  errorMessage: string | null;
};

export type CreateOrderInput = {
  externalOrderId: string;
  stripePriceId: string;
};
