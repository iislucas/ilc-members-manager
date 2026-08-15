/* backfill-collection-timestamps.ts
 *
 * One-off / utility script to audit and backfill `lastUpdated` timestamps
 * on all documents across Firestore collections (`instructors`, `members`,
 * `schools`, `events`, `gradings`).
 *
 * Ensures all existing records have a valid timestamp so incremental
 * delta sync (`where('lastUpdated', '>', timestamp)`) functions accurately.
 *
 * Usage:
 *   # Dry run (checks collections and reports count of missing timestamps):
 *   pnpm tsx scripts/backfill-collection-timestamps.ts
 *
 *   # Apply changes with commit:
 *   pnpm tsx scripts/backfill-collection-timestamps.ts --commit
 *
 *   # Target a specific project:
 *   pnpm tsx scripts/backfill-collection-timestamps.ts --project=ilc-paris-class-tracker --commit
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const COMMIT = process.argv.includes('--commit');

const DEFAULT_PROJECT = 'ilc-paris-class-tracker';
const projectArg = process.argv.find((a) => a.startsWith('--project='));
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : DEFAULT_PROJECT;

const TARGET_COLLECTIONS = [
  'instructors',
  'members',
  'schools',
  'events',
  'gradings',
];

async function main() {
  console.log(`Using project: ${PROJECT_ID}`);
  console.log(`Mode: ${COMMIT ? 'COMMIT (writing changes)' : 'DRY RUN (no writes)'}`);

  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  for (const colName of TARGET_COLLECTIONS) {
    console.log(`\nScanning collection: "${colName}"...`);
    const snap = await db.collection(colName).get();
    console.log(`Found ${snap.size} documents in "${colName}".`);

    let missing = 0;
    let present = 0;
    let batch = db.batch();
    let batchOps = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const rawLastUpdated = data.lastUpdated;
      
      let needsUpdate = false;
      let targetTimestamp: Timestamp = Timestamp.now();

      if (!rawLastUpdated) {
        needsUpdate = true;
        targetTimestamp = Timestamp.now();
      } else if (typeof rawLastUpdated?.toDate === 'function') {
        // Already a native Firestore Timestamp!
        needsUpdate = false;
      } else if (typeof rawLastUpdated === 'string') {
        // String format (ISO string) -> convert to Firestore Timestamp
        try {
          const parsedDate = new Date(rawLastUpdated);
          if (!isNaN(parsedDate.getTime())) {
            targetTimestamp = Timestamp.fromDate(parsedDate);
            needsUpdate = true;
          } else {
            targetTimestamp = Timestamp.now();
            needsUpdate = true;
          }
        } catch {
          targetTimestamp = Timestamp.now();
          needsUpdate = true;
        }
      } else if (typeof rawLastUpdated === 'number') {
        try {
          targetTimestamp = Timestamp.fromMillis(rawLastUpdated);
          needsUpdate = true;
        } catch {
          targetTimestamp = Timestamp.now();
          needsUpdate = true;
        }
      } else {
        targetTimestamp = Timestamp.now();
        needsUpdate = true;
      }

      if (needsUpdate) {
        missing++;
        if (COMMIT) {
          batch.update(docSnap.ref, {
            lastUpdated: targetTimestamp,
          });
          batchOps++;

          if (batchOps >= 450) {
            await batch.commit();
            console.log(`  Committed batch of ${batchOps} updates to "${colName}"...`);
            batch = db.batch();
            batchOps = 0;
          }
        }
      } else {
        present++;
      }
    }

    if (COMMIT && batchOps > 0) {
      await batch.commit();
      console.log(`  Committed final batch of ${batchOps} updates to "${colName}".`);
    }

    console.log(`Collection "${colName}" summary:`);
    console.log(`  - Valid lastUpdated: ${present}`);
    console.log(`  - Missing / Backfilled: ${missing}`);
  }

  console.log('\nBackfill scan complete.');
}

main().catch((err) => {
  console.error('Fatal error running backfill:', err);
  process.exit(1);
});
