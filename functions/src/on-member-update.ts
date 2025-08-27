import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import { Member } from './data-model';
import { updateSchoolMember } from './mirror-school-members';
import { updateInstructor } from './mirror-instructors';

export const onMemberCreated = onDocumentCreated(
  'members/{memberId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    const member = snap.data() as Member;
    await updateSchoolMember(snap.id, member);
    await updateInstructor(snap.id, member);
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
    await updateInstructor(snap.after.id, member);
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
    await updateInstructor(snap.id, undefined);
  },
);
