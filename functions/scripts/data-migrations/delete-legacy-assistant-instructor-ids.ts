import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/*
 Data migration: delete the deprecated `assistantInstructorIds` field.

 `assistantInstructorIds` was the legacy name for `gradingManagerIds`. Once
 everything reads/writes `gradingManagerIds` (and existing docs have been
 backfilled with it), this script removes the dead field from:
   - /gradings/{id}
   - the mirrored copies at /instructors/{memberDocId}/gradings/{id}
   - the mirrored copies at /schools/{schoolDocId}/gradings/{id}

 Safety: it only deletes `assistantInstructorIds` and never touches
 `gradingManagerIds`. It is idempotent — docs without the field are skipped — so
 re-running makes no further changes. Run the
 `backfill-grading-managers-paid-level` migration first to guarantee every doc
 has `gradingManagerIds`.

 Usage:
   cd functions
   pnpm run delete-legacy-assistant-instructor-ids --project ilc-paris-class-tracker --dry-run

 Remove --dry-run to actually delete.
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

const LEGACY_FIELD = 'assistantInstructorIds';

async function run() {
  const isDryRun = argv['dry-run'];
  console.log(`Deleting '${LEGACY_FIELD}' from gradings for project: ${projectId}`);
  if (isDryRun) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  // A collection-group query catches the top-level /gradings as well as the
  // mirrored /instructors/*/gradings and /schools/*/gradings copies in one pass.
  const snap = await db.collectionGroup('gradings').get();
  const stats = { total: snap.size, deletedFrom: 0 };
  console.log(`Found ${stats.total} grading docs (including mirrors).`);

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    if (!(LEGACY_FIELD in (doc.data() as Record<string, unknown>))) continue;
    stats.deletedFrom++;
    if (!isDryRun) {
      batch.update(doc.ref, { [LEGACY_FIELD]: FieldValue.delete() });
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
  console.log(`Total grading docs scanned:        ${stats.total}`);
  console.log(`Docs with '${LEGACY_FIELD}' deleted: ${stats.deletedFrom}`);
  if (isDryRun) console.log('(dry run — nothing was saved)');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
