import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { OrderStatus } from '../../src/data-model';

/*
 Data migration: mark legacy (Google Sheets import) orders as processed.

 Legacy orders (ilcAppOrderKind === 'ilc-2005-sheets-db-import', or older docs
 with the field absent — firestoreDocToOrder treats both as Sheets imports) are
 historical records imported from the 2005 spreadsheet. They were never meant to
 flow through automatic processing, so any 'error' / 'needs-manual-processing'
 status on them is spurious and now surfaces unwanted admin notifications
 (NotificationKind.OrderNeedsAttention).

 This script sets ilcAppOrderStatus to 'processed' and clears ilcAppOrderIssues
 on every legacy order that isn't already in that state — mirroring what the
 order-list "mark as processed" action does. It does NOT touch Squarespace
 orders, and leaves lastUpdated untouched so chronological ordering is preserved.

 The script is idempotent: re-running it makes no further changes.

 Usage:
   cd functions
   pnpm run mark-legacy-orders-processed --project ilc-paris-class-tracker --dry-run

 If running against the local emulator or with GCLOUD_PROJECT set:
   pnpm run mark-legacy-orders-processed --dry-run

 Remove --dry-run to actually save changes.
*/

const SQUARESPACE_KIND = 'https://api.squarespace.com/1.0/commerce/orders';
const PROCESSED: OrderStatus = 'processed';

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

// A legacy order is anything that is not a Squarespace order: either the
// explicit Sheets-import kind, or an older doc with no ilcAppOrderKind at all.
function isLegacyOrder(data: Record<string, unknown>): boolean {
  return data.ilcAppOrderKind !== SQUARESPACE_KIND;
}

async function run() {
  const isDryRun = argv['dry-run'];
  console.log(`Marking legacy orders as processed for project: ${projectId}`);
  if (isDryRun) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const stats = { total: 0, legacy: 0, updated: 0 };

  const snap = await db.collection('orders').get();
  stats.total = snap.size;
  console.log(`Found ${stats.total} orders.`);

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (!isLegacyOrder(data)) continue;
    stats.legacy++;

    const alreadyProcessed = data.ilcAppOrderStatus === PROCESSED;
    const issues = (data.ilcAppOrderIssues as unknown[] | undefined) ?? [];
    const hasIssues = issues.length > 0;
    if (alreadyProcessed && !hasIssues) continue; // already in the target state

    stats.updated++;
    console.log(
      `  Order ${doc.id}: ${String(data.ilcAppOrderStatus ?? '(unset)')} -> ${PROCESSED}` +
        (hasIssues ? `, clearing ${issues.length} issue(s)` : ''),
    );
    if (!isDryRun) {
      batch.update(doc.ref, {
        ilcAppOrderStatus: PROCESSED,
        ilcAppOrderIssues: [],
      });
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
  console.log(`Total orders:   ${stats.total}`);
  console.log(`Legacy orders:  ${stats.legacy}`);
  console.log(`Updated:        ${stats.updated}`);
  if (isDryRun) console.log('(dry run — nothing was saved)');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
