/* instructor-students.ts
 *
 * Callable Cloud Functions backing the actions an instructor can take on a
 * student who lists them as their primary instructor (the "My Students" list at
 * /my-students): removing the student, and recording a lapsed membership as
 * Inactive so the student drops out of the list's default view.
 *
 * These have to be callables rather than client Firestore writes: the security
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
import {
  canMarkMembershipInactive,
  Member,
  MembershipType,
  NotificationKind,
} from './data-model';
import { allowedOrigins, getUserMemberDocIds } from './common';
import { createMemberNotification } from './notifications';

/**
 * Picks the caller profile entitled to act on `student`: one of the member
 * profiles the caller manages whose instructorId is the student's current
 * primary instructor. Returns undefined when no profile qualifies, which is
 * exactly the "not your student" case.
 */
export function findPrimaryInstructorProfile(
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
 * instructor, points at the profile page where a new primary instructor can be
 * chosen, and invites them to talk to the instructor if this looks like a
 * mistake. Deliberately informational in tone — this is an 'info' notification,
 * so nothing here is presented as a task the student must complete.
 */
export function removedStudentMarkdown(instructor: Member): string {
  const who = `**${instructor.name}** (${instructor.instructorId})`;
  return (
    `${who} has removed you from their student list, so you no longer have a ` +
    `primary instructor.\n\n` +
    `You can [choose a new primary instructor](/myProfile) whenever you like.\n\n` +
    `If you think this was a mistake and you would like ${who} to remain your ` +
    `primary instructor, please talk to them directly and they can add you back.`
  );
}

/**
 * The message the student sees when their primary instructor records their
 * lapsed membership as Inactive. Says who did it and what it means, and points
 * at renewal — but as an option, not a demand: this is an 'info' notification.
 */
export function markedInactiveMarkdown(instructor: Member): string {
  const who = `**${instructor.name}** (${instructor.instructorId})`;
  return (
    `${who}, your primary instructor, has recorded your ILC membership as ` +
    `**inactive**, because it is no longer current.\n\n` +
    `Nothing else changes: ${who} is still your primary instructor and your ` +
    `records are kept. You will not have access to the members' area while ` +
    `your membership is inactive.\n\n` +
    `You can [renew your membership](/products) whenever you like, and it ` +
    `becomes active again straight away. If you think this was a mistake, ` +
    `please talk to ${who} directly.`
  );
}

/**
 * Why `markStudentInactive` turned down a student, phrased for the instructor
 * who tried it. Reached when the UI offered the action against a stale copy of
 * the member, so it has to say which of the three cases applies.
 */
export function markInactiveRefusal(membershipType: MembershipType): string {
  switch (membershipType) {
    case MembershipType.Inactive:
      return 'This student is already marked inactive.';
    case MembershipType.Deceased:
      return 'This student is recorded as deceased, so their status is not changed here.';
    default:
      return 'This student’s membership is still current, so it cannot be marked inactive.';
  }
}

/** The student, their doc ref, and the caller profile allowed to act on them. */
type StudentAndInstructor = {
  db: FirebaseFirestore.Firestore;
  student: Member;
  studentRef: FirebaseFirestore.DocumentReference;
  instructor: Member;
};

/**
 * Shared front half of both callables: authenticate the caller, load the
 * student, and check the caller really is that student's primary instructor.
 * Throws the appropriate HttpsError when any of that fails.
 *
 * `action` names the attempted action ("remove a student") so the error
 * messages the client shows say which one was refused.
 */
async function resolveStudentAndInstructor(
  request: CallableRequest<{ studentMemberDocId: string }>,
  action: string,
): Promise<StudentAndInstructor> {
  if (!request.auth || !request.auth.token.email) {
    throw new HttpsError(
      'unauthenticated',
      `Must be authenticated to ${action}.`,
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

  const instructor = findPrimaryInstructorProfile(callerProfiles, student);
  if (!instructor) {
    throw new HttpsError(
      'permission-denied',
      `You can only ${action} who lists you as their primary instructor.`,
    );
  }

  return { db, student, studentRef, instructor };
}

export const removeStudentFromInstructor = onCall(
  { cors: allowedOrigins },
  async (request: CallableRequest<{ studentMemberDocId: string }>) => {
    const { db, student, studentRef, instructor } =
      await resolveStudentAndInstructor(request, 'remove a student');
    const studentMemberDocId = studentRef.id;

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

/**
 * Records a student's lapsed membership as Inactive, so they drop out of the
 * default (active-only) view of their instructor's My Students list. The
 * student stays the instructor's student — only `membershipType` changes — and
 * renewing a membership sets it back to Annual.
 *
 * Refused for a membership that is still current: `canMarkMembershipInactive`
 * is checked here as well as in the UI, since the client's copy of the member
 * can be stale and the callable is reachable directly.
 */
export const markStudentInactive = onCall(
  { cors: allowedOrigins },
  async (request: CallableRequest<{ studentMemberDocId: string }>) => {
    const { db, student, studentRef, instructor } =
      await resolveStudentAndInstructor(request, 'mark a student inactive');
    const studentMemberDocId = studentRef.id;

    const today = new Date().toISOString().split('T')[0];
    if (!canMarkMembershipInactive(student, today)) {
      throw new HttpsError(
        'failed-precondition',
        markInactiveRefusal(student.membershipType),
      );
    }

    await studentRef.update({
      membershipType: MembershipType.Inactive,
      lastUpdated: FieldValue.serverTimestamp(),
    });

    await createMemberNotification(db, studentMemberDocId, {
      kind: NotificationKind.MembershipMarkedInactive,
      markdown: markedInactiveMarkdown(instructor),
      createdAt: new Date().toISOString(),
      dismissed: false,
      data: {
        instructorId: instructor.instructorId,
        instructorName: instructor.name,
      },
    });

    logger.info(
      `Instructor ${instructor.instructorId} (${instructor.docId}) marked ` +
        `student ${student.memberId} (${studentMemberDocId}) inactive.`,
    );

    return { success: true };
  },
);
