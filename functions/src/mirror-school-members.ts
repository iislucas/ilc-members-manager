import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member } from './data-model';

const db = admin.firestore();

export async function updateSchoolMember(
  memberId: string,
  member: Member | undefined,
  previousMember?: Member,
) {
  const schoolId = member?.managingOrgId;
  const previousSchoolId = previousMember?.managingOrgId;

  const primaryInstructorId = member?.sifuInstructorId;
  const previousPrimaryInstructorId = previousMember?.sifuInstructorId;

  if (previousSchoolId && previousSchoolId !== schoolId) {
    logger.info(`Removing member ${memberId} from school ${previousSchoolId}`);
    const previousMemberRef = db
      .collection('schools')
      .doc(previousSchoolId)
      .collection('members')
      .doc(memberId);
    await previousMemberRef.delete();
  }

  if (schoolId) {
    logger.info(`Updating member ${memberId} in school ${schoolId}`);
    const memberRef = db
      .collection('schools')
      .doc(schoolId)
      .collection('members')
      .doc(memberId);
    await memberRef.set(member as Member);
  }

  if (
    previousPrimaryInstructorId &&
    previousPrimaryInstructorId !== primaryInstructorId
  ) {
    logger.info(
      `Removing member ${memberId} under Primary Instructor ${previousPrimaryInstructorId}`,
    );
    const previousMemberRef = db
      .collection('instructors')
      .doc(previousPrimaryInstructorId)
      .collection('members')
      .doc(memberId);
    await previousMemberRef.delete();
  }

  if (primaryInstructorId) {
    logger.info(
      `Updating member ${memberId} under Primary Instructor ${primaryInstructorId}`,
    );
    const memberRef = db
      .collection('instructors')
      .doc(primaryInstructorId)
      .collection('members')
      .doc(memberId);
    await memberRef.set(member as Member);
  }
}
