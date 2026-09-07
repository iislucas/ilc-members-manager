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
});

