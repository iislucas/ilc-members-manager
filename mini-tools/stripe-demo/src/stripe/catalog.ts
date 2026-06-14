import type Stripe from "stripe";

export const subscriptionWebhookEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
];
