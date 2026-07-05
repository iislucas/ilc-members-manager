import { envConfig } from './sandbox.env.js';

export const DEFAULT_STRIPE_API_VERSION = "2026-04-22.dahlia";

export type AppConfig = {
  appBaseUrl: string;
  host: string;
  port: number;
  stripeApiVersion: string;
  stripePriceId: string | undefined;
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
};

export function getConfig(): AppConfig {
  return {
    appBaseUrl: envConfig.APP_BASE_URL ?? "http://localhost:3000",
    host: envConfig.HOST ?? "127.0.0.1",
    port: Number.parseInt(envConfig.PORT ?? "3000", 10),
    stripeApiVersion: envConfig.STRIPE_API_VERSION ?? DEFAULT_STRIPE_API_VERSION,
    stripePriceId: envConfig.STRIPE_PRICE_ID,
    stripeSecretKey: envConfig.STRIPE_SECRET_KEY,
    stripeWebhookSecret: envConfig.STRIPE_WEBHOOK_SECRET,
  };
}

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
