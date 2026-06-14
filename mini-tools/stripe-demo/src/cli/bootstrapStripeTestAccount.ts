import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { DEFAULT_STRIPE_API_VERSION } from "../config.js";
import { createStripeClient } from "../stripe/client.js";
import { subscriptionWebhookEvents } from "../stripe/catalog.js";

const DEFAULT_FORWARD_TO = "127.0.0.1:3000/stripe/webhook";

type CliOptions = {
  amount: number;
  apiVersion: string;
  currency: string;
  dryRun: boolean;
  forwardTo: string;
  interval: "day" | "week" | "month" | "year";
  json: boolean;
  live: boolean;
  productName: string;
};

function buildStripeListenCommand(forwardTo: string): string {
  return `stripe listen --events ${subscriptionWebhookEvents.join(",")} --forward-to ${forwardTo}`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    amount: 1000,
    apiVersion: DEFAULT_STRIPE_API_VERSION,
    currency: "usd",
    dryRun: false,
    forwardTo: DEFAULT_FORWARD_TO,
    interval: "month",
    json: false,
    live: false,
    productName: "Test Subscription",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--amount":
        options.amount = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--api-version":
        options.apiVersion = next ?? options.apiVersion;
        index += 1;
        break;
      case "--currency":
        options.currency = next ?? options.currency;
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--forward-to":
      case "--local-webhook-url":
      case "--webhook-url":
        options.forwardTo = next ?? options.forwardTo;
        index += 1;
        break;
      case "--interval":
        if (next !== "day" && next !== "week" && next !== "month" && next !== "year") {
          throw new Error("--interval must be day, week, month, or year");
        }
        options.interval = next;
        index += 1;
        break;
      case "--json":
        options.json = true;
        break;
      case "--live":
        options.live = true;
        break;
      case "--product-name":
        options.productName = next ?? options.productName;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }

  if (!Number.isInteger(options.amount) || options.amount <= 0) {
    throw new Error("--amount must be a positive integer in minor currency units");
  }

  return options;
}

async function askDefault(rl: readline.Interface, prompt: string, defaultValue: string): Promise<string> {
  const answer = await rl.question(`${prompt} (${defaultValue}): `);
  return answer.trim() || defaultValue;
}

async function pause(rl: readline.Interface, message: string, json: boolean): Promise<void> {
  if (json) {
    return;
  }

  console.log("");
  console.log(message);
  await rl.question("Press Enter when complete...");
}

async function confirmCreate(rl: readline.Interface, label: string): Promise<void> {
  const answer = await rl.question(`Create ${label}? Type yes to continue: `);

  if (answer.trim().toLowerCase() !== "yes") {
    throw new Error(`Skipped ${label}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rl = readline.createInterface({ input, output });

  try {
    await pause(
      rl,
      "Open Stripe Dashboard. Confirm you are in test mode. Create or copy a restricted/secret test API key.",
      options.json,
    );

    const secretKey =
      process.env.STRIPE_SECRET_KEY ?? (await rl.question("STRIPE_SECRET_KEY: ")).trim();

    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required");
    }

    if (secretKey.startsWith("sk_live_") && !options.live) {
      throw new Error("Refusing to use a live-mode key unless --live is passed");
    }

    const stripe = createStripeClient(secretKey, options.apiVersion);

    if (!options.dryRun) {
      await stripe.accounts.retrieve();
    }

    const forwardTo = await askDefault(rl, "Stripe CLI forward-to target", options.forwardTo);
    const productName = await askDefault(rl, "Product name", options.productName);
    const currency = await askDefault(rl, "Currency", options.currency);
    const amount = Number.parseInt(await askDefault(rl, "Amount", String(options.amount)), 10);
    const interval = (await askDefault(rl, "Interval", options.interval)) as CliOptions["interval"];

    if (interval !== "day" && interval !== "week" && interval !== "month" && interval !== "year") {
      throw new Error("Interval must be day, week, month, or year");
    }

    await pause(
      rl,
      [
        "Install and log in to the Stripe CLI if needed.",
        `In one terminal, run: ${buildStripeListenCommand(forwardTo)}`,
        "Copy the whsec_ value from the Stripe CLI output into STRIPE_WEBHOOK_SECRET.",
        "Then start the app with pnpm dev in another terminal.",
      ].join("\n"),
      options.json,
    );

    if (!options.dryRun) {
      await confirmCreate(rl, "product and recurring price");
    }

    const product = options.dryRun
      ? null
      : await stripe.products.create({
          name: productName,
          description: "Generic test subscription product",
          metadata: {
            environment: options.live ? "live" : "test",
            provisioning_key: "test_subscription",
          },
        });

    const price =
      options.dryRun || !product
        ? null
        : await stripe.prices.create({
            product: product.id,
            currency,
            unit_amount: amount,
            recurring: {
              interval,
              interval_count: 1,
            },
            metadata: {
              environment: options.live ? "live" : "test",
              plan_key: "test_monthly",
            },
          });

    const result = {
      STRIPE_SECRET_KEY: secretKey,
      STRIPE_PRICE_ID: price?.id ?? "",
      STRIPE_PRODUCT_ID: product?.id ?? "",
      STRIPE_API_VERSION: options.apiVersion,
      STRIPE_WEBHOOK_SECRET: "from `stripe listen` output",
      STRIPE_WEBHOOK_FORWARD_TO: forwardTo,
      STRIPE_LISTEN_COMMAND: buildStripeListenCommand(forwardTo),
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("");
      console.log("Final configuration. Do not commit secrets.");
      for (const [key, value] of Object.entries(result)) {
        console.log(`${key}=${value}`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
