/**
 * Register (or reconcile) the Stripe webhook endpoint that feeds the orders
 * collection, and print its signing secret.
 *
 * Idempotent: safe to re-run. It looks up any existing endpoint with the same
 * URL and only writes when the enabled event set differs; on an unchanged
 * endpoint it performs no writes.
 *
 * NOTE ON THE SIGNING SECRET: Stripe only returns an endpoint's `whsec_...`
 * signing secret at CREATION time — it cannot be read back later. So:
 *   - First run (endpoint created): the secret is printed. Save it via
 *     `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`.
 *   - Later runs (endpoint already exists): the secret is NOT available; the
 *     script just reconciles the event list. If you lost the secret, delete the
 *     endpoint in the Stripe Dashboard and re-run to create a fresh one.
 *
 * The webhook URL is derived automatically from the current Cloud project and
 * the function's region — no need to pass it in. Resolution order:
 *   - project: --project > GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT env >
 *              .firebaserc "default" > `gcloud config get-value project`
 *   - region:  --region  > FUNCTIONS_REGION env > us-central1 (Firebase default)
 * The resolved `https://<region>-<project>.cloudfunctions.net/stripeWebhook`
 * URL works for both gen1 and gen2 functions. Pass --url to override entirely.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm register:stripe-webhook
 *   STRIPE_SECRET_KEY=sk_test_... pnpm register:stripe-webhook -- --dry-run
 *   STRIPE_SECRET_KEY=sk_test_... pnpm register:stripe-webhook -- --project my-proj --region europe-west1
 *   STRIPE_SECRET_KEY=sk_test_... pnpm register:stripe-webhook -- --url https://.../stripeWebhook
 *
 * A live-mode key (sk_live_) is refused unless --live is passed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import Stripe from 'stripe';

const DEFAULT_STRIPE_API_VERSION = '2026-04-22.dahlia';
const DEFAULT_REGION = 'us-central1';
const FUNCTION_NAME = 'stripeWebhook';

// Must stay in sync with the events handled in
// functions/src/stripe-webhook.ts.
const ENABLED_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'invoice.paid',
  'customer.subscription.deleted',
];

type CliOptions = {
  url: string;
  project: string;
  region: string;
  dryRun: boolean;
  live: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let url = '';
  let project = '';
  let region = '';
  let dryRun = false;
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--':
        // pnpm may forward a literal `--` separator; ignore it.
        break;
      case '--url':
        url = argv[++i] ?? '';
        break;
      case '--project':
        project = argv[++i] ?? '';
        break;
      case '--region':
        region = argv[++i] ?? '';
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--live':
        live = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return { url, project, region, dryRun, live };
}

/** Reads the default project from `.firebaserc` at the repo root, if present. */
function projectFromFirebaseRc(): string | undefined {
  try {
    const raw = readFileSync(
      path.join(__dirname, '..', '.firebaserc'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as {
      projects?: { default?: string };
    };
    return parsed.projects?.default;
  } catch {
    return undefined;
  }
}

/** Reads the active project from the gcloud CLI, if it is installed. */
function projectFromGcloud(): string | undefined {
  try {
    const value = execFileSync(
      'gcloud',
      ['config', 'get-value', 'project'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    // gcloud prints "(unset)" when no project is configured.
    return value && value !== '(unset)' ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveProject(options: CliOptions): string {
  const project =
    options.project ||
    process.env['GOOGLE_CLOUD_PROJECT'] ||
    process.env['GCLOUD_PROJECT'] ||
    projectFromFirebaseRc() ||
    projectFromGcloud();
  if (!project) {
    throw new Error(
      'Could not determine the Cloud project. Pass --project, set ' +
        'GOOGLE_CLOUD_PROJECT, add a .firebaserc default, or run ' +
        '`gcloud config set project <id>`.',
    );
  }
  return project;
}

function resolveWebhookUrl(options: CliOptions): string {
  if (options.url) return options.url;
  const project = resolveProject(options);
  const region =
    options.region || process.env['FUNCTIONS_REGION'] || DEFAULT_REGION;
  return `https://${region}-${project}.cloudfunctions.net/${FUNCTION_NAME}`;
}

function sameEvents(existing: string[], desired: string[]): boolean {
  if (existing.includes('*')) return false;
  const a = [...existing].sort();
  const b = [...desired].sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const secretKey = process.env['STRIPE_SECRET_KEY'];
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required');
  if (secretKey.startsWith('sk_live_') && !options.live) {
    throw new Error('Refusing to use a live-mode key unless --live is passed');
  }

  const webhookUrl = resolveWebhookUrl(options);

  type StripeApiVersion = NonNullable<
    ConstructorParameters<typeof Stripe>[1]
  >['apiVersion'];
  const stripe = new Stripe(secretKey, {
    apiVersion: (process.env['STRIPE_API_VERSION'] ??
      DEFAULT_STRIPE_API_VERSION) as StripeApiVersion,
  });

  console.log(`Target endpoint URL: ${webhookUrl}`);
  if (options.dryRun) console.log('DRY RUN — no writes will be made.\n');

  // Find an existing endpoint with the same URL (paginate through all).
  let existing: Stripe.WebhookEndpoint | undefined;
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url === webhookUrl) {
      existing = endpoint;
      break;
    }
  }

  if (existing) {
    if (sameEvents(existing.enabled_events, ENABLED_EVENTS)) {
      console.log(
        `Endpoint already registered and up to date (${existing.id}). No changes.`,
      );
    } else {
      console.log(
        `Endpoint exists (${existing.id}); reconciling enabled events...`,
      );
      if (!options.dryRun) {
        await stripe.webhookEndpoints.update(existing.id, {
          enabled_events: ENABLED_EVENTS,
        });
      }
      console.log('Enabled events updated.');
    }
    console.log(
      '\nThe signing secret is only shown when an endpoint is first created and\n' +
        'cannot be read back. If you need it, delete this endpoint in the Stripe\n' +
        'Dashboard and re-run this script to create a fresh one.',
    );
    return;
  }

  console.log('No matching endpoint found; creating a new one...');
  if (options.dryRun) {
    console.log('DRY RUN — would create endpoint with events:');
    console.log(ENABLED_EVENTS.map((e) => `  - ${e}`).join('\n'));
    return;
  }

  const created = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: ENABLED_EVENTS,
    description: 'ILC Members Manager — orders webhook (stripeWebhook)',
  });

  console.log(`Created endpoint ${created.id}.`);
  console.log('\n=== STRIPE_WEBHOOK_SECRET (save this now — shown only once) ===');
  console.log(created.secret);
  console.log('===============================================================');
  console.log(
    '\nSet it with:\n  firebase functions:secrets:set STRIPE_WEBHOOK_SECRET',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
