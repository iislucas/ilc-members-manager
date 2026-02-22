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
  const memberDocId = member?.id || previous?.id;

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

async function refreshACLAdminStatus(email: string) {
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

  const newInstructorIds = new Set<string>();
  for (const snap of memberSnaps) {
    if (snap.exists) {
      const instId = snap.data()?.instructorId;
      if (instId) {
        newInstructorIds.add(instId);
      }
    }
  }

  await aclRef.update({
    isAdmin: anyAdmin,
    instructorIds: Array.from(newInstructorIds),
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
    data.id = d.id;
    return data;
  });

  for (const grading of gradings) {
    if (previousSifu) {
      const assessors = [grading.gradingInstructorId, ...grading.assistantInstructorIds];
      if (!assessors.includes(previousSifu)) {
        await removeGradingFromInstructor(grading.id, previousSifu);
      }
    }
    if (currentSifu) {
      await mirrorGradingToInstructor(grading.id, grading, currentSifu);
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
    member.id = snap.id; // Ensure ID is present

    await updateMemberViewForSchoolAndInstrucor(snap.id, member);
    await updateInstructorPublicProfile({ previous: undefined, member });
    await ensureCountersAreAtLeast(member);
    await updateACL({ previous: undefined, member: member });
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
    member.id = snap.after.id;

    const previous = snap.before.data() as Member;
    previous.id = snap.before.id;

    await updateMemberViewForSchoolAndInstrucor(snap.after.id, member, previous);
    await updateInstructorPublicProfile({ previous, member });

    // Move grading mirrors if Sifu changed
    await mirrorGradingsForSifuChange(snap.after.id, previous.sifuInstructorId, member.sifuInstructorId);

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
    member.id = snap.id;

    await updateMemberViewForSchoolAndInstrucor(snap.id, undefined, member);
    await updateInstructorPublicProfile({ previous: member, member: undefined });
    await updateACL({ previous: member, member: undefined });
  },
);
