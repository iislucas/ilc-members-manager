/* instructor-students.ts
 *
 * Callable Cloud Function letting an instructor remove a student who lists them
 * as their primary instructor (the "My Students" list at /my-students).
 *
 * This has to be a callable rather than a client Firestore write: the security
 * rules only let a member's owner, their school's managers, or an admin write a
 * member document, and an instructor is none of those for their students. The
 * removal itself is just clearing the student's `primaryInstructorId`; the
 * `onMemberUpdated` trigger then takes care of tearing down the mirrored
 * /instructors/{docId}/members/{studentDocId} entry and the grading mirrors.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { Member, NotificationKind } from './data-model';
import { allowedOrigins, getUserMemberDocIds } from './common';
import { createMemberNotification } from './notifications';

/**
 * Picks the caller profile entitled to remove `student`: one of the member
 * profiles the caller manages whose instructorId is the student's current
 * primary instructor. Returns undefined when no profile qualifies, which is
 * exactly the "not your student" case.
 */
export function findRemovingInstructor(
  callerProfiles: Member[],
  student: Member,
): Member | undefined {
  if (!student.primaryInstructorId) return undefined;
  return callerProfiles.find(
    (m) => !!m.instructorId && m.instructorId === student.primaryInstructorId,
  );
}

/**
 * The message the removed student sees in their notification feed. Names the
 * instructor, points at the profile page where a new primary instructor is
 * chosen, and invites them to talk to the instructor if this looks like a
 * mistake.
 */
export function removedStudentMarkdown(instructor: Member): string {
  const who = `**${instructor.name}** (${instructor.instructorId})`;
  return (
    `${who} has removed you from their student list, so you no longer have a ` +
    `primary instructor.\n\n` +
    `Please [choose your primary instructor](#/myProfile) so your membership, ` +
    `gradings and classes stay linked to the right person.\n\n` +
    `If you think this was a mistake and you would like ${who} to remain your ` +
    `primary instructor, please talk to them directly and they can add you back.`
  );
}

export const removeStudentFromInstructor = onCall(
  { cors: allowedOrigins },
  async (request: CallableRequest<{ studentMemberDocId: string }>) => {
    if (!request.auth || !request.auth.token.email) {
      throw new HttpsError(
        'unauthenticated',
        'Must be authenticated to remove a student.',
      );
    }
    const email = request.auth.token.email;
    const studentMemberDocId = request.data?.studentMemberDocId;
    if (!studentMemberDocId) {
      throw new HttpsError('invalid-argument', 'studentMemberDocId is required.');
    }

    const db = admin.firestore();

    const studentRef = db.collection('members').doc(studentMemberDocId);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) {
      throw new HttpsError('not-found', 'Student not found.');
    }
    const student = { ...studentSnap.data(), docId: studentSnap.id } as Member;

    // Resolve the caller's own member profiles from the ACL, then read them so
    // the instructorId check is made against live member docs rather than the
    // ACL's cached copy.
    const callerDocIds = await getUserMemberDocIds(email, db);
    const callerSnaps = await Promise.all(
      callerDocIds.map((docId) => db.collection('members').doc(docId).get()),
    );
    const callerProfiles = callerSnaps
      .filter((snap) => snap.exists)
      .map((snap) => ({ ...snap.data(), docId: snap.id }) as Member);

    const instructor = findRemovingInstructor(callerProfiles, student);
    if (!instructor) {
      throw new HttpsError(
        'permission-denied',
        'You can only remove students who list you as their primary instructor.',
      );
    }

    await studentRef.update({
      primaryInstructorId: '',
      lastUpdated: FieldValue.serverTimestamp(),
    });

    await createMemberNotification(db, studentMemberDocId, {
      kind: NotificationKind.PrimaryInstructorRemoved,
      markdown: removedStudentMarkdown(instructor),
      createdAt: new Date().toISOString(),
      dismissed: false,
      data: {
        instructorId: instructor.instructorId,
        instructorName: instructor.name,
      },
    });

    logger.info(
      `Instructor ${instructor.instructorId} (${instructor.docId}) removed ` +
        `student ${student.memberId} (${studentMemberDocId}).`,
    );

    return { success: true };
  },
);
