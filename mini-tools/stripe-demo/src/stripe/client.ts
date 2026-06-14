import Stripe from "stripe";
import { DEFAULT_STRIPE_API_VERSION, getConfig, requireEnv } from "../config.js";

type StripeApiVersion = NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"];

export function createStripeClient(secretKey: string, apiVersion = DEFAULT_STRIPE_API_VERSION): Stripe {
  return new Stripe(secretKey, {
    apiVersion: apiVersion as StripeApiVersion,
  });
}

export function getStripeClient(): Stripe {
  const config = getConfig();
  return createStripeClient(
    requireEnv(config.stripeSecretKey, "STRIPE_SECRET_KEY"),
    config.stripeApiVersion,
  );
}
