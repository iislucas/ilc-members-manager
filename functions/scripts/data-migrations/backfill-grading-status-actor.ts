import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { initGrading } from '../../src/data-model';

/*
 Data migration: backfill grading status-actor fields.

 Two pairs of fields track "who did what" on a grading:
   - acceptedByMemberDocId / acceptedByName        — who accepted the request
   - statusChangedByMemberDocId / statusChangedByName — who last changed status

 Older grading documents either lack these entirely, or were written during
 development with the now-removed flat `acceptedByMemberDocId` only. This script
 brings every grading up to date:

   1. Ensures all four fields exist (defaulting to '' via initGrading()).
   2. If `acceptedByMemberDocId` is set but `acceptedByName` is empty, looks up
      the member's name and fills it in.
   3. If the grading was accepted (acceptedByMemberDocId set) but the
      statusChangedBy* pair is empty, seeds it from the acceptance — the
      acceptance was the most recent recorded status action we know of.

 The script is idempotent: re-running it makes no further changes.

 Usage:
   cd functions
   pnpm run backfill-grading-status-actor --project ilc-paris-class-tracker --dry-run

 If running against the local emulator or with GCLOUD_PROJECT set:
   pnpm run backfill-grading-status-actor --dry-run

 Remove --dry-run to actually save changes.
*/

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    demandOption: false,
  })
  .option('dry-run', {
    type: 'boolean',
    description: 'If true, no changes will be made to Firestore',
    default: false,
  })
  .parseSync();

const projectId =
  argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Error: Project ID is required. Use --project or GCLOUD_PROJECT env var.',
  );
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

// Cache member-docId → name lookups so we don't re-read the same member.
const nameCache = new Map<string, string>();
async function memberName(docId: string): Promise<string> {
  if (!docId) return '';
  if (nameCache.has(docId)) return nameCache.get(docId)!;
  const snap = await db.collection('members').doc(docId).get();
  const name = snap.exists ? (snap.data()?.name as string) || '' : '';
  nameCache.set(docId, name);
  return name;
}

async function run() {
  const isDryRun = argv['dry-run'];
  console.log(`Backfilling grading status-actor fields for project: ${projectId}`);
  if (isDryRun) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const defaults = initGrading();
  const stats = { total: 0, updated: 0, namesFilled: 0, statusSeeded: 0 };

  const snap = await db.collection('gradings').get();
  stats.total = snap.size;
  console.log(`Found ${stats.total} gradings.`);

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    // 1. Ensure all four actor fields exist (default '').
    for (const key of [
      'acceptedByMemberDocId',
      'acceptedByName',
      'statusChangedByMemberDocId',
      'statusChangedByName',
    ] as const) {
      if (data[key] === undefined) {
        update[key] = defaults[key];
      }
    }

    const acceptedByDocId =
      (update.acceptedByMemberDocId as string | undefined) ??
      (data.acceptedByMemberDocId as string | undefined) ??
      '';

    // 2. Fill acceptedByName from the member if we have a docId but no name.
    const acceptedByName =
      (update.acceptedByName as string | undefined) ??
      (data.acceptedByName as string | undefined) ??
      '';
    if (acceptedByDocId && !acceptedByName) {
      update.acceptedByName = await memberName(acceptedByDocId);
      stats.namesFilled++;
    }

    // 3. Seed statusChangedBy* from the acceptance if it is still empty.
    const statusDocId =
      (update.statusChangedByMemberDocId as string | undefined) ??
      (data.statusChangedByMemberDocId as string | undefined) ??
      '';
    if (acceptedByDocId && !statusDocId) {
      update.statusChangedByMemberDocId = acceptedByDocId;
      update.statusChangedByName =
        (update.acceptedByName as string | undefined) ||
        acceptedByName ||
        (await memberName(acceptedByDocId));
      stats.statusSeeded++;
    }

    if (Object.keys(update).length === 0) continue;

    stats.updated++;
    console.log(`  Grading ${doc.id}: ${Object.keys(update).join(', ')}`);
    if (!isDryRun) {
      batch.update(doc.ref, update);
      batchCount++;
      if (batchCount >= 100) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  if (!isDryRun && batchCount > 0) {
    await batch.commit();
  }

  console.log('\n--- Summary ---');
  console.log(`Total gradings:        ${stats.total}`);
  console.log(`Updated:               ${stats.updated}`);
  console.log(`acceptedByName filled: ${stats.namesFilled}`);
  console.log(`statusChangedBy seeded: ${stats.statusSeeded}`);
  if (isDryRun) console.log('(dry run — nothing was saved)');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
