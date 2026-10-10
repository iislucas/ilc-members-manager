/* normalize-emails.ts
 *
 * One-off, idempotent backfill that rewrites existing Firestore data so every
 * stored email is in its normalised form (trimmed + lower-cased), matching the
 * invariant documented in functions/src/data-model/email.ts. New writes are
 * already normalised by the client and Cloud Functions; this script fixes data
 * written before that change.
 *
 * What it does (only fields/docs that actually need changing are touched):
 *   - /acl/{id} whose id is not normalised: merged into /acl/{normalisedId}
 *     (permissions unioned, never reduced — see mergeAclDocs) and the legacy
 *     doc deleted.
 *   - /members: `emails` (normalised + de-duplicated, primary kept first) and
 *     `publicEmail`.
 *   - /events: `ownerEmails`, `managerEmails`, `updatedByEmail`.
 *   - /schools: `ownerEmails`, `managerEmails` (deprecated fields).
 *   - every `registrations` subcollection (events + members): `email`.
 *   - every `videoGrants` subcollection and /video_grants: `memberEmail`,
 *     `giftedByEmail`; email-keyed /video_grants ids (`${email}_${targetId}`)
 *     with a non-normalised email are moved to the normalised id.
 *   - `lastUpdated` is bumped (server timestamp) on docs that have that field,
 *     so clients' incremental caches pick up the change.
 * Orders are intentionally NOT rewritten (they are not used for access control
 * and writing /orders re-fires the order-processing trigger).
 *
 * DEFAULTS TO A DRY RUN: it only reports what would change. Pass --apply to
 * write. Safe to re-run: a second run reports zero changes.
 *
 * REQUIRED order (see docs/email-normalisation.md):
 *   1. Deploy the new firestore.rules + storage.rules FIRST
 *      (`pnpm deploy:rules`). They accept both the raw and the lower-cased auth
 *      email, so nobody loses access while data is mixed.
 *   2. Deploy functions and hosting (these start normalising new writes; with
 *      the old rules still live they could lock out users whose auth email has
 *      capitals, hence step 1 first).
 *   3. Run this script as a dry run and review the report.
 *   4. Run it again with --apply. (Running it before step 1 would delete
 *      mixed-case ACL ids / rewrite emails that the OLD rules still match by
 *      exact case.)
 *
 * Usage:
 *   cd functions
 *   pnpm run normalize-emails --project <PROJECT_ID>            # dry run
 *   pnpm run normalize-emails --project <PROJECT_ID> --apply    # write changes
 *
 *   # Against the local emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm run normalize-emails --project demo-ilc-test
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { FirestoreCollection, FirestoreSubcollection } from '../src/data-model/collections';
import { normalizeEmail } from '../src/data-model/email';
import { ACL } from '../src/data-model/system';
import { Member } from '../src/data-model/members';
import { IlcEvent, EventRegistration } from '../src/data-model/events';
import { School } from '../src/data-model/schools';
import { VideoGrant } from '../src/data-model/vod';
import {
  planMemberEmailUpdates,
  planEventEmailUpdates,
  planSchoolEmailUpdates,
  planRegistrationEmailUpdates,
  planVideoGrantEmailUpdates,
  planVideoGrantDocIdMove,
  mergeAclDocs,
} from '../src/email-backfill';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase project ID',
    demandOption: false,
  })
  .option('apply', {
    type: 'boolean',
    description: 'Actually write the changes (default: dry run)',
    default: false,
  })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error('Error: Project ID is required. Use --project or the GCLOUD_PROJECT env var.');
  process.exit(1);
}
const apply = argv.apply;

admin.initializeApp({ projectId });
const db = admin.firestore();

// Accumulates writes into batches of at most 400 operations (Firestore's
// limit is 500) and commits them, only when --apply was given.
class BatchWriter {
  private batch = db.batch();
  private count = 0;
  public totalOps = 0;

  async set<T extends object>(ref: admin.firestore.DocumentReference, data: T, merge: boolean): Promise<void> {
    if (!apply) return;
    this.batch.set(ref, data, { merge });
    await this.bump();
  }

  async update<T extends object>(ref: admin.firestore.DocumentReference, data: T): Promise<void> {
    if (!apply) return;
    this.batch.update(ref, data);
    await this.bump();
  }

  async delete(ref: admin.firestore.DocumentReference): Promise<void> {
    if (!apply) return;
    this.batch.delete(ref);
    await this.bump();
  }

  private async bump(): Promise<void> {
    this.count++;
    this.totalOps++;
    if (this.count >= 400) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.count === 0) return;
    await this.batch.commit();
    this.batch = db.batch();
    this.count = 0;
  }
}

// Per-area summary counters printed at the end.
const summary: Record<string, { scanned: number; changed: number; notes: string[] }> = {};
function area(name: string) {
  if (!summary[name]) summary[name] = { scanned: 0, changed: 0, notes: [] };
  return summary[name];
}

// Adds a server-timestamp `lastUpdated` to an update when the doc tracks it,
// so incremental client caches notice the change.
function withLastUpdated<T extends object>(updates: T, hasLastUpdated: boolean): T & { lastUpdated?: FieldValue } {
  return hasLastUpdated ? { ...updates, lastUpdated: FieldValue.serverTimestamp() } : updates;
}

// Applies a planner to every doc of a query and writes the changed fields.
async function normalizeDocs<T extends object>(
  name: string,
  docs: admin.firestore.QueryDocumentSnapshot[],
  plan: (data: Partial<T>) => Partial<T>,
  writer: BatchWriter,
): Promise<void> {
  const stats = area(name);
  for (const doc of docs) {
    stats.scanned++;
    const data = doc.data() as Partial<T>;
    const updates = plan(data);
    if (Object.keys(updates).length === 0) continue;
    stats.changed++;
    console.log(`[${name}] ${doc.ref.path}: ${JSON.stringify(updates)}`);
    await writer.update(doc.ref, withLastUpdated(updates, 'lastUpdated' in data));
  }
}

// Merges every /acl doc whose id is not normalised into the normalised id.
async function normalizeAcls(writer: BatchWriter): Promise<void> {
  const stats = area('acl');
  const snap = await db.collection(FirestoreCollection.Acl).get();
  const byId = new Map<string, Partial<ACL>>();
  snap.docs.forEach((d) => byId.set(d.id, d.data() as Partial<ACL>));
  // Target ACL state after merging, so several legacy variants of the same
  // email (e.g. Foo@x.com and FOO@x.com) all fold into one doc.
  const merged = new Map<string, ACL>();

  for (const doc of snap.docs) {
    stats.scanned++;
    const targetId = normalizeEmail(doc.id);
    if (targetId === doc.id) continue;
    stats.changed++;
    if (!targetId) {
      stats.notes.push(`Skipped ACL with blank id "${doc.id}" (manual review needed).`);
      continue;
    }
    const existing = merged.get(targetId) ?? byId.get(targetId);
    const result = mergeAclDocs(doc.data() as Partial<ACL>, existing);
    merged.set(targetId, result);
    console.log(
      `[acl] merge /acl/${doc.id} -> /acl/${targetId}${existing ? ' (existing doc)' : ' (new doc)'}: ${JSON.stringify(result)}`,
    );
    await writer.delete(doc.ref);
  }
  for (const [targetId, result] of merged) {
    await writer.set(db.collection(FirestoreCollection.Acl).doc(targetId), result, true);
  }
}

// Normalises /video_grants fields and moves email-keyed ids to the normalised id.
async function normalizeGlobalVideoGrants(writer: BatchWriter): Promise<void> {
  const stats = area('video_grants');
  const snap = await db.collection(FirestoreCollection.VideoGrants).get();
  const existingIds = new Set(snap.docs.map((d) => d.id));
  for (const doc of snap.docs) {
    stats.scanned++;
    const data = doc.data() as Partial<VideoGrant>;
    const updates = planVideoGrantEmailUpdates(data);
    const newId = planVideoGrantDocIdMove(doc.id, data.memberEmail);
    if (Object.keys(updates).length === 0 && !newId) continue;
    stats.changed++;
    const hasLastUpdated = 'lastUpdated' in data;
    if (newId && !existingIds.has(newId)) {
      console.log(`[video_grants] move ${doc.id} -> ${newId}: ${JSON.stringify(updates)}`);
      existingIds.add(newId);
      await writer.set(
        db.collection(FirestoreCollection.VideoGrants).doc(newId),
        withLastUpdated({ ...data, ...updates }, hasLastUpdated),
        false,
      );
      await writer.delete(doc.ref);
    } else {
      if (newId) {
        stats.notes.push(`Grant ${doc.id}: normalised id ${newId} already exists; kept both (fields normalised in place).`);
      }
      console.log(`[video_grants] ${doc.id}: ${JSON.stringify(updates)}`);
      if (Object.keys(updates).length > 0) {
        await writer.update(doc.ref, withLastUpdated(updates, hasLastUpdated));
      }
    }
  }
}

async function run(): Promise<void> {
  console.log(`normalize-emails for project: ${projectId}`);
  console.log(apply ? '--- APPLY MODE: changes WILL be written ---' : '--- DRY RUN: no changes will be written (pass --apply) ---');

  const writer = new BatchWriter();

  await normalizeAcls(writer);

  const members = await db.collection(FirestoreCollection.Members).get();
  await normalizeDocs<Member>('members', members.docs, planMemberEmailUpdates, writer);

  const events = await db.collection(FirestoreCollection.Events).get();
  await normalizeDocs<IlcEvent>('events', events.docs, planEventEmailUpdates, writer);

  const schools = await db.collection(FirestoreCollection.Schools).get();
  await normalizeDocs<School>('schools', schools.docs, planSchoolEmailUpdates, writer);

  const registrations = await db.collectionGroup(FirestoreSubcollection.Registrations).get();
  await normalizeDocs<EventRegistration>('registrations', registrations.docs, planRegistrationEmailUpdates, writer);

  const memberGrants = await db.collectionGroup(FirestoreSubcollection.VideoGrants).get();
  await normalizeDocs<VideoGrant>('members/*/videoGrants', memberGrants.docs, planVideoGrantEmailUpdates, writer);

  await normalizeGlobalVideoGrants(writer);

  await writer.flush();

  console.log('\n=== Summary ===');
  for (const [name, stats] of Object.entries(summary)) {
    console.log(`${name}: scanned ${stats.scanned}, ${apply ? 'changed' : 'would change'} ${stats.changed}`);
    stats.notes.forEach((n) => console.log(`  note: ${n}`));
  }
  console.log(apply ? `Wrote ${writer.totalOps} operations.` : 'Dry run complete; re-run with --apply to write.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('normalize-emails failed:', err);
    process.exit(1);
  });
