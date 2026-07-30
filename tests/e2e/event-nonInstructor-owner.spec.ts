/*
 * Emulator-driven e2e test for the user story:
 *   A non-instructor can be an event's owner / main contact.
 *
 * Exercises the real event Cloud Function triggers (`onEventCreated` /
 * `onEventUpdated`) against the Firebase emulator, proving that the owner
 * pipeline never depends on the owner being a licensed instructor:
 *   - a non-instructor owner (instructorId === '') has their emails resolved and
 *     the event mirrored into /members/{ownerDocId}/events (their "My Events");
 *   - when the event becomes publicly listed, that owner receives the
 *     NewEventPosted notification (fanned out by member doc ID, not instructorId).
 *
 * Run via `pnpm test:e2e` (starts the Firestore + Functions emulators with
 * `firebase emulators:exec` then runs this spec). Not part of `pnpm test`.
 */

// Must be set before firebase-admin is imported so the SDK talks to the emulator.
process.env['FIRESTORE_EMULATOR_HOST'] ||= '127.0.0.1:8080';
process.env['FIREBASE_AUTH_EMULATOR_HOST'] ||= '127.0.0.1:9099';

import * as admin from 'firebase-admin';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EventSourceKind,
  EventStatus,
  NotificationKind,
  initEvent,
  initMember,
  type IlcEvent,
  type MemberNotification,
} from '../../functions/src/data-model';

const PROJECT_ID = 'demo-ilc-test';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

const seedMember = (docId: string, overrides: Record<string, unknown>) =>
  db.collection('members').doc(docId).set({ ...initMember(), ...overrides });

// Poll until `predicate` is satisfied or the timeout elapses (triggers run async).
async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (v: T) => boolean,
  label: string,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${label}. Last: ${JSON.stringify(last)}`);
}

describe('story: event-nonInstructor-owner', () => {
  const suffix = Date.now().toString(36);
  const ownerDocId = `owner-${suffix}`;
  const eventDocId = `event-${suffix}`;

  beforeAll(async () => {
    // A non-instructor owner: instructorId is empty, but they have contact emails.
    await seedMember(ownerDocId, {
      name: 'Non Instructor Owner',
      memberId: 'NIO001',
      instructorId: '',
      emails: ['owner@example.com'],
      publicEmail: 'owner@example.com',
    });

    // A member-proposed event owned by the non-instructor, with the cached owner
    // identity + inline mini-profile the organise form would have written.
    const event: Omit<IlcEvent, 'docId'> = {
      ...initEvent(),
      title: 'Community Workshop',
      start: '2026-09-01',
      end: '2026-09-02',
      status: EventStatus.Proposed,
      kind: EventSourceKind.FirebaseSourced,
      ownerDocId,
      managerDocIds: [ownerDocId],
      ownerName: 'Non Instructor Owner',
      ownerMemberId: 'NIO001',
      ownerInstructorId: '',
      ownerContactEmail: 'owner@example.com',
      ownerContactUrl: 'https://example.com/workshop',
      leadingInstructorId: '',
      // The owner is listed as a public contact (with the display fields left
      // for the trigger to fill in), alongside a stale entry for someone who is
      // no longer on the organising team.
      contacts: [
        {
          memberDocId: ownerDocId,
          name: '',
          memberId: '',
          instructorId: '',
          contactEmail: 'owner@example.com',
          contactUrl: 'https://example.com/workshop',
        },
        {
          memberDocId: 'removed-manager',
          name: 'Removed Manager',
          memberId: 'RM001',
          instructorId: '',
          contactEmail: '',
          contactUrl: '',
        },
      ],
    };
    await db.collection('events').doc(eventDocId).set(event);
  });

  afterAll(async () => {
    await db.terminate();
  });

  it('resolves the non-instructor owner emails and mirrors to their My Events', async () => {
    // onEventCreated enriches ownerEmails; onEventUpdated then mirrors the event
    // into the owner's /members/{docId}/events subcollection.
    const enriched = await waitFor(
      async () => (await db.collection('events').doc(eventDocId).get()).data() as IlcEvent,
      (e) => (e.ownerEmails || []).includes('owner@example.com'),
      'ownerEmails enrichment',
    );
    expect(enriched.ownerInstructorId).toBe('');
    expect(enriched.ownerContactEmail).toBe('owner@example.com');

    const mirrored = await waitFor(
      async () =>
        (
          await db
            .collection('members')
            .doc(ownerDocId)
            .collection('events')
            .doc(eventDocId)
            .get()
        ).data(),
      (d) => !!d,
      'My Events mirror',
    );
    expect(mirrored?.['title']).toBe('Community Workshop');
  });

  it('keeps only the contacts still on the team and fills their cached name', async () => {
    const event = await waitFor(
      async () => (await db.collection('events').doc(eventDocId).get()).data() as IlcEvent,
      (e) => (e.contacts || []).length === 1,
      'contacts pruning',
    );
    expect(event.contacts).toEqual([{
      memberDocId: ownerDocId,
      name: 'Non Instructor Owner',
      memberId: 'NIO001',
      instructorId: '',
      contactEmail: 'owner@example.com',
      contactUrl: 'https://example.com/workshop',
    }]);
  });

  it('notifies the non-instructor owner when the event becomes listed', async () => {
    await db.collection('events').doc(eventDocId).update({
      status: EventStatus.Listed,
      lastUpdated: new Date().toISOString(),
    });

    const note = await waitFor(
      async () => {
        const snap = await db
          .collection('members')
          .doc(ownerDocId)
          .collection('notifications')
          .where('data.eventId', '==', eventDocId)
          .get();
        return snap.docs.map((d) => d.data() as MemberNotification);
      },
      (notes) => notes.some((n) => n.kind === NotificationKind.NewEventPosted),
      'NewEventPosted notification for the owner',
    );
    expect(note.some((n) => n.kind === NotificationKind.NewEventPosted)).toBe(true);
  });
});
