/* common.spec.ts — tests for shared membership helpers. */
import { describe, it, expect } from 'vitest';
import { hasActiveMembership, hasActiveInstructorLicense } from './common';
import { Member, MembershipType } from './data-model/members';
import { InstructorLicenseType } from './data-model/curriculum';

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

describe('hasActiveInstructorLicense', () => {
  const today = new Date().toISOString().split('T')[0];
  const future = '2999-01-01';
  const past = '2000-01-01';

  it('is false if member has no instructorId', () => {
    expect(hasActiveInstructorLicense({ instructorId: null, instructorLicenseExpires: future })).toBe(false);
    expect(hasActiveInstructorLicense({ instructorId: 0, instructorLicenseExpires: future })).toBe(false);
    expect(hasActiveInstructorLicense({ instructorId: undefined, instructorLicenseExpires: future })).toBe(false);
  });

  it('is true for Life license type regardless of expiry', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseType: InstructorLicenseType.Life })).toBe(true);
  });

  it('is true for life sentinel string expiry', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: 'life' })).toBe(true);
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: '9999-12-31' })).toBe(true);
  });

  it('is true for future license expiry', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: future })).toBe(true);
  });

  it('is true for license expiring today', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: today })).toBe(true);
  });

  it('is false for expired license', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: past })).toBe(false);
  });

  it('is false for empty license expiry', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: '' })).toBe(false);
  });
});
