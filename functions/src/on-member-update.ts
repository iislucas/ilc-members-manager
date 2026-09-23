import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
// Use the modular FieldValue export rather than `admin.firestore.FieldValue`:
// the namespaced accessor is `undefined` inside the Functions emulator runtime,
// which crashes trigger writes that use serverTimestamp()/arrayUnion(). The
// named import works in both the emulator and production. (Same fix as
// on-grading-update.ts.)
import { FieldValue } from 'firebase-admin/firestore';
import { Grading, gradingManagerIdsOf } from './data-model/gradings';
import { Member, MembershipType } from './data-model/members';
import { NotificationKind } from './data-model/notifications';
import { ACL } from './data-model/system';
import { mirrorGradingToInstructor, removeGradingFromInstructor } from './on-grading-update';
import { createMemberNotification } from './notifications';
import { updateMemberViewForSchoolAndInstrucor } from './mirror-members-to-school-and-instructor-views';
import { updateInstructorPublicProfile } from './mirror-instructors-to-public-profile';
import { ensureCountersAreAtLeast } from './counters';
import { FirestoreUpdate, recordTombstone } from './common';
import * as logger from 'firebase-functions/logger';
import { environment } from './environment/environment.js';
import { sendTransactionalEmail, TransactionalEmailKey } from './email-dispatcher.js';

const getDb = () => admin.firestore();

export async function updateACL(aclUpdate: {
  previous?: Member;
  member?: Member;
}) {
  const { previous, member } = aclUpdate;
  if (!previous && !member) {
    logger.error(`updateACL called without member or previous member`);
    return;
  }
  const memberDocId = member?.docId || previous?.docId;

  const emails = (member?.emails || [])
    .filter(Boolean)
    .map((e) => e.trim().toLowerCase());
  const instructorId = member?.instructorId;

  const previousEmails = (previous?.emails || [])
    .filter(Boolean)
    .map((e) => e.trim().toLowerCase());
  const previousInstructorId = previous?.instructorId;
  const added = emails.filter((e) => !previousEmails.includes(e));
  const removed = previousEmails.filter((e) => !emails.includes(e));

  const isAdminChanged = member?.isAdmin !== previous?.isAdmin;
  const instructorIdChanged = instructorId !== previousInstructorId;
  const membershipTypeChanged = member?.membershipType !== previous?.membershipType;
  const membershipExpiresChanged = member?.currentMembershipExpires !== previous?.currentMembershipExpires;
  const instructorLicenseTypeChanged = member?.instructorLicenseType !== previous?.instructorLicenseType;
  const instructorLicenseExpiresChanged = member?.instructorLicenseExpires !== previous?.instructorLicenseExpires;

  if (
    added.length === 0 &&
    removed.length === 0 &&
    !isAdminChanged &&
    !instructorIdChanged &&
    !membershipTypeChanged &&
    !membershipExpiresChanged &&
    !instructorLicenseTypeChanged &&
    !instructorLicenseExpiresChanged
  ) {
    return;
  }

  const batch = getDb().batch();

  for (const email of added) {
    if (!email) continue;
    const aclRef = getDb().collection('acl').doc(email);
    const aclSnap = await aclRef.get();
    // Security check: If target ACL is an admin account, never attach a non-admin member document to it
    if (aclSnap.exists && aclSnap.data()?.isAdmin === true && !member?.isAdmin) {
      logger.warn(
        `Security violation: Non-admin member ${memberDocId} attempted to link to admin ACL ${email}. Ignored.`,
      );
      continue;
    }
    const update: FirestoreUpdate<ACL> = {
      memberDocIds: FieldValue.arrayUnion(memberDocId),
    };
    if (member?.isAdmin) {
      update.isAdmin = true;
    }
    batch.set(aclRef, update, { merge: true });
  }

  for (const email of removed) {
    if (!email) continue;
    const aclRef = getDb().collection('acl').doc(email);
    const update: FirestoreUpdate<ACL> = {
      memberDocIds: FieldValue.arrayRemove(memberDocId),
    };
    batch.update(aclRef, update);
  }

  if (added.length > 0 || removed.length > 0) {
    await batch.commit();
  }

  // Recalculate isAdmin and instructorIds for all affected emails
  const allAffected = [...new Set([...emails, ...previousEmails])];
  for (const email of allAffected) {
    if (email) {
      await refreshACLAdminStatus(email);
    }
  }
}

// Returns the membership expiry string for a member profile:
// "life" for Life members, the YYYY-MM-DD expiry date for Annual,
// or "" for anything else (Inactive, Deceased, NotYetAMember, etc.).
function getMembershipExpiry(data: FirebaseFirestore.DocumentData): string {
  const type = data.membershipType;
  if (type === 'Life') return 'life';
  if (type === 'Annual') return data.currentMembershipExpires || '';
  return '';
}

// Returns the instructor license expiry string for a member profile:
// "life" for Life license, the YYYY-MM-DD expiry date for Annual,
// or "" if not an instructor or no license.
function getInstructorLicenseExpiry(data: FirebaseFirestore.DocumentData): string {
  if (!data.instructorId) return '';
  const type = data.instructorLicenseType;
  if (type === 'Life') return 'life';
  if (type === 'Annual') return data.instructorLicenseExpires || '';
  return '';
}

// Returns the "best" (latest / most permissive) expiry across values.
// "life" always wins, then the latest YYYY-MM-DD string, then "".
export function bestExpiry(values: string[]): string {
  let best = '';
  for (const v of values) {
    if (v === 'life') return 'life';
    // YYYY-MM-DD strings sort lexicographically by date, so > works.
    if (v && v > best) best = v;
  }
  return best;
}

// Returns the school document IDs and best school license expiry
// across all schools the user owns or manages, identified by their instructorIds
// and memberDocIds.
async function getSchoolInfo(
  instructorIds: string[],
  memberDocIds: string[] = [],
): Promise<{ docIds: string[]; expiry: string }> {
  const validInstructorIds = instructorIds
    .map((id) => String(id || '').trim().toUpperCase())
    .filter((id) => !!id);
  const validMemberDocIds = memberDocIds.filter((id) => !!id);
  if (validInstructorIds.length === 0 && validMemberDocIds.length === 0) {
    return { docIds: [], expiry: '' };
  }

  const docIdSet = new Set<string>();
  const expiries: string[] = [];

  // Query schools where this user is the owner by instructorId.
  for (const instId of validInstructorIds) {
    const ownerSnap = await getDb()
      .collection('schools')
      .where('ownerInstructorId', '==', instId)
      .get();
    for (const doc of ownerSnap.docs) {
      docIdSet.add(doc.id);
      expiries.push(doc.data().schoolLicenseExpires || 'life');
    }
  }

  // Query schools where this user is the owner by ownerMemberDocId.
  for (const mDocId of validMemberDocIds) {
    const ownerSnap = await getDb()
      .collection('schools')
      .where('ownerMemberDocId', '==', mDocId)
      .get();
    for (const doc of ownerSnap.docs) {
      docIdSet.add(doc.id);
      expiries.push(doc.data().schoolLicenseExpires || 'life');
    }
  }

  // Query schools where this user is a manager.
  for (const instId of validInstructorIds) {
    const managerSnap = await getDb()
      .collection('schools')
      .where('managerInstructorIds', 'array-contains', instId)
      .get();
    for (const doc of managerSnap.docs) {
      docIdSet.add(doc.id);
      expiries.push(doc.data().schoolLicenseExpires || 'life');
    }
  }

  return { docIds: Array.from(docIdSet), expiry: bestExpiry(expiries) };
}

export async function refreshACLAdminStatus(email: string) {
  const cleanEmail = email.trim().toLowerCase();
  const aclRef = getDb().collection('acl').doc(cleanEmail);
  const aclSnap = await aclRef.get();

  if (!aclSnap.exists) return;

  const data = aclSnap.data() as ACL;
  if (!data.memberDocIds || data.memberDocIds.length === 0) {
    if (data.isAdmin === true) {
      return;
    }
    await aclRef.delete();
    return;
  }

  const memberRefs = data.memberDocIds.map((memberDocId: string) =>
    getDb().collection('members').doc(memberDocId),
  );
  let memberSnaps: admin.firestore.DocumentSnapshot[] = [];
  if (memberRefs.length > 0) {
    memberSnaps = await getDb().getAll(...memberRefs);
  }

  const anyAdmin = memberSnaps.some(
    (snap: admin.firestore.DocumentSnapshot) =>
      snap.exists && snap.data()?.isAdmin === true,
  );

  const anyFullMember = memberSnaps.some(
    (snap: admin.firestore.DocumentSnapshot) =>
      snap.exists && snap.data()?.membershipType !== 'NotYetAMember',
  );

  // Compute the best (latest / most permissive) expiry dates across
  // all linked member profiles.
  const membershipExpiries: string[] = [];
  const instructorExpiries: string[] = [];
  const newInstructorIds = new Set<string>();

  for (const snap of memberSnaps) {
    if (!snap.exists) continue;
    const d = snap.data()!;
    membershipExpiries.push(getMembershipExpiry(d));
    instructorExpiries.push(getInstructorLicenseExpiry(d));
    if (d.instructorId) {
      newInstructorIds.add(d.instructorId);
    }
  }

  // Look up school info (docIds + license expiry) for all instructor IDs and memberDocIds this user has.
  const schoolInfo = await getSchoolInfo(
    Array.from(newInstructorIds),
    data.memberDocIds || [],
  );

  await aclRef.update({
    isAdmin: anyAdmin,
    instructorIds: Array.from(newInstructorIds),
    schoolDocIds: schoolInfo.docIds,
    notYetLinkedToMember: !anyFullMember,
    membershipExpires: bestExpiry(membershipExpiries),
    instructorLicenseExpires: bestExpiry(instructorExpiries),
    schoolLicenseExpires: schoolInfo.expiry,
  });
}

async function mirrorGradingsForSifuChange(
  memberDocId: string,
  previousSifu: string | undefined,
  currentSifu: string | undefined,
) {
  const cleanPrevSifu = previousSifu ? previousSifu.trim().toUpperCase() : undefined;
  const cleanCurrSifu = currentSifu ? currentSifu.trim().toUpperCase() : undefined;
  if (cleanPrevSifu === cleanCurrSifu) return;
  if (!cleanPrevSifu && !cleanCurrSifu) return;

  const gradingsSnap = await getDb().collection('gradings')
    .where('studentMemberDocId', '==', memberDocId)
    .get();

  if (gradingsSnap.empty) return;

  const gradings = gradingsSnap.docs.map(d => {
    const data = d.data() as Grading;
    data.docId = d.id;
    return data;
  });

  for (const grading of gradings) {
    if (cleanPrevSifu) {
      const assessors = [grading.gradingInstructorId, ...gradingManagerIdsOf(grading)];
      if (!assessors.includes(cleanPrevSifu)) {
        await removeGradingFromInstructor(grading.docId, cleanPrevSifu);
      }
    }
    if (cleanCurrSifu) {
      await mirrorGradingToInstructor(grading.docId, grading, cleanCurrSifu);
    }
  }
}

async function populateInstructorMembers(instructorDocId: string, instructorId: string) {
  const cleanId = String(instructorId || '').trim().toUpperCase();
  if (!cleanId) return;
  const snapshot = await getDb().collection('members').where('primaryInstructorId', '==', cleanId).get();

  const chunks: admin.firestore.WriteBatch[] = [];
  let i = 0;
  snapshot.docs.forEach((doc) => {
    if (i % 500 === 0) chunks.push(getDb().batch());
    const batch = chunks[chunks.length - 1];
    const ref = getDb().collection('instructors').doc(instructorDocId).collection('members').doc(doc.id);
    batch.set(ref, doc.data());
    i++;
  });

  for (const batch of chunks) {
    await batch.commit();
  }
}



export async function cleanUpPendingNotifications(
  db: admin.firestore.Firestore,
  memberDocId: string,
  kinds: NotificationKind[]
) {
  const notifications = db
    .collection('members')
    .doc(memberDocId)
    .collection('notifications');

  for (const kind of kinds) {
    const snap = await notifications.where('kind', '==', kind).get();
    if (!snap.empty) {
      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
  }
}

export async function sendTemplateEmail(
  db: admin.firestore.Firestore,
  toEmails: string[],
  templateKey: TransactionalEmailKey.MembershipActivated | TransactionalEmailKey.InstructorLicenseActivated,
  replacements: Record<string, string>,
) {
  await sendTransactionalEmail(db, {
    to: toEmails,
    templateKey,
    replacements,
  });
}

export async function handleMembershipActivation(
  db: admin.firestore.Firestore,
  member: Member,
  previous?: Member
) {
  const isNowActive =
    (member.membershipType === MembershipType.Annual || member.membershipType === MembershipType.Life) &&
    (!previous || (previous.membershipType !== MembershipType.Annual && previous.membershipType !== MembershipType.Life));

  if (isNowActive) {
    await cleanUpPendingNotifications(db, member.docId, [NotificationKind.MembershipPending]);

    await createMemberNotification(db, member.docId, {
      kind: NotificationKind.MembershipActivated,
      markdown: `Welcome to the I Liq Chuan family! Your membership is now active. You can now access the [Active Members Area](/members-area) to read the blog, view classes, and more.`,
      createdAt: new Date().toISOString(),
      dismissed: false,
      data: {}
    });

    try {
      await sendTemplateEmail(db, member.emails || [], TransactionalEmailKey.MembershipActivated, {
        name: member.name || 'ILC Member',
        memberId: member.memberId || '',
        email: (member.emails || [])[0] || '',
        appBase: environment.links.appBase,
      });
    } catch (error) {
      logger.error(`Failed to enqueue welcome email for member ${member.docId}:`, error);
    }
  }
}

export async function handleInstructorActivation(
  db: admin.firestore.Firestore,
  member: Member,
  previous?: Member
) {
  const isNowInstructor = member.instructorId && (!previous || !previous.instructorId);

  if (isNowInstructor) {
    await cleanUpPendingNotifications(db, member.docId, [NotificationKind.InstructorLicensePending]);

    await createMemberNotification(db, member.docId, {
      kind: NotificationKind.InstructorLicenseActivated,
      markdown: `Congratulations on getting your Instructor ID **${member.instructorId}**! Please [update your public instructor profile](/myProfile) with a bio, photos, and links, and make sure to review the [Instructor Standard Operating Procedures (SOP)](${environment.links.instructorSopPath}) in the Instructors Area.`,
      createdAt: new Date().toISOString(),
      dismissed: false,
      data: {
        instructorId: member.instructorId
      }
    });

    try {
      await sendTemplateEmail(db, member.emails || [], TransactionalEmailKey.InstructorLicenseActivated, {
        name: member.name || 'ILC Instructor',
        memberId: member.memberId || '',
        instructorId: member.instructorId || '',
        email: (member.emails || [])[0] || '',
        appBase: environment.links.appBase,
        instructorSopUrl: `${environment.links.appBase}${environment.links.instructorSopPath}`,
      });
    } catch (error) {
      logger.error(`Failed to enqueue welcome email for instructor ${member.docId}:`, error);
    }
  }
}

export const onMemberCreated = onDocumentCreated(
  'members/{memberId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    const member = snap.data() as Member;
    member.docId = snap.id; // Ensure ID is present

    // Normalize IDs to uppercase in the document if they contain lowercase letters or surrounding whitespace
    const cleanMemberId = member.memberId ? member.memberId.trim().toUpperCase() : undefined;
    const cleanInstructorId = member.instructorId ? member.instructorId.trim().toUpperCase() : undefined;
    const cleanPrimaryInstructorId = member.primaryInstructorId ? member.primaryInstructorId.trim().toUpperCase() : undefined;

    const needsNormalization =
      (member.memberId && member.memberId !== cleanMemberId) ||
      (member.instructorId && member.instructorId !== cleanInstructorId) ||
      (member.primaryInstructorId && member.primaryInstructorId !== cleanPrimaryInstructorId);

    if (needsNormalization) {
      const normalizationPatch: Partial<Member> = {};
      if (cleanMemberId !== undefined && member.memberId !== cleanMemberId) normalizationPatch.memberId = cleanMemberId;
      if (cleanInstructorId !== undefined && member.instructorId !== cleanInstructorId) normalizationPatch.instructorId = cleanInstructorId;
      if (cleanPrimaryInstructorId !== undefined && member.primaryInstructorId !== cleanPrimaryInstructorId) normalizationPatch.primaryInstructorId = cleanPrimaryInstructorId;
      await getDb().collection('members').doc(snap.id).update(normalizationPatch);
      if (cleanMemberId !== undefined) member.memberId = cleanMemberId;
      if (cleanInstructorId !== undefined) member.instructorId = cleanInstructorId;
      if (cleanPrimaryInstructorId !== undefined) member.primaryInstructorId = cleanPrimaryInstructorId;
    }

    await updateMemberViewForSchoolAndInstrucor(snap.id, member);
    await updateInstructorPublicProfile({ previous: undefined, member });
    await ensureCountersAreAtLeast(member);
    await updateACL({ previous: undefined, member: member });

    if (member.instructorId) {
      await populateInstructorMembers(snap.id, member.instructorId);
    }

    await handleMembershipActivation(getDb(), member);
    await handleInstructorActivation(getDb(), member);
  },
);

export const onMemberUpdated = onDocumentUpdated(
  'members/{memberId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    const member = snap.after.data() as Member;
    member.docId = snap.after.id;

    const previous = snap.before.data() as Member;
    previous.docId = snap.before.id;

    // Normalize IDs to uppercase in the document if they contain lowercase letters or surrounding whitespace
    const cleanMemberId = member.memberId ? member.memberId.trim().toUpperCase() : undefined;
    const cleanInstructorId = member.instructorId ? member.instructorId.trim().toUpperCase() : undefined;
    const cleanPrimaryInstructorId = member.primaryInstructorId ? member.primaryInstructorId.trim().toUpperCase() : undefined;

    const needsNormalization =
      (member.memberId && member.memberId !== cleanMemberId) ||
      (member.instructorId && member.instructorId !== cleanInstructorId) ||
      (member.primaryInstructorId && member.primaryInstructorId !== cleanPrimaryInstructorId);

    if (needsNormalization) {
      const normalizationPatch: Partial<Member> = {};
      if (cleanMemberId !== undefined && member.memberId !== cleanMemberId) normalizationPatch.memberId = cleanMemberId;
      if (cleanInstructorId !== undefined && member.instructorId !== cleanInstructorId) normalizationPatch.instructorId = cleanInstructorId;
      if (cleanPrimaryInstructorId !== undefined && member.primaryInstructorId !== cleanPrimaryInstructorId) normalizationPatch.primaryInstructorId = cleanPrimaryInstructorId;
      await getDb().collection('members').doc(snap.after.id).update(normalizationPatch);
      if (cleanMemberId !== undefined) member.memberId = cleanMemberId;
      if (cleanInstructorId !== undefined) member.instructorId = cleanInstructorId;
      if (cleanPrimaryInstructorId !== undefined) member.primaryInstructorId = cleanPrimaryInstructorId;
    }

    await updateMemberViewForSchoolAndInstrucor(snap.after.id, member, previous);
    await updateInstructorPublicProfile({ previous, member });

    // Move grading mirrors if Sifu changed
    await mirrorGradingsForSifuChange(snap.after.id, previous.primaryInstructorId, member.primaryInstructorId);

    // Only update counters if IDs have changed/added
    if (
      member.memberId !== previous.memberId ||
      member.instructorId !== previous.instructorId
    ) {
      await ensureCountersAreAtLeast(member);
    }

    await updateACL({ previous, member });

    await handleMembershipActivation(getDb(), member, previous);
    await handleInstructorActivation(getDb(), member, previous);
  },
);

export const onMemberDeleted = onDocumentDeleted(
  'members/{memberId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    const member = snap.data() as Member;
    member.docId = snap.id;

    await updateMemberViewForSchoolAndInstrucor(snap.id, undefined, member);
    await updateInstructorPublicProfile({ previous: member, member: undefined });
    await updateACL({ previous: member, member: undefined });
    await recordTombstone(getDb(), 'members', snap.id);
    if (member.instructorId) {
      await recordTombstone(getDb(), 'instructors', snap.id);
    }
  },
);
