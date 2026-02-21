import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Grading, GradingStatus, StudentLevel } from './data-model';
import * as logger from 'firebase-functions/logger';

const db = admin.firestore();

/**
 * Given an instructorId (human-readable), find the member document that has
 * that instructorId and return its Firestore doc ID.
 */
async function findInstructorMemberDocId(
  instructorId: string,
): Promise<string | undefined> {
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
 * Mirror a grading document to an instructor's gradings sub-collection.
 * Path: /instructors/{instructorMemberDocId}/gradings/{gradingDocId}
 */
async function mirrorGradingToInstructor(
  gradingDocId: string,
  grading: Grading,
  instructorId: string,
): Promise<void> {
  const instructorMemberDocId = await findInstructorMemberDocId(instructorId);
  if (!instructorMemberDocId) {
    logger.warn(
      `Could not find instructor member doc for instructorId ${instructorId} to mirror grading ${gradingDocId}`,
    );
    return;
  }
  const ref = db
    .collection('instructors')
    .doc(instructorMemberDocId)
    .collection('gradings')
    .doc(gradingDocId);
  await ref.set(grading);
}

/**
 * Remove a grading document from an instructor's gradings sub-collection.
 */
async function removeGradingFromInstructor(
  gradingDocId: string,
  instructorId: string,
): Promise<void> {
  const instructorMemberDocId = await findInstructorMemberDocId(instructorId);
  if (!instructorMemberDocId) {
    logger.warn(
      `Could not find instructor member doc for instructorId ${instructorId} to remove grading ${gradingDocId}`,
    );
    return;
  }
  const ref = db
    .collection('instructors')
    .doc(instructorMemberDocId)
    .collection('gradings')
    .doc(gradingDocId);
  await ref.delete();
}

/**
 * Mirror a grading document to a school's gradings sub-collection.
 * Path: /schools/{schoolId}/gradings/{gradingDocId}
 */
async function mirrorGradingToSchool(
  gradingDocId: string,
  grading: Grading,
  schoolId: string,
): Promise<void> {
  const ref = db
    .collection('schools')
    .doc(schoolId)
    .collection('gradings')
    .doc(gradingDocId);
  await ref.set(grading);
}

/**
 * Remove a grading document from a school's gradings sub-collection.
 */
async function removeGradingFromSchool(
  gradingDocId: string,
  schoolId: string,
): Promise<void> {
  const ref = db
    .collection('schools')
    .doc(schoolId)
    .collection('gradings')
    .doc(gradingDocId);
  await ref.delete();
}

/**
 * Mirror the grading to all relevant instructors (primary + assistants).
 */
async function mirrorGradingToAllInstructors(
  gradingDocId: string,
  grading: Grading,
): Promise<void> {
  const instructorIds = [
    grading.gradingInstructorId,
    ...grading.assistantInstructorIds,
  ].filter((id) => id !== '');

  for (const instructorId of instructorIds) {
    await mirrorGradingToInstructor(gradingDocId, grading, instructorId);
  }
}

/**
 * Remove the grading from all relevant instructors (primary + assistants).
 */
async function removeGradingFromAllInstructors(
  gradingDocId: string,
  grading: Grading,
): Promise<void> {
  const instructorIds = [
    grading.gradingInstructorId,
    ...grading.assistantInstructorIds,
  ].filter((id) => id !== '');

  for (const instructorId of instructorIds) {
    await removeGradingFromInstructor(gradingDocId, instructorId);
  }
}

// ---------------------------------------------------------------
// Firestore triggers
// ---------------------------------------------------------------

export const onGradingCreated = onDocumentCreated(
  'gradings/{gradingId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const grading = snap.data() as Grading;
    grading.id = snap.id;
    const gradingDocId = snap.id;

    // Mirror to all instructors (primary + assistants)
    await mirrorGradingToAllInstructors(gradingDocId, grading);

    // Mirror to school if set
    if (grading.schoolId) {
      await mirrorGradingToSchool(gradingDocId, grading, grading.schoolId);
    }

    logger.info(`Grading ${gradingDocId} created and mirrored.`);
  },
);

export const onGradingUpdated = onDocumentUpdated(
  'gradings/{gradingId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const grading = snap.after.data() as Grading;
    grading.id = snap.after.id;
    const previous = snap.before.data() as Grading;
    previous.id = snap.before.id;
    const gradingDocId = snap.after.id;

    // Determine which instructor IDs changed
    const previousInstructorIds = new Set(
      [previous.gradingInstructorId, ...previous.assistantInstructorIds].filter(
        (id) => id !== '',
      ),
    );
    const currentInstructorIds = new Set(
      [grading.gradingInstructorId, ...grading.assistantInstructorIds].filter(
        (id) => id !== '',
      ),
    );

    // Remove from instructors no longer associated
    for (const id of previousInstructorIds) {
      if (!currentInstructorIds.has(id)) {
        await removeGradingFromInstructor(gradingDocId, id);
      }
    }
    // Mirror to all current instructors (update the cached copy)
    for (const id of currentInstructorIds) {
      await mirrorGradingToInstructor(gradingDocId, grading, id);
    }

    // Handle school change
    if (previous.schoolId && previous.schoolId !== grading.schoolId) {
      await removeGradingFromSchool(gradingDocId, previous.schoolId);
    }
    if (grading.schoolId) {
      await mirrorGradingToSchool(gradingDocId, grading, grading.schoolId);
    }

    // If status changed to 'passed', update the student's studentLevel
    if (
      grading.status === GradingStatus.Passed &&
      previous.status !== GradingStatus.Passed &&
      grading.studentId &&
      grading.level !== StudentLevel.None
    ) {
      const studentRef = db.collection('members').doc(grading.studentId);
      await studentRef.update({
        studentLevel: grading.level,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info(
        `Student ${grading.studentId} level updated to ${grading.level} from grading ${gradingDocId}.`,
      );
    }

    logger.info(`Grading ${gradingDocId} updated and re-mirrored.`);
  },
);

export const onGradingDeleted = onDocumentDeleted(
  'gradings/{gradingId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const grading = snap.data() as Grading;
    grading.id = snap.id;
    const gradingDocId = snap.id;

    // Remove from all instructors
    await removeGradingFromAllInstructors(gradingDocId, grading);

    // Remove from school if set
    if (grading.schoolId) {
      await removeGradingFromSchool(gradingDocId, grading.schoolId);
    }

    logger.info(`Grading ${gradingDocId} deleted and mirrors removed.`);
  },
);
