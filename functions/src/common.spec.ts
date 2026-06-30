/* common.spec.ts — tests for shared membership helpers. */
import { describe, it, expect } from 'vitest';
import { hasActiveMembership } from './common';
import { Member, MembershipType } from './data-model';

describe('hasActiveMembership', () => {
  const today = new Date().toISOString().split('T')[0];
  const future = '2999-01-01';
  const past = '2000-01-01';

  it('is true for a Life member regardless of expiry', () => {
    const m = { membershipType: MembershipType.Life, currentMembershipExpires: '' } as Member;
    expect(hasActiveMembership(m)).toBe(true);
  });

  it('is true for an Annual member whose membership expires in the future', () => {
    const m = { membershipType: MembershipType.Annual, currentMembershipExpires: future } as Member;
    expect(hasActiveMembership(m)).toBe(true);
  });

  it('is true for an Annual member expiring today', () => {
    const m = { membershipType: MembershipType.Annual, currentMembershipExpires: today } as Member;
    expect(hasActiveMembership(m)).toBe(true);
  });

  it('is false for an Annual member whose membership has expired', () => {
    const m = { membershipType: MembershipType.Annual, currentMembershipExpires: past } as Member;
    expect(hasActiveMembership(m)).toBe(false);
  });

  it('is false for an Annual member with no expiry date', () => {
    const m = { membershipType: MembershipType.Annual, currentMembershipExpires: '' } as Member;
    expect(hasActiveMembership(m)).toBe(false);
  });

  it('is false for non-annual / non-life membership types', () => {
    for (const type of [MembershipType.Inactive, MembershipType.Deceased, MembershipType.NotYetAMember]) {
      const m = { membershipType: type, currentMembershipExpires: future } as Member;
      expect(hasActiveMembership(m)).toBe(false);
    }
  });
});
