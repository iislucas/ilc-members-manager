import type Stripe from "stripe";
import { grantOrExtendEntitlement, revokeEntitlement } from "../orders/entitlementService.js";
import {
  getOrderByExternalId,
  getOrderBySubscriptionId,
  updateOrder,
} from "../orders/orderRepository.js";

type SubscriptionLike = Stripe.Subscription & {
  current_period_start?: number | null;
  current_period_end?: number | null;
};

function fromUnixSeconds(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

function getExternalOrderId(subscription: Stripe.Subscription): string | undefined {
  return subscription.metadata?.externalOrderId;
}

export function syncSubscription(subscription: Stripe.Subscription): void {
  const externalOrderId = getExternalOrderId(subscription);
  const order = externalOrderId
    ? getOrderByExternalId(externalOrderId)
    : getOrderBySubscriptionId(subscription.id);

  if (!order) {
    return;
  }

  const subscriptionWithPeriods = subscription as SubscriptionLike;
  const status = subscription.cancel_at_period_end
    ? "canceling_at_period_end"
    : subscription.status === "active" || subscription.status === "trialing"
      ? "active"
      : subscription.status === "past_due"
        ? "payment_failed_grace_period"
        : subscription.status === "unpaid"
          ? "payment_failed_access_revoked"
          : subscription.status === "canceled"
            ? "canceled"
            : order.status;

  const updatedOrder = updateOrder(order.externalOrderId, {
    currentPeriodStart: fromUnixSeconds(subscriptionWithPeriods.current_period_start),
    currentPeriodEnd: fromUnixSeconds(subscriptionWithPeriods.current_period_end),
    status,
    stripeCustomerId:
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
  });

  if (status === "active" || status === "canceling_at_period_end") {
    grantOrExtendEntitlement(updatedOrder);
  }

  if (status === "payment_failed_access_revoked" || status === "canceled") {
    revokeEntitlement(updatedOrder.externalOrderId);
  }
}

export function markSubscriptionDeleted(subscription: Stripe.Subscription): void {
  const externalOrderId = getExternalOrderId(subscription);
  const order = externalOrderId
    ? getOrderByExternalId(externalOrderId)
    : getOrderBySubscriptionId(subscription.id);

  if (!order) {
    return;
  }

  const subscriptionWithPeriods = subscription as SubscriptionLike;
  updateOrder(order.externalOrderId, {
    currentPeriodStart: fromUnixSeconds(subscriptionWithPeriods.current_period_start),
    currentPeriodEnd: fromUnixSeconds(subscriptionWithPeriods.current_period_end),
    status: "canceled",
    stripeSubscriptionId: subscription.id,
  });
  revokeEntitlement(order.externalOrderId);
}
