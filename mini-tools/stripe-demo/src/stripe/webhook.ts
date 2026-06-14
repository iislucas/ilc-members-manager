import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getConfig, requireEnv } from "../config.js";
import { grantOrExtendEntitlement } from "../orders/entitlementService.js";
import {
  getOrderByExternalId,
  getOrderBySubscriptionId,
  insertWebhookEventProcessing,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  updateOrder,
} from "../orders/orderRepository.js";
import { getStripeClient } from "./client.js";
import { markSubscriptionDeleted, syncSubscription } from "./subscriptions.js";

type InvoiceLike = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

function getObjectId(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return typeof value === "string" ? value : value.id;
}

function getSessionExternalOrderId(session: Stripe.Checkout.Session): string | undefined {
  return session.client_reference_id ?? session.metadata?.externalOrderId;
}

async function retrieveSubscription(stripe: Stripe, subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const externalOrderId = getSessionExternalOrderId(session);

  if (!externalOrderId || session.mode !== "subscription") {
    return;
  }

  const order = getOrderByExternalId(externalOrderId);

  if (!order) {
    return;
  }

  if (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== session.id) {
    throw new Error(`Checkout Session ${session.id} does not match order ${externalOrderId}`);
  }

  updateOrder(externalOrderId, {
    status: "checkout_completed_pending_invoice_confirmation",
    stripeCheckoutSessionId: session.id,
    stripeCustomerId: getObjectId(session.customer),
    stripeSubscriptionId: getObjectId(session.subscription),
  });
}

async function handleCheckoutSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  const externalOrderId = getSessionExternalOrderId(session);

  if (!externalOrderId) {
    return;
  }

  const order = getOrderByExternalId(externalOrderId);

  if (!order || order.status === "active") {
    return;
  }

  updateOrder(externalOrderId, { status: "expired" });
}

async function handleInvoicePaid(stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  const invoiceWithSubscription = invoice as InvoiceLike;
  const subscriptionId = getObjectId(invoiceWithSubscription.subscription);

  if (!subscriptionId || invoice.status !== "paid") {
    return;
  }

  const subscription = await retrieveSubscription(stripe, subscriptionId);

  if (subscription.status !== "active" && subscription.status !== "trialing") {
    return;
  }

  const externalOrderId = subscription.metadata?.externalOrderId;
  const order = externalOrderId
    ? getOrderByExternalId(externalOrderId)
    : getOrderBySubscriptionId(subscription.id);

  if (!order) {
    return;
  }

  syncSubscription(subscription);
  const updatedOrder = getOrderByExternalId(order.externalOrderId);

  if (updatedOrder) {
    grantOrExtendEntitlement(updatedOrder);
  }
}

async function handleInvoicePaymentIssue(stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  const invoiceWithSubscription = invoice as InvoiceLike;
  const subscriptionId = getObjectId(invoiceWithSubscription.subscription);

  if (!subscriptionId) {
    return;
  }

  const subscription = await retrieveSubscription(stripe, subscriptionId);
  syncSubscription(subscription);
}

async function processStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.expired":
      await handleCheckoutSessionExpired(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      syncSubscription(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      markSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    case "invoice.paid":
      await handleInvoicePaid(stripe, event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
    case "invoice.payment_action_required":
      await handleInvoicePaymentIssue(stripe, event.data.object as Stripe.Invoice);
      break;
  }
}

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const config = getConfig();
  const stripe = getStripeClient();
  const signature = req.header("stripe-signature");

  if (!signature) {
    res.status(400).send("Missing Stripe signature");
    return;
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      requireEnv(config.stripeWebhookSecret, "STRIPE_WEBHOOK_SECRET"),
    );
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Invalid Stripe webhook");
    return;
  }

  const { inserted, record } = insertWebhookEventProcessing(event.id, event.type);

  if (!inserted && record.processingStatus === "processed") {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    await processStripeEvent(stripe, event);
    markWebhookEventProcessed(event.id);
    res.json({ received: true });
  } catch (error) {
    markWebhookEventFailed(event.id, error);
    throw error;
  }
}
