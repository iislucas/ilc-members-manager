/* grading-checkout.spec.ts
 *
 * Tests for the server-authoritative grading checkout rules: which levels may
 * be bought (`parseRequestedLevels`, `checkLevelsArePurchasable`), how their
 * prices are chosen (`findGradingPrice`, `pricesForLevels`), and the
 * monotonic, transactional level award (`awardGradingLevel`).
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpsError } from 'firebase-functions/v2/https';
import {
  parseRequestedLevels,
  checkLevelsArePurchasable,
  pricesForLevels,
  resolveGradingPrices,
} from './grading-checkout';
import { findGradingPrice } from './data-model/grading-prices';
import { awardGradingLevel, AwardOutcome } from './award-level';
import { GradingLevel, StudentLevel, ApplicationLevel } from './data-model/curriculum';
import { Grading, GradingStatus, PaymentStatus, initGrading } from './data-model/gradings';
import { initMember, Member } from './data-model/members';
import {
  CachedStripeProducts,
  StripeCacheSource,
  StripePriceType,
  StripeProduct,
  StripeProductPrice,
} from './stripe-types';

function price(
  id: string,
  nickname: string | null,
  overrides: Partial<StripeProductPrice> = {},
): StripeProductPrice {
  return {
    id,
    active: true,
    currency: 'usd',
    unitAmount: 8000,
    type: StripePriceType.OneTime,
    recurringInterval: null,
    recurringIntervalCount: null,
    nickname,
    created: 1,
    ...overrides,
  };
}

function product(id: string, name: string, prices: StripeProductPrice[], active = true): StripeProduct {
  return {
    id,
    name,
    description: null,
    active,
    images: [],
    metadata: {},
    created: 1,
    updated: 1,
    defaultPrice: null,
    prices,
  };
}

const catalogue: StripeProduct[] = [
  product('prod_student', 'GRADING : Student Levels', [
    price('price_entry', 'Entry Level'),
    price('price_s1', 'Student Level 1'),
    price('price_s2', 'Student Level 2'),
    price('price_s2_new', 'Student Level 2', { created: 5, unitAmount: 9000 }),
    price('price_s3_off', 'Student Level 3', { active: false }),
    price('price_s4_sub', 'Student Level 4', { type: StripePriceType.Recurring }),
  ]),
  product('prod_app', 'GRADING : Application Levels', [price('price_a1', 'Application Level 1')]),
  // Not a grading product: never used for grading fees.
  product('prod_member', 'Student Membership', [price('price_member', 'Student 1')]),
  product('prod_other', 'GRADING : Additional', [price('price_med', 'Meditation & Philosophy')]),
];

describe('findGradingPrice', () => {
  it('matches the nickname exactly as a grading level', () => {
    expect(findGradingPrice(catalogue, 'Student Entry')?.price.id).toBe('price_entry');
    expect(findGradingPrice(catalogue, 'Application 1')?.price.id).toBe('price_a1');
  });

  it('prefers the most recently created active price for a level', () => {
    expect(findGradingPrice(catalogue, GradingLevel.Student2)?.price.id).toBe('price_s2_new');
  });

  it('ignores inactive, recurring and non-grading-product prices', () => {
    expect(findGradingPrice(catalogue, 'Student 3')).toBeNull();
    expect(findGradingPrice(catalogue, 'Student 4')).toBeNull();
    // 'Student 1' only appears on the non-grading product besides price_s1.
    expect(findGradingPrice(catalogue, 'Student 1')?.price.id).toBe('price_s1');
  });

  it('never matches something that is not a syllabus level', () => {
    expect(findGradingPrice(catalogue, 'Meditation & Philosophy')).toBeNull();
  });
});

describe('parseRequestedLevels', () => {
  it('accepts any spelling of syllabus levels and returns them canonical', () => {
    expect(parseRequestedLevels(['Student Level 2', 'Application 1'])).toEqual([
      GradingLevel.Student2,
      GradingLevel.Application1,
    ]);
  });

  it('rejects empty, oversized, duplicate or non-syllabus requests', () => {
    expect(() => parseRequestedLevels([])).toThrow(HttpsError);
    expect(() => parseRequestedLevels('Student 2')).toThrow(HttpsError);
    expect(() => parseRequestedLevels(new Array(19).fill('Student 2'))).toThrow(HttpsError);
    expect(() => parseRequestedLevels(['Student 2', 'Student Level 2'])).toThrow(HttpsError);
    expect(() => parseRequestedLevels(['Good Hands'])).toThrow(/student and application/);
  });
});

describe('checkLevelsArePurchasable', () => {
  const member: Member = {
    ...initMember(),
    docId: 'm1',
    studentLevel: StudentLevel.Level1,
    applicationLevel: ApplicationLevel.None,
  };
  const grading = (overrides: Partial<Grading>): Grading => ({ ...initGrading(), ...overrides });

  it('accepts the next levels in order', () => {
    expect(() =>
      checkLevelsArePurchasable(member, [], [GradingLevel.Student2, GradingLevel.Student3]),
    ).not.toThrow();
  });

  it('rejects skipping a level, a wrong order, or a level already bought', () => {
    expect(() => checkLevelsArePurchasable(member, [], [GradingLevel.Student3])).toThrow(
      /Student 2/,
    );
    expect(() =>
      checkLevelsArePurchasable(member, [], [GradingLevel.Student3, GradingLevel.Student2]),
    ).toThrow(HttpsError);
    const bought = grading({
      level: GradingLevel.Student2,
      status: GradingStatus.AwaitingRequest,
      paymentStatus: PaymentStatus.PaidByStripe,
    });
    expect(() => checkLevelsArePurchasable(member, [bought], [GradingLevel.Student2])).toThrow(
      HttpsError,
    );
    expect(() => checkLevelsArePurchasable(member, [bought], [GradingLevel.Student3])).not.toThrow();
  });

  it('skips a free retake level, as the purchase page does', () => {
    const failed = grading({
      level: GradingLevel.Student2,
      status: GradingStatus.NotPassed,
      paymentStatus: PaymentStatus.PaidByStripe,
    });
    expect(() => checkLevelsArePurchasable(member, [failed], [GradingLevel.Student3])).not.toThrow();
    expect(() => checkLevelsArePurchasable(member, [failed], [GradingLevel.Student2])).toThrow(
      HttpsError,
    );
  });
});

describe('pricesForLevels', () => {
  it('returns the server-chosen price for each level', () => {
    expect(
      pricesForLevels(catalogue, [GradingLevel.Student1, GradingLevel.Student2]).map((p) => p.price.id),
    ).toEqual(['price_s1', 'price_s2_new']);
  });

  it('refuses levels without a price', () => {
    expect(() => pricesForLevels(catalogue, [GradingLevel.Student3])).toThrow(/Student 3/);
  });

  it('refuses mixed currencies', () => {
    const mixed = [
      product('prod_student', 'GRADING : Student Levels', [
        price('price_s1', 'Student Level 1'),
        price('price_s2', 'Student Level 2', { currency: 'eur' }),
      ]),
    ];
    expect(() => pricesForLevels(mixed, [GradingLevel.Student1, GradingLevel.Student2])).toThrow(
      /different currencies/,
    );
  });
});

describe('awardGradingLevel', () => {
  // A minimal Firestore stand-in whose transaction reads and writes one member.
  function fakeDb(member: Partial<Member> | undefined) {
    const update = vi.fn();
    const ref = { id: 'm1' } as never;
    const db = {
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({
          get: async () => ({ exists: !!member, data: () => member }),
          update,
        }),
    } as never;
    return { db, ref, update };
  }

  it('raises the level on the right track', async () => {
    const { db, ref, update } = fakeDb({ studentLevel: StudentLevel.Level2 });
    expect(await awardGradingLevel(db, ref, GradingLevel.Student3)).toBe(AwardOutcome.Raised);
    expect(update).toHaveBeenCalledWith(ref, expect.objectContaining({ studentLevel: '3' }));

    const app = fakeDb({ applicationLevel: ApplicationLevel.None });
    expect(await awardGradingLevel(app.db, app.ref, GradingLevel.Application1)).toBe(AwardOutcome.Raised);
    expect(app.update).toHaveBeenCalledWith(app.ref, expect.objectContaining({ applicationLevel: '1' }));
  });

  it('never lowers a level (a late award for an earlier grading is a no-op)', async () => {
    const { db, ref, update } = fakeDb({ studentLevel: StudentLevel.Level3 });
    expect(await awardGradingLevel(db, ref, GradingLevel.Student2)).toBe(AwardOutcome.AlreadyHeld);
    expect(update).not.toHaveBeenCalled();
  });

  it('compares legacy spellings correctly', async () => {
    const { db, ref, update } = fakeDb({ studentLevel: 'Student Level 3' as never });
    expect(await awardGradingLevel(db, ref, GradingLevel.Student3)).toBe(AwardOutcome.AlreadyHeld);
    expect(update).not.toHaveBeenCalled();
  });

  it('reports a missing member', async () => {
    const { db, ref } = fakeDb(undefined);
    expect(await awardGradingLevel(db, ref, GradingLevel.Student1)).toBe(AwardOutcome.MemberNotFound);
  });
});

describe('resolveGradingPrices', () => {
  function fakeCacheDb(initialCache?: CachedStripeProducts) {
    let stored: CachedStripeProducts | undefined = initialCache;
    const set = vi.fn(async (data: unknown) => {
      if (data && typeof data === 'object' && 'products' in (data as Record<string, unknown>)) {
        stored = data as CachedStripeProducts;
      }
    });
    const db = {
      collection: (col: string) => ({
        doc: (docId: string) => ({
          get: async () => ({
            exists: col === 'system' && docId === 'stripe-products' && !!stored,
            data: () => (col === 'system' && docId === 'stripe-products' ? stored : undefined),
          }),
          set,
        }),
      }),
    } as never;
    return { db, set, getStored: () => stored };
  }

  function fakeLiveStripe() {
    const listProducts = vi.fn(() => ({
      autoPagingToArray: async () => [
        {
          id: 'prod_student',
          name: 'GRADING : Student Levels',
          description: null,
          active: true,
          images: [],
          metadata: {},
          created: 1,
          updated: 1,
          default_price: null,
        },
      ],
    }));
    const listPrices = vi.fn(() => ({
      autoPagingToArray: async () => [
        {
          id: 'price_s1_live',
          product: 'prod_student',
          active: true,
          currency: 'usd',
          unit_amount: 8000,
          type: 'one_time',
          recurring: null,
          nickname: 'Student Level 1',
          created: 10,
        },
        {
          id: 'price_s3_live',
          product: 'prod_student',
          active: true,
          currency: 'usd',
          unit_amount: 8000,
          type: 'one_time',
          recurring: null,
          nickname: 'Student Level 3',
          created: 11,
        },
      ],
    }));
    return {
      stripe: { products: { list: listProducts }, prices: { list: listPrices } } as never,
      listProducts,
      listPrices,
    };
  }

  it('uses /system/stripe-products without enumerating Stripe when the cache has the price', async () => {
    const { db } = fakeCacheDb({
      products: catalogue,
      lastRefreshed: '2026-11-01T00:00:00.000Z',
      source: StripeCacheSource.Schedule,
    });
    const { stripe, listProducts, listPrices } = fakeLiveStripe();

    const result = await resolveGradingPrices(db, stripe, [GradingLevel.Student1]);

    expect(result.prices.map((p) => p.price.id)).toEqual(['price_s1']);
    expect(result.freshlyFetched).toBe(false);
    expect(listProducts).not.toHaveBeenCalled();
    expect(listPrices).not.toHaveBeenCalled();
  });

  it('populates the cache from Stripe when /system/stripe-products does not exist yet', async () => {
    const { db, getStored } = fakeCacheDb(undefined);
    const { stripe, listProducts } = fakeLiveStripe();

    const result = await resolveGradingPrices(db, stripe, [GradingLevel.Student1]);

    expect(result.prices.map((p) => p.price.id)).toEqual(['price_s1_live']);
    expect(result.freshlyFetched).toBe(true);
    expect(listProducts).toHaveBeenCalledTimes(1);
    expect(getStored()?.source).toBe(StripeCacheSource.CheckoutFallback);
  });

  it('refreshes a stale cache once when a newly added grading price is missing from cache', async () => {
    // In `catalogue`, Student 3 is inactive, so pricesForLevels(catalogue, [Student3]) fails;
    // the live Stripe mock has an active `price_s3_live`.
    const { db } = fakeCacheDb({
      products: catalogue,
      lastRefreshed: new Date(Date.now() - 120_000).toISOString(),
      source: StripeCacheSource.Schedule,
    });
    const { stripe, listProducts } = fakeLiveStripe();

    const result = await resolveGradingPrices(db, stripe, [GradingLevel.Student3]);

    expect(result.prices.map((p) => p.price.id)).toEqual(['price_s3_live']);
    expect(result.freshlyFetched).toBe(true);
    expect(listProducts).toHaveBeenCalledTimes(1);
  });

  it('does not re-enumerate Stripe when the cache was refreshed within the cooldown window', async () => {
    const { db } = fakeCacheDb({
      products: catalogue,
      lastRefreshed: new Date().toISOString(),
      source: StripeCacheSource.CheckoutFallback,
    });
    const { stripe, listProducts } = fakeLiveStripe();

    await expect(resolveGradingPrices(db, stripe, [GradingLevel.Student3])).rejects.toThrow(
      /Student 3/,
    );
    expect(listProducts).not.toHaveBeenCalled();
  });
});
