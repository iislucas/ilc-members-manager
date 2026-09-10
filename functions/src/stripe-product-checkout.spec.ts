import { describe, it, expect } from 'vitest';
import {
  getPricingTierKey,
  initProduct,
  Product,
  AttendeeRole,
  AttendanceType,
  hasSpecialRolePrice,
  hasAnySpecialPricing,
} from './data-model/events';

describe('stripe-product-checkout tier resolution', () => {
  it('correctly maps pricing tier keys', () => {
    expect(getPricingTierKey(AttendeeRole.NonMember, AttendanceType.InPerson, false)).toBe('non_member_in_person_novideo');
    expect(getPricingTierKey(AttendeeRole.NonMember, AttendanceType.InPerson, true)).toBe('non_member_in_person_video');
    expect(getPricingTierKey(AttendeeRole.Member, AttendanceType.InPerson, false)).toBe('member_in_person_novideo');
    expect(getPricingTierKey(AttendeeRole.Member, AttendanceType.Online, false)).toBe('member_online_novideo');
    expect(getPricingTierKey(AttendeeRole.Instructor, AttendanceType.VideoOnly, false)).toBe('instructor_video_only');
    expect(getPricingTierKey(AttendeeRole.Instructor, AttendanceType.VideoOnly, true)).toBe('instructor_video_only');
  });

  it('validates product tier configuration fallback logic', () => {
    const product: Product = {
      ...initProduct(),
      docId: 'prod_test_1',
      allowNonMembers: true,
      allowMembers: true,
      allowInPerson: true,
      tiers: {
        non_member_in_person_novideo: { enabled: true, price: 100 },
      },
    };

    // Member with no dedicated member tier falls back to non_member tier
    const memberTierKey = getPricingTierKey(AttendeeRole.Member, AttendanceType.InPerson, false);
    let resolvedTier = product.tiers[memberTierKey];
    if (!resolvedTier || !resolvedTier.enabled) {
      const fallbackKey = getPricingTierKey(AttendeeRole.NonMember, AttendanceType.InPerson, false);
      resolvedTier = product.tiers[fallbackKey];
    }
    expect(resolvedTier).toBeDefined();
    expect(resolvedTier?.price).toBe(100);
  });

  it('validates upgrade delta and entitlement logic', () => {
    // Entitlement check helper reproducing server-side check
    function checkUpgradeEntitlement(
      existing: { attendance: AttendanceType; hasVideoAccess?: boolean },
      requested: { attendance: AttendanceType; includeVideo: boolean },
    ): boolean {
      const addsVideo = Boolean(requested.includeVideo && !existing.hasVideoAccess);
      const hadInPerson =
        existing.attendance === AttendanceType.InPerson ||
        existing.attendance === AttendanceType.InPersonAndOnline;
      const hadOnline =
        existing.attendance === AttendanceType.Online ||
        existing.attendance === AttendanceType.InPersonAndOnline;
      const requestingInPerson =
        requested.attendance === AttendanceType.InPerson ||
        requested.attendance === AttendanceType.InPersonAndOnline;
      const requestingOnline =
        requested.attendance === AttendanceType.Online ||
        requested.attendance === AttendanceType.InPersonAndOnline;
      const addsInPerson = requestingInPerson && !hadInPerson;
      const addsOnline = requestingOnline && !hadOnline;
      const upgradesFromVideoOnly =
        existing.attendance === AttendanceType.VideoOnly &&
        requested.attendance !== AttendanceType.VideoOnly;

      return addsVideo || addsInPerson || addsOnline || upgradesFromVideoOnly;
    }

    // 1. In-person adding video is a valid upgrade
    expect(
      checkUpgradeEntitlement(
        { attendance: AttendanceType.InPerson, hasVideoAccess: false },
        { attendance: AttendanceType.InPerson, includeVideo: true },
      ),
    ).toBe(true);

    // 2. In-person selecting in-person with no video is NOT an upgrade (no new entitlement)
    expect(
      checkUpgradeEntitlement(
        { attendance: AttendanceType.InPerson, hasVideoAccess: false },
        { attendance: AttendanceType.InPerson, includeVideo: false },
      ),
    ).toBe(false);

    // 3. Online upgrading to InPerson is a valid upgrade
    expect(
      checkUpgradeEntitlement(
        { attendance: AttendanceType.Online, hasVideoAccess: false },
        { attendance: AttendanceType.InPerson, includeVideo: false },
      ),
    ).toBe(true);

    // 4. VideoOnly upgrading to live attendance is a valid upgrade
    expect(
      checkUpgradeEntitlement(
        { attendance: AttendanceType.VideoOnly, hasVideoAccess: true },
        { attendance: AttendanceType.InPerson, includeVideo: true },
      ),
    ).toBe(true);

    // 5. Full package (both live + video) cannot add any further entitlement
    expect(
      checkUpgradeEntitlement(
        { attendance: AttendanceType.InPersonAndOnline, hasVideoAccess: true },
        { attendance: AttendanceType.InPersonAndOnline, includeVideo: true },
      ),
    ).toBe(false);
  });

  it('validates video-only pre-order tier keys and constraints', () => {
    // VideoOnly tier keys
    expect(getPricingTierKey(AttendeeRole.NonMember, AttendanceType.VideoOnly, true)).toBe('non_member_video_only');
    expect(getPricingTierKey(AttendeeRole.Member, AttendanceType.VideoOnly, true)).toBe('member_video_only');
    expect(getPricingTierKey(AttendeeRole.Instructor, AttendanceType.VideoOnly, true)).toBe('instructor_video_only');

    const product: Product = {
      ...initProduct(),
      allowVideoOnly: true,
      tiers: {
        non_member_video_only: { enabled: true, price: 45 },
      },
    };

    const key = getPricingTierKey(AttendeeRole.NonMember, AttendanceType.VideoOnly, true);
    expect(product.tiers[key]?.price).toBe(45);
    expect(product.allowVideoOnly).toBe(true);
  });

  it('validates unmark in-person paid registration business logic', () => {
    // Helper replicating unmark validation & state transition
    function unmarkRegistration(reg: {
      status: string;
      paymentMethod?: string;
      amountPaidCents?: number;
      amountDueCents?: number;
    }) {
      if (reg.paymentMethod !== 'in_person') {
        throw new Error('Only in-person door payments can be unmarked.');
      }
      const restoredDue = reg.amountPaidCents || reg.amountDueCents || 0;
      return {
        ...reg,
        status: 'pending_in_person',
        amountDueCents: restoredDue,
        amountPaidCents: 0,
        paidAt: null,
      };
    }

    // 1. Successful unmark of in-person paid registration
    const paidInPerson = {
      status: 'paid',
      paymentMethod: 'in_person',
      amountPaidCents: 6500,
      amountDueCents: 0,
      paidAt: '2026-09-08T10:00:00Z',
    };
    const reverted = unmarkRegistration(paidInPerson);
    expect(reverted.status).toBe('pending_in_person');
    expect(reverted.amountDueCents).toBe(6500);
    expect(reverted.amountPaidCents).toBe(0);
    expect(reverted.paidAt).toBeNull();

    // 2. Safeguard: Stripe online payment throws error
    const paidStripe = {
      status: 'paid',
      paymentMethod: 'stripe',
      amountPaidCents: 6500,
      amountDueCents: 0,
    };
    expect(() => unmarkRegistration(paidStripe)).toThrow('Only in-person door payments can be unmarked.');
  });

  it('calculates credit based on existing tier entitlements when changing attendance', () => {
    const product: Product = {
      ...initProduct(),
      tiers: {
        instructor_in_person_novideo: { enabled: true, price: 90 },
        instructor_in_person_video: { enabled: true, price: 110 },
        instructor_online_novideo: { enabled: true, price: 90 },
        instructor_online_video: { enabled: true, price: 110 },
      },
    };

    function calculateCreditAndDiff(
      existingReg: { role: AttendeeRole; attendance: AttendanceType; hasVideoAccess: boolean; amountPaidCents: number },
      requestedAttendance: AttendanceType,
      requestedIncludeVideo: boolean,
    ) {
      let existingTierPriceInCents = existingReg.amountPaidCents || 0;
      const existingLookupAtt =
        existingReg.attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : existingReg.attendance;
      const existingKey = getPricingTierKey(existingReg.role, existingLookupAtt, Boolean(existingReg.hasVideoAccess));
      const existingTier = product.tiers[existingKey];
      if (existingTier && existingTier.enabled && typeof existingTier.price === 'number') {
        existingTierPriceInCents = Math.round(existingTier.price * 100);
      }
      const creditAppliedCents = Math.max(existingReg.amountPaidCents || 0, existingTierPriceInCents);

      const targetLookupAtt =
        requestedAttendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : requestedAttendance;
      const targetKey = getPricingTierKey(existingReg.role, targetLookupAtt, requestedIncludeVideo);
      const targetTier = product.tiers[targetKey];
      const fullPriceInCents = Math.round((targetTier?.price ?? 0) * 100);
      const upgradeDiffCents = fullPriceInCents - creditAppliedCents;

      return { creditAppliedCents, upgradeDiffCents };
    }

    // Existing attendee paid $90 for in-person with video (before delta price was added)
    const existing = {
      role: AttendeeRole.Instructor,
      attendance: AttendanceType.InPerson,
      hasVideoAccess: true,
      amountPaidCents: 9000,
    };

    // Switching to Online (keeping video)
    const res = calculateCreditAndDiff(existing, AttendanceType.Online, true);
    expect(res.creditAppliedCents).toBe(11000); // Valued at current in-person with video tier ($110)
    expect(res.upgradeDiffCents).toBe(0); // Online with video is $110 -> 0 upgrade difference!
  });
});

describe('hasSpecialRolePrice and hasAnySpecialPricing', () => {
  it('returns false for NonMember role', () => {
    const product: Product = { ...initProduct(), docId: 'p1' };
    expect(hasSpecialRolePrice(product, AttendeeRole.NonMember)).toBe(false);
  });

  it('respects explicit hasMemberPrice / hasInstructorPrice flags', () => {
    const product: Product = {
      ...initProduct(),
      docId: 'p1',
      hasMemberPrice: true,
      hasInstructorPrice: false,
    };
    expect(hasSpecialRolePrice(product, AttendeeRole.Member)).toBe(true);
    expect(hasSpecialRolePrice(product, AttendeeRole.Instructor)).toBe(false);
    expect(hasAnySpecialPricing(product)).toBe(true);

    const product2: Product = {
      ...initProduct(),
      docId: 'p2',
      hasMemberPrice: false,
      hasInstructorPrice: true,
    };
    expect(hasSpecialRolePrice(product2, AttendeeRole.Member)).toBe(false);
    expect(hasSpecialRolePrice(product2, AttendeeRole.Instructor)).toBe(true);
    expect(hasAnySpecialPricing(product2)).toBe(true);

    const product3: Product = {
      ...initProduct(),
      docId: 'p3',
      hasMemberPrice: false,
      hasInstructorPrice: false,
    };
    expect(hasSpecialRolePrice(product3, AttendeeRole.Member)).toBe(false);
    expect(hasSpecialRolePrice(product3, AttendeeRole.Instructor)).toBe(false);
    expect(hasAnySpecialPricing(product3)).toBe(false);
  });

  it('detects special pricing from tiers when flags are undefined or legacy', () => {
    const baseProduct = initProduct();
    delete (baseProduct as Partial<Product>).hasMemberPrice;
    delete (baseProduct as Partial<Product>).hasInstructorPrice;

    // Standard non-member in-person is 100, member is 80
    baseProduct.tiers['non_member_in_person_novideo'] = { enabled: true, price: 100 };
    baseProduct.tiers['member_in_person_novideo'] = { enabled: true, price: 80 };
    baseProduct.tiers['instructor_in_person_novideo'] = { enabled: true, price: 100 }; // same as non-member

    expect(hasSpecialRolePrice(baseProduct, AttendeeRole.Member)).toBe(true);
    expect(hasSpecialRolePrice(baseProduct, AttendeeRole.Instructor)).toBe(false);
    expect(hasAnySpecialPricing(baseProduct)).toBe(true);
  });
});

describe('role authorization verification logic', () => {
  function verifyRoleAuth(
    product: Product,
    role: AttendeeRole,
    member: { hasActiveMembership: boolean; hasActiveLicense: boolean } | undefined,
  ): { allowed: boolean; error?: string } {
    if (!product.allowNonMembers) {
      if (!member || (!member.hasActiveMembership && !member.hasActiveLicense)) {
        return { allowed: false, error: 'Active membership is required to register for this event.' };
      }
    }

    if (role === AttendeeRole.Member) {
      if (hasSpecialRolePrice(product, AttendeeRole.Member)) {
        if (!member || !member.hasActiveMembership) {
          return { allowed: false, error: 'Active membership is required to register at the member rate.' };
        }
      }
    } else if (role === AttendeeRole.Instructor) {
      if (hasSpecialRolePrice(product, AttendeeRole.Instructor)) {
        if (!member || !member.hasActiveLicense) {
          return { allowed: false, error: 'Active instructor license is required to register at the instructor rate.' };
        }
      } else if (hasSpecialRolePrice(product, AttendeeRole.Member)) {
        if (!member || (!member.hasActiveMembership && !member.hasActiveLicense)) {
          return { allowed: false, error: 'Active membership is required to register at the member rate.' };
        }
      }
    }

    return { allowed: true };
  }

  it('allows registration when an instructor has expired license on an event without special instructor price', () => {
    const product: Product = {
      ...initProduct(),
      docId: 'event_no_special_price',
      allowNonMembers: true,
      hasMemberPrice: false,
      hasInstructorPrice: false,
    };

    // Member with expired instructor license and expired membership
    const member = { hasActiveMembership: false, hasActiveLicense: false };

    // Registering with Instructor role on uniform price event should succeed
    const res = verifyRoleAuth(product, AttendeeRole.Instructor, member);
    expect(res.allowed).toBe(true);
  });

  it('rejects registration when an instructor has expired license on an event with special instructor price', () => {
    const product: Product = {
      ...initProduct(),
      docId: 'event_with_instructor_price',
      allowNonMembers: true,
      hasMemberPrice: true,
      hasInstructorPrice: true,
    };

    const member = { hasActiveMembership: true, hasActiveLicense: false };
    const res = verifyRoleAuth(product, AttendeeRole.Instructor, member);
    expect(res.allowed).toBe(false);
    expect(res.error).toBe('Active instructor license is required to register at the instructor rate.');
  });

  it('allows registration when an instructor has expired license but active membership on event with only member discount', () => {
    const product: Product = {
      ...initProduct(),
      docId: 'event_with_member_only_price',
      allowNonMembers: true,
      hasMemberPrice: true,
      hasInstructorPrice: false,
    };

    const member = { hasActiveMembership: true, hasActiveLicense: false };
    const res = verifyRoleAuth(product, AttendeeRole.Instructor, member);
    expect(res.allowed).toBe(true);
  });
});



