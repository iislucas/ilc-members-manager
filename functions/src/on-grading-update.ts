import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Grading, GradingStatus, StudentLevel, NotificationKind, MemberNotification } from './data-model';
import { canonicalizeGradingLevel, extractLevelValue } from './level-utils';
import * as logger from 'firebase-functions/logger';

const db = admin.firestore();

async function createNotification(
  memberDocId: string,
  notification: Omit<MemberNotification, 'docId'>,
): Promise<void> {
  const notifRef = db
    .collection('members')
    .doc(memberDocId)
    .collection('notifications')
    .doc(); // Auto ID

  const fullNotification: MemberNotification = {
    ...notification,
    docId: notifRef.id,
  } as MemberNotification;

  await notifRef.set(fullNotification);
}

async function cancelAndDismissGradingNotifications(
  memberDocId: string,
  gradingDocId: string,
  kind?: NotificationKind,
): Promise<void> {
  let query: admin.firestore.Query = db
    .collection('members')
    .doc(memberDocId)
    .collection('notifications')
    .where('dismissed', '==', false)
    .where('data.gradingDocId', '==', gradingDocId);

  if (kind) {
    query = query.where('kind', '==', kind);
  }

  const snap = await query.get();
  if (snap.empty) return;

  const batch = db.batch();
  for (const doc of snap.docs) {
    const data = doc.data() as MemberNotification;
    const currentMarkdown = data.markdown;
    // Wrap in markdown strikethrough if not already wrapped
    const updatedMarkdown = currentMarkdown.startsWith('~~') ? currentMarkdown : `~~${currentMarkdown}~~ (Cancelled/Reassigned)`;
    batch.update(doc.ref, {
      markdown: updatedMarkdown,
      dismissed: true,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

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
export async function mirrorGradingToInstructor(
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
export async function removeGradingFromInstructor(
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

async function getPrimaryInstructorId(memberDocId: string | undefined): Promise<string | undefined> {
  if (!memberDocId) return undefined;
  const snap = await db.collection('members').doc(memberDocId).get();
  if (snap.exists) {
    return snap.data()?.primaryInstructorId;
  }
  return undefined;
}

/**
 * Mirror the grading to all relevant instructors (primary + assistants + sifu).
 */
async function mirrorGradingToAllInstructors(
  gradingDocId: string,
  grading: Grading,
): Promise<void> {
  const primaryInstructor = await getPrimaryInstructorId(grading.studentMemberDocId);
  const instructorIds = new Set([
    grading.gradingInstructorId,
    ...grading.assistantInstructorIds,
    primaryInstructor
  ].filter((id) => id && id !== '') as string[]);

  for (const instructorId of instructorIds) {
    await mirrorGradingToInstructor(gradingDocId, grading, instructorId);
  }
}

/**
 * Remove the grading from all relevant instructors (primary + assistants + sifu).
 */
async function removeGradingFromAllInstructors(
  gradingDocId: string,
  grading: Grading,
): Promise<void> {
  const primaryInstructor = await getPrimaryInstructorId(grading.studentMemberDocId);
  const instructorIds = new Set([
    grading.gradingInstructorId,
    ...grading.assistantInstructorIds,
    primaryInstructor
  ].filter((id) => id && id !== '') as string[]);

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
    grading.docId = snap.id;
    const gradingDocId = snap.id;

    // Mirror to all instructors (primary + assistants)
    await mirrorGradingToAllInstructors(gradingDocId, grading);

    // Mirror to school if set
    if (grading.schoolId) {
      await mirrorGradingToSchool(gradingDocId, grading, grading.schoolId);
    }

    // Add grading to the student's gradingDocIds
    if (grading.studentMemberDocId) {
      await db
        .collection('members')
        .doc(grading.studentMemberDocId)
        .update({
          gradingDocIds: admin.firestore.FieldValue.arrayUnion(gradingDocId),
        });
    }

    // Notify the instructor of new request
    if (grading.status === GradingStatus.AwaitingAcceptance && grading.gradingInstructorId) {
      const instructorMemberDocId = await findInstructorMemberDocId(grading.gradingInstructorId);
      if (instructorMemberDocId) {
        const studentSnap = await db.collection('members').doc(grading.studentMemberDocId).get();
        const studentName = studentSnap.exists ? (studentSnap.data()?.name || 'A student') : 'A student';
        const msg = `**${studentName}** has requested you to grade them for **${grading.level}**.`;
        await createNotification(
          instructorMemberDocId,
          {
            markdown: msg,
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingRequestsYouAsInstructor,
            data: {
              gradingDocId,
              studentName,
              level: grading.level,
            },
          }
        );
      }
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
    grading.docId = snap.after.id;
    const previous = snap.before.data() as Grading;
    previous.docId = snap.before.id;
    const gradingDocId = snap.after.id;

    // Determine which instructor IDs changed
    const previousPrimaryInstructor = await getPrimaryInstructorId(previous.studentMemberDocId);
    const currentPrimaryInstructor = await getPrimaryInstructorId(grading.studentMemberDocId);

    const previousInstructorIds = new Set(
      [previous.gradingInstructorId, ...previous.assistantInstructorIds, previousPrimaryInstructor].filter(
        (id) => id && id !== '',
      ) as string[],
    );
    const currentInstructorIds = new Set(
      [grading.gradingInstructorId, ...grading.assistantInstructorIds, currentPrimaryInstructor].filter(
        (id) => id && id !== '',
      ) as string[],
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
      grading.studentMemberId &&
      grading.level !== StudentLevel.None
    ) {
      // Look up the student by their human-readable memberId
      const studentQuery = await db
        .collection('members')
        .where('memberId', '==', grading.studentMemberId)
        .limit(1)
        .get();
      if (!studentQuery.empty) {
        const studentDoc = studentQuery.docs[0];
        const { type, value } = extractLevelValue(grading.level);
        const update: any = {
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (type === 'Student') {
          update.studentLevel = value;
        } else if (type === 'Application') {
          update.applicationLevel = value;
        } else {
          // Fallback if type is null
          update.studentLevel = grading.level;
        }

        await studentDoc.ref.update(update);
        logger.info(
          `Student ${grading.studentMemberId} ${type || 'student'}Level updated to ${value || grading.level} from grading ${gradingDocId}.`,
        );
      } else {
        logger.warn(
          `Could not find student with memberId ${grading.studentMemberId} to update level.`,
        );
      }
    }

    // Handle student change: update gradingDocIds on member docs
    if (previous.studentMemberDocId !== grading.studentMemberDocId) {
      // Remove from previous student
      if (previous.studentMemberDocId) {
        await db
          .collection('members')
          .doc(previous.studentMemberDocId)
          .update({
            gradingDocIds:
              admin.firestore.FieldValue.arrayRemove(gradingDocId),
          });
      }
      // Add to new student
      if (grading.studentMemberDocId) {
        await db
          .collection('members')
          .doc(grading.studentMemberDocId)
          .update({
            gradingDocIds:
              admin.firestore.FieldValue.arrayUnion(gradingDocId),
          });
      }
    }

    // Notify student if instructor accepted grading request
    if (
      grading.status === GradingStatus.AwaitingGrading &&
      previous.status === GradingStatus.AwaitingAcceptance &&
      grading.studentMemberDocId
    ) {
      const instructorMemberDocId = await findInstructorMemberDocId(grading.gradingInstructorId);
      let instructorName = 'Your instructor';
      if (instructorMemberDocId) {
        const instSnap = await db.collection('members').doc(instructorMemberDocId).get();
        instructorName = instSnap.exists ? (instSnap.data()?.name || 'Your instructor') : 'Your instructor';
      }
      const msg = `Sifu **${instructorName}** has accepted your grading request for **${grading.level}**!`;
      await createNotification(
        grading.studentMemberDocId,
        {
          markdown: msg,
          createdAt: new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.GradingRequestAccepted,
          data: {
            gradingDocId,
            level: grading.level,
          },
        }
      );
    }

    // Notify student if instructor declined grading request
    if (
      grading.status === GradingStatus.Declined &&
      previous.status === GradingStatus.AwaitingAcceptance &&
      grading.studentMemberDocId
    ) {
      const instructorMemberDocId = await findInstructorMemberDocId(grading.gradingInstructorId);
      let instructorName = 'Your instructor';
      if (instructorMemberDocId) {
        const instSnap = await db.collection('members').doc(instructorMemberDocId).get();
        instructorName = instSnap.exists ? (instSnap.data()?.name || 'Your instructor') : 'Your instructor';
        // Cancel the declined instructor's notifications if any
        await cancelAndDismissGradingNotifications(
          instructorMemberDocId,
          gradingDocId,
          NotificationKind.GradingRequestsYouAsInstructor
        );
      }
      const msg = `Sifu **${instructorName}** has declined your grading request for **${grading.level}**. Please select a different instructor.`;
      await createNotification(
        grading.studentMemberDocId,
        {
          markdown: msg,
          createdAt: new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.GradingRequestDeclined,
          data: {
            gradingDocId,
            level: grading.level,
          },
        }
      );
    }

    // Notify instructor if assigned/reassigned and is AwaitingAcceptance
    if (
      grading.status === GradingStatus.AwaitingAcceptance &&
      (previous.status !== GradingStatus.AwaitingAcceptance || previous.gradingInstructorId !== grading.gradingInstructorId) &&
      grading.gradingInstructorId
    ) {
      // Cancel previous instructor's notifications if any
      if (previous.gradingInstructorId && previous.gradingInstructorId !== grading.gradingInstructorId) {
        const oldInstructorMemberDocId = await findInstructorMemberDocId(previous.gradingInstructorId);
        if (oldInstructorMemberDocId) {
          await cancelAndDismissGradingNotifications(
            oldInstructorMemberDocId,
            gradingDocId,
            NotificationKind.GradingRequestsYouAsInstructor
          );
        }
      }

      const instructorMemberDocId = await findInstructorMemberDocId(grading.gradingInstructorId);
      if (instructorMemberDocId) {
        const studentSnap = await db.collection('members').doc(grading.studentMemberDocId).get();
        const studentName = studentSnap.exists ? (studentSnap.data()?.name || 'A student') : 'A student';
        const msg = `**${studentName}** has requested you to grade them for **${grading.level}**.`;
        await createNotification(
          instructorMemberDocId,
          {
            markdown: msg,
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingRequestsYouAsInstructor,
            data: {
              gradingDocId,
              studentName,
              level: grading.level,
            },
          }
        );
      }
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
    grading.docId = snap.id;
    const gradingDocId = snap.id;

    // Remove from all instructors
    await removeGradingFromAllInstructors(gradingDocId, grading);

    // Remove from school if set
    if (grading.schoolId) {
      await removeGradingFromSchool(gradingDocId, grading.schoolId);
    }

    // Remove grading from the student's gradingDocIds
    if (grading.studentMemberDocId) {
      await db
        .collection('members')
        .doc(grading.studentMemberDocId)
        .update({
          gradingDocIds: admin.firestore.FieldValue.arrayRemove(gradingDocId),
        });
      // Cancel and dismiss the student's grading notifications
      await cancelAndDismissGradingNotifications(grading.studentMemberDocId, gradingDocId);
    }

    // Cancel and dismiss the instructors' grading notifications
    const instructorIds = new Set([
      grading.gradingInstructorId,
      ...grading.assistantInstructorIds,
    ].filter((id) => id && id !== '') as string[]);

    for (const id of instructorIds) {
      const instructorMemberDocId = await findInstructorMemberDocId(id);
      if (instructorMemberDocId) {
        await cancelAndDismissGradingNotifications(instructorMemberDocId, gradingDocId);
      }
    }

    logger.info(`Grading ${gradingDocId} deleted and mirrors removed.`);
  },
);
