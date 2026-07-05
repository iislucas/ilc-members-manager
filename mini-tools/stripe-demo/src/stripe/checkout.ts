import { getConfig, requireEnv } from "../config.js";
import { createOrder, updateOrder } from "../orders/orderRepository.js";
import { getStripeClient } from "./client.js";

export type CreateSubscriptionCheckoutSessionInput = {
  externalOrderId: string;
  priceId?: string;
};

export type CreateSubscriptionCheckoutSessionResult = {
  checkoutUrl: string;
  sessionId: string;
};

function validateExternalOrderId(externalOrderId: string): void {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(externalOrderId)) {
    throw new Error(
      "externalOrderId must be 1-128 characters and contain only letters, numbers, colon, underscore, or hyphen",
    );
  }
}

export async function createSubscriptionCheckoutSession(
  input: CreateSubscriptionCheckoutSessionInput,
): Promise<CreateSubscriptionCheckoutSessionResult> {
  validateExternalOrderId(input.externalOrderId);

  const config = getConfig();
  const priceId = input.priceId ?? requireEnv(config.stripePriceId, "STRIPE_PRICE_ID");
  createOrder({ externalOrderId: input.externalOrderId, stripePriceId: priceId });

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      client_reference_id: input.externalOrderId,
      metadata: {
        externalOrderId: input.externalOrderId,
      },
      subscription_data: {
        metadata: {
          externalOrderId: input.externalOrderId,
          internal_order_key: input.externalOrderId,
        },
      },
      success_url: `${config.appBaseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appBaseUrl}/checkout/cancel?externalOrderId=${encodeURIComponent(
        input.externalOrderId,
      )}`,
    },
    {
      idempotencyKey: `checkout-session:${input.externalOrderId}`,
    },
  );

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout Session URL");
  }

  updateOrder(input.externalOrderId, {
    checkoutUrl: session.url,
    status: "checkout_created",
    stripeCheckoutSessionId: session.id,
  });

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
  };
}
