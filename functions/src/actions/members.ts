/* members.ts
 *
 * Member domain actions for creating, updating, searching, and managing
 * member accounts with strict schema and referential consistency.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreCollection, FirestoreSubcollection } from '../data-model/collections';
import {
  Member,
  initMember,
  firestoreDocToMember,
  MembershipType,
} from '../data-model/members';
import { StudentLevel, ApplicationLevel } from '../data-model/curriculum';
import { assignNextMemberId } from '../counters';
import { ActionContext, ActionResult } from './types';

/** Parameters for creating a new member record. */
export interface CreateMemberInput {
  name: string;
  email: string;
  countryCode: string;
  emails?: string[];
  memberId?: string;
  phone?: string;
  city?: string;
  country?: string;
  primaryInstructorId?: string;
  primarySchoolId?: string;
  membershipType?: MembershipType;
  currentMembershipExpires?: string;
  firstMembershipStarted?: string;
  dateOfBirth?: string;
  studentLevel?: StudentLevel;
  applicationLevel?: ApplicationLevel;
  notes?: string;
  customDocId?: string;
}

/** Updates allowed on an existing member. */
export type UpdateMemberInput = Partial<Member> & {
  email?: string;
};

/** Search/filter parameters for querying members. */
export interface MemberSearchOptions {
  searchTerm?: string;
  membershipType?: MembershipType;
  primarySchoolId?: string;
  primaryInstructorId?: string;
  countryCode?: string;
  hasInstructorLicense?: boolean;
  limitCount?: number;
}

/**
 * Retrieves a single member by their Firestore document ID.
 */
export async function getMember(
  ctx: ActionContext,
  memberDocId: string,
): Promise<Member | null> {
  if (!memberDocId) return null;
  const docRef = ctx.db.collection(FirestoreCollection.Members).doc(memberDocId);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  return firestoreDocToMember(snap);
}

/**
 * Looks up a member by their public member ID (e.g. 'US402').
 */
export async function getMemberByMemberId(
  ctx: ActionContext,
  memberId: string,
): Promise<Member | null> {
  if (!memberId) return null;
  const snap = await ctx.db
    .collection(FirestoreCollection.Members)
    .where('memberId', '==', memberId.trim().toUpperCase())
    .limit(1)
    .get();

  if (snap.empty) return null;
  return firestoreDocToMember(snap.docs[0]);
}

/**
 * Looks up a member by email address (searches both primary email and additional emails).
 */
export async function getMemberByEmail(
  ctx: ActionContext,
  email: string,
): Promise<Member | null> {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();

  // Search primary email field
  const primarySnap = await ctx.db
    .collection(FirestoreCollection.Members)
    .where('email', '==', cleanEmail)
    .limit(1)
    .get();

  if (!primarySnap.empty) {
    return firestoreDocToMember(primarySnap.docs[0]);
  }

  // Search emails array
  const arraySnap = await ctx.db
    .collection(FirestoreCollection.Members)
    .where('emails', 'array-contains', cleanEmail)
    .limit(1)
    .get();

  if (!arraySnap.empty) {
    return firestoreDocToMember(arraySnap.docs[0]);
  }

  return null;
}

/**
 * Searches and lists members matching criteria.
 */
export async function searchMembers(
  ctx: ActionContext,
  options?: MemberSearchOptions,
): Promise<Member[]> {
  let q = ctx.db.collection(FirestoreCollection.Members).limit(options?.limitCount || 100);

  if (options?.membershipType) {
    q = q.where('membershipType', '==', options.membershipType);
  }
  if (options?.primarySchoolId) {
    q = q.where('primarySchoolId', '==', options.primarySchoolId);
  }
  if (options?.primaryInstructorId) {
    q = q.where('primaryInstructorId', '==', options.primaryInstructorId);
  }
  if (options?.countryCode) {
    q = q.where('countryCode', '==', options.countryCode.toUpperCase());
  }

  const snap = await q.get();
  let results = snap.docs.map(firestoreDocToMember);

  if (options?.hasInstructorLicense) {
    results = results.filter((m) => Boolean(m.instructorId));
  }

  if (options?.searchTerm) {
    const term = options.searchTerm.toLowerCase().trim();
    results = results.filter(
      (m) =>
        m.name.toLowerCase().includes(term) ||
        m.emails.some((e) => e.toLowerCase().includes(term)) ||
        m.memberId.toLowerCase().includes(term),
    );
  }

  return results;
}

/**
 * Creates a new Member with atomic memberId generation and default schema initialization.
 */
export async function createMember(
  ctx: ActionContext,
  input: CreateMemberInput,
): Promise<ActionResult<Member>> {
  if (!input.name?.trim()) {
    return { success: false, error: 'Member name is required.' };
  }
  if (!input.email?.trim()) {
    return { success: false, error: 'Member email is required.' };
  }

  const cleanEmail = input.email.trim().toLowerCase();
  const existing = await getMemberByEmail(ctx, cleanEmail);
  if (existing) {
    return {
      success: false,
      error: `A member with email "${cleanEmail}" already exists (docId: ${existing.docId}, memberId: ${existing.memberId}).`,
    };
  }

  let memberId = input.memberId?.trim().toUpperCase();
  if (!memberId) {
    const country = (input.countryCode || 'US').trim().toUpperCase();
    if (ctx.dryRun) {
      memberId = `${country}999_DRYRUN`;
    } else {
      memberId = await assignNextMemberId(country, ctx.db);
    }
  }

  const nowIso = new Date().toISOString();
  const baseDefaults = initMember();
  const emails = input.emails && input.emails.length > 0 ? input.emails : [cleanEmail];

  const newMember: Member = {
    ...baseDefaults,
    name: input.name.trim(),
    phone: input.phone || '',
    city: input.city || '',
    country: input.country || input.countryCode.toUpperCase(),
    primaryInstructorId: input.primaryInstructorId || '',
    primarySchoolId: input.primarySchoolId || '',
    primarySchoolDocId: '',
    memberId,
    emails,
    studentLevel: input.studentLevel || baseDefaults.studentLevel,
    applicationLevel: input.applicationLevel || baseDefaults.applicationLevel,
    dateOfBirth: input.dateOfBirth || '',
    firstMembershipStarted: input.firstMembershipStarted || '',
    currentMembershipExpires: input.currentMembershipExpires || '',
    membershipType: input.membershipType || MembershipType.Annual,
    lastUpdated: nowIso,
  };

  const colRef = ctx.db.collection(FirestoreCollection.Members);
  const docRef = input.customDocId ? colRef.doc(input.customDocId) : colRef.doc();
  newMember.docId = docRef.id;

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Created member record: ${newMember.name} (${newMember.memberId}) at /members/${docRef.id}`);
    return { success: true, data: newMember, dryRun: true };
  }

  const payload = {
    ...newMember,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete (payload as { docId?: string }).docId;

  await docRef.set(payload);
  ctx.logger?.(`Created member ${newMember.name} (${newMember.memberId}) with docId: ${docRef.id}`);

  return { success: true, data: newMember };
}

/**
 * Updates an existing member document safely, updating timestamps.
 */
export async function updateMember(
  ctx: ActionContext,
  memberDocId: string,
  patch: UpdateMemberInput,
): Promise<ActionResult<Member>> {
  if (!memberDocId) {
    return { success: false, error: 'memberDocId is required.' };
  }

  const existing = await getMember(ctx, memberDocId);
  if (!existing) {
    return { success: false, error: `Member with docId "${memberDocId}" not found.` };
  }

  const patchCopy: Partial<Member> = { ...patch };
  delete (patchCopy as { email?: string }).email;

  const updated: Member = {
    ...existing,
    ...patchCopy,
    docId: memberDocId,
    lastUpdated: new Date().toISOString(),
  };

  // Keep emails array in sync if email was passed in
  if (patch.email && !updated.emails.includes(patch.email.toLowerCase())) {
    updated.emails = Array.from(new Set([...updated.emails, patch.email.toLowerCase()]));
    patchCopy.emails = updated.emails;
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Updated member ${memberDocId}:`, patch);
    return { success: true, data: updated, dryRun: true };
  }

  const docRef = ctx.db.collection(FirestoreCollection.Members).doc(memberDocId);
  const payload: Record<string, unknown> = {
    ...patchCopy,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete payload['docId'];

  await docRef.set(payload, { merge: true });
  ctx.logger?.(`Updated member ${existing.name} (${memberDocId})`);

  return { success: true, data: updated };
}

/**
 * Renews or extends a member's membership, setting expiry date and active type.
 */
export async function renewMembership(
  ctx: ActionContext,
  memberDocId: string,
  options: {
    expirationDate: string;
    membershipType?: MembershipType;
  },
): Promise<ActionResult<Member>> {
  const existing = await getMember(ctx, memberDocId);
  if (!existing) {
    return { success: false, error: `Member with docId "${memberDocId}" not found.` };
  }

  const today = new Date().toISOString().split('T')[0];
  const patch: Partial<Member> = {
    currentMembershipExpires: options.expirationDate,
    membershipType: options.membershipType || MembershipType.Annual,
  };

  if (!existing.firstMembershipStarted) {
    patch.firstMembershipStarted = today;
  }

  return updateMember(ctx, memberDocId, patch);
}

/**
 * Updates a member's primary membership status.
 */
export async function setMemberStatus(
  ctx: ActionContext,
  memberDocId: string,
  membershipType: MembershipType,
): Promise<ActionResult<Member>> {
  return updateMember(ctx, memberDocId, { membershipType });
}

/**
 * Assigns a primary instructor to a student.
 */
export async function assignMemberInstructor(
  ctx: ActionContext,
  studentMemberDocId: string,
  instructorId: string,
): Promise<ActionResult<Member>> {
  return updateMember(ctx, studentMemberDocId, { primaryInstructorId: instructorId });
}

/**
 * Assigns a primary school to a member.
 */
export async function assignMemberSchool(
  ctx: ActionContext,
  memberDocId: string,
  schoolId: string,
): Promise<ActionResult<Member>> {
  return updateMember(ctx, memberDocId, { primarySchoolId: schoolId });
}

/**
 * Schedules account deletion for a member in /members/{id}/deletions.
 */
export async function scheduleMemberAccountDeletion(
  ctx: ActionContext,
  memberDocId: string,
  daysUntilDeletion = 30,
): Promise<ActionResult<{ deletionDate: string }>> {
  const member = await getMember(ctx, memberDocId);
  if (!member) {
    return { success: false, error: `Member "${memberDocId}" not found.` };
  }

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysUntilDeletion);
  const deletionDate = targetDate.toISOString().split('T')[0];

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Scheduled deletion for member ${memberDocId} on ${deletionDate}`);
    return { success: true, data: { deletionDate }, dryRun: true };
  }

  const deletionRef = ctx.db
    .collection(FirestoreCollection.Members)
    .doc(memberDocId)
    .collection(FirestoreSubcollection.Deletions)
    .doc('pending');

  await deletionRef.set({
    memberDocId,
    email: member.emails[0] || '',
    name: member.name,
    scheduledDeletionDate: deletionDate,
    requestedAt: FieldValue.serverTimestamp(),
  });

  return { success: true, data: { deletionDate } };
}

/**
 * Cancels a pending account deletion for a member.
 */
export async function cancelMemberAccountDeletion(
  ctx: ActionContext,
  memberDocId: string,
): Promise<ActionResult<void>> {
  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Cancelled account deletion for member ${memberDocId}`);
    return { success: true, dryRun: true };
  }

  const deletionRef = ctx.db
    .collection(FirestoreCollection.Members)
    .doc(memberDocId)
    .collection(FirestoreSubcollection.Deletions)
    .doc('pending');

  await deletionRef.delete();
  return { success: true };
}
