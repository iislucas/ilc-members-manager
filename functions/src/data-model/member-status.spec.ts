import { describe, it, expect } from 'vitest';
import {
  MemberStatusLevel,
  getMemberStatusLevel,
  satisfiesMemberStatusLevel,
  getAttendeeRoleForStatus,
  isRegistrationAllowed,
  hasActiveMembership,
  hasActiveInstructorLicense,
  isLifeMember,
  isLifeInstructor,
  MembershipType,
} from './member-status';
import { InstructorLicenseType } from './curriculum';
import { AttendeeRole } from './events';

describe('Member Status & Hierarchy Library', () => {
  const today = '2026-09-25';
  const future = '2027-01-01';
  const past = '2025-01-01';

  const publicUser = null;
  const accountUser = { hasAccount: true };
  const expiredMember = {
    hasAccount: true,
    member: {
      membershipType: MembershipType.Annual,
      currentMembershipExpires: past,
    },
  };
  const activeAnnualMember = {
    hasAccount: true,
    member: {
      membershipType: MembershipType.Annual,
      currentMembershipExpires: future,
    },
  };
  const activeLifeMember = {
    hasAccount: true,
    member: {
      membershipType: MembershipType.Life,
      currentMembershipExpires: '',
    },
  };
  const activeInstructor = {
    hasAccount: true,
    member: {
      instructorId: 'INST-001',
      instructorLicenseExpires: future,
      membershipType: MembershipType.Annual,
      currentMembershipExpires: future,
    },
  };
  const activeLifeInstructor = {
    hasAccount: true,
    member: {
      instructorId: 'INST-002',
      instructorLicenseType: InstructorLicenseType.Life,
      membershipType: MembershipType.Annual,
      currentMembershipExpires: past,
    },
  };
  const adminUser = {
    hasAccount: true,
    isAdmin: true,
  };

  describe('Invariant: Every Active Instructor is an Active Member', () => {
    it('returns true for hasActiveMembership when user has an active instructor license even if membership is expired', () => {
      const instructorWithExpiredMembership = {
        instructorId: 'INST-100',
        instructorLicenseExpires: future,
        membershipType: MembershipType.Annual,
        currentMembershipExpires: past,
      };
      expect(hasActiveInstructorLicense(instructorWithExpiredMembership, today)).toBe(true);
      expect(hasActiveMembership(instructorWithExpiredMembership, today)).toBe(true);
    });

    it('returns true for hasActiveMembership when user has a Life instructor license even if membership is Inactive', () => {
      const lifeInstructorWithInactiveMembership = {
        instructorId: 'INST-101',
        instructorLicenseType: InstructorLicenseType.Life,
        membershipType: MembershipType.Inactive,
        currentMembershipExpires: '',
      };
      expect(hasActiveInstructorLicense(lifeInstructorWithInactiveMembership, today)).toBe(true);
      expect(hasActiveMembership(lifeInstructorWithInactiveMembership, today)).toBe(true);
    });
  });

  describe('getMemberStatusLevel', () => {
    it('resolves Public (1) for unauthenticated / anonymous users', () => {
      expect(getMemberStatusLevel(publicUser, today)).toBe(MemberStatusLevel.Public);
      expect(getMemberStatusLevel(undefined, today)).toBe(MemberStatusLevel.Public);
    });

    it('resolves Account (2) for authenticated users without active membership', () => {
      expect(getMemberStatusLevel(accountUser, today)).toBe(MemberStatusLevel.Account);
      expect(getMemberStatusLevel(expiredMember, today)).toBe(MemberStatusLevel.Account);
    });

    it('resolves ActiveMember (3) for Annual and Life active members', () => {
      expect(getMemberStatusLevel(activeAnnualMember, today)).toBe(MemberStatusLevel.ActiveMember);
      expect(getMemberStatusLevel(activeLifeMember, today)).toBe(MemberStatusLevel.ActiveMember);
    });

    it('resolves ActiveInstructor (4) for active licensed instructors', () => {
      expect(getMemberStatusLevel(activeInstructor, today)).toBe(MemberStatusLevel.ActiveInstructor);
      expect(getMemberStatusLevel(activeLifeInstructor, today)).toBe(MemberStatusLevel.ActiveInstructor);
    });
  });

  describe('satisfiesMemberStatusLevel (Hierarchy & Invariants)', () => {
    it('Admin satisfies all status levels unconditionally', () => {
      expect(satisfiesMemberStatusLevel(adminUser, MemberStatusLevel.Public, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(adminUser, MemberStatusLevel.Account, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(adminUser, MemberStatusLevel.ActiveMember, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(adminUser, MemberStatusLevel.ActiveInstructor, today)).toBe(true);
    });

    it('Active Instructor (Level 4) satisfies all 4 levels', () => {
      expect(satisfiesMemberStatusLevel(activeInstructor, MemberStatusLevel.Public, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(activeInstructor, MemberStatusLevel.Account, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(activeInstructor, MemberStatusLevel.ActiveMember, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(activeInstructor, MemberStatusLevel.ActiveInstructor, today)).toBe(true);
    });

    it('Active Member (Level 3) satisfies Public, Account, and ActiveMember, but not ActiveInstructor', () => {
      expect(satisfiesMemberStatusLevel(activeAnnualMember, MemberStatusLevel.Public, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(activeAnnualMember, MemberStatusLevel.Account, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(activeAnnualMember, MemberStatusLevel.ActiveMember, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(activeAnnualMember, MemberStatusLevel.ActiveInstructor, today)).toBe(false);

      expect(satisfiesMemberStatusLevel(activeLifeMember, MemberStatusLevel.ActiveMember, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(activeLifeMember, MemberStatusLevel.ActiveInstructor, today)).toBe(false);
    });

    it('User with an Account (Level 2) satisfies Public and Account, but not ActiveMember or ActiveInstructor', () => {
      expect(satisfiesMemberStatusLevel(accountUser, MemberStatusLevel.Public, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(accountUser, MemberStatusLevel.Account, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(accountUser, MemberStatusLevel.ActiveMember, today)).toBe(false);
      expect(satisfiesMemberStatusLevel(accountUser, MemberStatusLevel.ActiveInstructor, today)).toBe(false);
    });

    it('Public (Level 1) satisfies Public only', () => {
      expect(satisfiesMemberStatusLevel(publicUser, MemberStatusLevel.Public, today)).toBe(true);
      expect(satisfiesMemberStatusLevel(publicUser, MemberStatusLevel.Account, today)).toBe(false);
      expect(satisfiesMemberStatusLevel(publicUser, MemberStatusLevel.ActiveMember, today)).toBe(false);
      expect(satisfiesMemberStatusLevel(publicUser, MemberStatusLevel.ActiveInstructor, today)).toBe(false);
    });
  });

  describe('getAttendeeRoleForStatus', () => {
    it('maps ActiveInstructor to AttendeeRole.Instructor', () => {
      expect(getAttendeeRoleForStatus(activeInstructor, today)).toBe(AttendeeRole.Instructor);
    });

    it('maps ActiveMember to AttendeeRole.Member', () => {
      expect(getAttendeeRoleForStatus(activeAnnualMember, today)).toBe(AttendeeRole.Member);
      expect(getAttendeeRoleForStatus(activeLifeMember, today)).toBe(AttendeeRole.Member);
    });

    it('maps Account and Public to AttendeeRole.NonMember', () => {
      expect(getAttendeeRoleForStatus(accountUser, today)).toBe(AttendeeRole.NonMember);
      expect(getAttendeeRoleForStatus(publicUser, today)).toBe(AttendeeRole.NonMember);
      expect(getAttendeeRoleForStatus(expiredMember, today)).toBe(AttendeeRole.NonMember);
    });
  });

  describe('isRegistrationAllowed', () => {
    it('allows everyone when allowNonMembers is true', () => {
      const perms = { allowNonMembers: true, allowMembers: false, allowInstructors: false };
      expect(isRegistrationAllowed(perms, publicUser, today)).toBe(true);
      expect(isRegistrationAllowed(perms, accountUser, today)).toBe(true);
      expect(isRegistrationAllowed(perms, activeAnnualMember, today)).toBe(true);
      expect(isRegistrationAllowed(perms, activeInstructor, today)).toBe(true);
      expect(isRegistrationAllowed(perms, AttendeeRole.NonMember, today)).toBe(true);
      expect(isRegistrationAllowed(perms, AttendeeRole.Member, today)).toBe(true);
      expect(isRegistrationAllowed(perms, AttendeeRole.Instructor, today)).toBe(true);
    });

    it('allows members and instructors when allowMembers is true', () => {
      const perms = { allowNonMembers: false, allowMembers: true, allowInstructors: false };
      expect(isRegistrationAllowed(perms, publicUser, today)).toBe(false);
      expect(isRegistrationAllowed(perms, accountUser, today)).toBe(false);
      expect(isRegistrationAllowed(perms, activeAnnualMember, today)).toBe(true);
      expect(isRegistrationAllowed(perms, activeLifeMember, today)).toBe(true);
      // Invariant: Instructor is an Active Member, so instructor is allowed even if allowInstructors is false
      expect(isRegistrationAllowed(perms, activeInstructor, today)).toBe(true);

      expect(isRegistrationAllowed(perms, AttendeeRole.NonMember, today)).toBe(false);
      expect(isRegistrationAllowed(perms, AttendeeRole.Member, today)).toBe(true);
      expect(isRegistrationAllowed(perms, AttendeeRole.Instructor, today)).toBe(true);
    });

    it('allows only instructors when only allowInstructors is true', () => {
      const perms = { allowNonMembers: false, allowMembers: false, allowInstructors: true };
      expect(isRegistrationAllowed(perms, publicUser, today)).toBe(false);
      expect(isRegistrationAllowed(perms, accountUser, today)).toBe(false);
      expect(isRegistrationAllowed(perms, activeAnnualMember, today)).toBe(false);
      expect(isRegistrationAllowed(perms, activeInstructor, today)).toBe(true);

      expect(isRegistrationAllowed(perms, AttendeeRole.NonMember, today)).toBe(false);
      expect(isRegistrationAllowed(perms, AttendeeRole.Member, today)).toBe(false);
      expect(isRegistrationAllowed(perms, AttendeeRole.Instructor, today)).toBe(true);
    });

    it('allows Admin unconditionally even if all allow flags are false', () => {
      const perms = { allowNonMembers: false, allowMembers: false, allowInstructors: false };
      expect(isRegistrationAllowed(perms, adminUser, today)).toBe(true);
    });
  });

  describe('isLifeMember and isLifeInstructor', () => {
    it('correctly identifies Life members', () => {
      expect(isLifeMember({ membershipType: MembershipType.Life })).toBe(true);
      expect(isLifeMember({ membershipType: MembershipType.Annual })).toBe(false);
      expect(isLifeMember(null)).toBe(false);
    });

    it('correctly identifies Life instructors', () => {
      expect(isLifeInstructor({ instructorId: '1', instructorLicenseType: InstructorLicenseType.Life })).toBe(true);
      expect(isLifeInstructor({ instructorId: '1', instructorLicenseExpires: 'life' })).toBe(true);
      expect(isLifeInstructor({ instructorId: '1', instructorLicenseExpires: '9999-12-31' })).toBe(true);
      expect(isLifeInstructor({ instructorId: '1', instructorLicenseExpires: '2027-01-01' })).toBe(false);
      expect(isLifeInstructor({ instructorId: null, instructorLicenseExpires: 'life' })).toBe(false);
    });
  });
});
