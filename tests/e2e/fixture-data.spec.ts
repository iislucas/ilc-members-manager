/*
 * Emulator e2e for the representative seed fixture.
 *
 * 1. Loads a bounded slice of the active dataset (SEED_FIXTURE_DIR, default
 *    tests/fixtures/seed) into the Firestore emulator via the shared loader and
 *    confirms the docs land and are queryable — i.e. the e2e setup works with
 *    the fixture data.
 * 2. Regression test for the onMemberCreated ACL trigger: a member that has an
 *    email must get an /acl/{email} doc listing its docId. This is the path that
 *    used to crash on `admin.firestore.FieldValue` being undefined in the
 *    emulator (fixed by importing FieldValue from 'firebase-admin/firestore');
 *    no prior test exercised it because their members had no emails.
 *
 * Run via `pnpm test:e2e` (starts Firestore + Functions emulators). Not part of
 * the default `pnpm test`.
 */
process.env['FIRESTORE_EMULATOR_HOST'] ||= '127.0.0.1:8080';
process.env['FIREBASE_AUTH_EMULATOR_HOST'] ||= '127.0.0.1:9099';

import * as admin from 'firebase-admin';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initMember } from '../../functions/src/data-model';
import { loadSeedFixtures, seedFixtureDir } from '../helpers/load-seed-fixtures';

const PROJECT_ID = 'demo-ilc-test';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

// Poll a doc until `predicate` holds or the timeout elapses (triggers run async).
async function waitFor<T>(
  get: () => Promise<T | undefined>,
  predicate: (v: T) => boolean,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await get();
    if (last !== undefined && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting; last seen: ${JSON.stringify(last)}`);
}

describe('story: representative seed fixture', () => {
  let counts: Record<string, number> = {};

  beforeAll(async () => {
    // Keep the member cap small: each member write fans out into the onMember*
    // triggers, and this spec shares the emulator with timing-sensitive specs.
    counts = await loadSeedFixtures(db, admin.firestore.Timestamp, { maxMembers: 8 });
  });

  afterAll(async () => {
    await db.terminate();
  });

  it(`loads the core collections from ${seedFixtureDir()}`, () => {
    expect(counts['members'] ?? 0).toBeGreaterThan(0);
    expect(counts['schools'] ?? 0).toBeGreaterThan(0);
    expect(counts['instructors'] ?? 0).toBeGreaterThan(0);
  });

  it('writes documents that are queryable back from the emulator', async () => {
    const snap = await db.collection('members').limit(5).get();
    expect(snap.size).toBeGreaterThan(0);
    expect(snap.docs[0].id).not.toBe('');
    expect(snap.docs[0].data()['memberId']).toBeDefined();
  });

  it('onMemberCreated builds the ACL for a member that has an email', async () => {
    const suffix = Date.now().toString(36);
    const email = `acl-trigger-${suffix}@example.com`;
    const memberRef = db.collection('members').doc(`acl-trigger-${suffix}`);
    // Base on initMember() for a complete, valid member shape (the trigger's
    // downstream mirrors choke on missing fields); only the email matters here.
    await memberRef.set({
      ...initMember(),
      name: 'ACL Trigger Member',
      memberId: `ACLT-${suffix}`,
      emails: [email],
      membershipType: 'Life',
    });

    const acl = await waitFor(
      async () => {
        const s = await db.collection('acl').doc(email).get();
        return s.exists ? (s.data() as { memberDocIds?: string[] }) : undefined;
      },
      (a) => (a.memberDocIds ?? []).includes(memberRef.id),
    );
    expect(acl.memberDocIds).toContain(memberRef.id);
  });
});
