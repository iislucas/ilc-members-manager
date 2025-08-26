import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { InstructorPublicData, Member } from './data-model';

const db = admin.firestore();

function isInstructor(member: Member): boolean {
  const today = new Date().toISOString().split('T')[0];
  return member.instructorId !== '' && member.instructorLicenseExpires >= today;
}

async function updateInstructor(
  instructorId: string,
  member: Member | undefined,
) {
  const instructorRef = db.collection('instructorsPublic').doc(instructorId);

  if (member && isInstructor(member)) {
    logger.info(`Updating instructor ${instructorId}`);
    const instructor: InstructorPublicData = {
      name: member.name,
      memberId: member.memberId,
      instructorWebsite: member.instructorWebsite,
      studentLevel: member.studentLevel,
      applicationLevel: member.applicationLevel,
      mastersLevels: member.mastersLevels,
      instructorId: member.instructorId,
    };
    // For now we copy all data
    await instructorRef.set(instructor);
  } else {
    logger.info(`Removing instructor ${instructorId}`);
    await instructorRef.delete();
  }
}

export const onInstructorCreated = onDocumentCreated(
  'members/{memberId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    const member = snap.data() as Member;
    await updateInstructor(snap.id, member);
  },
);

export const onInstructorUpdated = onDocumentUpdated(
  'members/{memberId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    const member = snap.after.data() as Member;
    await updateInstructor(snap.after.id, member);
  },
);

export const onInstructorDeleted = onDocumentDeleted(
  'members/{memberId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    await updateInstructor(snap.id, undefined);
  },
);
