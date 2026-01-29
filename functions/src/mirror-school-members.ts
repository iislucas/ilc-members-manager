import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member } from './data-model';

const db = admin.firestore();

export async function updateSchoolMember(
  memberDocId: string,
  member: Member | undefined,
  previousMember?: Member,
) {
  const schoolId = member?.managingOrgId;
  const previousSchoolId = previousMember?.managingOrgId;

  const primaryInstructorId = member?.sifuInstructorId;
  const previousPrimaryInstructorId = previousMember?.sifuInstructorId;

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

  if (
    previousPrimaryInstructorId &&
    previousPrimaryInstructorId !== primaryInstructorId
  ) {
    logger.info(
      `Removing member ${memberDocId} under Primary Instructor ${previousPrimaryInstructorId}`,
    );
    const previousMemberRef = db
      .collection('instructors')
      .doc(previousPrimaryInstructorId)
      .collection('members')
      .doc(memberDocId);
    await previousMemberRef.delete();
  }

  if (primaryInstructorId) {
    logger.info(
      `Updating member ${memberDocId} under Primary Instructor ${primaryInstructorId}`,
    );
    const memberRef = db
      .collection('instructors')
      .doc(primaryInstructorId)
      .collection('members')
      .doc(memberDocId);
    await memberRef.set(member as Member);
  }
}
