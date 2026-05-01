import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Member, ACL, Grading } from './data-model';
import { mirrorGradingToInstructor, removeGradingFromInstructor } from './on-grading-update';
import { updateMemberViewForSchoolAndInstrucor } from './mirror-members-to-school-and-instructor-views';
import { updateInstructorPublicProfile } from './mirror-instructors-to-public-profile';
import { ensureCountersAreAtLeast } from './counters';
import { FirestoreUpdate } from './common';
import * as logger from 'firebase-functions/logger';

const db = admin.firestore();

async function updateACL(aclUpdate: {
  previous?: Member;
  member?: Member;
}) {
  const { previous, member } = aclUpdate;
  if (!previous && !member) {
    logger.error(`updateACL called without member or previous member`);
    return;
  }
  const memberDocId = member?.docId || previous?.docId;

  const emails = member?.emails || [];
  const instructorId = member?.instructorId;

  const previousEmails = previous?.emails || [];
  const previousInstructorId = previous?.instructorId;
  const added = emails.filter((e) => !previousEmails.includes(e));
  const removed = previousEmails.filter((e) => !emails.includes(e));

  const isAdminChanged = member?.isAdmin !== previous?.isAdmin;
  const instructorIdChanged = instructorId !== previousInstructorId;

  if (added.length === 0 && removed.length === 0 && !isAdminChanged && !instructorIdChanged) {
    return;
  }

  const batch = db.batch();

  for (const email of added) {
    if (!email) continue;
    const aclRef = db.collection('acl').doc(email);
    const update: FirestoreUpdate<ACL> = {
      memberDocIds: admin.firestore.FieldValue.arrayUnion(memberDocId),
    };
    batch.set(aclRef, update, { merge: true });
  }

  for (const email of removed) {
    if (!email) continue;
    const aclRef = db.collection('acl').doc(email);
    const update: FirestoreUpdate<ACL> = {
      memberDocIds: admin.firestore.FieldValue.arrayRemove(memberDocId),
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

// Returns the best school license expiry across all schools the user
// owns or manages, identified by their instructorIds.
async function getSchoolLicenseExpiry(instructorIds: string[]): Promise<string> {
  const validIds = instructorIds.filter(id => !!id);
  if (validIds.length === 0) return '';

  const expiries: string[] = [];

  // Query schools where this user is the owner.
  for (const instId of validIds) {
    const ownerSnap = await db.collection('schools')
      .where('ownerInstructorId', '==', instId).get();
    for (const doc of ownerSnap.docs) {
      expiries.push(doc.data().schoolLicenseExpires || '');
    }
  }

  // Query schools where this user is a manager.
  for (const instId of validIds) {
    const managerSnap = await db.collection('schools')
      .where('managerInstructorIds', 'array-contains', instId).get();
    for (const doc of managerSnap.docs) {
      expiries.push(doc.data().schoolLicenseExpires || '');
    }
  }

  return bestExpiry(expiries);
}

export async function refreshACLAdminStatus(email: string) {
  const aclRef = db.collection('acl').doc(email);
  const aclSnap = await aclRef.get();

  if (!aclSnap.exists) return;

  const data = aclSnap.data() as ACL;
  if (!data.memberDocIds || data.memberDocIds.length === 0) {
    await aclRef.delete();
    return;
  }

  const memberRefs = data.memberDocIds.map((memberDocId: string) =>
    db.collection('members').doc(memberDocId),
  );
  let memberSnaps: admin.firestore.DocumentSnapshot[] = [];
  if (memberRefs.length > 0) {
    memberSnaps = await db.getAll(...memberRefs);
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

  // Look up school license expiry for all instructor IDs this user has.
  const schoolLicenseExpires = await getSchoolLicenseExpiry(Array.from(newInstructorIds));

  await aclRef.update({
    isAdmin: anyAdmin,
    instructorIds: Array.from(newInstructorIds),
    notYetLinkedToMember: !anyFullMember,
    membershipExpires: bestExpiry(membershipExpiries),
    instructorLicenseExpires: bestExpiry(instructorExpiries),
    schoolLicenseExpires,
  });
}

async function mirrorGradingsForSifuChange(
  memberDocId: string,
  previousSifu: string | undefined,
  currentSifu: string | undefined,
) {
  if (previousSifu === currentSifu) return;
  if (!previousSifu && !currentSifu) return;

  const gradingsSnap = await db.collection('gradings')
    .where('studentMemberDocId', '==', memberDocId)
    .get();

  if (gradingsSnap.empty) return;

  const gradings = gradingsSnap.docs.map(d => {
    const data = d.data() as Grading;
    data.docId = d.id;
    return data;
  });

  for (const grading of gradings) {
    if (previousSifu) {
      const assessors = [grading.gradingInstructorId, ...grading.assistantInstructorIds];
      if (!assessors.includes(previousSifu)) {
        await removeGradingFromInstructor(grading.docId, previousSifu);
      }
    }
    if (currentSifu) {
      await mirrorGradingToInstructor(grading.docId, grading, currentSifu);
    }
  }
}

async function populateInstructorMembers(instructorDocId: string, instructorId: string) {
  if (!instructorId) return;
  const snapshot = await db.collection('members').where('primaryInstructorId', '==', instructorId).get();

  const chunks: admin.firestore.WriteBatch[] = [];
  let i = 0;
  snapshot.docs.forEach((doc) => {
    if (i % 500 === 0) chunks.push(db.batch());
    const batch = chunks[chunks.length - 1];
    const ref = db.collection('instructors').doc(instructorDocId).collection('members').doc(doc.id);
    batch.set(ref, doc.data());
    i++;
  });

  for (const batch of chunks) {
    await batch.commit();
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

    await updateMemberViewForSchoolAndInstrucor(snap.id, member);
    await updateInstructorPublicProfile({ previous: undefined, member });
    await ensureCountersAreAtLeast(member);
    await updateACL({ previous: undefined, member: member });

    if (member.instructorId) {
      await populateInstructorMembers(snap.id, member.instructorId);
    }
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
  },
);
