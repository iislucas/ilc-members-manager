import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
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
}
