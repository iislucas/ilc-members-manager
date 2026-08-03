/*
 * Emulator-driven e2e test for the user story:
 *   An instructor can record a lapsed membership as Inactive for a student who
 *   lists them as their primary instructor, so that student drops out of the
 *   default view of their My Students list.
 *
 * Exercises the real `markStudentInactive` callable (invoked over HTTP against
 * the Functions emulator, the way the browser client calls it) together with
 * the `onMemberUpdated` trigger it relies on:
 *   - the student's membershipType becomes Inactive, and nothing else about the
 *     relationship changes (they are still the instructor's student);
 *   - the change reaches the mirrored /instructors/{docId}/members/{studentDocId}
 *     entry, which is what the My Students list actually reads;
 *   - the student is notified, and told renewing reactivates them;
 *   - a still-current membership is refused, as is an instructor who is NOT the
 *     student's primary instructor.
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
  MembershipType,
  NotificationKind,
  type Member,
  type MemberNotification,
} from '../../functions/src/data-model';

describe('story: instructor-mark-student-inactive', () => {
  const suffix = Date.now().toString(36);
  const sifuDocId = `mi-sifu-${suffix}`;
  const otherSifuDocId = `mi-other-sifu-${suffix}`;
  const lapsedDocId = `mi-lapsed-${suffix}`;
  const currentDocId = `mi-current-${suffix}`;
  const sifuEmail = `mi-sifu-${suffix}@example.com`;
  const otherSifuEmail = `mi-other-sifu-${suffix}@example.com`;
  const sifuInstructorId = `MI-INST-${suffix}`;
  const otherInstructorId = `MI-INST-OTHER-${suffix}`;

  const readMember = async (docId: string) =>
    (await db.collection('members').doc(docId).get()).data() as Member;

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
    // A student whose annual membership ran out a long time ago.
    await seedMember(lapsedDocId, {
      name: 'Lapsed Lee',
      memberId: `FR23${suffix}`,
      emails: [`mi-lapsed-${suffix}@example.com`],
      primaryInstructorId: sifuInstructorId,
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2020-01-01',
    });
    // A student of the same instructor whose membership is still current.
    await seedMember(currentDocId, {
      name: 'Current Chris',
      memberId: `FR24${suffix}`,
      emails: [`mi-current-${suffix}@example.com`],
      primaryInstructorId: sifuInstructorId,
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2099-12-31',
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

    // The students show up in the instructor's My Students list via this mirror.
    await waitFor(
      async () =>
        (
          await db
            .collection('instructors')
            .doc(sifuDocId)
            .collection('members')
            .doc(lapsedDocId)
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
      'markStudentInactive',
      { studentMemberDocId: lapsedDocId },
      fakeIdToken('mi-other-sifu-uid', otherSifuEmail),
    );
    expect(res.status).toBe(403);
    expect(res.body.error?.status).toBe('PERMISSION_DENIED');

    const student = await readMember(lapsedDocId);
    expect(student.membershipType).toBe(MembershipType.Annual);
  });

  // The guard that stops this being a way to switch off a paid-up membership.
  it('refuses a student whose membership is still current', async () => {
    const res = await callFunction(
      'markStudentInactive',
      { studentMemberDocId: currentDocId },
      fakeIdToken('mi-sifu-uid', sifuEmail),
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.status).toBe('FAILED_PRECONDITION');

    const student = await readMember(currentDocId);
    expect(student.membershipType).toBe(MembershipType.Annual);
  });

  it('marks a lapsed membership inactive and leaves the relationship intact', async () => {
    const res = await callFunction(
      'markStudentInactive',
      { studentMemberDocId: lapsedDocId },
      fakeIdToken('mi-sifu-uid', sifuEmail),
    );
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ success: true });

    const student = await readMember(lapsedDocId);
    expect(student.membershipType).toBe(MembershipType.Inactive);
    // Still this instructor's student — this action only changes the status.
    expect(student.primaryInstructorId).toBe(sifuInstructorId);

    // The My Students list reads the mirror, so the new status has to reach it
    // for the student to be filtered out of the default view.
    await waitFor(
      async () =>
        (
          await db
            .collection('instructors')
            .doc(sifuDocId)
            .collection('members')
            .doc(lapsedDocId)
            .get()
        ).data() as Member | undefined,
      (m) => !!m && m.membershipType === MembershipType.Inactive,
      'Inactive status mirrored into the instructor’s My Students',
    );
  });

  it('notifies the student that renewing makes them active again', async () => {
    const notes = await waitFor(
      async () => {
        const snap = await db
          .collection('members')
          .doc(lapsedDocId)
          .collection('notifications')
          .get();
        return snap.docs.map((d) => d.data() as MemberNotification);
      },
      (list) => list.some((n) => n.kind === NotificationKind.MembershipMarkedInactive),
      'MembershipMarkedInactive notification for the student',
    );
    const note = notes.find(
      (n) => n.kind === NotificationKind.MembershipMarkedInactive,
    )!;
    expect(note.markdown).toContain('Sifu Sam');
    expect(note.markdown).toContain('](/products)');
    expect(note.markdown).toContain('still your primary instructor');
    expect(note.data).toMatchObject({
      instructorId: sifuInstructorId,
      instructorName: 'Sifu Sam',
    });
  });

  it('refuses a second attempt, once the student is already inactive', async () => {
    const res = await callFunction(
      'markStudentInactive',
      { studentMemberDocId: lapsedDocId },
      fakeIdToken('mi-sifu-uid', sifuEmail),
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.status).toBe('FAILED_PRECONDITION');
    expect(res.body.error?.message).toContain('already marked inactive');
  });
});
