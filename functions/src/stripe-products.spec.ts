/* stripe-products.spec.ts
 *
 * Unit tests for Stripe products catalogue fetching and mapping.
 */

import { describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';
import type * as admin from 'firebase-admin';
import {
  fetchStripeProducts,
  refreshStripeProductCache,
} from './stripe-products';
import { StripeCacheSource } from './stripe-types';

describe('fetchStripeProducts', () => {
  it('should fetch and map products with prices sorted in creation order', async () => {
    const mockProducts = [
      {
        id: 'prod_2',
        name: 'GRADING : Student Levels',
        description: 'Student level grading fee.',
        active: true,
        images: [],
        metadata: {},
        created: 2000,
        updated: 2000,
        default_price: null,
      },
      {
        id: 'prod_1',
        name: 'MEMBERSHIP : Annual',
        description: 'Annual membership.',
        active: true,
        images: ['https://example.com/mem.png'],
        metadata: {},
        created: 1000,
        updated: 1000,
        default_price: null,
      },
    ];

    const mockPrices = [
      {
        id: 'price_stu2',
        product: 'prod_2',
        active: true,
        currency: 'usd',
        unit_amount: 8000,
        type: 'one_time',
        recurring: null,
        nickname: 'Student Level 1',
        created: 2002,
      },
      {
        id: 'price_stu1',
        product: 'prod_2',
        active: true,
        currency: 'usd',
        unit_amount: 6000,
        type: 'one_time',
        recurring: null,
        nickname: 'Entry Level',
        created: 2001,
      },
      {
        id: 'price_mem_sen',
        product: 'prod_1',
        active: true,
        currency: 'usd',
        unit_amount: 5500,
        type: 'recurring',
        recurring: { interval: 'year', interval_count: 1 },
        nickname: 'Annual : 65+ Senior',
        created: 1002,
      },
      {
        id: 'price_mem_reg',
        product: 'prod_1',
        active: true,
        currency: 'usd',
        unit_amount: 8500,
        type: 'recurring',
        recurring: { interval: 'year', interval_count: 1 },
        nickname: 'Annual : Regular',
        created: 1001,
      },
    ];

    const mockStripe = {
      products: {
        list: vi.fn().mockReturnValue({
          autoPagingToArray: vi.fn().mockResolvedValue(mockProducts),
        }),
      },
      prices: {
        list: vi.fn().mockReturnValue({
          autoPagingToArray: vi.fn().mockResolvedValue(mockPrices),
        }),
      },
    } as unknown as Stripe;

    const result = await fetchStripeProducts(mockStripe);

    expect(result.products.length).toBe(2);

    // Products sorted by creation date ascending (prod_1 first, prod_2 second)
    expect(result.products[0].id).toBe('prod_1');
    expect(result.products[0].name).toBe('MEMBERSHIP : Annual');
    expect(result.products[0].prices.map((p) => p.id)).toEqual([
      'price_mem_reg',
      'price_mem_sen',
    ]);
    expect(result.products[0].prices[0].nickname).toBe('Annual : Regular');
    expect(result.products[0].prices[0].type).toBe('recurring');
    expect(result.products[0].prices[0].recurringInterval).toBe('year');

    expect(result.products[1].id).toBe('prod_2');
    expect(result.products[1].name).toBe('GRADING : Student Levels');
    expect(result.products[1].prices.map((p) => p.id)).toEqual([
      'price_stu1',
      'price_stu2',
    ]);
    expect(result.products[1].prices[0].nickname).toBe('Entry Level');
  });
});

describe('refreshStripeProductCache', () => {
  function mockStripeWith(
    products: unknown[],
    prices: unknown[],
  ): Stripe {
    return {
      products: {
        list: vi.fn().mockReturnValue({
          autoPagingToArray: vi.fn().mockResolvedValue(products),
        }),
      },
      prices: {
        list: vi.fn().mockReturnValue({
          autoPagingToArray: vi.fn().mockResolvedValue(prices),
        }),
      },
    } as unknown as Stripe;
  }

  function mockDb() {
    const sets: { path: string; data: unknown; options?: unknown }[] = [];
    const db = {
      collection: (collection: string) => ({
        doc: (docId: string) => ({
          set: (data: unknown, options?: unknown) => {
            sets.push({ path: `${collection}/${docId}`, data, options });
            return Promise.resolve();
          },
        }),
      }),
    } as unknown as admin.firestore.Firestore;
    return { db, sets };
  }

  const sampleProduct = {
    id: 'prod_1',
    name: 'MEMBERSHIP : Annual',
    description: 'Annual membership.',
    active: true,
    images: [],
    metadata: {},
    created: 1000,
    updated: 1000,
    default_price: null,
  };

  const samplePrice = {
    id: 'price_mem_reg',
    product: 'prod_1',
    active: true,
    currency: 'usd',
    unit_amount: 8500,
    type: 'recurring',
    recurring: { interval: 'year', interval_count: 1 },
    nickname: 'Annual : Regular',
    created: 1000,
  };

  it('should write the whole catalogue to /system/stripe-products in one set', async () => {
    const { db, sets } = mockDb();
    const stripe = mockStripeWith([sampleProduct], [samplePrice]);

    const cached = await refreshStripeProductCache(
      stripe,
      db,
      StripeCacheSource.Schedule,
    );

    const catalogueWrite = sets.find(
      (w) => w.path === 'system/stripe-products',
    );
    expect(catalogueWrite).toBeDefined();
    // Written whole, not merged: a removed price must disappear from the cache.
    expect(catalogueWrite?.options).toBeUndefined();

    const data = catalogueWrite?.data as typeof cached;
    expect(data.products.length).toBe(1);
    expect(data.products[0].prices[0].nickname).toBe('Annual : Regular');
    expect(data.source).toBe(StripeCacheSource.Schedule);
    expect(data.lastRefreshed).toBe(cached.lastRefreshed);
  });

  it('should record the refresh in the shared cache metadata', async () => {
    const { db, sets } = mockDb();
    const stripe = mockStripeWith([sampleProduct], [samplePrice]);

    await refreshStripeProductCache(stripe, db, StripeCacheSource.Webhook);

    const metaWrite = sets.find((w) => w.path === 'system/cache-metadata');
    expect(metaWrite?.data).toMatchObject({ stripeProductCount: 1 });
    // Merged, so it does not clobber the blog cache's own statistics.
    expect(metaWrite?.options).toEqual({ merge: true });
  });

  it('should record the source that triggered the refresh', async () => {
    const { db, sets } = mockDb();
    const stripe = mockStripeWith([sampleProduct], [samplePrice]);

    await refreshStripeProductCache(stripe, db, StripeCacheSource.Manual);

    const catalogueWrite = sets.find(
      (w) => w.path === 'system/stripe-products',
    );
    expect((catalogueWrite?.data as { source: string }).source).toBe('manual');
  });

  it('should cache an empty catalogue rather than failing', async () => {
    const { db, sets } = mockDb();
    const stripe = mockStripeWith([], []);

    const cached = await refreshStripeProductCache(
      stripe,
      db,
      StripeCacheSource.Schedule,
    );

    expect(cached.products).toEqual([]);
    const metaWrite = sets.find((w) => w.path === 'system/cache-metadata');
    expect(metaWrite?.data).toMatchObject({ stripeProductCount: 0 });
  });
});
