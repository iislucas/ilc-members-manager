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

export async function updateInstructor(
  instructorId: string,
  member: Member | undefined,
) {
  const instructorRef = db.collection('instructorsPublic').doc(instructorId);

  if (member && isInstructor(member)) {
    logger.info(`Updating instructor ${instructorId}`);
    const instructor: InstructorPublicData = {
      id: member.instructorId,
      name: member.name,
      memberId: member.memberId,
      studentLevel: member.studentLevel,
      applicationLevel: member.applicationLevel,
      mastersLevels: member.mastersLevels,
      instructorId: member.instructorId,
      publicRegionOrCity: member.publicRegionOrCity,
      country: member.country,
      publicEmail: member.publicEmail,
      publicPhone: member.publicPhone,
      instructorWebsite: member.instructorWebsite,
    };
    // For now we copy all data
    await instructorRef.set(instructor);
  } else {
    logger.info(`Removing instructor ${instructorId}`);
    await instructorRef.delete();
  }
}
