/*
 * Emulator-driven e2e test for the user story:
 *   docs/user-stories/grading-event-managers.md
 *
 * Exercises the real `onGradingUpdated` Cloud Function trigger against the
 * Firebase emulator: linking a grading to an event makes the event's organizer
 * and managers grading managers (and notifies them), and one of those event
 * managers can then accept the grading — notifying the student and annotating
 * the other managers' notifications with who accepted.
 *
 * Run via `pnpm test:e2e` (which starts the Firestore + Functions emulators
 * with `firebase emulators:exec` and then runs this spec). It is not part of
 * the default `pnpm test`.
 */

// Must be set before firebase-admin is imported so the SDK talks to the
// emulator rather than a real project. `emulators:exec` also sets these, but we
// set explicit defaults so the spec is robust if run differently.
process.env['FIRESTORE_EMULATOR_HOST'] ||= '127.0.0.1:8080';
process.env['FIREBASE_AUTH_EMULATOR_HOST'] ||= '127.0.0.1:9099';

import * as admin from 'firebase-admin';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GradingStatus,
  NotificationKind,
  initGrading,
  initMember,
  type Grading,
  type MemberNotification,
} from '../../functions/src/data-model';

const PROJECT_ID = 'demo-ilc-test';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

// Write a complete member doc (initMember defaults + overrides) so the member
// triggers don't choke on undefined fields when mirroring derived docs.
const seedMember = (docId: string, overrides: Record<string, unknown>) =>
  db.collection('members').doc(docId).set({ ...initMember(), ...overrides });

// Poll a member's notifications until one matching `predicate` for the given
// grading appears, or the timeout elapses. Triggers run asynchronously, so we
// cannot assert immediately after a write.
async function waitForNotification(
  memberDocId: string,
  gradingDocId: string,
  predicate: (n: MemberNotification) => boolean,
  timeoutMs = 15000,
): Promise<MemberNotification> {
  const deadline = Date.now() + timeoutMs;
  let last: MemberNotification[] = [];
  while (Date.now() < deadline) {
    const snap = await db
      .collection('members')
      .doc(memberDocId)
      .collection('notifications')
      .where('data.gradingDocId', '==', gradingDocId)
      .get();
    last = snap.docs.map((d) => d.data() as MemberNotification);
    const match = last.find(predicate);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `Timed out waiting for notification (member=${memberDocId}, grading=${gradingDocId}). ` +
      `Saw: ${JSON.stringify(last.map((n) => ({ kind: n.kind, markdown: n.markdown })))}`,
  );
}

// Minimal grading document for the scenario. Based on initGrading() so it stays
// a complete, valid Grading as the type evolves; only the fields this scenario's
// trigger reads are overridden.
function makeGrading(studentMemberDocId: string, studentMemberId: string): Grading {
  return {
    ...initGrading(),
    gradingPurchaseDate: '2026-01-01',
    level: 'Student 1',
    studentMemberId,
    studentMemberDocId,
    status: GradingStatus.AwaitingAcceptance,
  };
}

describe('story: grading-event-managers', () => {
  // Unique-ish ids so reruns within one emulator session don't collide.
  const suffix = Date.now().toString(36);
  const studentDocId = `student-${suffix}`;
  const organizerDocId = `organizer-${suffix}`;
  const managerDocId = `manager-${suffix}`;
  const eventDocId = `event-${suffix}`;
  let gradingDocId = '';

  beforeAll(async () => {
    // Student with no primary instructor (keeps this test focused on the event
    // managers; sifu notifications are a separate story).
    await seedMember(studentDocId, {
      name: 'Test Student',
      memberId: 'TS001',
      primaryInstructorId: '',
      gradingDocIds: [],
    });
    // The event organizer and manager (manager is not a licensed instructor).
    await seedMember(organizerDocId, { name: 'Organizer O' });
    await seedMember(managerDocId, { name: 'Manager M' });
    // The listed event, owned by O and managed by M.
    await db.collection('events').doc(eventDocId).set({
      title: 'Spring Camp',
      ownerDocId: organizerDocId,
      managerDocIds: [managerDocId],
    });
    // The grading, initially not linked to any event.
    const gradingRef = db.collection('gradings').doc();
    gradingDocId = gradingRef.id;
    await gradingRef.set(makeGrading(studentDocId, 'TS001'));
  });

  afterAll(async () => {
    await db.terminate();
  });

  it('caches the student name on the grading so non-admins see it', async () => {
    // The onGradingCreated trigger should denormalize the student's display name
    // onto the grading (studentName) so viewers who cannot read the members
    // collection still see a name instead of a bare ID.
    const deadline = Date.now() + 15000;
    let studentName = '';
    while (Date.now() < deadline) {
      const snap = await db.collection('gradings').doc(gradingDocId).get();
      studentName = (snap.data() as Grading | undefined)?.studentName || '';
      if (studentName) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(studentName).toBe('Test Student');
  });

  it('links the grading to the event, notifying organizer and manager', async () => {
    await db.collection('gradings').doc(gradingDocId).update({
      gradingEventDocId: eventDocId,
      gradingEvent: 'Spring Camp',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    const organizerNote = await waitForNotification(
      organizerDocId,
      gradingDocId,
      (n) => n.kind === NotificationKind.GradingManagerAdded,
    );
    expect(organizerNote.data).toMatchObject({ eventDocId, gradingDocId });

    const managerNote = await waitForNotification(
      managerDocId,
      gradingDocId,
      (n) => n.kind === NotificationKind.GradingManagerAdded,
    );
    expect(managerNote.data).toMatchObject({ eventDocId, gradingDocId });
  });

  it('lets the event manager accept: student notified, other manager annotated', async () => {
    await db.collection('gradings').doc(gradingDocId).update({
      status: GradingStatus.AwaitingGrading,
      acceptedByMemberDocId: managerDocId,
      acceptedByName: 'Manager M',
      statusChangedByMemberDocId: managerDocId,
      statusChangedByName: 'Manager M',
      instructorAcceptedDate: '2026-02-01',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    // The student is told their request was accepted.
    await waitForNotification(
      studentDocId,
      gradingDocId,
      (n) => n.kind === NotificationKind.GradingRequestAccepted,
    );

    // The organizer's "you are now a manager" notification is annotated with
    // who accepted it.
    await waitForNotification(
      organizerDocId,
      gradingDocId,
      (n) =>
        n.kind === NotificationKind.GradingManagerAdded &&
        n.markdown.includes('Accepted by'),
    );

    // The acceptor (manager M) is not annotated about their own acceptance.
    const managerSnap = await db
      .collection('members')
      .doc(managerDocId)
      .collection('notifications')
      .where('data.gradingDocId', '==', gradingDocId)
      .get();
    const managerNotes = managerSnap.docs.map((d) => d.data() as MemberNotification);
    expect(managerNotes.some((n) => n.markdown.includes('Accepted by'))).toBe(false);
  });
});
