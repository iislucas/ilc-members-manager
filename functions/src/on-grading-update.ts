import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
// Use the modular FieldValue export rather than `admin.firestore.FieldValue`:
// the namespaced accessor is `undefined` inside the Functions emulator runtime,
// which crashes trigger writes that use serverTimestamp()/arrayUnion(). The
// named import works in both the emulator and production.
import { FieldValue } from 'firebase-admin/firestore';
import { Grading, GradingStatus, StudentLevel, NotificationKind, MemberNotification, gradingManagerIdsOf, isGradingPaid } from './data-model';
import { canonicalizeGradingLevel, extractLevelValue } from './level-utils';
import { createMemberNotification } from './notifications';
import * as logger from 'firebase-functions/logger';

const db = admin.firestore();

// Thin wrapper around the shared helper, binding the module-level db handle.
async function createNotification(
  memberDocId: string,
  notification: Omit<MemberNotification, 'docId'>,
): Promise<void> {
  await createMemberNotification(db, memberDocId, notification);
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
      lastUpdated: FieldValue.serverTimestamp(),
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

// The member docIds of an event's organizer + managers, plus the event title.
interface EventManagers {
  docIds: string[];
  title: string;
}

/**
 * Resolve the member docIds of the owner and managers of a linked event, plus
 * the event title (for notification messages). Returns an empty result when the
 * eventDocId is empty or the event document no longer exists. Grading-manager
 * status for event staff is derived live from these (never cached on the
 * grading), so unlinking/relinking automatically revokes/grants access.
 */
async function resolveEventManagers(
  eventDocId: string | undefined,
): Promise<EventManagers> {
  if (!eventDocId) return { docIds: [], title: '' };
  const snap = await db.collection('events').doc(eventDocId).get();
  if (!snap.exists) return { docIds: [], title: '' };
  const data = snap.data() || {};
  const docIds = [data.ownerDocId, ...(data.managerDocIds || [])].filter(
    (id) => id && id !== '',
  ) as string[];
  return { docIds: [...new Set(docIds)], title: data.title || '' };
}

/** Look up a member's display name by their Firestore doc ID. */
async function getMemberName(
  memberDocId: string | undefined,
  fallback: string,
): Promise<string> {
  if (!memberDocId) return fallback;
  const snap = await db.collection('members').doc(memberDocId).get();
  return snap.exists ? snap.data()?.name || fallback : fallback;
}

/**
 * Resolve a member's display name from a Firestore doc ID, falling back to the
 * human-readable memberId when the doc ID is missing or doesn't resolve. Some
 * gradings carry only a studentMemberId, so we look up by that too.
 */
async function getMemberNameByDocIdOrMemberId(
  memberDocId: string | undefined,
  memberId: string | undefined,
): Promise<string> {
  if (memberDocId) {
    const snap = await db.collection('members').doc(memberDocId).get();
    if (snap.exists && snap.data()?.name) return snap.data()!.name;
  }
  if (memberId) {
    const q = await db
      .collection('members')
      .where('memberId', '==', memberId)
      .limit(1)
      .get();
    if (!q.empty && q.docs[0].data()?.name) return q.docs[0].data().name;
  }
  return '';
}

/**
 * Resolve the denormalized display-name snapshots cached on a grading: the
 * student's name and the primary grading instructor's name. Returns '' for
 * either when the referenced member can't be found. See the Grading.studentName
 * / gradingInstructorName fields for why these are cached.
 */
async function resolveGradingNames(
  grading: Grading,
): Promise<{ studentName: string; gradingInstructorName: string }> {
  const studentName = await getMemberNameByDocIdOrMemberId(
    grading.studentMemberDocId,
    grading.studentMemberId,
  );
  let gradingInstructorName = '';
  if (grading.gradingInstructorId) {
    const instructorMemberDocId = await findInstructorMemberDocId(
      grading.gradingInstructorId,
    );
    gradingInstructorName = await getMemberName(instructorMemberDocId, '');
  }
  return { studentName, gradingInstructorName };
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
 * Resolve the student's primary instructor (sifu) to notify about a grading
 * action, plus the student's display name. Returns undefined (i.e. don't
 * notify) when the student has no resolvable primary instructor, or when the
 * sifu is the member who performed the action (`actorMemberDocId`) or is the
 * student themselves. `actorMemberDocId` is who accepted or recorded the
 * result, so the sifu is never notified about their own action.
 *
 * story: docs/user-stories/grading-sifu-notifications.md
 */
async function resolvePrimaryInstructorToNotify(
  grading: Grading,
  actorMemberDocId: string,
): Promise<{ sifuMemberDocId: string; studentName: string } | undefined> {
  const primaryInstructorId = await getPrimaryInstructorId(grading.studentMemberDocId);
  if (!primaryInstructorId) return undefined;
  const sifuMemberDocId = await findInstructorMemberDocId(primaryInstructorId);
  if (!sifuMemberDocId) return undefined;
  if (sifuMemberDocId === actorMemberDocId) return undefined;
  if (sifuMemberDocId === grading.studentMemberDocId) return undefined;
  const studentName = await getMemberName(grading.studentMemberDocId, 'Your student');
  return { sifuMemberDocId, studentName };
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
    ...gradingManagerIdsOf(grading),
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
    ...gradingManagerIdsOf(grading),
    primaryInstructor
  ].filter((id) => id && id !== '') as string[]);

  for (const instructorId of instructorIds) {
    await removeGradingFromInstructor(gradingDocId, instructorId);
  }
}

/**
 * Notify a set of event organizers/managers that they have been added as (or
 * removed as) managers of a grading because it was linked to (or unlinked from)
 * their event. Skips the student themselves.
 */
async function notifyEventManagers(
  memberDocIds: string[],
  added: boolean,
  grading: Grading,
  gradingDocId: string,
  studentName: string,
  event: EventManagers,
  eventDocId: string,
): Promise<void> {
  const gradingHref = `#/gradings/${gradingDocId}`;
  for (const memberDocId of memberDocIds) {
    if (memberDocId === grading.studentMemberDocId) continue;
    const msg = added
      ? `You are now a manager of **${studentName}**'s grading for **${grading.level}**, ` +
        `linked to your event **${event.title}**. ` +
        `[Open the grading](${gradingHref}) to accept or record the result.`
      : `**${studentName}** has unlinked their grading for **${grading.level}** from your event ` +
        `**${event.title}**, so they are no longer requesting you as one of its grading managers.`;
    await createNotification(memberDocId, {
      markdown: msg,
      createdAt: new Date().toISOString(),
      dismissed: false,
      kind: added
        ? NotificationKind.GradingManagerAdded
        : NotificationKind.GradingManagerRemoved,
      data: {
        gradingDocId,
        studentName,
        level: grading.level,
        eventDocId,
        eventTitle: event.title,
      },
    });
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

    // Cache the student/instructor display names so non-admin viewers (who can't
    // read members/instructors) see names instead of IDs. Set on the in-memory
    // grading first so the mirrored copies below carry the names too, then write
    // them back to the source doc if they were missing/stale. The write-back
    // re-fires onGradingUpdated, which re-resolves and finds them unchanged.
    const resolvedNames = await resolveGradingNames(grading);
    grading.studentName = resolvedNames.studentName;
    grading.gradingInstructorName = resolvedNames.gradingInstructorName;

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
          gradingDocIds: FieldValue.arrayUnion(gradingDocId),
        });
    }

    // Notify the student that their grading was purchased, guiding them to the
    // next step. Skipped when the grading still needs admin review (it isn't
    // yet actionable by the student) or has no linked student.
    if (grading.studentMemberDocId && grading.status !== GradingStatus.RequiresReview) {
      const awaitingInstructor = grading.status === GradingStatus.AwaitingRequest;
      const gradingHref = `#/gradings/${gradingDocId}`;
      const msg = awaitingInstructor
        ? `🥋 Your grading for **${grading.level}** is ready! Next step: choose the instructor who will grade you. ` +
          `[Open your grading](${gradingHref}) to select your instructor and send your request.`
        : `🥋 Your grading for **${grading.level}** has been set up and your request has been sent to your selected instructor. ` +
          `[View your grading](${gradingHref}) to track its progress.`;
      await createNotification(
        grading.studentMemberDocId,
        {
          markdown: msg,
          createdAt: new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.GradingPurchased,
          data: {
            gradingDocId,
            level: grading.level,
          },
        }
      );
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

      // Also notify the student's primary instructor (sifu), unless they are the
      // selected grading instructor (already notified above).
      const primaryInstructorId = await getPrimaryInstructorId(grading.studentMemberDocId);
      if (primaryInstructorId && primaryInstructorId !== grading.gradingInstructorId) {
        const sifu = await resolvePrimaryInstructorToNotify(
          grading,
          grading.statusChangedByMemberDocId,
        );
        if (sifu) {
          const gradingHref = `#/gradings/${gradingDocId}`;
          const instructorName = await getMemberName(
            await findInstructorMemberDocId(grading.gradingInstructorId),
            'another instructor',
          );
          await createNotification(sifu.sifuMemberDocId, {
            markdown:
              `Your student **${sifu.studentName}** has requested a grading for **${grading.level}** ` +
              `from **${instructorName}**. [Open the grading](${gradingHref}).`,
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingRequestsYouAsInstructor,
            data: {
              gradingDocId,
              studentName: sifu.studentName,
              level: grading.level,
            },
          });
        }
      }
    }

    // If the grading is created already linked to an event, notify the event's
    // organizer and managers that they are now managers of this grading.
    if (grading.gradingEventDocId) {
      const event = await resolveEventManagers(grading.gradingEventDocId);
      if (event.docIds.length > 0) {
        const studentName = await getMemberName(grading.studentMemberDocId, 'A student');
        await notifyEventManagers(
          event.docIds,
          true,
          grading,
          gradingDocId,
          studentName,
          event,
          grading.gradingEventDocId,
        );
      }
    }

    // Persist the cached names to the source grading if they weren't already
    // stored (e.g. the client created the doc without them).
    const storedStudentName = (snap.data() as Grading).studentName || '';
    const storedInstructorName = (snap.data() as Grading).gradingInstructorName || '';
    if (
      storedStudentName !== grading.studentName ||
      storedInstructorName !== grading.gradingInstructorName
    ) {
      await snap.ref.update({
        studentName: grading.studentName,
        gradingInstructorName: grading.gradingInstructorName,
      });
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

    // Re-resolve the cached display names from the current student/instructor so
    // they stay in sync on every update. Set on the in-memory grading first so
    // the sub-collection mirrors below carry the fresh names. Captured stored
    // values are compared at the end to decide whether a write-back is needed
    // (the write-back re-fires this trigger, which then finds them unchanged).
    const storedStudentName = grading.studentName || '';
    const storedInstructorName = grading.gradingInstructorName || '';
    const resolvedNames = await resolveGradingNames(grading);
    grading.studentName = resolvedNames.studentName;
    grading.gradingInstructorName = resolvedNames.gradingInstructorName;

    // Determine which instructor IDs changed
    const previousPrimaryInstructor = await getPrimaryInstructorId(previous.studentMemberDocId);
    const currentPrimaryInstructor = await getPrimaryInstructorId(grading.studentMemberDocId);

    const previousInstructorIds = new Set(
      [previous.gradingInstructorId, ...gradingManagerIdsOf(previous), previousPrimaryInstructor].filter(
        (id) => id && id !== '',
      ) as string[],
    );
    const currentInstructorIds = new Set(
      [grading.gradingInstructorId, ...gradingManagerIdsOf(grading), currentPrimaryInstructor].filter(
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

    // Selected instructors notifications and de-duplication (excluding student's primary instructor)
    const previousSelected = new Set(
      [previous.gradingInstructorId, ...gradingManagerIdsOf(previous)].filter(
        (id) => id && id !== '',
      ) as string[],
    );
    const currentSelected = new Set(
      [grading.gradingInstructorId, ...gradingManagerIdsOf(grading)].filter(
        (id) => id && id !== '',
      ) as string[],
    );

    const addedSelected = [...currentSelected].filter((id) => !previousSelected.has(id));
    const removedSelected = [...previousSelected].filter((id) => !currentSelected.has(id));

    if (addedSelected.length > 0 || removedSelected.length > 0) {
      const studentSnap = await db.collection('members').doc(grading.studentMemberDocId).get();
      const studentName = studentSnap.exists ? (studentSnap.data()?.name || 'A student') : 'A student';

      for (const id of addedSelected) {
        const instructorMemberDocId = await findInstructorMemberDocId(id);
        if (instructorMemberDocId) {
          const isMain = grading.gradingInstructorId === id;
          const role = isMain ? 'grading instructor' : 'grading manager';
          const msg = `You have been assigned as the **${role}** to grade **${studentName}** for **${grading.level}**.`;
          await createNotification(
            instructorMemberDocId,
            {
              markdown: msg,
              createdAt: new Date().toISOString(),
              dismissed: false,
              kind: NotificationKind.GradingManagerAdded,
              data: {
                gradingDocId,
                studentName,
                level: grading.level,
              },
            }
          );
        }
      }

      for (const id of removedSelected) {
        const instructorMemberDocId = await findInstructorMemberDocId(id);
        if (instructorMemberDocId) {
          const msg = `You have been removed as a grading manager for **${studentName}**'s grading for **${grading.level}**.`;
          await createNotification(
            instructorMemberDocId,
            {
              markdown: msg,
              createdAt: new Date().toISOString(),
              dismissed: false,
              kind: NotificationKind.GradingManagerRemoved,
              data: {
                gradingDocId,
                studentName,
                level: grading.level,
              },
            }
          );
        }
      }
    }

    // Handle school change
    if (previous.schoolId && previous.schoolId !== grading.schoolId) {
      await removeGradingFromSchool(gradingDocId, previous.schoolId);
    }
    if (grading.schoolId) {
      await mirrorGradingToSchool(gradingDocId, grading, grading.schoolId);
    }

    // Update the student's level once a grading is BOTH passed and paid. This
    // fires when the grading just became passed (and is already paid) or when an
    // already-passed grading is later marked paid — so an unpaid pass does not
    // promote the student until payment is recorded.
    const isPaid = isGradingPaid(grading);
    const becamePassed =
      grading.status === GradingStatus.Passed && previous.status !== GradingStatus.Passed;
    const becamePaidWhilePassed =
      grading.status === GradingStatus.Passed && isPaid && !isGradingPaid(previous);
    if (
      grading.status === GradingStatus.Passed &&
      isPaid &&
      (becamePassed || becamePaidWhilePassed) &&
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
          lastUpdated: FieldValue.serverTimestamp(),
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
    } else if (becamePassed && !isPaid) {
      logger.info(
        `Grading ${gradingDocId} passed but not paid (status ${grading.paymentStatus}); ` +
          `student ${grading.studentMemberId} level NOT updated until payment is recorded.`,
      );
    }

    // Notify the student when their grading result is recorded.
    if (grading.studentMemberDocId) {
      const gradingHref = `#/gradings/${gradingDocId}`;
      if (
        grading.status === GradingStatus.Passed &&
        previous.status !== GradingStatus.Passed
      ) {
        await createNotification(
          grading.studentMemberDocId,
          {
            markdown:
              `🎉 Congratulations! You passed your grading for **${grading.level}**. ` +
              `Wonderful work — savour the moment, and enjoy the journey ahead. ` +
              `[See your instructor's notes](${gradingHref}).`,
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingPassed,
            data: {
              gradingDocId,
              level: grading.level,
            },
          }
        );
        // Also notify the student's primary instructor (sifu), unless they are
        // the one who recorded the result.
        // story: docs/user-stories/grading-sifu-notifications.md
        const sifu = await resolvePrimaryInstructorToNotify(
          grading,
          grading.statusChangedByMemberDocId,
        );
        if (sifu) {
          await createNotification(sifu.sifuMemberDocId, {
            markdown:
              `🎉 Your student **${sifu.studentName}** passed their grading for **${grading.level}**. ` +
              `[See the result](${gradingHref}).`,
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingPassed,
            data: {
              gradingDocId,
              level: grading.level,
            },
          });
        }
      } else if (
        grading.status === GradingStatus.NotPassed &&
        previous.status !== GradingStatus.NotPassed
      ) {
        await createNotification(
          grading.studentMemberDocId,
          {
            markdown:
              `🙏 Your grading result for **${grading.level}** is in. Not quite this time — ` +
              `but every grading is a step forward, and your instructor's notes will help guide your practice. ` +
              `[Read your feedback](${gradingHref}) and keep going!`,
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingNotPassed,
            data: {
              gradingDocId,
              level: grading.level,
            },
          }
        );
        // Also notify the student's primary instructor (sifu), unless they are
        // the one who recorded the result.
        // story: docs/user-stories/grading-sifu-notifications.md
        const sifu = await resolvePrimaryInstructorToNotify(
          grading,
          grading.statusChangedByMemberDocId,
        );
        if (sifu) {
          await createNotification(sifu.sifuMemberDocId, {
            markdown:
              `Your student **${sifu.studentName}**'s grading result for **${grading.level}** is in: ` +
              `not passed this time. [See the result](${gradingHref}).`,
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingNotPassed,
            data: {
              gradingDocId,
              level: grading.level,
            },
          });
        }
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
              FieldValue.arrayRemove(gradingDocId),
          });
      }
      // Add to new student
      if (grading.studentMemberDocId) {
        await db
          .collection('members')
          .doc(grading.studentMemberDocId)
          .update({
            gradingDocIds:
              FieldValue.arrayUnion(gradingDocId),
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

      // Also notify the student's primary instructor (sifu) that their
      // student's grading request was accepted, unless the sifu is the one who
      // accepted it. story: docs/user-stories/grading-sifu-notifications.md
      const sifu = await resolvePrimaryInstructorToNotify(
        grading,
        grading.acceptedByMemberDocId,
      );
      if (sifu) {
        const gradingHref = `#/gradings/${gradingDocId}`;
        const acceptorName = grading.acceptedByName || 'a grading manager';
        await createNotification(sifu.sifuMemberDocId, {
          markdown:
            `Your student **${sifu.studentName}**'s grading request for **${grading.level}** ` +
            `has been accepted by **${acceptorName}**. [Open the grading](${gradingHref}).`,
          createdAt: new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.GradingRequestAccepted,
          data: {
            gradingDocId,
            level: grading.level,
          },
        });
      }
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

    // Notify the student's primary instructor (sifu) when their student makes a
    // grading request — only on a fresh request (not reassignment), and not when
    // the sifu is the selected grading instructor (they already get the request
    // notification above). story: docs/user-stories/grading-sifu-notifications.md
    if (
      grading.status === GradingStatus.AwaitingAcceptance &&
      previous.status !== GradingStatus.AwaitingAcceptance &&
      grading.gradingInstructorId
    ) {
      const primaryInstructorId = await getPrimaryInstructorId(grading.studentMemberDocId);
      if (primaryInstructorId && primaryInstructorId !== grading.gradingInstructorId) {
        const sifu = await resolvePrimaryInstructorToNotify(
          grading,
          grading.statusChangedByMemberDocId,
        );
        if (sifu) {
          const gradingHref = `#/gradings/${gradingDocId}`;
          const instructorName = await getMemberName(
            await findInstructorMemberDocId(grading.gradingInstructorId),
            'another instructor',
          );
          await createNotification(sifu.sifuMemberDocId, {
            markdown:
              `Your student **${sifu.studentName}** has requested a grading for **${grading.level}** ` +
              `from **${instructorName}**. [Open the grading](${gradingHref}).`,
            createdAt: new Date().toISOString(),
            dismissed: false,
            kind: NotificationKind.GradingRequestsYouAsInstructor,
            data: {
              gradingDocId,
              studentName: sifu.studentName,
              level: grading.level,
            },
          });
        }
      }
    }

    // Handle event-link change: notify event organizers/managers that they have
    // gained or lost grading-manager status. Status is derived live from the
    // link (no cached field), so we only need to notify on the transition.
    if (previous.gradingEventDocId !== grading.gradingEventDocId) {
      const beforeEvent = await resolveEventManagers(previous.gradingEventDocId);
      const afterEvent = await resolveEventManagers(grading.gradingEventDocId);
      const added = afterEvent.docIds.filter((id) => !beforeEvent.docIds.includes(id));
      const removed = beforeEvent.docIds.filter((id) => !afterEvent.docIds.includes(id));
      if (added.length > 0 || removed.length > 0) {
        const studentName = await getMemberName(grading.studentMemberDocId, 'A student');
        await notifyEventManagers(
          added, true, grading, gradingDocId, studentName, afterEvent, grading.gradingEventDocId,
        );
        await notifyEventManagers(
          removed, false, grading, gradingDocId, studentName, beforeEvent, previous.gradingEventDocId,
        );
      }
    }

    // When a grading manager accepts the request, update the other managers'
    // "you are now a manager" notifications to say who accepted it.
    if (
      grading.status === GradingStatus.AwaitingGrading &&
      previous.status === GradingStatus.AwaitingAcceptance
    ) {
      await annotateManagerNotificationsWithAcceptor(grading, gradingDocId);
    }

    // Capture the student's level snapshot when the grading is accepted (moves
    // to AwaitingGrading), if not already captured. This is the authoritative
    // record of the level the student held going in, so we no longer infer it
    // from `grading.level`.
    const acceptedNow =
      grading.status === GradingStatus.AwaitingGrading &&
      previous.status !== GradingStatus.AwaitingGrading;
    const snapshotMissing =
      !grading.studentLevelAtAcceptance && !grading.applicationLevelAtAcceptance;
    let snapshotUpdate:
      | { studentLevelAtAcceptance: string; applicationLevelAtAcceptance: string }
      | undefined;
    if (acceptedNow && snapshotMissing && grading.studentMemberDocId) {
      const studentSnap = await db
        .collection('members')
        .doc(grading.studentMemberDocId)
        .get();
      if (studentSnap.exists) {
        const d = studentSnap.data() || {};
        snapshotUpdate = {
          studentLevelAtAcceptance: (d.studentLevel as string) || '',
          applicationLevelAtAcceptance: (d.applicationLevel as string) || '',
        };
      }
    }

    // Write the refreshed cached names (and any acceptance level snapshot) back
    // to the source grading. Skipping the write when nothing changed stops the
    // trigger re-firing in a loop.
    const writeBack: Record<string, unknown> = {};
    if (storedStudentName !== grading.studentName) {
      writeBack.studentName = grading.studentName;
    }
    if (storedInstructorName !== grading.gradingInstructorName) {
      writeBack.gradingInstructorName = grading.gradingInstructorName;
    }
    if (snapshotUpdate) {
      writeBack.studentLevelAtAcceptance = snapshotUpdate.studentLevelAtAcceptance;
      writeBack.applicationLevelAtAcceptance = snapshotUpdate.applicationLevelAtAcceptance;
    }
    if (Object.keys(writeBack).length > 0) {
      await snap.after.ref.update(writeBack);
    }

    logger.info(`Grading ${gradingDocId} updated and re-mirrored.`);
  },
);

/**
 * After a grading is accepted, find the other managers' GradingManagerAdded
 * notifications for this grading and append a note naming who accepted it.
 * Managers are: the event organizer/managers (derived live from the linked
 * event) plus the primary and assistant grading instructors. The acceptor
 * (grading.acceptedByMemberDocId) is skipped.
 */
async function annotateManagerNotificationsWithAcceptor(
  grading: Grading,
  gradingDocId: string,
): Promise<void> {
  const acceptorName =
    grading.acceptedByName ||
    (await getMemberName(grading.acceptedByMemberDocId, 'A grading manager'));

  const managerDocIds = new Set<string>();
  const event = await resolveEventManagers(grading.gradingEventDocId);
  for (const id of event.docIds) managerDocIds.add(id);
  const instructorIds = [grading.gradingInstructorId, ...gradingManagerIdsOf(grading)].filter(
    (id) => id && id !== '',
  ) as string[];
  for (const instructorId of instructorIds) {
    const docId = await findInstructorMemberDocId(instructorId);
    if (docId) managerDocIds.add(docId);
  }
  managerDocIds.delete(grading.acceptedByMemberDocId);

  for (const memberDocId of managerDocIds) {
    const snap = await db
      .collection('members')
      .doc(memberDocId)
      .collection('notifications')
      .where('kind', '==', NotificationKind.GradingManagerAdded)
      .where('data.gradingDocId', '==', gradingDocId)
      .get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const doc of snap.docs) {
      const data = doc.data() as MemberNotification;
      if (data.markdown.includes('accepted by')) continue;
      batch.update(doc.ref, {
        markdown: `${data.markdown}\n\n_Accepted by **${acceptorName}**._`,
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

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
          gradingDocIds: FieldValue.arrayRemove(gradingDocId),
        });
      // Cancel and dismiss the student's grading notifications
      await cancelAndDismissGradingNotifications(grading.studentMemberDocId, gradingDocId);
    }

    // Cancel and dismiss the instructors' grading notifications
    const instructorIds = new Set([
      grading.gradingInstructorId,
      ...gradingManagerIdsOf(grading),
    ].filter((id) => id && id !== '') as string[]);

    for (const id of instructorIds) {
      const instructorMemberDocId = await findInstructorMemberDocId(id);
      if (instructorMemberDocId) {
        await cancelAndDismissGradingNotifications(instructorMemberDocId, gradingDocId);
      }
    }

    // Cancel and dismiss event organizers'/managers' grading notifications.
    const linkedEvent = await resolveEventManagers(grading.gradingEventDocId);
    for (const memberDocId of linkedEvent.docIds) {
      await cancelAndDismissGradingNotifications(memberDocId, gradingDocId);
    }

    logger.info(`Grading ${gradingDocId} deleted and mirrors removed.`);
  },
);
