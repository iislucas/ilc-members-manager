/**
 * Square API + CLI helper (subscriptions, checkout links, orders, and test catalog setup).
 *
 * This file exports a small public API for working with Square’s REST endpoints and a CLI wrapper
 * for running common workflows during development / experiments.
 *
 * -------------------------------------------------------------------------------------------------
 * Public exports (library usage)
 * -------------------------------------------------------------------------------------------------
 * Types:
 * - SquareEnvironmentName: `'sandbox' | 'production'`
 * - Environment: Stable runtime config (envName, baseUrl, accessToken, squareVersion, timeoutMs)
 * - CheckoutLinkInputs: Inputs required to generate a subscription checkout link
 * - SquareLocation, SquareSubscription, SquareOrder (+ related response/shape types)
 * - SetupTestProductParams, SetupTestSubscriptionParams
 *
 * Functions:
 * - loadEnvironment()
 *   Reads process.env and returns a frozen Environment used by all API calls.
 *
 * - listLocationIds(env, opts?)
 *   Calls GET /v2/locations and returns an array of locations (IDs + metadata).
 *
 * - createSubscriptionCartLink(env, inputs)
 *   Calls POST /v2/online-checkout/payment-links to create a Square-hosted checkout link
 *   for a *subscription plan variation* (note: the input is the plan variation ID).
 *
 * - getSubscriptionStatus(env, { subscriptionId?, customerId?, includeActions?, locationId })
 *   Retrieves a subscription by ID (GET /v2/subscriptions/{id}) OR searches by customerId
 *   (POST /v2/subscriptions/search). When searching, it returns all matches plus a bestGuess
 *   (ranked by status then most-recent update/create time).
 *
 * - getOrderDetails(env, { orderId })
 *   Calls GET /v2/orders/{order_id} and returns the full order payload.
 *
 * - listOrderIds(env, { locationId, limit?, cursor?, customerId?, state? })
 *   Calls POST /v2/orders/search and returns order IDs (plus cursor for pagination).
 *
 * Test helpers (catalog automation):
 * - setupTestProduct(env, params?)
 *   Creates a Catalog ITEM + one ITEM_VARIATION in a single UpsertCatalogObject call
 *   (POST /v2/catalog/object). Returns the created itemId + itemVariationId.
 *
 * - setupTestSubscription(env, params)
 *   Creates a SUBSCRIPTION_PLAN and SUBSCRIPTION_PLAN_VARIATION via UpsertCatalogObject,
 *   linking the variation to the plan. Requires eligibleItemIds (Catalog ITEM IDs).
 *   Supports pricingType:
 *     - RELATIVE (recommended): pricing is derived from the recurring order template/items
 *     - STATIC: sets a fixed phase price (often displayed as “Legacy” in Square dashboard)
 *
 * - setupTestProductAndSub(env, params?)
 *   Convenience: creates a product, then creates a subscription plan/variation eligible for that product.
 *
 * -------------------------------------------------------------------------------------------------
 * CLI usage
 * -------------------------------------------------------------------------------------------------
 * Run with:
 *   pnpm exec ts-node scripts/experiments/square-api.ts <command> [options]
 *
 * Commands:
 * - listLocations [--includeInactive]
 *   Prints location IDs (use these for --locationId / SQUARE_LOCATION_ID in your own scripts).
 *
 * - createCartLink --locationId <loc> --subscriptionPlanVariationId <varId> --priceAmount <minorUnits>
 *                 [--displayName <name>] [--currency <USD>] [--redirectUrl <url>]
 *   Creates and prints a Square-hosted checkout URL for the given subscription plan variation.
 *
 * - checkStatus --locationId <loc> (--subscriptionId <id> | --customerId <id>) [--includeActions]
 *   Prints subscription status details.
 *
 * - setupTestEnv [--createProduct=true|false] [--productId <itemId>]
 *                [--planName <name>] [--variationName <name>]
 *                [--priceAmount <minorUnits>] [--currency <USD>] [--cadence <ANNUAL|...>]
 *   Automates test data creation and prints the resulting Catalog IDs:
 *   - If --createProduct=true (default), it creates a new test ITEM + ITEM_VARIATION and uses the ITEM id
 *     as eligible_item_ids for the subscription plan.
 *   - If --createProduct=false, you must pass --productId (an existing Catalog ITEM id) to use as eligible_item_ids.
 *
 * - getOrder --orderId <id>
 *   Retrieves and prints a single order payload.
 *
 * - listOrderIds --locationId <loc> [--limit <n>] [--cursor <cursor>] [--customerId <id>] [--state <OPEN|COMPLETED|CANCELED>]
 *   Lists order IDs (supports pagination via --cursor).
 *
 * -------------------------------------------------------------------------------------------------
 * Environment variables (required / optional)
 * -------------------------------------------------------------------------------------------------
 * Required:
 * - SQUARE_ACCESS_TOKEN
 *   Access token for the chosen environment (sandbox or production).
 *
 * Optional:
 * - SQUARE_ENV
 *   "sandbox" (default) or "production".
 *
 * - SQUARE_BASE_URL
 *   Override base URL if needed. Otherwise, it's chosen based on $SQUARE_ENV Defaults:
 *     - production: https://connect.squareup.com
 *     - sandbox:    https://connect.squareupsandbox.com
 *
 * - SQUARE_VERSION
 *   Square API version header, default: "2026-01-22".
 *
 * - SQUARE_HTTP_TIMEOUT_MS
 *   Request timeout in milliseconds, default: 20000.
 *
 * -------------------------------------------------------------------------------------------------
 * Square account + API key setup (high-level)
 * -------------------------------------------------------------------------------------------------
 * 1) Create / sign in to a Square account and open the Square Developer Dashboard.
 * 2) Create an application (or select an existing one).
 * 3) Choose environment:
 *    - Sandbox: used for safe testing; you’ll use sandbox credentials and sandbox endpoints.
 *    - Production: live payments/data; use production credentials and production endpoint.
 * 4) Generate / copy the appropriate Access Token for that environment and set:
 *    - SQUARE_ENV=sandbox|production
 *    - SQUARE_ACCESS_TOKEN=<token>
 * 5) Ensure the token has permissions for the APIs you’re calling (Locations, Catalog, Orders, Subscriptions,
 *    and Online Checkout / Payment Links).
 * 6) In sandbox, you may need to create a sandbox “test account/business” or enable sandbox resources in the
 *    dashboard so Locations/Catalog calls have a place to write data.
 *
 * -------------------------------------------------------------------------------------------------
 * Sandbox mode notes
 * -------------------------------------------------------------------------------------------------
 * - Sandbox uses a separate host (https://connect.squareupsandbox.com) and segregated data store.
 * - IDs created in sandbox (locations, catalog objects, subscriptions, orders) are not valid in production.
 * - This script defaults to sandbox unless SQUARE_ENV=production is explicitly set.
 *
 * -------------------------------------------------------------------------------------------------
 * What setupTestEnv automates
 * -------------------------------------------------------------------------------------------------
 * The `setupTestEnv` CLI command orchestrates a predictable “known-good” set of resources for manual and
 * automated experiments:
 * - (Optionally) creates a test Catalog ITEM + ITEM_VARIATION via `setupTestProduct`, returning stable IDs.
 * - creates a SUBSCRIPTION_PLAN + SUBSCRIPTION_PLAN_VARIATION via `setupTestSubscription`, using the product’s
 *   ITEM id as eligible_item_ids so the plan is immediately usable.
 * - prints the resulting IDs so you can plug them into checkout link creation (`createCartLink`) and other flows
 *   without clicking around the Square dashboard.
 */

/* TODO:
    - Make more hardcoded values configurable
    - Support for firebase secrets
    - Support webhooks for when subscriptions are created/updated, events: https://developer.squareup.com/reference/square/subscriptions-api/webhooks
        * subscription.created
        * subscription.updated
 */

import axios, { AxiosInstance } from 'axios';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

//#region Configuration
export type SquareEnvironmentName = 'sandbox' | 'production';

// NOTE: Environment is now ONLY the stable runtime config.
// Checkout-link inputs (plan variation id, display name, price, currency, redirectUrl)
// are passed only where required (CLI -> function call).
export type Environment = Readonly<{
  envName: SquareEnvironmentName;
  baseUrl: string; // https://connect.squareup.com or https://connect.squareupsandbox.com
  accessToken: string;
  squareVersion: string; // e.g. 2026-01-22
  timeoutMs: number;
}>;

export type CheckoutLinkInputs = Readonly<{
  locationId: string, // squarespace location id
  subscriptionPlanVariationId: string; // passed as checkout_options.subscription_plan_id (plan variation id)
  subscriptionDisplayName: string; // quick_pay.name
  priceAmount: number; // integer in minor units, e.g. 1500 = $15.00
  currency: string; // e.g. "USD"
  redirectUrl?: string;
}>;
//#endregion

//#region EnvironmentHelpers
function mustGetEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim().length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v.trim();
}

function getEnvOrUndefined(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function parseIntStrict(name: string, value: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`Env var ${name} must be an integer, got: ${value}`);
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} is not finite: ${value}`);
  return n;
}

function inferBaseUrl(envName: SquareEnvironmentName): string {
  return envName === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

/**
 * Construct a single Environment object so call-sites don’t sprinkle process.env everywhere.
 */
export function loadEnvironment(): Environment {
  const envName = (getEnvOrUndefined('SQUARE_ENV') ?? 'sandbox') as SquareEnvironmentName;
  if (envName !== 'sandbox' && envName !== 'production') {
    throw new Error(`SQUARE_ENV must be "sandbox" or "production" (got: ${envName})`);
  }

  const baseUrl = getEnvOrUndefined('SQUARE_BASE_URL') ?? inferBaseUrl(envName);
  const accessToken = mustGetEnv('SQUARE_ACCESS_TOKEN');
  const squareVersion = getEnvOrUndefined('SQUARE_VERSION') ?? '2026-01-22';
  const timeoutMs = parseIntStrict('SQUARE_HTTP_TIMEOUT_MS', getEnvOrUndefined('SQUARE_HTTP_TIMEOUT_MS') ?? '20000');

  return Object.freeze({
    envName,
    baseUrl,
    accessToken,
    squareVersion,
    timeoutMs
  });
}

function createSquareClient(env: Environment): AxiosInstance {
  return axios.create({
    baseURL: env.baseUrl,
    timeout: env.timeoutMs,
    headers: {
      Authorization: `Bearer ${env.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': env.squareVersion
    }
  });
}

//#endregion

//#region SquareApiModels
export type SquareLocation = {
  id?: string;
  name?: string;
  country?: string;
  currency?: string;
  status?: string;
  timezone?: string;
  business_name?: string;
  address?: {
    address_line_1?: string;
    locality?: string;
    administrative_district_level_1?: string;
    postal_code?: string;
  };
};

export type ListLocationsResponse = {
  locations?: SquareLocation[];
  errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
};

export type CreatePaymentLinkResponse = {
  payment_link?: { id?: string; url?: string; version?: number; created_at?: string; updated_at?: string };
  errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
};

export type RetrieveSubscriptionResponse = {
  subscription?: SquareSubscription;
  errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
};

export type SearchSubscriptionsResponse = {
  subscriptions?: SquareSubscription[];
  cursor?: string;
  errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
};

export type SquareSubscription = {
  id?: string;
  location_id?: string;
  customer_id?: string;
  plan_variation_id?: string;
  status?: string;
  start_date?: string;
  charged_through_date?: string;
  created_at?: string;
  updated_at?: string;
};

// ---- Catalog (minimal) ----
export type UpsertCatalogObjectResponse = {
  catalog_object?: { id?: string; type?: string; version?: number; [k: string]: any };
  id_mappings?: Array<{ client_object_id?: string; object_id?: string }>;
  errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
};

export type Money = { amount?: number; currency?: string };

export type SquareLineItem = {
  uid?: string;
  catalog_object_id?: string;
  name?: string;
  variation_name?: string;
  quantity?: string;
  base_price_money?: Money;
  gross_sales_money?: Money;
  total_tax_money?: Money;
  total_discount_money?: Money;
  total_money?: Money;
};

export type SquareOrder = {
  id?: string;
  location_id?: string;
  customer_id?: string;
  state?: string;
  source?: { name?: string };
  created_at?: string;
  updated_at?: string;
  total_money?: Money;
  total_tax_money?: Money;
  total_discount_money?: Money;
  net_amounts?: {
    total_money?: Money;
    tax_money?: Money;
    discount_money?: Money;
    tip_money?: Money;
    service_charge_money?: Money;
  };
  tenders?: Array<{
    id?: string;
    type?: string;
    amount_money?: Money;
    status?: string;
    created_at?: string;
    payment_id?: string;
  }>;
  line_items?: SquareLineItem[];
};

export type RetrieveOrderResponse = {
  order?: SquareOrder;
  errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
};

export type SearchOrdersResponse = {
  orders?: SquareOrder[];
  cursor?: string;
  errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
};
//#endregion

//#region SquareApiHelpers
function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function throwIfSquareErrors(
  action: string,
  resp: { errors?: Array<{ code?: string; detail?: string; field?: string }> }
): void {
  if (resp.errors && resp.errors.length > 0) {
    const msg = resp.errors
      .map((e) => `${e.code ?? 'ERROR'}${e.field ? ` (${e.field})` : ''}: ${e.detail ?? ''}`.trim())
      .join(' | ');
    throw new Error(`${action} failed: ${msg}`);
  }
}

function pretty(obj: any): string {
  return JSON.stringify(obj, null, 2);
}

async function upsertCatalogObject(
  env: Environment,
  object: any,
  idempotencyKey?: string
): Promise<UpsertCatalogObjectResponse> {
  const client = createSquareClient(env);
  const body = {
    idempotency_key: idempotencyKey ?? newIdempotencyKey(),
    object
  };

  // UpsertCatalogObject: POST /v2/catalog/object.
  const { data } = await client.post<UpsertCatalogObjectResponse>('/v2/catalog/object', body);
  throwIfSquareErrors('UpsertCatalogObject', data);
  return data;
}

function pickMappingId(resp: UpsertCatalogObjectResponse, clientObjectId: string): string | undefined {
  return resp.id_mappings?.find((m) => m.client_object_id === clientObjectId)?.object_id;
}

function randomClientId(prefix: string): string {
  // For create flows, object.id must start with "#".
  const suffix = newIdempotencyKey().split('-')[0];
  return `#${prefix}_${suffix}`;
}

//#endregion

//#region PublicApi
export async function listLocationIds(
  env: Environment,
  opts?: { includeInactive?: boolean }
): Promise<{ locations: SquareLocation[] }> {
  const client = createSquareClient(env);

  // Locations: GET /v2/locations (optionally include inactive)
  const qs = opts?.includeInactive ? '?include_inactive=true' : '';
  const { data } = await client.get<ListLocationsResponse>(`/v2/locations${qs}`);

  throwIfSquareErrors('ListLocations', data);

  return { locations: data.locations ?? [] };
}

export async function createSubscriptionCartLink(
  env: Environment,
  inputs: CheckoutLinkInputs & { idempotencyKey?: string }
): Promise<{ paymentLinkId: string; url: string }> {
  const client = createSquareClient(env);

  const idempotencyKey = inputs.idempotencyKey ?? newIdempotencyKey();

  const body: any = {
    idempotency_key: idempotencyKey,
    quick_pay: {
      name: inputs.subscriptionDisplayName,
      price_money: { amount: inputs.priceAmount, currency: inputs.currency },
      location_id: inputs.locationId
    },
    checkout_options: {
      // subscription_plan_id is the *plan variation id* for this flow.
      subscription_plan_id: inputs.subscriptionPlanVariationId
    }
  };

  if (inputs.redirectUrl) body.checkout_options.redirect_url = inputs.redirectUrl;

  const { data } = await client.post<CreatePaymentLinkResponse>('/v2/online-checkout/payment-links', body);

  throwIfSquareErrors('CreatePaymentLink', data);

  const url = data.payment_link?.url;
  const paymentLinkId = data.payment_link?.id;

  if (!url || !paymentLinkId) {
    throw new Error('CreatePaymentLink succeeded but response is missing payment_link.id or payment_link.url');
  }

  return { paymentLinkId, url };
}

export async function getSubscriptionStatus(
  env: Environment,
  args: { subscriptionId?: string; customerId?: string; includeActions?: boolean; locationId: string }
): Promise<
  | { mode: 'bySubscriptionId'; subscription: SquareSubscription }
  | { mode: 'byCustomerId'; subscriptions: SquareSubscription[]; bestGuess?: SquareSubscription }
> {
  const client = createSquareClient(env);

  if (args.subscriptionId && args.subscriptionId.trim().length > 0) {
    const includeParam = args.includeActions ? '?include=actions' : '';
    const { data } = await client.get<RetrieveSubscriptionResponse>(
      `/v2/subscriptions/${encodeURIComponent(args.subscriptionId)}${includeParam}`
    );

    throwIfSquareErrors('RetrieveSubscription', data);

    if (!data.subscription) {
      throw new Error('RetrieveSubscription succeeded but response.subscription is missing');
    }

    return { mode: 'bySubscriptionId', subscription: data.subscription };
  }

  if (args.customerId && args.customerId.trim().length > 0) {
    const body = {
      query: {
        filter: {
          customer_ids: [args.customerId.trim()],
          location_ids: [args.locationId]
        }
      }
    };

    const { data } = await client.post<SearchSubscriptionsResponse>('/v2/subscriptions/search', body);

    throwIfSquareErrors('SearchSubscriptions', data);

    const subs = data.subscriptions ?? [];

    const rankStatus = (s?: string): number => {
      const v = (s ?? '').toUpperCase();
      if (v === 'ACTIVE') return 3;
      if (v === 'PAUSED') return 2;
      if (v === 'PENDING') return 1;
      return 0;
    };

    const bestGuess = [...subs].sort((a, b) => {
      const rs = rankStatus(b.status) - rankStatus(a.status);
      if (rs !== 0) return rs;

      const bt = Date.parse(b.updated_at ?? b.created_at ?? '') || 0;
      const at = Date.parse(a.updated_at ?? a.created_at ?? '') || 0;
      return bt - at;
    })[0];

    return { mode: 'byCustomerId', subscriptions: subs, bestGuess };
  }

  throw new Error('getSubscriptionStatus requires either subscriptionId or customerId');
}

/**
 * Retrieve a single order by id.
 *
 * Docs: GET /v2/orders/{order_id}
 */
export async function getOrderDetails(
  env: Environment,
  args: { orderId: string }
): Promise<{ order: SquareOrder }> {
  const orderId = args.orderId?.trim();
  if (!orderId) throw new Error('getOrderDetails: orderId is required');

  const client = createSquareClient(env);
  const { data } = await client.get<RetrieveOrderResponse>(`/v2/orders/${encodeURIComponent(orderId)}`);

  throwIfSquareErrors('RetrieveOrder', data);

  if (!data.order) {
    throw new Error('RetrieveOrder succeeded but response.order is missing');
  }

  return { order: data.order };
}

/**
 * List order ids for a location (paginated).
 *
 * This uses Orders Search so you can optionally filter by customerId and/or state.
 *
 * Docs: POST /v2/orders/search
 */
export async function listOrderIds(
  env: Environment,
  args: {
    locationId: string;
    limit?: number; // per page (Square max is typically 100)
    cursor?: string;
    customerId?: string;
    state?: 'OPEN' | 'COMPLETED' | 'CANCELED' | string;
    // You can extend later with date-time range, source, etc.
  }
): Promise<{ orderIds: string[]; cursor?: string }> {
  const locationId = args.locationId?.trim();
  if (!locationId) throw new Error('listOrderIds: locationId is required');

  const limit = args.limit ?? 50;
  if (!Number.isFinite(limit) || limit <= 0) throw new Error(`listOrderIds: limit must be > 0 (got: ${limit})`);

  const body: any = {
    location_ids: [locationId],
    limit
  };

  if (args.cursor) body.cursor = args.cursor;

  const filters: any = {};
  if (args.customerId?.trim()) filters.customer_filter = { customer_ids: [args.customerId.trim()] };
  if (args.state?.trim()) filters.state_filter = { states: [args.state.trim().toUpperCase()] };

  if (Object.keys(filters).length > 0) body.query = { filter: filters };

  const client = createSquareClient(env);
  const { data } = await client.post<SearchOrdersResponse>('/v2/orders/search', body);

  throwIfSquareErrors('SearchOrders', data);

  const orderIds = (data.orders ?? []).map((o) => o.id).filter((id): id is string => !!id);

  return { orderIds, cursor: data.cursor };
}

//#endregion

//#region Test Helpers
export type SetupTestProductParams = Partial<{
  name: string;
  description: string;
  currency: string;
  priceAmount: number; // minor units
  sku: string;
}>;

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_PRICE_AMOUNT = 1500;

export async function setupTestProduct(
  env: Environment,
  params?: SetupTestProductParams
): Promise<{
  itemId: string;
  itemVariationId: string;
  name: string;
  priceAmount: number;
  currency: string;
}> {
  const name = params?.name ?? `Test Product (${env.envName})`;
  const description = params?.description ?? 'Created by setupTestProduct()';
  const currency = params?.currency ?? DEFAULT_CURRENCY;
  const priceAmount = params?.priceAmount ?? DEFAULT_PRICE_AMOUNT;
  const sku = params?.sku ?? `TEST-SKU-${newIdempotencyKey().split('-')[0]}`;

  const itemClientId = randomClientId('TEST_ITEM');
  const variationClientId = randomClientId('TEST_VAR');

  // Create ITEM w/ one ITEM_VARIATION in a single UpsertCatalogObject call.
  // For creates, object.id must start with "#".
  const object = {
    type: 'ITEM',
    id: itemClientId,
    present_at_all_locations: true,
    item_data: {
      name,
      description,
      variations: [
        {
          type: 'ITEM_VARIATION',
          id: variationClientId,
          present_at_all_locations: true,
          item_variation_data: {
            name: 'Standard',
            sku,
            pricing_type: 'FIXED_PRICING',
            price_money: { amount: priceAmount, currency }
          }
        }
      ]
    }
  };

  const resp = await upsertCatalogObject(env, object);

  const itemId = pickMappingId(resp, itemClientId) ?? resp.catalog_object?.id;
  const itemVariationId = pickMappingId(resp, variationClientId);

  if (!itemId || !itemVariationId) {
    throw new Error(`setupTestProduct: Missing id mappings for created item/variation.\nResponse:\n${pretty(resp)}`);
  }

  return { itemId, itemVariationId, name, priceAmount, currency };
}

export type SetupTestSubscriptionParams = Partial<{
  planName: string;
  variationName: string;
  currency: string;

  /**
   * Used only when pricingType === 'STATIC'.
   * Minor units (e.g., cents).
   */
  priceAmount: number;

  /**
   * Square subscription cadence enum values include ANNUAL, MONTHLY, WEEKLY, DAILY, etc.
   * (Keep as string to allow more values than just ANNUAL|MONTHLY.)
   */
  cadence: 'ANNUAL' | 'MONTHLY' | string;

  /**
   * CatalogItem IDs eligible for this plan.
   * (These are ITEM ids, not ITEM_VARIATION ids.)
   */
  eligibleItemIds: string[];

  /**
   * 'RELATIVE' is the item-based model that typically avoids the Dashboard “Legacy” tag.
   * 'STATIC' is supported, but is often shown as Legacy in Dashboard.
   */
  pricingType: 'RELATIVE' | 'STATIC';
}>;

export async function setupTestSubscription(
  env: Environment,
  params: SetupTestSubscriptionParams
): Promise<{
  subscriptionPlanId: string;
  subscriptionPlanVariationId: string;
  planName: string;
  variationName: string;
  cadence: string;
  priceAmount: number;
  currency: string;
  eligibleItemIds: string[];
  pricingType: 'RELATIVE' | 'STATIC';
}> {
  const planName = params.planName ?? `Test Subscription Plan (${env.envName})`;
  const variationName = params.variationName ?? 'Annual Plan';
  const currency = params.currency ?? DEFAULT_CURRENCY;

  // Keep returning priceAmount for backward compatibility, but only require it for STATIC pricing.
  const priceAmount = params.priceAmount ?? DEFAULT_PRICE_AMOUNT;

  const cadence = params.cadence ?? 'ANNUAL';
  const eligibleItemIds = params.eligibleItemIds ?? [];
  const pricingType: 'RELATIVE' | 'STATIC' = params.pricingType ?? 'RELATIVE';

  if (eligibleItemIds.length === 0) {
    throw new Error('setupTestSubscription requires eligibleItemIds (include at least one CatalogItem id).');
  }

  if (pricingType === 'STATIC' && (priceAmount == null || !Number.isFinite(priceAmount) || priceAmount < 0)) {
    throw new Error('setupTestSubscription: priceAmount must be a non-negative number (minor units) for STATIC pricing.');
  }

  // 1) Create SUBSCRIPTION_PLAN
  const planClientId = randomClientId('TEST_SUB_PLAN');

  const planObject = {
    type: 'SUBSCRIPTION_PLAN',
    id: planClientId,
    present_at_all_locations: true,
    subscription_plan_data: {
      name: planName,
      eligible_item_ids: eligibleItemIds,
      all_items: false
    }
  } as const;

  const planResp = await upsertCatalogObject(env, planObject);
  const subscriptionPlanId = pickMappingId(planResp, planClientId) ?? planResp.catalog_object?.id;

  if (!subscriptionPlanId) {
    throw new Error(`setupTestSubscription: Missing subscription plan id.\nResponse:\n${pretty(planResp)}`);
  }

  // 2) Create SUBSCRIPTION_PLAN_VARIATION linked to plan
  const variationClientId = randomClientId('TEST_SUB_VAR');

  const pricing =
    pricingType === 'RELATIVE'
      ? ({
        type: 'RELATIVE'
        // For RELATIVE pricing, do NOT set `price` here.
        // The subscription’s recurring order template/items determine what’s charged.
      } as const)
      : ({
        type: 'STATIC',
        price: { amount: priceAmount, currency }
      } as const);

  const variationObject = {
    type: 'SUBSCRIPTION_PLAN_VARIATION',
    id: variationClientId,
    present_at_all_locations: true,
    subscription_plan_variation_data: {
      name: variationName,
      subscription_plan_id: subscriptionPlanId,
      phases: [
        {
          cadence,
          ordinal: 0,
          // Omit `periods` for an indefinite (never-ending) final phase.
          pricing
        }
      ]
    }
  } as const;

  const varResp = await upsertCatalogObject(env, variationObject);
  const subscriptionPlanVariationId = pickMappingId(varResp, variationClientId) ?? varResp.catalog_object?.id;

  if (!subscriptionPlanVariationId) {
    throw new Error(`setupTestSubscription: Missing subscription plan variation id.\nResponse:\n${pretty(varResp)}`);
  }

  return {
    subscriptionPlanId,
    subscriptionPlanVariationId,
    planName,
    variationName,
    cadence,
    priceAmount,
    currency,
    eligibleItemIds,
    pricingType
  };
}

export async function setupTestProductAndSub(
  env: Environment,
  params?: Partial<SetupTestProductParams & SetupTestSubscriptionParams>
): Promise<{
  product: Awaited<ReturnType<typeof setupTestProduct>>;
  subscription: Awaited<ReturnType<typeof setupTestSubscription>>;
}> {
  const product = await setupTestProduct(env, params);
  const subscription = await setupTestSubscription(env, {
    planName: params?.planName,
    variationName: params?.variationName,
    cadence: params?.cadence,
    priceAmount: params?.priceAmount ?? product.priceAmount,
    currency: params?.currency ?? product.currency,
    eligibleItemIds: [product.itemId]
  });
  return { product, subscription };
}

//#endregion

//#region CliRunner
async function main(): Promise<void> {
  const env = loadEnvironment();

  await yargs(hideBin(process.argv))
    .scriptName('square-api')
    .strict()
    .demandCommand(1)
    .recommendCommands()

    // -------------------------
    // listLocations
    // -------------------------
    .command(
      'listLocations',
      'List Square location IDs (use one for SQUARE_LOCATION_ID)',
      (y) =>
        y.option('includeInactive', {
          type: 'boolean',
          default: false,
          describe: 'Include inactive locations'
        }),
      async (argv) => {
        const { locations } = await listLocationIds(env, { includeInactive: argv.includeInactive });

        if (locations.length === 0) {
          console.log('No locations returned.');
          return;
        }

        // concise output: ID + name + status + tz
        for (const loc of locations) {
          console.log(
            [
              `id=${loc.id ?? ''}`,
              `name=${loc.name ?? ''}`,
              `status=${loc.status ?? ''}`,
              `timezone=${loc.timezone ?? ''}`,
              `country=${loc.country ?? ''}`
            ]
              .filter(Boolean)
              .join(' | ')
          );
        }
      }
    )
    // -------------------------
    // createCartLink
    // -------------------------
    .command(
      'createCartLink',
      'Create a Square-hosted checkout cart link for a subscription plan variation',
      (y) =>
        y
          .option('locationId', {
            type: 'string',
            demandOption: true,
            describe: 'Id of squarespace location to use (run listLocations for a list)'
          })
          .option('subscriptionPlanVariationId', {
            type: 'string',
            demandOption: true,
            describe: 'Subscription plan variation ID to use for checkout'
          })
          .option('displayName', {
            type: 'string',
            default: 'Subscription',
            describe: 'Display name for quick_pay.name'
          })
          .option('priceAmount', {
            type: 'number',
            demandOption: true,
            describe: 'Quick pay amount in minor units (e.g. 1500 = $15.00)'
          })
          .option('currency', {
            type: 'string',
            default: DEFAULT_CURRENCY,
            describe: 'Currency (e.g. "USD")'
          })
          .option('redirectUrl', {
            type: 'string',
            describe: 'Redirect URL after checkout (optional)'
          }),
      async (argv) => {
        const { paymentLinkId, url } = await createSubscriptionCartLink(env, {
          locationId: argv.locationId,
          subscriptionPlanVariationId: argv.subscriptionPlanVariationId,
          subscriptionDisplayName: argv.displayName,
          priceAmount: argv.priceAmount,
          currency: argv.currency,
          redirectUrl: argv.redirectUrl
        });

        console.log('✅ Payment Link ID:', paymentLinkId);
        console.log('🔗 Checkout URL:', url);
      }
    )

    // -------------------------
    // checkStatus
    // -------------------------
    .command(
      'checkStatus',
      'Check & print subscription status (by subscriptionId or by customerId search)',
      (y) =>
        y
          .option('locationId', {
            type: 'string',
            demandOption: true,
            describe: 'Id of squarespace location to use (run listLocations for a list)'
          })
          .option('subscriptionId', { type: 'string', describe: 'Subscription ID to retrieve' })
          .option('customerId', { type: 'string', describe: 'Customer ID to search subscriptions for' })
          .option('includeActions', { type: 'boolean', default: false, describe: 'Include actions in retrieve' })
          .check((argv) => {
            if (!argv.subscriptionId && !argv.customerId) {
              throw new Error('Provide either --subscriptionId or --customerId');
            }
            return true;
          }),
      async (argv) => {
        const status = await getSubscriptionStatus(env, {
          locationId: argv.locationId,
          subscriptionId: argv.subscriptionId,
          customerId: argv.customerId,
          includeActions: argv.includeActions
        });

        console.log('✅ Status result:');
        console.log(pretty(status));
      }
    )

    // -------------------------
    // setupTestEnv
    // -------------------------
    .command(
      'setupTestEnv',
      'Create a test product + annual subscription plan/variation, then print IDs',
      (y) =>
        y
          .option('createProduct', {
            type: 'boolean',
            default: true,
            describe: 'If true, creates a product first and uses it as eligible_item_ids'
          })
          .option('productId', {
            type: 'string',
            describe: 'If createProduct=false, provide an existing product ITEM id to include in eligible_item_ids'
          })
          .option('planName', { type: 'string', describe: 'Subscription plan name' })
          .option('variationName', { type: 'string', describe: 'Subscription plan variation name' })
          .option('priceAmount', {
            type: 'number',
            default: DEFAULT_PRICE_AMOUNT,
            describe: 'Variation price in minor units'
          })
          .option('currency', {
            type: 'string',
            default: DEFAULT_CURRENCY,
            describe: 'Currency'
          })
          .option('cadence', {
            type: 'string',
            default: 'ANNUAL',
            describe: 'Billing cadence (default ANNUAL)'
          })
          .check((argv) => {
            if (!argv.createProduct && !argv.productId) {
              throw new Error('If --createProduct=false, you must provide --productId');
            }
            return true;
          }),
      async (argv) => {
        let product: Awaited<ReturnType<typeof setupTestProduct>> | undefined;

        let eligibleItemIds: string[];

        if (argv.createProduct) {
          product = await setupTestProduct(env, {
            currency: argv.currency,
            priceAmount: argv.priceAmount
          });
          eligibleItemIds = [product.itemId];
        } else {
          eligibleItemIds = [argv.productId!];
        }

        const sub = await setupTestSubscription(env, {
          planName: argv.planName,
          variationName: argv.variationName,
          cadence: argv.cadence,
          priceAmount: argv.priceAmount,
          currency: argv.currency,
          eligibleItemIds
        });

        console.log('✅ Test environment created:');
        if (product) {
          console.log('🧾 Product ITEM id:', product.itemId);
          console.log('🧾 Product VARIATION id:', product.itemVariationId);
          console.log('🧾 Product name:', product.name);
        } else {
          console.log('🧾 Product ITEM id (provided):', eligibleItemIds[0]);
        }

        console.log('📦 Subscription PLAN id:', sub.subscriptionPlanId);
        console.log('📦 Subscription PLAN VARIATION id:', sub.subscriptionPlanVariationId);
        console.log('📦 Cadence:', sub.cadence);
        console.log('📦 Price:', `${sub.priceAmount} ${sub.currency} (minor units)`);
        console.log('📦 Eligible item ids:', sub.eligibleItemIds.join(', '));
      }
    )
    // -------------------------
    // getOrder
    // -------------------------
    .command(
      'getOrder',
      'Retrieve & print order details by orderId',
      (y) =>
        y.option('orderId', {
          type: 'string',
          demandOption: true,
          describe: 'Square order id'
        }),
      async (argv) => {
        const { order } = await getOrderDetails(env, { orderId: argv.orderId });

        console.log('✅ Order:');
        console.log(pretty(order));
      }
    )

    // -------------------------
    // listOrderIds
    // -------------------------
    .command(
      'listOrderIds',
      'List order ids for a location (optionally filter by customerId/state)',
      (y) =>
        y
          .option('locationId', {
            type: 'string',
            demandOption: true,
            describe: 'Square location id'
          })
          .option('limit', {
            type: 'number',
            default: 50,
            describe: 'Max orders per page (pagination supported via --cursor)'
          })
          .option('cursor', {
            type: 'string',
            describe: 'Cursor for pagination (from previous call)'
          })
          .option('customerId', {
            type: 'string',
            describe: 'Filter orders by customer id'
          })
          .option('state', {
            type: 'string',
            describe: 'Filter by order state (OPEN|COMPLETED|CANCELED)'
          }),
      async (argv) => {
        const { orderIds, cursor } = await listOrderIds(env, {
          locationId: argv.locationId,
          limit: argv.limit,
          cursor: argv.cursor,
          customerId: argv.customerId,
          state: argv.state
        });

        if (orderIds.length === 0) {
          console.log('No orders returned.');
        } else {
          for (const id of orderIds) console.log(id);
        }

        if (cursor) {
          console.log('\n---');
          console.log('Next cursor:', cursor);
          console.log('Run again with: --cursor', cursor);
        }
      }
    )

    .help()
    .wrap(Math.min(120, process.stdout.columns || 120))
    .parseAsync();
}

main().catch((error) => {
  console.error('\n❌ Error:', error?.message || error);
  process.exit(1);
});
//#endregion
