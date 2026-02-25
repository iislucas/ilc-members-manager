import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member } from './data-model';

const db = admin.firestore();

export async function updateMemberViewForSchoolAndInstrucor(
  memberDocId: string,
  member: Member | undefined,
  previousMember?: Member,
) {
  const schoolId = member?.primarySchoolId;
  const previousSchoolId = previousMember?.primarySchoolId;

  // Remove from previous school if it changed
  if (previousSchoolId && previousSchoolId !== schoolId) {
    logger.info(`Removing member ${memberDocId} from school ${previousSchoolId}`);
    const previousSchoolDocId = await findSchoolDocId(previousSchoolId);
    if (previousSchoolDocId) {
      const previousMemberRef = db
        .collection('schools')
        .doc(previousSchoolDocId)
        .collection('members')
        .doc(memberDocId);
      await previousMemberRef.delete();
    }
  }

  // Update/Add to current school
  if (schoolId) {
    const schoolDocId = await findSchoolDocId(schoolId);
    if (schoolDocId) {
      const memberRef = db
        .collection('schools')
        .doc(schoolDocId)
        .collection('members')
        .doc(memberDocId);
      if (member) {
        await memberRef.set(member as Member);
      } else {
        await memberRef.delete();
      }
    }
  }

  // Remove from previous instructor if it changed.
  const primaryInstructorId = member?.primaryInstructorId;
  const previousPrimaryInstructorId = previousMember?.primaryInstructorId;
  if (
    previousPrimaryInstructorId &&
    previousPrimaryInstructorId !== primaryInstructorId
  ) {
    const previousInstructorDocId = await findInstructorMemberDocId(previousPrimaryInstructorId);
    if (previousInstructorDocId) {
      logger.info(
        `Removing member ${memberDocId} from instructor doc ${previousInstructorDocId} (instructorId: ${previousPrimaryInstructorId})`,
      );
      const previousMemberRef = db
        .collection('instructors')
        .doc(previousInstructorDocId)
        .collection('members')
        .doc(memberDocId);
      await previousMemberRef.delete();
    } else {
      logger.warn(
        `Could not find instructor member doc for instructorId ${previousPrimaryInstructorId} to remove student ${memberDocId}`,
      );
    }
  }

  // Update/Add to current instructor
  if (primaryInstructorId) {
    const instructorDocId = await findInstructorMemberDocId(primaryInstructorId);
    if (instructorDocId) {
      const memberRef = db
        .collection('instructors')
        .doc(instructorDocId)
        .collection('members')
        .doc(memberDocId);
      if (member) {
        await memberRef.set(member as Member);
      } else {
        await memberRef.delete();
      }
    } else {
      logger.warn(
        `Could not find instructor member doc for instructorId ${primaryInstructorId} to add student ${memberDocId}`,
      );
    }
  }
}

/**
 * Given an instructorId (e.g. "INST-001"), find the member document that has
 * that instructorId and return its Firestore doc ID.
 */
async function findInstructorMemberDocId(instructorId: string): Promise<string | undefined> {
  const snap = await db
    .collection('members')
    .where('instructorId', '==', instructorId)
    .limit(1)
    .get();
  if (snap.empty) {
    return undefined;
  }
  return snap.docs[0].id;
}

/**
 * Given a schoolId (e.g. "SCH-XXX"), find the school document that has
 * that schoolId and return its Firestore doc ID.
 */
async function findSchoolDocId(schoolId: string): Promise<string | undefined> {
  const snap = await db
    .collection('schools')
    .where('schoolId', '==', schoolId)
    .limit(1)
    .get();
  if (snap.empty) {
    return undefined;
  }
  return snap.docs[0].id;
}
