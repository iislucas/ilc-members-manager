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
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    host: process.env.HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    stripeApiVersion: process.env.STRIPE_API_VERSION ?? DEFAULT_STRIPE_API_VERSION,
    stripePriceId: process.env.STRIPE_PRICE_ID,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  };
}

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
