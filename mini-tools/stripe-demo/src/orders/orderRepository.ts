import type {
  CreateOrderInput,
  Order,
  OrderStatus,
  StripeWebhookEventRecord,
} from "../stripe/types.js";

const ordersByExternalId = new Map<string, Order>();
const ordersByCheckoutSessionId = new Map<string, string>();
const ordersBySubscriptionId = new Map<string, string>();
const webhookEvents = new Map<string, StripeWebhookEventRecord>();

function cloneOrder(order: Order): Order {
  return {
    ...order,
    currentPeriodStart: order.currentPeriodStart ? new Date(order.currentPeriodStart) : null,
    currentPeriodEnd: order.currentPeriodEnd ? new Date(order.currentPeriodEnd) : null,
    createdAt: new Date(order.createdAt),
    updatedAt: new Date(order.updatedAt),
  };
}

function storeOrder(order: Order): Order {
  const now = new Date();
  const nextOrder = { ...order, updatedAt: now };

  ordersByExternalId.set(nextOrder.externalOrderId, nextOrder);

  if (nextOrder.stripeCheckoutSessionId) {
    ordersByCheckoutSessionId.set(nextOrder.stripeCheckoutSessionId, nextOrder.externalOrderId);
  }

  if (nextOrder.stripeSubscriptionId) {
    ordersBySubscriptionId.set(nextOrder.stripeSubscriptionId, nextOrder.externalOrderId);
  }

  return cloneOrder(nextOrder);
}

export function createOrder(input: CreateOrderInput): Order {
  if (ordersByExternalId.has(input.externalOrderId)) {
    throw new Error(`Order ${input.externalOrderId} already exists`);
  }

  const now = new Date();
  const order: Order = {
    externalOrderId: input.externalOrderId,
    status: "pending_checkout",
    checkoutUrl: null,
    stripeCheckoutSessionId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: input.stripePriceId,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    createdAt: now,
    updatedAt: now,
  };

  ordersByExternalId.set(order.externalOrderId, order);
  return cloneOrder(order);
}

export function getOrderByExternalId(externalOrderId: string): Order | null {
  const order = ordersByExternalId.get(externalOrderId);
  return order ? cloneOrder(order) : null;
}

export function getOrderByCheckoutSessionId(sessionId: string): Order | null {
  const externalOrderId = ordersByCheckoutSessionId.get(sessionId);
  return externalOrderId ? getOrderByExternalId(externalOrderId) : null;
}

export function getOrderBySubscriptionId(subscriptionId: string): Order | null {
  const externalOrderId = ordersBySubscriptionId.get(subscriptionId);
  return externalOrderId ? getOrderByExternalId(externalOrderId) : null;
}

export function listOrders(): Order[] {
  return Array.from(ordersByExternalId.values(), cloneOrder);
}

export function updateOrder(
  externalOrderId: string,
  patch: Partial<Omit<Order, "externalOrderId" | "createdAt" | "updatedAt">>,
): Order {
  const order = ordersByExternalId.get(externalOrderId);

  if (!order) {
    throw new Error(`Order ${externalOrderId} was not found`);
  }

  return storeOrder({ ...order, ...patch });
}

export function setOrderStatus(externalOrderId: string, status: OrderStatus): Order {
  return updateOrder(externalOrderId, { status });
}

export function insertWebhookEventProcessing(
  stripeEventId: string,
  eventType: string,
): { inserted: boolean; record: StripeWebhookEventRecord } {
  const existing = webhookEvents.get(stripeEventId);

  if (existing) {
    return { inserted: false, record: { ...existing } };
  }

  const record: StripeWebhookEventRecord = {
    stripeEventId,
    eventType,
    processingStatus: "processing",
    processedAt: null,
    errorMessage: null,
  };

  webhookEvents.set(stripeEventId, record);
  return { inserted: true, record: { ...record } };
}

export function markWebhookEventProcessed(stripeEventId: string): void {
  const record = webhookEvents.get(stripeEventId);

  if (!record) {
    throw new Error(`Webhook event ${stripeEventId} was not found`);
  }

  webhookEvents.set(stripeEventId, {
    ...record,
    processingStatus: "processed",
    processedAt: new Date(),
    errorMessage: null,
  });
}

export function markWebhookEventFailed(stripeEventId: string, error: unknown): void {
  const record = webhookEvents.get(stripeEventId);

  if (!record) {
    throw new Error(`Webhook event ${stripeEventId} was not found`);
  }

  webhookEvents.set(stripeEventId, {
    ...record,
    processingStatus: "failed",
    processedAt: null,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
}
