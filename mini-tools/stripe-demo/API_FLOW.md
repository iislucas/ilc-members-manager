# Stripe API Flow

This document describes the Stripe API flows implemented in this repository.

## Configuration

The app uses the official Stripe Node SDK.

```ts
new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
});
```

Default API version:

```txt
2026-04-22.dahlia
```

Required Stripe values:

```txt
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET # from stripe listen for local testing
STRIPE_PRICE_ID
```

## 1. Subscription Checkout Creation

Route:

```txt
POST /checkout/subscription
```

Request body:

```json
{
  "externalOrderId": "order_123",
  "priceId": "price_optional_override"
}
```

If `externalOrderId` is omitted, the server generates one. If `priceId` is
omitted, the server uses `STRIPE_PRICE_ID`.

Local steps:

1. Validate `externalOrderId`.
2. Create a local order with `pending_checkout`.
3. Call Stripe Checkout Session create.
4. Store the returned Checkout Session ID and URL.
5. Mark the order as `checkout_created`.
6. Return the hosted Checkout URL.

Stripe API call:

```ts
stripe.checkout.sessions.create(
  {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: externalOrderId,
    metadata: { externalOrderId },
    subscription_data: {
      metadata: {
        externalOrderId,
        internal_order_key: externalOrderId,
      },
    },
    success_url: `${APP_BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL}/checkout/cancel?externalOrderId=${externalOrderId}`,
  },
  {
    idempotencyKey: `checkout-session:${externalOrderId}`,
  },
);
```

Response:

```json
{
  "externalOrderId": "order_123",
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_test_..."
}
```

Important behavior:

- Checkout is hosted by Stripe.
- The idempotency key is based on `externalOrderId`.
- Metadata is copied to the Stripe Subscription through `subscription_data`.
- Access is not granted when this API succeeds.

## 2. Customer Success Return

Route:

```txt
GET /checkout/success?session_id=cs_test_...
```

Purpose:

The customer reached the success URL after Checkout.

Local steps:

1. Read the Checkout Session ID from the query string.
2. Load the local order by stored Checkout Session ID.
3. Return a pending message and order snapshot.

This route does not grant access.

Reason:

The success URL is browser-controlled and is not authoritative. The app waits
for signed Stripe webhooks before activating the subscription.

## 3. Customer Cancel Return

Route:

```txt
GET /checkout/cancel?externalOrderId=order_123
```

Purpose:

The customer left Checkout without completing payment.

Local steps:

1. Read `externalOrderId`.
2. Load the local order.
3. If the order is not active, mark it as `customer_returned_from_checkout`.
4. Return the order snapshot.

This route does not cancel a Stripe Subscription and does not revoke access.

Reason:

The cancel URL means the customer returned from Checkout. It is not a
subscription cancellation signal.

## 4. Webhook Verification

Route:

```txt
POST /stripe/webhook
```

The route uses:

```ts
express.raw({ type: "application/json" })
```

Stripe signature verification:

```ts
stripe.webhooks.constructEvent(
  rawBody,
  stripeSignatureHeader,
  STRIPE_WEBHOOK_SECRET,
);
```

Processing steps:

1. Verify the Stripe signature.
2. Insert the Stripe event ID as `processing`.
3. If the event was already `processed`, return success immediately.
4. Dispatch by event type.
5. Mark the event as `processed`.
6. If processing fails, mark the event as `failed`.

Reason:

Stripe retries webhook delivery. Event ID tracking prevents duplicate local
side effects.

## 5. `checkout.session.completed`

Purpose:

Capture Checkout completion and attach Stripe customer/subscription IDs to the
local order.

Event object:

```txt
Stripe.Checkout.Session
```

Local steps:

1. Read `externalOrderId` from `client_reference_id` or metadata.
2. Verify `session.mode === "subscription"`.
3. Load the local order.
4. Verify the session matches the stored session when present.
5. Store:
   - `stripeCheckoutSessionId`
   - `stripeCustomerId`
   - `stripeSubscriptionId`
6. Mark order as `checkout_completed_pending_invoice_confirmation`.

This event does not grant access.

Reason:

Checkout completion confirms the customer completed the Checkout flow. The app
still waits for invoice confirmation before activation.

## 6. `checkout.session.expired`

Purpose:

Mark abandoned Checkout Sessions.

Event object:

```txt
Stripe.Checkout.Session
```

Local steps:

1. Read `externalOrderId` from `client_reference_id` or metadata.
2. Load the local order.
3. If the order is not active, mark it as `expired`.

## 7. `invoice.paid`

Purpose:

Grant or extend access after Stripe confirms a paid invoice.

Event object:

```txt
Stripe.Invoice
```

Stripe API call:

```ts
stripe.subscriptions.retrieve(subscriptionId);
```

Local steps:

1. Read the subscription ID from the invoice.
2. Confirm `invoice.status === "paid"`.
3. Retrieve the Stripe Subscription.
4. Verify subscription status is `active` or `trialing`.
5. Read `externalOrderId` from subscription metadata.
6. Sync subscription fields to the local order.
7. Mark the order as `active`.
8. Grant or extend local entitlement.

Stored subscription fields:

```txt
stripeCustomerId
stripeSubscriptionId
currentPeriodStart
currentPeriodEnd
status
```

This is the authoritative activation path.

## 8. `invoice.payment_failed`

Purpose:

Record failed recurring payment state.

Event object:

```txt
Stripe.Invoice
```

Stripe API call:

```ts
stripe.subscriptions.retrieve(subscriptionId);
```

Local steps:

1. Read the subscription ID from the invoice.
2. Retrieve the Stripe Subscription.
3. Map Stripe subscription status to local order status.
4. Revoke local entitlement only when the subscription is `unpaid` or canceled.

Status mapping:

```txt
past_due -> payment_failed_grace_period
unpaid   -> payment_failed_access_revoked
canceled -> canceled
```

## 9. `invoice.payment_action_required`

Purpose:

Record payment authentication or customer action requirements.

Processing:

This project handles it like `invoice.payment_failed`:

1. Read subscription ID from the invoice.
2. Retrieve the Stripe Subscription.
3. Sync local subscription/payment state.

Customer notification is not implemented in this repository.

## 10. `customer.subscription.created`

Purpose:

Sync the initial subscription object if this event arrives before or after
Checkout completion.

Event object:

```txt
Stripe.Subscription
```

Local steps:

1. Read `externalOrderId` from subscription metadata.
2. Load the local order.
3. Store customer ID, subscription ID, current period dates, and status.
4. Grant entitlement if the subscription is active or trialing.

## 11. `customer.subscription.updated`

Purpose:

Keep local subscription state in sync.

Event object:

```txt
Stripe.Subscription
```

Local steps:

1. Read `externalOrderId` from subscription metadata.
2. Load the local order by external order ID or subscription ID.
3. Persist customer ID, subscription ID, and period dates.
4. Map Stripe status to local status.
5. Update entitlement state when needed.

Status mapping:

```txt
cancel_at_period_end=true -> canceling_at_period_end
active                    -> active
trialing                  -> active
past_due                  -> payment_failed_grace_period
unpaid                    -> payment_failed_access_revoked
canceled                  -> canceled
```

## 12. `customer.subscription.deleted`

Purpose:

Finalize local cancellation.

Event object:

```txt
Stripe.Subscription
```

Local steps:

1. Read `externalOrderId` from subscription metadata.
2. Load the local order by external order ID or subscription ID.
3. Mark the order as `canceled`.
4. Revoke local entitlement.
5. Persist subscription period fields when available.

## 13. Bootstrap Stripe Test Account

Script:

```bash
pnpm bootstrap:stripe
```

Stripe API calls:

```ts
stripe.accounts.retrieve()
stripe.products.create(...)
stripe.prices.create(...)
```

Created objects:

```txt
Product
Recurring Price
```

Local webhook forwarding:

```bash
pnpm stripe:listen
```

Equivalent Stripe CLI command:

```bash
stripe listen --events checkout.session.completed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required --forward-to 127.0.0.1:3000/stripe/webhook
```

The Stripe CLI forwards snapshot events to the local Express route and prints the
`whsec_...` signing secret. Use that listener signing secret as
`STRIPE_WEBHOOK_SECRET` when running the app with `pnpm dev`.

Forwarded webhook events:

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

Safety behavior:

- Refuses live keys unless `--live` is passed.
- Supports `--dry-run`.
- Supports `--json`.
- Prints created object IDs and the Stripe CLI forwarding command.
- Does not write secrets to source files.

## Local State Model

Order statuses:

```txt
pending_checkout
checkout_created
customer_returned_from_checkout
checkout_completed_pending_invoice_confirmation
active
expired
canceling_at_period_end
payment_failed_grace_period
payment_failed_access_revoked
canceled
```

Entitlements are separate from orders. They are granted only from verified
webhook processing, mainly `invoice.paid`.

## Source Of Truth Rules

- Checkout Session creation starts the flow.
- Success URL is not authoritative.
- Cancel URL is not authoritative.
- Webhooks are authoritative for subscription state.
- `invoice.paid` is authoritative for granting access.
- Stripe event IDs are used for idempotency.
- Stripe metadata links Stripe objects back to local `externalOrderId`.
