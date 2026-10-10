/* email-backfill.ts
 *
 * Pure (Firestore-free) planning functions used by the one-off
 * `functions/scripts/normalize-emails.ts` backfill, which rewrites existing
 * data so that every stored email is in its normalised form (trimmed,
 * lower-cased; see data-model/email.ts for the invariant).
 *
 * Each `plan*` function takes the current document data and returns ONLY the
 * fields that need to change (an empty object means "already normalised").
 * Keeping these pure makes the backfill idempotent and unit-testable without
 * an emulator; the script is a thin loop that reads docs, calls these and
 * (only with --apply) writes the result.
 */

import { normalizeEmail, normalizeEmails } from './data-model/email';
import { ACL } from './data-model/system';
import { Member } from './data-model/members';
import { IlcEvent, EventRegistration } from './data-model/events';
import { School } from './data-model/schools';
import { VideoGrant } from './data-model/vod';

// Returns the normalised value of a single stored email string, or undefined
// when it is already normalised (or not a string, which we leave untouched).
function normalizedStringIfChanged(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeEmail(value);
  return normalized === value ? undefined : normalized;
}

// Returns the normalised value of a stored email list (lower-cased, trimmed,
// empties dropped, de-duplicated preserving order), or undefined when it is
// already normalised (or not an array, which we leave untouched).
function normalizedListIfChanged(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((v): v is string => typeof v === 'string');
  const normalized = normalizeEmails(strings);
  return JSON.stringify(normalized) === JSON.stringify(value) ? undefined : normalized;
}

// /members/{docId}: `emails` (identity, used by rules and ACL) and
// `publicEmail` (display contact address).
export function planMemberEmailUpdates(member: Partial<Member>): Partial<Member> {
  const updates: Partial<Member> = {};
  const emails = normalizedListIfChanged(member.emails);
  if (emails) updates.emails = emails;
  const publicEmail = normalizedStringIfChanged(member.publicEmail);
  if (publicEmail !== undefined) updates.publicEmail = publicEmail;
  return updates;
}

// /events/{docId}: derived `ownerEmails`/`managerEmails` (matched by rules)
// and the `updatedByEmail` audit snapshot.
export function planEventEmailUpdates(event: Partial<IlcEvent>): Partial<IlcEvent> {
  const updates: Partial<IlcEvent> = {};
  const ownerEmails = normalizedListIfChanged(event.ownerEmails);
  if (ownerEmails) updates.ownerEmails = ownerEmails;
  const managerEmails = normalizedListIfChanged(event.managerEmails);
  if (managerEmails) updates.managerEmails = managerEmails;
  const updatedByEmail = normalizedStringIfChanged(event.updatedByEmail);
  if (updatedByEmail !== undefined) updates.updatedByEmail = updatedByEmail;
  return updates;
}

// /schools/{docId}: deprecated (but still maintained) owner/manager email arrays.
export function planSchoolEmailUpdates(school: Partial<School>): Partial<School> {
  const updates: Partial<School> = {};
  const ownerEmails = normalizedListIfChanged(school.ownerEmails);
  if (ownerEmails) updates.ownerEmails = ownerEmails;
  const managerEmails = normalizedListIfChanged(school.managerEmails);
  if (managerEmails) updates.managerEmails = managerEmails;
  return updates;
}

// /events/{id}/registrations/{id} and /members/{id}/registrations/{id}:
// attendee `email` (matched by rules for self-read).
export function planRegistrationEmailUpdates(
  registration: Partial<EventRegistration>,
): Partial<EventRegistration> {
  const updates: Partial<EventRegistration> = {};
  const email = normalizedStringIfChanged(registration.email);
  if (email !== undefined) updates.email = email;
  return updates;
}

// /video_grants/{id} and /members/{id}/videoGrants/{id}: `memberEmail`
// (matched by rules) and the `giftedByEmail` snapshot.
export function planVideoGrantEmailUpdates(grant: Partial<VideoGrant>): Partial<VideoGrant> {
  const updates: Partial<VideoGrant> = {};
  const memberEmail = normalizedStringIfChanged(grant.memberEmail);
  if (memberEmail !== undefined) updates.memberEmail = memberEmail;
  const giftedByEmail = normalizedStringIfChanged(grant.giftedByEmail);
  if (giftedByEmail !== undefined) updates.giftedByEmail = giftedByEmail;
  return updates;
}

// Global /video_grants docs for recipients without a member profile are keyed
// `${memberEmail}_${targetId}` (storage.rules looks them up by that path).
// Returns the normalised doc id when the id is email-keyed with a
// non-normalised email prefix, otherwise undefined (no move needed).
export function planVideoGrantDocIdMove(docId: string, memberEmail: string | undefined): string | undefined {
  if (!memberEmail) return undefined;
  const prefix = `${memberEmail}_`;
  if (!docId.startsWith(prefix)) return undefined;
  const normalizedId = `${normalizeEmail(memberEmail)}_${docId.slice(prefix.length)}`;
  return normalizedId === docId ? undefined : normalizedId;
}

// /orders/{docId}: Squarespace/Stripe `customerEmail`, sheets-import `email`
// and the nested `billingAddress.email`. Returns Firestore update paths
// (dotted for nested fields). Safe to write: the order-processing trigger
// ignores email-case-only changes (squarespace-orders/order-change.ts).
// Orders' `lastUpdated` is the order date (used for sorting), so it must NOT be
// bumped by the backfill.
export function planOrderEmailUpdates(order: Record<string, unknown>): Record<string, string> {
  const updates: Record<string, string> = {};
  const customerEmail = normalizedStringIfChanged(order['customerEmail']);
  if (customerEmail !== undefined) updates['customerEmail'] = customerEmail;
  const email = normalizedStringIfChanged(order['email']);
  if (email !== undefined) updates['email'] = email;
  const billing = order['billingAddress'];
  if (billing !== null && typeof billing === 'object') {
    const billingEmail = normalizedStringIfChanged((billing as Record<string, unknown>)['email']);
    if (billingEmail !== undefined) updates['billingAddress.email'] = billingEmail;
  }
  return updates;
}

// Union of two string lists, preserving first-occurrence order.
function union(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

// The latest / most permissive of two expiry values ('life' > latest
// YYYY-MM-DD > ''), matching bestExpiry() in on-member-update.ts.
function laterExpiry(a: string | undefined, b: string | undefined): string {
  let best = '';
  for (const v of [a ?? '', b ?? '']) {
    if (v === 'life') return 'life';
    if (v && v > best) best = v;
  }
  return best;
}

// Merges a legacy ACL doc stored under a non-normalised id (e.g. /acl/Foo@X.com)
// into the ACL doc at the normalised id (/acl/foo@x.com), which may not exist.
// Permissions are unioned (never reduced): memberDocIds/instructorIds/
// schoolDocIds are unioned, isAdmin is OR-ed, expiries take the later value and
// notYetLinkedToMember is only true if both say so. The derived fields are
// recomputed anyway by refreshACLAdminStatus the next time the member changes.
export function mergeAclDocs(legacy: Partial<ACL>, existing: Partial<ACL> | undefined): ACL {
  const merged: ACL = {
    memberDocIds: union(existing?.memberDocIds, legacy.memberDocIds),
    instructorIds: union(existing?.instructorIds, legacy.instructorIds),
    schoolDocIds: union(existing?.schoolDocIds, legacy.schoolDocIds),
    isAdmin: existing?.isAdmin === true || legacy.isAdmin === true,
    membershipExpires: laterExpiry(existing?.membershipExpires, legacy.membershipExpires),
    instructorLicenseExpires: laterExpiry(existing?.instructorLicenseExpires, legacy.instructorLicenseExpires),
    schoolLicenseExpires: laterExpiry(existing?.schoolLicenseExpires, legacy.schoolLicenseExpires),
  };
  // A missing flag means "linked" (rules read it with a `false` default), so
  // the merged doc is only unlinked when every source doc explicitly says so.
  const sources: Partial<ACL>[] = existing ? [legacy, existing] : [legacy];
  if (sources.some((s) => s.notYetLinkedToMember !== undefined)) {
    merged.notYetLinkedToMember = sources.every((s) => s.notYetLinkedToMember === true);
  }
  return merged;
}
