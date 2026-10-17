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
} from './grading-checkout';
import { findGradingPrice } from './data-model/grading-prices';
import { awardGradingLevel, AwardOutcome } from './award-level';
import { GradingLevel, StudentLevel, ApplicationLevel } from './data-model/curriculum';
import { Grading, GradingStatus, PaymentStatus, initGrading } from './data-model/gradings';
import { initMember, Member } from './data-model/members';
import { StripePriceType, StripeProduct, StripeProductPrice } from './stripe-types';

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
