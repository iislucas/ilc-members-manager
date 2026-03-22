/**
 * Shared utility for computing "meta-tags" for a member.
 *
 * Meta-tags are synthetic labels derived from membership/instructor status
 * (e.g. "⚠ membership issue", "membership expired"). They mirror exactly the
 * chip labels rendered in `member-row-header.html` so the tag filter in the
 * member list can match them.
 */
import {
  Member,
  MembershipType,
  InstructorLicenseType,
  ExpiryStatus,
} from '../../functions/src/data-model';

// ── helpers (duplicated from MemberRowHeaderComponent to keep this pure) ──

export function getMemberExpiryStatus(member: Member, today: string): ExpiryStatus {
  const type = member.membershipType;
  if (type === MembershipType.Life) return ExpiryStatus.Valid;
  if (type === MembershipType.Inactive || type === MembershipType.Deceased) return ExpiryStatus.Valid;

  const activeTypes: string[] = [MembershipType.Annual, MembershipType.Life];
  if (!activeTypes.includes(type)) return ExpiryStatus.Issue;

  const expires = member.currentMembershipExpires;
  if (!expires) return ExpiryStatus.Issue;
  if (expires >= today) return ExpiryStatus.Valid;

  const expireDate = new Date(expires);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return expireDate >= sixMonthsAgo ? ExpiryStatus.Recent : ExpiryStatus.Expired;
}

export function getInstructorExpiryStatus(member: Member, today: string): ExpiryStatus {
  const expires = member.instructorLicenseExpires;
  if (!expires || member.instructorLicenseType === InstructorLicenseType.Life) return ExpiryStatus.Valid;
  if (expires >= today) return ExpiryStatus.Valid;

  const expireDate = new Date(expires);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return expireDate >= sixMonthsAgo ? ExpiryStatus.Recent : ExpiryStatus.Expired;
}


// ── public API ──────────────────────────────────────────────────────────────

/** Meta-tag label constants (must match the chip text in member-row-header.html). */
export const META_TAG_MEMBERSHIP_ISSUE = '⚠ membership issue';
export const META_TAG_MEMBERSHIP_EXPIRED = 'membership expired';
export const META_TAG_MEMBERSHIP_RECENTLY_EXPIRED = 'recently expired membership';
export const META_TAG_INSTRUCTOR_EXPIRED = 'instructor license expired';
export const META_TAG_INSTRUCTOR_RECENTLY_EXPIRED = 'recently expired instructor license';
export const META_TAG_INACTIVE = 'Inactive';
export const META_TAG_DECEASED = 'Deceased';

/**
 * Returns the set of meta-tags that apply to the given member.
 *
 * These are the same labels shown as identifier-chip / status chips in the
 * member row header.
 */
export function getMemberMetaTags(member: Member, today?: string): string[] {
  const todayStr = today ?? new Date().toISOString().split('T')[0];
  const tags: string[] = [];

  // Inactive / Deceased status
  if (member.membershipType === MembershipType.Inactive) tags.push(META_TAG_INACTIVE);
  if (member.membershipType === MembershipType.Deceased) tags.push(META_TAG_DECEASED);

  // Membership expiry
  const memberExpiry = getMemberExpiryStatus(member, todayStr);
  switch (memberExpiry) {
    case ExpiryStatus.Issue:
      tags.push(META_TAG_MEMBERSHIP_ISSUE);
      break;
    case ExpiryStatus.Recent:
      tags.push(META_TAG_MEMBERSHIP_RECENTLY_EXPIRED);
      break;
    case ExpiryStatus.Expired:
      tags.push(META_TAG_MEMBERSHIP_EXPIRED);
      break;
  }

  // Instructor license expiry
  const instrExpiry = getInstructorExpiryStatus(member, todayStr);
  switch (instrExpiry) {
    case ExpiryStatus.Recent:
      tags.push(META_TAG_INSTRUCTOR_RECENTLY_EXPIRED);
      break;
    case ExpiryStatus.Expired:
      tags.push(META_TAG_INSTRUCTOR_EXPIRED);
      break;
  }

  return tags;
}

/**
 * Returns all tags for a member: their explicit `.tags` array plus any
 * computed meta-tags.
 */
export function getAllMemberTags(member: Member, today?: string): string[] {
  return [...(member.tags || []), ...getMemberMetaTags(member, today)];
}
