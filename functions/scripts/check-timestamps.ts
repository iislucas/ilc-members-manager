import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/**
 * Script to check all lastUpdated fields in all top-level collections
 * (and explicitly subcollections if needed) to ensure they are
 * Firestore Timestamps, and not strings.
 * 
 * Usage:
 *   cd functions
 *   pnpm run check-timestamps --fix --project <YOUR_PROJECT_ID>
 */

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    demandOption: false,
  })
  .option('fix', {
    type: 'boolean',
    description: 'If true, string timestamps will be converted to Timestamps',
    default: false,
  })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Error: Project ID is required. Use --project or GCLOUD_PROJECT env var.',
  );
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function run() {
  console.log(`Checking lastUpdated fields for project: ${projectId}`);
  if (argv['fix']) {
    console.log('--- FIX MODE: Invalid string timestamps will be converted ---');
  } else {
    console.log('--- READONLY MODE: No fixes will be applied (pass --fix to apply) ---');
  }

  let batch = db.batch();
  let batchCount = 0;

  async function commitBatchIfNeeded(force = false) {
    if (batchCount > 0 && (force || batchCount >= 500)) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Define explicitly the collections that have lastUpdated.
  // Using collectionGroups ensures we check nested documents (e.g. members inside schools)
  const collectionGroups = [
    'members',
    'schools',
    'instructors',
    'orders',
    'gradings'
  ];

  let totalDocsChecked = 0;
  let invalidDocs = 0;
  let fixedDocs = 0;

  for (const cg of collectionGroups) {
    console.log(`\n--- Checking collectionGroup: ${cg} ---`);
    const snap = await db.collectionGroup(cg).get();

    let cgInvalidDocs = 0;

    for (const doc of snap.docs) {
      totalDocsChecked++;
      const data = doc.data();

      const lastUpdated = data.lastUpdated;
      if (!lastUpdated) continue;

      if (typeof lastUpdated === 'string') {
        invalidDocs++;
        cgInvalidDocs++;
        console.log(`❌ Invalid (String): ${doc.ref.path} => "${lastUpdated}"`);

        if (argv['fix']) {
          const newTimestamp = admin.firestore.Timestamp.fromDate(new Date(lastUpdated));
          batch.update(doc.ref, { lastUpdated: newTimestamp });
          batchCount++;
          fixedDocs++;
          await commitBatchIfNeeded();
        }
      } else if (lastUpdated && typeof lastUpdated.toDate !== 'function') {
        invalidDocs++;
        cgInvalidDocs++;
        console.log(`❌ Invalid (Not Timestamp): ${doc.ref.path} => ${JSON.stringify(lastUpdated)}`);

        // Cannot automatically safely fix unknown random types
      }
    }

    if (cgInvalidDocs === 0) {
      console.log(`✅ All ${snap.size} documents in '${cg}' have correct Timestamps!`);
    }
  }

  if (argv['fix']) {
    console.log('\nCommitting final fixes batch...');
    await commitBatchIfNeeded(true);
  }

  console.log('\n======================================');
  console.log('Summary:');
  console.log(`Checked ${totalDocsChecked} total documents.`);
  console.log(`Found ${invalidDocs} invalid lastUpdated fields.`);
  if (argv['fix']) {
    console.log(`Fixed ${fixedDocs} string timestamps.`);
  }
  console.log('======================================');
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
