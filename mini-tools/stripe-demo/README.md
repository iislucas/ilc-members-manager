# Stripe Subscription Checkout

Small TypeScript/Express app for Stripe hosted subscription checkout.

The primary demo case is mapping an external order key from your application to
Stripe Checkout, subscriptions, webhooks, and local entitlement state. The app
accepts an `externalOrderId`, stores it as the local order key, writes it to
Stripe metadata, and uses it to reconcile webhook events back to the local
order.

## Structure

```txt
src/index.ts                         Express server and HTTP routes
src/config.ts                        Environment config helpers

src/stripe/client.ts                 Stripe SDK initialization
src/stripe/checkout.ts               Subscription Checkout Session creation
src/stripe/webhook.ts                Stripe webhook verification and dispatch
src/stripe/subscriptions.ts          Subscription status syncing
src/stripe/catalog.ts                Shared Stripe catalog/webhook constants
src/stripe/types.ts                  Order and webhook record types

src/orders/orderRepository.ts        In-memory order and webhook event store
src/orders/entitlementService.ts     In-memory entitlement state

src/cli/bootstrapStripeTestAccount.ts Test-mode Stripe setup helper
stripe-subscription-checkout-plan.md Detailed implementation plan
```

The repository currently uses in-memory storage. Replace `orderRepository` and
`entitlementService` with persistent storage before production use.

## External Order Key Mapping

This mini repo is intended to show how to keep your own order identifier as the
source of truth while Stripe owns Checkout, subscription, and invoice objects.

`POST /checkout/subscription` accepts an optional `externalOrderId`. If omitted,
the server generates one. When a Checkout Session is created, the value is sent
to Stripe as:

- `client_reference_id`
- Checkout Session `metadata.externalOrderId`
- Subscription `metadata.externalOrderId`
- Subscription `metadata.internal_order_key`

The in-memory order repository also maintains lookup maps from Stripe Checkout
Session ID and Stripe Subscription ID back to `externalOrderId`. Webhook handlers
prefer the external order key from Stripe metadata and fall back to these Stripe
object ID mappings when needed.

In production, model this as a durable order table with columns for your
external order key, Stripe Checkout Session ID, Stripe Customer ID, Stripe
Subscription ID, status, and entitlement state.

## Environment

```txt
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_... # from stripe listen
STRIPE_PRICE_ID=price_...
APP_BASE_URL=http://127.0.0.1:3000
STRIPE_API_VERSION=2026-04-22.dahlia
PORT=3000
HOST=127.0.0.1
```

Do not commit Stripe secrets.

## Scripts

```bash
pnpm install
pnpm dev
pnpm stripe:listen
pnpm build
pnpm start
pnpm typecheck
pnpm bootstrap:stripe
```

## Checkout Flow

1. Client calls `POST /checkout/subscription`.
2. App validates or generates `externalOrderId`.
3. App creates a local order with `pending_checkout`, keyed by
   `externalOrderId`.
4. App creates a Stripe Checkout Session in `subscription` mode.
5. App writes `externalOrderId` to Stripe Checkout and Subscription metadata.
6. App stores the Checkout Session ID and URL.
7. Client redirects the customer to `checkoutUrl`.

Example:

```bash
curl -X POST http://127.0.0.1:3000/checkout/subscription \
  -H 'content-type: application/json' \
  -d '{"externalOrderId":"order_123"}'
```

## Return URLs

`GET /checkout/success?session_id=...`

Shows a pending state only. It does not grant access.

`GET /checkout/cancel?externalOrderId=...`

Marks non-active orders as `customer_returned_from_checkout`. It does not cancel
or revoke a subscription.

## Webhook Flow

For local testing, use the Stripe CLI to forward snapshot events to:

```txt
POST /stripe/webhook
```

```bash
pnpm stripe:listen
```

The Stripe CLI prints a webhook signing secret like `whsec_...`. Use that value
for `STRIPE_WEBHOOK_SECRET` when running the app with `pnpm dev`. Keep the
listener running while you test checkout. The listener forwards only the events
this project handles.

The route uses Stripe raw-body signature verification. Each Stripe event ID is
recorded before processing so retries are idempotent.

Handled events:

```txt
checkout.session.completed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
invoice.payment_action_required
```

Access is granted only after `invoice.paid` confirms a paid invoice and an
active or trialing subscription.

Webhook reconciliation is keyed by `externalOrderId` whenever Stripe sends it in
`client_reference_id` or metadata. Subscription and invoice events are resolved
through Subscription metadata first, then through the local Subscription ID to
order mapping.

## Bootstrap Flow

Run:

```bash
pnpm bootstrap:stripe
```

The helper verifies a Stripe test key, creates a test subscription product,
creates a recurring price, and prints the environment values plus the Stripe CLI
forwarding command needed by the app.

Use `--dry-run` to preview prompts without creating Stripe objects.

The bootstrap helper does not create a Dashboard webhook endpoint for local
testing. Instead, run:

```bash
stripe listen --events checkout.session.completed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required --forward-to 127.0.0.1:3000/stripe/webhook
```

Copy the `whsec_...` value printed by `stripe listen` into
`STRIPE_WEBHOOK_SECRET`.
