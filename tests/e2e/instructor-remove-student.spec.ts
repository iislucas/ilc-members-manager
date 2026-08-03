/*
 * Emulator-driven e2e test for the user story:
 *   An instructor can remove a student who lists them as their primary instructor.
 *
 * Exercises the real `removeStudentFromInstructor` callable (invoked over HTTP
 * against the Functions emulator, the way the browser client calls it) together
 * with the `onMemberUpdated` trigger it relies on:
 *   - the student's primaryInstructorId is cleared;
 *   - the mirrored /instructors/{docId}/members/{studentDocId} entry — the
 *     source of the instructor's "My Students" list — is torn down;
 *   - the student is notified and told to talk to the instructor if it was a
 *     mistake;
 *   - an instructor who is NOT the student's primary instructor is refused.
 *
 * Run via `pnpm test:e2e` (starts the Firestore + Functions emulators with
 * `firebase emulators:exec` then runs this spec). Not part of `pnpm test`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callFunction,
  db,
  fakeIdToken,
  seedMember,
  waitFor,
} from './emulator-helpers';
import {
  NotificationKind,
  type Member,
  type MemberNotification,
} from '../../functions/src/data-model';

describe('story: instructor-remove-student', () => {
  const suffix = Date.now().toString(36);
  const sifuDocId = `sifu-${suffix}`;
  const otherSifuDocId = `other-sifu-${suffix}`;
  const studentDocId = `student-${suffix}`;
  const sifuEmail = `sifu-${suffix}@example.com`;
  const otherSifuEmail = `other-sifu-${suffix}@example.com`;
  const sifuInstructorId = `INST-${suffix}`;
  const otherInstructorId = `INST-OTHER-${suffix}`;

  beforeAll(async () => {
    await seedMember(sifuDocId, {
      name: 'Sifu Sam',
      memberId: `FR${suffix}`,
      instructorId: sifuInstructorId,
      emails: [sifuEmail],
    });
    await seedMember(otherSifuDocId, {
      name: 'Sifu Other',
      memberId: `FR9${suffix}`,
      instructorId: otherInstructorId,
      emails: [otherSifuEmail],
    });
    await seedMember(studentDocId, {
      name: 'Student Stan',
      memberId: `FR23${suffix}`,
      emails: [`student-${suffix}@example.com`],
      primaryInstructorId: sifuInstructorId,
    });

    // onMemberCreated builds the ACL entries the callable reads to work out
    // which member profiles each login email manages.
    await waitFor(
      async () => (await db.collection('acl').doc(sifuEmail).get()).data(),
      (d) => !!d && (d['memberDocIds'] || []).includes(sifuDocId),
      'ACL entry for the instructor',
    );
    await waitFor(
      async () => (await db.collection('acl').doc(otherSifuEmail).get()).data(),
      (d) => !!d && (d['memberDocIds'] || []).includes(otherSifuDocId),
      'ACL entry for the other instructor',
    );

    // The student shows up in the instructor's My Students list via this mirror.
    await waitFor(
      async () =>
        (
          await db
            .collection('instructors')
            .doc(sifuDocId)
            .collection('members')
            .doc(studentDocId)
            .get()
        ).exists,
      (exists) => exists,
      'student mirrored into the instructor’s My Students',
    );
  });

  afterAll(async () => {
    await db.terminate();
  });

  it('refuses an instructor who is not the student’s primary instructor', async () => {
    const res = await callFunction(
      'removeStudentFromInstructor',
      { studentMemberDocId: studentDocId },
      fakeIdToken('other-sifu-uid', otherSifuEmail),
    );
    expect(res.status).toBe(403);
    expect(res.body.error?.status).toBe('PERMISSION_DENIED');

    // The student is untouched.
    const student = (await db.collection('members').doc(studentDocId).get()).data() as Member;
    expect(student.primaryInstructorId).toBe(sifuInstructorId);
  });

  it('clears the primary instructor and tears down the My Students mirror', async () => {
    const res = await callFunction(
      'removeStudentFromInstructor',
      { studentMemberDocId: studentDocId },
      fakeIdToken('sifu-uid', sifuEmail),
    );
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ success: true });

    const student = (await db.collection('members').doc(studentDocId).get()).data() as Member;
    expect(student.primaryInstructorId).toBe('');

    await waitFor(
      async () =>
        (
          await db
            .collection('instructors')
            .doc(sifuDocId)
            .collection('members')
            .doc(studentDocId)
            .get()
        ).exists,
      (exists) => !exists,
      'student removed from the instructor’s My Students mirror',
    );
  });

  it('notifies the student, pointing them back to the instructor if it was a mistake', async () => {
    const notes = await waitFor(
      async () => {
        const snap = await db
          .collection('members')
          .doc(studentDocId)
          .collection('notifications')
          .get();
        return snap.docs.map((d) => d.data() as MemberNotification);
      },
      (list) => list.some((n) => n.kind === NotificationKind.PrimaryInstructorRemoved),
      'PrimaryInstructorRemoved notification for the student',
    );
    const note = notes.find(
      (n) => n.kind === NotificationKind.PrimaryInstructorRemoved,
    )!;
    expect(note.markdown).toContain('Sifu Sam');
    expect(note.markdown).toContain('#/myProfile');
    expect(note.markdown).toContain('talk to them directly');
    expect(note.data).toMatchObject({
      instructorId: sifuInstructorId,
      instructorName: 'Sifu Sam',
    });
  });

  it('refuses once the student no longer has that primary instructor', async () => {
    const res = await callFunction(
      'removeStudentFromInstructor',
      { studentMemberDocId: studentDocId },
      fakeIdToken('sifu-uid', sifuEmail),
    );
    expect(res.status).toBe(403);
    expect(res.body.error?.status).toBe('PERMISSION_DENIED');
  });
});
