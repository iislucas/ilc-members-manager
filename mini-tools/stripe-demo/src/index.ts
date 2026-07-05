import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { getConfig } from "./config.js";
import { getEntitlement } from "./orders/entitlementService.js";
import {
  getOrderByCheckoutSessionId,
  getOrderByExternalId,
  listOrders,
  setOrderStatus,
} from "./orders/orderRepository.js";
import { createSubscriptionCheckoutSession } from "./stripe/checkout.js";
import { stripeWebhookHandler } from "./stripe/webhook.js";

const app = express();
const config = getConfig();

app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    stripeWebhookHandler(req, res).catch(next);
  },
);

app.use(express.json());

app.post("/checkout/subscription", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const externalOrderId =
      typeof req.body?.externalOrderId === "string" ? req.body.externalOrderId : randomUUID();
    const priceId = typeof req.body?.priceId === "string" ? req.body.priceId : undefined;
    const result = await createSubscriptionCheckoutSession({ externalOrderId, priceId });

    res.status(201).json({
      externalOrderId,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/checkout/success", (req: Request, res: Response) => {
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : undefined;
  const order = sessionId ? getOrderByCheckoutSessionId(sessionId) : null;

  res.status(202).json({
    message: "Checkout returned successfully. Subscription activation is pending webhook confirmation.",
    order,
  });
});

app.get("/checkout/cancel", (req: Request, res: Response) => {
  const externalOrderId =
    typeof req.query.externalOrderId === "string" ? req.query.externalOrderId : undefined;
  const order = externalOrderId ? getOrderByExternalId(externalOrderId) : null;

  if (order && order.status !== "active") {
    const updatedOrder = setOrderStatus(order.externalOrderId, "customer_returned_from_checkout");
    res.json({ order: updatedOrder });
    return;
  }

  res.json({ order });
});

app.get("/orders", (_req: Request, res: Response) => {
  res.json({ orders: listOrders() });
});

app.get("/orders/:externalOrderId", (req: Request, res: Response) => {
  const externalOrderId = req.params.externalOrderId;

  if (typeof externalOrderId !== "string") {
    res.status(400).json({ error: "externalOrderId is required" });
    return;
  }

  const order = getOrderByExternalId(externalOrderId);

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json({
    order,
    entitlement: getEntitlement(order.externalOrderId),
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  res.status(500).json({ error: message });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Stripe subscription checkout server listening on http://${config.host}:${config.port}`);
});

export { app, server };
