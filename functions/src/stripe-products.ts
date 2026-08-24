/**
 * Fetching the Stripe product catalogue and caching it for the client.
 *
 * It fetches every product from the connected Stripe account together with
 * their prices, and maps them into a plain, strongly-typed JSON structure (no
 * `any`). The raw Stripe objects are intentionally not returned — we map only
 * the fields the app needs into stable, self-documenting shapes.
 *
 * There is deliberately no callable that hands the catalogue to the client on
 * request: the client reads the cached copy at /system/stripe-products, so
 * nothing can make the server enumerate Stripe's catalogue on demand. The
 * cache is refreshed on a schedule and on Stripe product/price webhooks, and
 * admins can force a refresh.
 *
 * The Stripe secret key is supplied at runtime via the STRIPE_SECRET_KEY
 * secret; the (non-secret) API version is pinned in environment.ts.
 */

import Stripe from 'stripe';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from './common';
import { getStripeClient, stripeSecretKey } from './stripe-common';
import {
  CachedStripeProducts,
  ListStripeProductsResult,
  StripeCacheSource,
  StripePriceType,
  StripeProduct,
  StripeProductPrice,
  StripeRecurringInterval,
} from './stripe-types';

// Re-export the shared DTOs so existing importers of this module keep working.
export {
  CachedStripeProducts,
  ListStripeProductsResult,
  StripeCacheSource,
  StripePriceType,
  StripeProduct,
  StripeProductPrice,
  StripeRecurringInterval,
} from './stripe-types';

/** Firestore location of the cached catalogue. */
export const STRIPE_PRODUCTS_DOC = { collection: 'system', doc: 'stripe-products' };

function mapPrice(price: Stripe.Price): StripeProductPrice {
  return {
    id: price.id,
    active: price.active,
    currency: price.currency,
    unitAmount: price.unit_amount,
    type: price.type as StripePriceType,
    recurringInterval: (price.recurring?.interval as StripeRecurringInterval) ?? null,
    recurringIntervalCount: price.recurring?.interval_count ?? null,
    nickname: price.nickname,
    created: price.created,
  };
}

/**
 * Core logic, decoupled from the cache wrapper so it can be unit/integration
 * tested directly with a Stripe client built from a test key.
 */
export async function fetchStripeProducts(
  stripe: Stripe,
): Promise<ListStripeProductsResult> {
  // Pull every product (expanding its default price) and every price. Using
  // auto-pagination avoids missing entries when the catalogue exceeds one page.
  const [products, prices] = await Promise.all([
    stripe.products
      .list({ limit: 100, expand: ['data.default_price'] })
      .autoPagingToArray({ limit: 1000 }),
    stripe.prices.list({ limit: 100 }).autoPagingToArray({ limit: 1000 }),
  ]);

  // Sort prices by creation date ascending so price options appear in natural defined order.
  const sortedPrices = [...prices].sort((a, b) => a.created - b.created);

  // Group prices by their product id for quick lookup.
  const pricesByProduct = new Map<string, StripeProductPrice[]>();
  for (const price of sortedPrices) {
    const productId =
      typeof price.product === 'string' ? price.product : price.product.id;
    const list = pricesByProduct.get(productId) ?? [];
    list.push(mapPrice(price));
    pricesByProduct.set(productId, list);
  }

  // Sort products by creation date ascending so products appear in catalog order.
  const sortedProducts = [...products].sort((a, b) => a.created - b.created);

  const mapped: StripeProduct[] = sortedProducts.map((product) => {
    // `default_price` is expanded, so it is either a full Price object, a bare
    // id string (if unexpandable), or null.
    const defaultPrice =
      product.default_price && typeof product.default_price !== 'string'
        ? mapPrice(product.default_price)
        : null;

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      active: product.active,
      images: product.images,
      metadata: product.metadata,
      created: product.created,
      updated: product.updated,
      defaultPrice,
      prices: pricesByProduct.get(product.id) ?? [],
    };
  });

  return { products: mapped };
}

// ------------------------------------------------------------------
// Firestore cache
//
// The purchase pages show their price structure before the visitor has
// signed in, so the catalogue cannot sit behind a callable: it is cached
// at /system/stripe-products and read straight from Firestore. That is
// also the only way the client can see prices — nothing asks the server
// to enumerate the catalogue. It changes a few times a year, so a
// scheduled refresh plus webhook invalidation keeps it fresh cheaply.
// ------------------------------------------------------------------

/**
 * Fetch the catalogue from Stripe and write it to /system/stripe-products,
 * recording the refresh in /system/cache-metadata. Returns the snapshot
 * written so callers can report on it.
 */
export async function refreshStripeProductCache(
  stripe: Stripe,
  db: admin.firestore.Firestore,
  source: StripeCacheSource,
): Promise<CachedStripeProducts> {
  const { products } = await fetchStripeProducts(stripe);
  const cached: CachedStripeProducts = {
    products,
    lastRefreshed: new Date().toISOString(),
    source,
  };

  // The whole catalogue is replaced in one write, so readers never observe a
  // half-updated price list.
  await db
    .collection(STRIPE_PRODUCTS_DOC.collection)
    .doc(STRIPE_PRODUCTS_DOC.doc)
    .set(cached);

  await db
    .collection('system')
    .doc('cache-metadata')
    .set(
      {
        stripeLastRefreshed: cached.lastRefreshed,
        stripeProductCount: products.length,
      },
      { merge: true },
    );

  logger.info('Stripe product cache refreshed', {
    source,
    count: products.length,
  });
  return cached;
}

// Scheduled backstop: webhooks carry most refreshes, this catches anything
// missed (a dropped delivery, a change made while the endpoint was down).
export const refreshStripeProducts = onSchedule(
  { schedule: 'every 6 hours', secrets: [stripeSecretKey] },
  async () => {
    try {
      await refreshStripeProductCache(
        getStripeClient(),
        admin.firestore(),
        StripeCacheSource.Schedule,
      );
    } catch (error) {
      logger.error('Scheduled Stripe product cache refresh failed:', error);
    }
  },
);

// Admin-callable: refresh the catalogue on demand from the settings page.
export const manualRefreshStripeProducts = onCall<
  void,
  Promise<{ success: boolean; productCount: number; lastRefreshed: string }>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  logger.info('manualRefreshStripeProducts called.');
  await assertAdmin(request);

  const cached = await refreshStripeProductCache(
    getStripeClient(),
    admin.firestore(),
    StripeCacheSource.Manual,
  );
  return {
    success: true,
    productCount: cached.products.length,
    lastRefreshed: cached.lastRefreshed,
  };
});
