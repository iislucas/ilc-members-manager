import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member } from './data-model';

const db = admin.firestore();

export async function updateMemberViewForSchoolAndInstrucor(
  memberDocId: string,
  member: Member | undefined,
  previousMember?: Member,
) {
  const schoolId = member?.managingOrgId;
  const previousSchoolId = previousMember?.managingOrgId;

  const sifuInstructorId = member?.sifuInstructorId;
  const previousSifuInstructorId = previousMember?.sifuInstructorId;

  if (previousSchoolId && previousSchoolId !== schoolId) {
    logger.info(`Removing member ${memberDocId} from school ${previousSchoolId}`);
    const previousMemberRef = db
      .collection('schools')
      .doc(previousSchoolId)
      .collection('members')
      .doc(memberDocId);
    await previousMemberRef.delete();
  }

  if (schoolId) {
    logger.info(`Updating member ${memberDocId} in school ${schoolId}`);
    const memberRef = db
      .collection('schools')
      .doc(schoolId)
      .collection('members')
      .doc(memberDocId);
    await memberRef.set(member as Member);
  }

  // Look up the instructor's member docId from their instructorId.
  // The instructors collection is keyed by the instructor's member docId,
  // not the instructorId string.
  if (
    previousSifuInstructorId &&
    previousSifuInstructorId !== sifuInstructorId
  ) {
    const previousInstructorDocId = await findInstructorMemberDocId(previousSifuInstructorId);
    if (previousInstructorDocId) {
      logger.info(
        `Removing member ${memberDocId} from instructor doc ${previousInstructorDocId} (instructorId: ${previousSifuInstructorId})`,
      );
      const previousMemberRef = db
        .collection('instructors')
        .doc(previousInstructorDocId)
        .collection('members')
        .doc(memberDocId);
      await previousMemberRef.delete();
    } else {
      logger.warn(
        `Could not find instructor member doc for instructorId ${previousSifuInstructorId} to remove student ${memberDocId}`,
      );
    }
  }

  if (sifuInstructorId) {
    const instructorDocId = await findInstructorMemberDocId(sifuInstructorId);
    if (instructorDocId) {
      logger.info(
        `Adding member ${memberDocId} under instructor doc ${instructorDocId} (instructorId: ${sifuInstructorId})`,
      );
      const memberRef = db
        .collection('instructors')
        .doc(instructorDocId)
        .collection('members')
        .doc(memberDocId);
      await memberRef.set(member as Member);
    } else {
      logger.warn(
        `Could not find instructor member doc for instructorId ${sifuInstructorId} to add student ${memberDocId}`,
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
