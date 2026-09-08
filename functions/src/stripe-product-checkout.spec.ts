import { describe, it, expect } from 'vitest';
import { getPricingTierKey, initProduct, Product, AttendeeRole, AttendanceType } from './data-model/events';

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
});


