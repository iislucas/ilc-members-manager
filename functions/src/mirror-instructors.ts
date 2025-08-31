import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { InstructorPublicData, Member } from './data-model';

const db = admin.firestore();

function isInstructor(member: Member): boolean {
  const today = new Date().toISOString().split('T')[0];
  return member.instructorId !== '' && member.instructorLicenseExpires >= today;
}

export type InstructorUpdate =
  | { previousMember: undefined; member: Member }
  | {
      previousMember: Member;
      member: undefined;
    }
  | {
      previousMember: Member;
      member: Member;
    };

export async function updateInstructor(update: InstructorUpdate) {
  if (update.member) {
    // TODO: consider putting in a transaction
    const member = update.member;
    const prev = update.previousMember;
    if (
      prev &&
      prev.instructorId &&
      prev.instructorId !== member.instructorId
    ) {
      logger.info(
        `Removing old instructor, ID changed: ${prev.instructorId} -> ${member.instructorId}`,
      );
      await db.collection('instructorsPublic').doc(prev.instructorId).delete();
    }

    if (isInstructor(member)) {
      const instructorRef = db
        .collection('instructorsPublic')
        .doc(member.instructorId);

      logger.info(`Updating instructor $${member.instructorId}`);
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
    }
  } else {
    logger.info(`Removing instructor ${update.previousMember.instructorId}`);
    await db
      .collection('instructorsPublic')
      .doc(update.previousMember.instructorId)
      .delete();
  }
}
