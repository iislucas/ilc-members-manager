import { InstructorLicenseType } from './curriculum';
import { AttendeeRole } from './events';

export enum MembershipType {
  Annual = 'Annual',
  Life = 'Life',
  Deceased = 'Deceased',
  Inactive = 'Inactive',
  NotYetAMember = 'NotYetAMember',
}

/** The membership fields the active/inactive rules look at. */
export type MembershipFields = {
  membershipType: MembershipType;
  currentMembershipExpires: string;
};

/** Fields needed to check instructor license validity. */
export type InstructorLicenseFields = {
  instructorId?: number | string | null;
  instructorLicenseType?: InstructorLicenseType;
  instructorLicenseExpires?: string;
};

/**
 * The 4 hierarchical member status levels in ILC:
 *
 * 1. Public: anyone, unauthenticated or anonymous visitor.
 * 2. Account: authenticated user with an account (not yet active member).
 * 3. ActiveMember: active ILC member (Annual or Life).
 * 4. ActiveInstructor: active licensed ILC instructor (Annual or Life).
 *
 * Core Invariants:
 * - Every Active Instructor is an Active Member (Level 4 implies Level 3).
 * - Every Active Member is a User with an Account (Level 3 implies Level 2).
 * - Every User with an Account is a Member of the Public (Level 2 implies Level 1).
 * - Permissions follow this flow (higher levels satisfy requirements for lower levels).
 * - Admins bypass and satisfy all status requirements.
 */
export enum MemberStatusLevel {
  Public = 1,
  Account = 2,
  ActiveMember = 3,
  ActiveInstructor = 4,
}

/** Context describing a user or member for status and permission checks. */
export type MemberStatusContext = {
  member?: (Partial<MembershipFields> & Partial<InstructorLicenseFields>) | null;
  hasAccount?: boolean;
  isAdmin?: boolean;
};

export type MemberStatusInput =
  | MemberStatusContext
  | (Partial<MembershipFields> & Partial<InstructorLicenseFields>)
  | null
  | undefined;

/**
 * Returns whether a member is a Life member.
 */
export function isLifeMember(
  member: Partial<MembershipFields> | null | undefined,
): boolean {
  return member?.membershipType === MembershipType.Life;
}

/**
 * Returns whether an instructor holds a Life instructor license.
 */
export function isLifeInstructor(
  member: Partial<InstructorLicenseFields> | null | undefined,
): boolean {
  if (!member || !member.instructorId) return false;
  if (member.instructorLicenseType === InstructorLicenseType.Life) return true;
  const expires = member.instructorLicenseExpires;
  return expires === 'life' || expires === '9999-12-31';
}

/**
 * Whether the member currently has an active instructor license.
 * Requires an instructorId, and either Life license type or an expiration
 * date ('life', '9999-12-31', or >= today).
 */
export function hasActiveInstructorLicense(
  member: (Partial<InstructorLicenseFields>) | null | undefined,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (!member || !member.instructorId) return false;
  if (member.instructorLicenseType === InstructorLicenseType.Life) return true;
  const expires = member.instructorLicenseExpires;
  if (!expires) return false;
  if (expires === 'life' || expires === '9999-12-31') return true;
  return expires >= today;
}

/**
 * Whether the member's ILC membership is active right now.
 *
 * Invariant: Every Active Instructor is an Active Member.
 * Life members always are, Annual members are up to and including `currentMembershipExpires`,
 * and any other type (Inactive, Deceased, NotYetAMember) is inactive unless they hold
 * an active instructor license.
 *
 * `today` is a YYYY-MM-DD string comparing lexicographically with stored dates.
 */
export function hasActiveMembership(
  member: (Partial<MembershipFields> & Partial<InstructorLicenseFields>) | null | undefined,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (!member) return false;
  // Core Invariant: Every Active Instructor is an Active Member
  if (hasActiveInstructorLicense(member, today)) return true;
  if (member.membershipType === MembershipType.Life) return true;
  if (member.membershipType !== MembershipType.Annual) return false;
  const expires = member.currentMembershipExpires;
  return !!expires && expires >= today;
}

/**
 * Resolves the 4-level member status for a given context or member record.
 */
export function getMemberStatusLevel(
  input: MemberStatusInput,
  today: string = new Date().toISOString().split('T')[0],
): MemberStatusLevel {
  if (!input) return MemberStatusLevel.Public;

  let member: (Partial<MembershipFields> & Partial<InstructorLicenseFields>) | null | undefined;
  let hasAccount = false;

  if (typeof input === 'object' && ('member' in input || 'hasAccount' in input || 'isAdmin' in input)) {
    const ctx = input as MemberStatusContext;
    member = ctx.member;
    hasAccount = Boolean(ctx.hasAccount || member);
  } else {
    member = input as Partial<MembershipFields> & Partial<InstructorLicenseFields>;
    hasAccount = true;
  }

  if (hasActiveInstructorLicense(member, today)) {
    return MemberStatusLevel.ActiveInstructor;
  }
  if (hasActiveMembership(member, today)) {
    return MemberStatusLevel.ActiveMember;
  }
  if (hasAccount) {
    return MemberStatusLevel.Account;
  }
  return MemberStatusLevel.Public;
}

/**
 * Checks whether the given user/member context satisfies a required status level.
 *
 * Invariants:
 * - Admins satisfy all levels (isAdmin === true).
 * - Active Instructors (4) satisfy Levels 1, 2, 3, 4.
 * - Active Members (3) satisfy Levels 1, 2, 3.
 * - Users with an Account (2) satisfy Levels 1, 2.
 * - Public (1) satisfies Level 1.
 */
export function satisfiesMemberStatusLevel(
  input: MemberStatusInput,
  requiredLevel: MemberStatusLevel,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (input && typeof input === 'object' && 'isAdmin' in input && input.isAdmin) {
    return true;
  }
  const currentLevel = getMemberStatusLevel(input, today);
  return currentLevel >= requiredLevel;
}

/**
 * Maps the resolved member status to an AttendeeRole.
 */
export function getAttendeeRoleForStatus(
  input: MemberStatusInput,
  today: string = new Date().toISOString().split('T')[0],
): AttendeeRole {
  const level = getMemberStatusLevel(input, today);
  if (level >= MemberStatusLevel.ActiveInstructor) {
    return AttendeeRole.Instructor;
  }
  if (level >= MemberStatusLevel.ActiveMember) {
    return AttendeeRole.Member;
  }
  return AttendeeRole.NonMember;
}

/** Event/product registration permission toggles. */
export interface RegistrationPermissions {
  allowNonMembers?: boolean;
  allowMembers?: boolean;
  allowInstructors?: boolean;
}

/**
 * Checks whether registration is allowed based on product permissions and user role/status.
 *
 * Invariants:
 * - Admins can always register.
 * - allowNonMembers opens registration to Public (Level 1), so everyone is allowed.
 * - allowMembers opens registration to Active Members (Level 3), so Members and Instructors are allowed.
 * - allowInstructors opens registration to Active Instructors (Level 4).
 */
export function isRegistrationAllowed(
  permissions: RegistrationPermissions,
  statusOrRole: MemberStatusInput | AttendeeRole | MemberStatusLevel,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (
    statusOrRole &&
    typeof statusOrRole === 'object' &&
    'isAdmin' in statusOrRole &&
    statusOrRole.isAdmin
  ) {
    return true;
  }

  let level: MemberStatusLevel;
  if (typeof statusOrRole === 'number') {
    level = statusOrRole;
  } else if (typeof statusOrRole === 'string') {
    switch (statusOrRole) {
      case AttendeeRole.Instructor:
        level = MemberStatusLevel.ActiveInstructor;
        break;
      case AttendeeRole.Member:
        level = MemberStatusLevel.ActiveMember;
        break;
      default:
        level = MemberStatusLevel.Public;
        break;
    }
  } else {
    level = getMemberStatusLevel(statusOrRole, today);
  }

  if (permissions.allowNonMembers) {
    return true;
  }
  if (permissions.allowMembers && level >= MemberStatusLevel.ActiveMember) {
    return true;
  }
  if (permissions.allowInstructors && level >= MemberStatusLevel.ActiveInstructor) {
    return true;
  }

  return false;
}

/**
 * Whether a primary instructor may mark this student's membership Inactive
 * (the action offered on the My Students view). Only lapsed memberships
 * qualify: a live membership must never be switched off this way, and someone
 * already recorded as Inactive or Deceased has nothing to change.
 */
export function canMarkMembershipInactive(
  member: (Partial<MembershipFields> & Partial<InstructorLicenseFields>) | null | undefined,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (!member) return false;
  if (
    member.membershipType === MembershipType.Inactive ||
    member.membershipType === MembershipType.Deceased
  ) {
    return false;
  }
  return !hasActiveMembership(member, today);
}

/** Status of a membership or license expiry. */
export enum ExpiryStatus {
  Valid = 'valid',
  Recent = 'recent',
  Expired = 'expired',
  Issue = 'issue',
}

/** Age-based membership category, inferred from date of birth. */
export enum AgeCategory {
  None = '',
  Under21 = 'Under 21',
  Senior = 'Senior',
}

export enum MemberIdUpdateStatus {
  Pending = 'pending',
  Stable = 'stable',
}
