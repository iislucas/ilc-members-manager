# Functions directory for server side code

Google Cloud Project APIs that need to be enabled: 

 * [Secret Manager](https://console.developers.google.com/apis/api/secretmanager.googleapis.com/overview).
 * [Calendar](https://console.cloud.google.com/marketplace/product/google/calendar-json.googleapis.com)

## Getting setup

Login to Google Cloud SDK:

```sh
gcloud auth login
```

```sh
export PROJECT=
gcloud config set project ${PROJECT}
gcloud auth application-default set-quota-project ${PROJECT}
```

Login to Firebase:

```sh
firebase login
firebase use --add # and then select your project
```

## API Key Secrets

See [Secret Manager](https://console.developers.google.com/apis/api/secretmanager.googleapis.com/overview).

Set the calendar API key by running the command
```sh
firebase functions:secrets:set GOOGLE_CALENDAR_API_KEY
# You will then be asked to enter the API key secret, do that.

# You can preview/get the secret with
gcloud secrets versions access 1 --secret=GOOGLE_CALENDAR_API_KEY

firebase functions:secrets:set SQUARESPACE_API_KEY
# Enter the the key from Squarespace Developer Settings > Developer API Keys

# You can preview/get the secret with
gcloud secrets versions access 1 --secret=SQUARESPACE_API_KEY
```

### Stripe secrets

The Stripe integration (products, checkout, and the orders webhook) needs two
secrets:

```sh
# The Stripe secret API key (Dashboard > Developers > API keys). Used by the
# products/checkout callables and the webhook.
firebase functions:secrets:set STRIPE_SECRET_KEY

# The signing secret for the orders webhook endpoint (`whsec_...`). Get it from
# the webhook's page in the Stripe Dashboard, or from the register script's
# output (see `scripts/register-stripe-webhook.ts`).
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

After setting `STRIPE_SECRET_KEY` and deploying the `stripeWebhook` function,
register its URL with Stripe and capture the signing secret by running (from the
repo root):

```sh
pnpm register:stripe-webhook
```

With an authenticated `gcloud`, the script needs no arguments: it reads
`STRIPE_SECRET_KEY` from Secret Manager and derives the webhook URL from the
active Cloud project (via `gcloud config`, `GOOGLE_CLOUD_PROJECT`, or
`.firebaserc`) and the function's region (default `us-central1`). Override with
`STRIPE_SECRET_KEY=...` (e.g. a throwaway test key), `--project`, `--region`, or
a full `--url`; add `--dry-run` to preview.

The script is idempotent (re-running reconciles the subscribed events). On first
creation it prints the `whsec_...` signing secret — Stripe only shows it once —
which you then store:

```sh
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```