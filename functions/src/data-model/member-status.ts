import { InstructorLicenseType } from './curriculum';
import { AttendeeRole } from './events';

export enum MembershipType {
  Annual = 'Annual',
  Life = 'Life',
  Deceased = 'Deceased',
  Inactive = 'Inactive',
  NotYetAMember = 'NotYetAMember',
}

/** Core membership fields required to evaluate membership status. */
export type MembershipFields = {
  membershipType: MembershipType;
  currentMembershipExpires: string;
};

/** Core instructor fields required to evaluate instructor license validity. */
export type InstructorLicenseFields = {
  instructorId: number | string | null;
  instructorLicenseType: InstructorLicenseType;
  instructorLicenseExpires: string;
};

/** Combined non-partial fields representing full member and instructor status. */
export type MemberStatusFields = MembershipFields & InstructorLicenseFields;

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

/** Non-partial context describing a user or member for status and permission checks. */
export interface MemberStatusContext {
  hasAccount: boolean;
  isAdmin: boolean;
  member: MemberStatusFields | null;
}

/** Public unauthenticated context singleton. */
export const PUBLIC_MEMBER_STATUS_CONTEXT: MemberStatusContext = {
  hasAccount: false,
  isAdmin: false,
  member: null,
};

/**
 * Converts a nullable user/member identity into a concrete non-partial MemberStatusContext.
 */
export function toMemberStatusContext(
  user: { member?: MemberStatusFields | null; isAdmin?: boolean } | null | undefined,
): MemberStatusContext {
  if (!user) {
    return PUBLIC_MEMBER_STATUS_CONTEXT;
  }
  return {
    hasAccount: true,
    isAdmin: Boolean(user.isAdmin),
    member: user.member ?? null,
  };
}

/**
 * Returns whether a member is a Life member.
 */
export function isLifeMember(member: MembershipFields): boolean {
  return member.membershipType === MembershipType.Life;
}

/**
 * Returns whether an instructor holds a Life instructor license.
 */
export function isLifeInstructor(member: InstructorLicenseFields): boolean {
  if (!member.instructorId) return false;
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
  member: InstructorLicenseFields,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (!member.instructorId) return false;
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
  member: MemberStatusFields,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  // Core Invariant: Every Active Instructor is an Active Member
  if (hasActiveInstructorLicense(member, today)) return true;
  if (member.membershipType === MembershipType.Life) return true;
  if (member.membershipType !== MembershipType.Annual) return false;
  const expires = member.currentMembershipExpires;
  return !!expires && expires >= today;
}

/**
 * Resolves the 4-level member status for a given concrete MemberStatusContext.
 */
export function getMemberStatusLevel(
  context: MemberStatusContext,
  today: string = new Date().toISOString().split('T')[0],
): MemberStatusLevel {
  if (context.member && hasActiveInstructorLicense(context.member, today)) {
    return MemberStatusLevel.ActiveInstructor;
  }
  if (context.member && hasActiveMembership(context.member, today)) {
    return MemberStatusLevel.ActiveMember;
  }
  if (context.hasAccount) {
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
  context: MemberStatusContext,
  requiredLevel: MemberStatusLevel,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (context.isAdmin) {
    return true;
  }
  return getMemberStatusLevel(context, today) >= requiredLevel;
}

/**
 * Maps the resolved member status to an AttendeeRole.
 */
export function getAttendeeRoleForStatus(
  context: MemberStatusContext,
  today: string = new Date().toISOString().split('T')[0],
): AttendeeRole {
  const level = getMemberStatusLevel(context, today);
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
  allowNonMembers: boolean;
  allowMembers: boolean;
  allowInstructors: boolean;
}

/**
 * Checks whether registration is allowed based on product permissions and attendee role.
 *
 * Invariants:
 * - allowNonMembers opens registration to Public (Level 1), so everyone is allowed.
 * - allowMembers opens registration to Active Members (Level 3), so Members and Instructors are allowed.
 * - allowInstructors opens registration to Active Instructors (Level 4).
 */
export function isRegistrationAllowed(
  permissions: RegistrationPermissions,
  role: AttendeeRole,
): boolean {
  if (permissions.allowNonMembers) {
    return true;
  }
  if (role === AttendeeRole.Instructor) {
    return permissions.allowInstructors || permissions.allowMembers;
  }
  if (role === AttendeeRole.Member) {
    return permissions.allowMembers;
  }
  return false;
}

/**
 * Checks whether registration is allowed for a given concrete context.
 * Admins are unconditionally allowed; other users resolve to their eligible AttendeeRole.
 */
export function isRegistrationAllowedForContext(
  permissions: RegistrationPermissions,
  context: MemberStatusContext,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (context.isAdmin) {
    return true;
  }
  const role = getAttendeeRoleForStatus(context, today);
  return isRegistrationAllowed(permissions, role);
}

/**
 * Whether a primary instructor may mark this student's membership Inactive
 * (the action offered on the My Students view). Only lapsed memberships
 * qualify: a live membership must never be switched off this way, and someone
 * already recorded as Inactive or Deceased has nothing to change.
 */
export function canMarkMembershipInactive(
  member: MemberStatusFields,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
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
