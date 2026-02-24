import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member } from './data-model';

const db = admin.firestore();

export async function updateMemberViewForSchoolAndInstrucor(
  memberDocId: string,
  member: Member | undefined,
  previousMember?: Member,
) {
  // TODO: fix this: primarySchoolId is not a DocID, it's a school ID. something is wrong here. 
  const schoolDocId = member?.primarySchoolId;
  const previousSchoolDocId = previousMember?.primarySchoolId;

  const primaryInstructorId = member?.primaryInstructorId;
  const previousPrimaryInstructorId = previousMember?.primaryInstructorId;

  if (previousSchoolDocId && previousSchoolDocId !== schoolDocId) {
    logger.info(`Removing member ${memberDocId} from school ${previousSchoolDocId}`);
    const previousMemberRef = db
      .collection('schools')
      .doc(previousSchoolDocId)
      .collection('members')
      .doc(memberDocId);
    await previousMemberRef.delete();
  }

  if (schoolDocId) {
    logger.info(`Updating member ${memberDocId} in school ${schoolDocId}`);
    const memberRef = db
      .collection('schools')
      .doc(schoolDocId)
      .collection('members')
      .doc(memberDocId);
    await memberRef.set(member as Member);
  }

  // Look up the instructor's member docId from their instructorId.
  // The instructors collection is keyed by the instructor's member docId,
  // not the instructorId string.
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

  if (primaryInstructorId) {
    const instructorDocId = await findInstructorMemberDocId(primaryInstructorId);
    if (instructorDocId) {
      logger.info(
        `Adding member ${memberDocId} under instructor doc ${instructorDocId} (instructorId: ${primaryInstructorId})`,
      );
      const memberRef = db
        .collection('instructors')
        .doc(instructorDocId)
        .collection('members')
        .doc(memberDocId);
      await memberRef.set(member as Member);
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
