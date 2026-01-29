import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Member, ACL } from './data-model';
import { updateSchoolMember } from './mirror-school-members';
import { updateInstructor } from './mirror-instructors';

const db = admin.firestore();

async function updateACL(
  memberDocId: string,
  instructorId: string,
  emails: string[],
  previousEmails: string[] = [],
  previousInstructorId: string = '',
) {
  const added = emails.filter((e) => !previousEmails.includes(e));
  const removed = previousEmails.filter((e) => !emails.includes(e));

  const batch = db.batch();

  for (const email of added) {
    if (!email) continue;
    const aclRef = db.collection('acl').doc(email);
    const update: any = {
      memberDocIds: admin.firestore.FieldValue.arrayUnion(memberDocId),
    };
    if (instructorId) {
      update.instructorIds = admin.firestore.FieldValue.arrayUnion(instructorId);
    }
    batch.set(aclRef, update, { merge: true });
  }

  for (const email of removed) {
    if (!email) continue;
    const aclRef = db.collection('acl').doc(email);
    const update: any = {
      memberDocIds: admin.firestore.FieldValue.arrayRemove(memberDocId),
    };
    if (previousInstructorId) {
      update.instructorIds =
        admin.firestore.FieldValue.arrayRemove(previousInstructorId);
    }
    batch.update(aclRef, update);
  }

  await batch.commit();

  // Recalculate isAdmin for all affected emails
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
  const memberSnaps = await db.getAll(...memberRefs);

  const anyAdmin = memberSnaps.some(
    (snap: admin.firestore.DocumentSnapshot) =>
      snap.exists && snap.data()?.isAdmin === true,
  );

  await aclRef.update({ isAdmin: anyAdmin });
}

export const onMemberCreated = onDocumentCreated(
  'members/{memberId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    const member = snap.data() as Member;
    await updateSchoolMember(snap.id, member);
    await updateInstructor({ previousMember: undefined, member });
    await updateACL(snap.id, member.instructorId, member.emails || []);
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
    const previousMember = snap.before.data() as Member;
    await updateSchoolMember(snap.after.id, member, previousMember);
    await updateInstructor({ previousMember, member });
    await updateACL(
      snap.after.id,
      member.instructorId,
      member.emails || [],
      previousMember.emails || [],
      previousMember.instructorId,
    );
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
    await updateSchoolMember(snap.id, undefined, member);
    await updateInstructor({ previousMember: member, member: undefined });
    await updateACL(snap.id, '', [], member.emails || [], member.instructorId);
  },
);
