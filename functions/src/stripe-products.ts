/**
 * Callable cloud function that returns the catalogue of Stripe products.
 *
 * It fetches every product from the connected Stripe account together with
 * their prices, and returns a plain, strongly-typed JSON structure (no `any`).
 * The raw Stripe objects are intentionally not returned — we map only the
 * fields the app needs into stable, self-documenting shapes.
 *
 * The Stripe secret key is supplied at runtime via the STRIPE_SECRET_KEY
 * secret; the (non-secret) API version is pinned in environment.ts.
 */

import Stripe from 'stripe';
import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { allowedOrigins } from './common';
import { getStripeClient, stripeSecretKey } from './stripe-common';
import {
  ListStripeProductsResult,
  StripeProduct,
  StripeProductPrice,
} from './stripe-types';

// Re-export the shared DTOs so existing importers of this module keep working.
export {
  ListStripeProductsResult,
  StripeProduct,
  StripeProductPrice,
} from './stripe-types';

function mapPrice(price: Stripe.Price): StripeProductPrice {
  return {
    id: price.id,
    active: price.active,
    currency: price.currency,
    unitAmount: price.unit_amount,
    type: price.type,
    recurringInterval: price.recurring?.interval ?? null,
    recurringIntervalCount: price.recurring?.interval_count ?? null,
    nickname: price.nickname,
  };
}

/**
 * Core logic, decoupled from the callable wrapper so it can be unit/integration
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

  // Group prices by their product id for quick lookup.
  const pricesByProduct = new Map<string, StripeProductPrice[]>();
  for (const price of prices) {
    const productId =
      typeof price.product === 'string' ? price.product : price.product.id;
    const list = pricesByProduct.get(productId) ?? [];
    list.push(mapPrice(price));
    pricesByProduct.set(productId, list);
  }

  const mapped: StripeProduct[] = products.map((product) => {
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

export const listStripeProducts = onCall<
  void,
  Promise<ListStripeProductsResult>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async () => {
  const stripe = getStripeClient();
  const result = await fetchStripeProducts(stripe);
  logger.info('listStripeProducts returned products', {
    count: result.products.length,
  });
  return result;
});
