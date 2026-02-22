import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  InstructorLicenseType,
  InstructorPublicData,
  Member,
} from './data-model';

const db = admin.firestore();

function isActiveInstructor(member: Member): boolean {
  if (!member.instructorId || member.instructorId === '') return false;

  if (member.instructorLicenseType === InstructorLicenseType.Life) return true;

  const today = new Date().toISOString().split('T')[0];

  // If explicitly Annual license, or if they have an expiration date in the future (legacy fallback)
  if (
    member.instructorLicenseType === InstructorLicenseType.Annual ||
    (!member.instructorLicenseType || member.instructorLicenseType === InstructorLicenseType.None)
  ) {
    if (member.instructorLicenseExpires) {
      return member.instructorLicenseExpires >= today;
    }
  }

  return false;
}

export type InstructorUpdate =
  | { previous: undefined; member: Member }
  | {
      previous: Member;
      member: undefined;
    }
  | {
      previous: Member;
      member: Member;
    };

export async function updateInstructorPublicProfile(update: InstructorUpdate) {
  if (update.member) {
    const member = update.member;
    if (member.instructorId !== '') {
      if (!member.id) {
        logger.error(
          `Member ${member.name} has no ID, cannot update instructor public data`,
        );
        return;
      }
      const instructorRef = db.collection('instructors').doc(member.id);

      logger.info(
        `Updating instructorId(${member.instructorId}) for member with Doc ${member.id}`,
      );
      const instructor: InstructorPublicData = {
        id: member.id, // The ID of this document matches the Member Document ID
        name: member.name,
        memberId: member.memberId,
        studentLevel: member.studentLevel,
        applicationLevel: member.applicationLevel,
        mastersLevels: member.mastersLevels,
        instructorId: member.instructorId,
        instructorLicenseType: member.instructorLicenseType,
        instructorLicenseExpires: member.instructorLicenseType === InstructorLicenseType.Life
          ? '9999-12-31'
          : member.instructorLicenseExpires,
        publicRegionOrCity: member.publicRegionOrCity,
        publicCountyOrState: member.publicCountyOrState,
        country: member.country,
        publicEmail: member.publicEmail,
        publicPhone: member.publicPhone,
        instructorWebsite: member.instructorWebsite,
        tags: member.tags || [],
      };
      // For now we copy all data
      await instructorRef.set(instructor);
    } else {
      // If they were an instructor and now are not, we should delete the public record.
      // We check if the record exists first? Or just delete it.
      // `delete()` is idempotent if it doesn't exist.
      if (member.id) {
        await db.collection('instructors').doc(member.id).delete();
      }
    }
  } else if (update.previous) {
    // Member was deleted
    const prev = update.previous;
    if (prev.id) {
      logger.info(
        `Removing instructor public data for deleted member ${prev.id}`,
      );
      await db.collection('instructors').doc(prev.id).delete();
    }
  }
}
