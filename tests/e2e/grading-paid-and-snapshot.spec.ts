/*
 * Emulator-driven e2e tests for the PR2 grading-trigger behaviours:
 *   - the student's level is only updated once a grading is BOTH passed and paid
 *     (an unpaid pass does not promote them; later marking it paid does);
 *   - the student's level snapshot is captured from the member record when the
 *     grading is accepted (status -> AwaitingGrading);
 *   - the student's primary instructor (sifu) is notified when their student
 *     makes a grading request.
 *
 * Exercises the real `onGradingCreated` / `onGradingUpdated` Cloud Functions
 * against the Firebase emulator. Run via `pnpm test:e2e`.
 */

process.env['FIRESTORE_EMULATOR_HOST'] ||= '127.0.0.1:8080';
process.env['FIREBASE_AUTH_EMULATOR_HOST'] ||= '127.0.0.1:9099';

import * as admin from 'firebase-admin';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GradingStatus,
  NotificationKind,
  PaymentStatus,
  initGrading,
  type Grading,
  type MemberNotification,
} from '../../functions/src/data-model';

const PROJECT_ID = 'demo-ilc-test';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

// Poll until `read()` returns a value satisfying `predicate`, or time out.
async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (v: T) => boolean,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 400));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting. Last value: ${JSON.stringify(last!)}`);
}

const memberLevel = (docId: string) => async () => {
  const snap = await db.collection('members').doc(docId).get();
  const d = (snap.data() as Record<string, unknown> | undefined) || {};
  return {
    studentLevel: (d.studentLevel as string) || '',
    applicationLevel: (d.applicationLevel as string) || '',
  };
};

const gradingDoc = (docId: string) => async () =>
  (await db.collection('gradings').doc(docId).get()).data() as Grading | undefined;

afterAll(async () => {
  await db.terminate();
});

describe('story: grading level updates only once paid', () => {
  const suffix = Date.now().toString(36);
  const studentDocId = `pg-student-${suffix}`;
  const memberId = `PG-${suffix}`;
  let gradingDocId = '';

  beforeAll(async () => {
    await db.collection('members').doc(studentDocId).set({
      name: 'Paid Gating Student',
      memberId,
      studentLevel: '',
      applicationLevel: '',
      primaryInstructorId: '',
      gradingDocIds: [],
    });
    const ref = db.collection('gradings').doc();
    gradingDocId = ref.id;
    await ref.set({
      ...initGrading(),
      level: 'Student 1',
      studentMemberId: memberId,
      studentMemberDocId: studentDocId,
      status: GradingStatus.AwaitingGrading,
      paymentStatus: PaymentStatus.NotYetPaid,
    });
  });

  it('does not promote the student while the passed grading is unpaid', async () => {
    await db.collection('gradings').doc(gradingDocId).update({
      status: GradingStatus.Passed,
      lastUpdated: ts(),
    });
    // Give the trigger time to run, then assert the level is still unset.
    await new Promise((r) => setTimeout(r, 3000));
    const { studentLevel } = await memberLevel(studentDocId)();
    expect(studentLevel).toBe('');
  });

  it('promotes the student once the grading is marked paid', async () => {
    await db.collection('gradings').doc(gradingDocId).update({
      paymentStatus: PaymentStatus.PaidByCash,
      lastUpdated: ts(),
    });
    const { studentLevel } = await waitFor(
      memberLevel(studentDocId),
      (v) => v.studentLevel === '1',
    );
    expect(studentLevel).toBe('1');
  });
});

describe('story: grading captures the level snapshot at acceptance', () => {
  const suffix = Date.now().toString(36);
  const studentDocId = `sn-student-${suffix}`;
  let gradingDocId = '';

  beforeAll(async () => {
    await db.collection('members').doc(studentDocId).set({
      name: 'Snapshot Student',
      memberId: `SN-${suffix}`,
      studentLevel: '3',
      applicationLevel: '1',
      primaryInstructorId: '',
      gradingDocIds: [],
    });
    const ref = db.collection('gradings').doc();
    gradingDocId = ref.id;
    await ref.set({
      ...initGrading(),
      level: 'Student 4',
      studentMemberId: `SN-${suffix}`,
      studentMemberDocId: studentDocId,
      gradingInstructorId: 'INST-SN',
      status: GradingStatus.AwaitingAcceptance,
    });
  });

  it('snapshots the student levels when the grading is accepted', async () => {
    await db.collection('gradings').doc(gradingDocId).update({
      status: GradingStatus.AwaitingGrading,
      acceptedByMemberDocId: studentDocId,
      statusChangedByMemberDocId: studentDocId,
      lastUpdated: ts(),
    });
    const g = await waitFor(
      gradingDoc(gradingDocId),
      (v) => !!v && v.studentLevelAtAcceptance === '3',
    );
    expect(g!.studentLevelAtAcceptance).toBe('3');
    expect(g!.applicationLevelAtAcceptance).toBe('1');
  });
});

describe('story: sifu notified when their student requests a grading', () => {
  const suffix = Date.now().toString(36);
  const sifuDocId = `rq-sifu-${suffix}`;
  const sifuInstructorId = `SIFU-${suffix}`;
  const studentDocId = `rq-student-${suffix}`;
  let gradingDocId = '';

  beforeAll(async () => {
    await db.collection('members').doc(sifuDocId).set({
      name: 'Sifu R',
      instructorId: sifuInstructorId,
    });
    await db.collection('members').doc(studentDocId).set({
      name: 'Requesting Student',
      memberId: `RQ-${suffix}`,
      primaryInstructorId: sifuInstructorId,
      gradingDocIds: [],
    });
    const ref = db.collection('gradings').doc();
    gradingDocId = ref.id;
    await ref.set({
      ...initGrading(),
      level: 'Student 1',
      studentMemberId: `RQ-${suffix}`,
      studentMemberDocId: studentDocId,
      status: GradingStatus.AwaitingRequest,
    });
  });

  it('notifies the sifu when the student selects a different instructor', async () => {
    await db.collection('gradings').doc(gradingDocId).update({
      status: GradingStatus.AwaitingAcceptance,
      gradingInstructorId: 'INST-OTHER',
      statusChangedByMemberDocId: studentDocId,
      statusChangedByName: 'Requesting Student',
      lastUpdated: ts(),
    });
    const note = await waitFor(
      async () => {
        const snap = await db
          .collection('members')
          .doc(sifuDocId)
          .collection('notifications')
          .where('data.gradingDocId', '==', gradingDocId)
          .get();
        return snap.docs.map((d) => d.data() as MemberNotification);
      },
      (notes) =>
        notes.some(
          (n) =>
            n.kind === NotificationKind.GradingRequestsYouAsInstructor &&
            n.markdown.includes('has requested a grading'),
        ),
    );
    expect(note.length).toBeGreaterThan(0);
  });
});

describe('story: new grading requests blocked while a grading is unpaid', () => {
  const suffix = Date.now().toString(36);
  const studentDocId = `rg-student-${suffix}`;
  const memberId = `RG-${suffix}`;
  const adminDocId = `rg-admin-${suffix}`;
  let unpaidDocId = '';
  let newDocId = '';

  beforeAll(async () => {
    await db.collection('members').doc(studentDocId).set({
      name: 'Request Guard Student',
      memberId,
      isAdmin: false,
      gradingDocIds: [],
    });
    await db.collection('members').doc(adminDocId).set({
      name: 'Admin A',
      isAdmin: true,
    });
    // A completed grading that has not been paid.
    const unpaidRef = db.collection('gradings').doc();
    unpaidDocId = unpaidRef.id;
    await unpaidRef.set({
      ...initGrading(),
      level: 'Student 1',
      studentMemberId: memberId,
      studentMemberDocId: studentDocId,
      status: GradingStatus.Passed,
      paymentStatus: PaymentStatus.NotYetPaid,
    });
    // A fresh grading the student will try to request.
    const newRef = db.collection('gradings').doc();
    newDocId = newRef.id;
    await newRef.set({
      ...initGrading(),
      level: 'Student 2',
      studentMemberId: memberId,
      studentMemberDocId: studentDocId,
      status: GradingStatus.AwaitingRequest,
    });
  });

  it('reverts a student request and notifies them when a grading is unpaid', async () => {
    await db.collection('gradings').doc(newDocId).update({
      status: GradingStatus.AwaitingAcceptance,
      gradingInstructorId: 'INST-RG',
      statusChangedByMemberDocId: studentDocId,
      statusChangedByName: 'Request Guard Student',
      lastUpdated: ts(),
    });
    // The trigger reverts the status back to AwaitingRequest.
    const g = await waitFor(
      gradingDoc(newDocId),
      (v) => !!v && v.status === GradingStatus.AwaitingRequest,
    );
    expect(g!.status).toBe(GradingStatus.AwaitingRequest);
    // The student is told why.
    await waitFor(
      async () => {
        const snap = await db
          .collection('members')
          .doc(studentDocId)
          .collection('notifications')
          .where('data.gradingDocId', '==', newDocId)
          .get();
        return snap.docs.map((d) => d.data() as MemberNotification);
      },
      (notes) => notes.some((n) => n.kind === NotificationKind.GradingUnpaid),
    );
  });

  it('lets an admin request despite the unpaid grading', async () => {
    // Reset the new grading to AwaitingRequest first.
    await db.collection('gradings').doc(newDocId).update({
      status: GradingStatus.AwaitingRequest,
      gradingInstructorId: '',
      lastUpdated: ts(),
    });
    await new Promise((r) => setTimeout(r, 1500));
    await db.collection('gradings').doc(newDocId).update({
      status: GradingStatus.AwaitingAcceptance,
      gradingInstructorId: 'INST-RG',
      statusChangedByMemberDocId: adminDocId,
      statusChangedByName: 'Admin A',
      lastUpdated: ts(),
    });
    // Give the trigger time, then confirm it was NOT reverted.
    await new Promise((r) => setTimeout(r, 3000));
    const g = await gradingDoc(newDocId)();
    expect(g!.status).toBe(GradingStatus.AwaitingAcceptance);
  });
});
