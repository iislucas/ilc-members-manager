import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { orderDisplayNumber } from '../../src/data-model';

/*
 Data migration: backfill the human-friendly `orderNumber` on gradings.

 `orderNumber` (e.g. '202608-4713') is the order's year and month plus four
 digits hashed from the real order reference — see `orderDisplayNumber`. It is
 denormalized onto the grading because instructors and school managers can read
 a grading but not the order document behind it, and the grading progress page
 shows the number to everyone.

 Going forward it is stamped on at purchase time (stripe-fulfillment.ts and
 squarespace-orders/grading.ts). This script fills it in for gradings bought
 before that existed.

 For each grading with an `orderId` it:
   1. Finds the order: by document id, then by `orderNumber`, then by
      `stripeObjectId` (a grading's orderId is a doc id for Stripe orders but
      the human order number for some Squarespace ones).
   2. Takes the date and real reference the same way the live code does, so the
      number matches what the member sees on their orders page.
   3. Falls back to hashing the grading's own orderId with its purchase date
      when the order document is gone, so the grading still gets a number.

 Gradings with no `orderId` (created by hand) are left alone — they have no
 order, so they get no order number.

 The script is idempotent: re-running it makes no further changes.

 Usage:
   cd functions
   pnpm exec ts-node scripts/data-migrations/backfill-grading-order-numbers.ts --project ilc-paris-class-tracker --dry-run

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

type OrderLookup = { date: string; ref: string } | null;

// Cache order lookups: several gradings can come from one order.
const orderCache = new Map<string, OrderLookup>();

// The date and real reference for an order, matching how the live code picks
// them (see stripe-fulfillment.ts and squarespace-orders/grading.ts).
function orderDateAndRef(data: Record<string, unknown>, docId: string): OrderLookup {
  const kind = (data.ilcAppOrderKind as string) || '';
  if (kind === 'stripe') {
    return {
      date: (data.created as string) || (data.lastUpdated as string) || '',
      ref: (data.invoiceId as string) || (data.stripeObjectId as string) || docId,
    };
  }
  if (kind === 'https://api.squarespace.com/1.0/commerce/orders') {
    return {
      date: (data.createdOn as string) || (data.lastUpdated as string) || '',
      ref: (data.orderNumber as string) || (data.id as string) || docId,
    };
  }
  return {
    date: (data.lastUpdated as string) || '',
    ref: (data.referenceNumber as string) || (data.orderNumber as string) || docId,
  };
}

async function lookupOrder(orderId: string): Promise<OrderLookup> {
  if (orderCache.has(orderId)) return orderCache.get(orderId)!;

  let result: OrderLookup = null;

  const byDocId = await db.collection('orders').doc(orderId).get();
  if (byDocId.exists) {
    result = orderDateAndRef(byDocId.data() as Record<string, unknown>, byDocId.id);
  } else {
    for (const field of ['orderNumber', 'stripeObjectId'] as const) {
      const q = await db.collection('orders').where(field, '==', orderId).limit(1).get();
      if (!q.empty) {
        result = orderDateAndRef(q.docs[0].data() as Record<string, unknown>, q.docs[0].id);
        break;
      }
    }
  }

  orderCache.set(orderId, result);
  return result;
}

async function run() {
  const isDryRun = argv['dry-run'];
  console.log(`Backfilling grading order numbers for project: ${projectId}`);
  if (isDryRun) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const stats = {
    total: 0,
    manual: 0,
    alreadySet: 0,
    fromOrder: 0,
    fromGradingOnly: 0,
    updated: 0,
  };

  const snap = await db.collection('gradings').get();
  stats.total = snap.size;
  console.log(`Found ${stats.total} gradings.`);

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const orderId = (data.orderId as string) || '';
    const purchaseDate = (data.gradingPurchaseDate as string) || '';

    // No order behind it (created by an admin): nothing to number.
    if (!orderId) {
      stats.manual++;
      continue;
    }

    const order = await lookupOrder(orderId);
    if (order) {
      stats.fromOrder++;
    } else {
      stats.fromGradingOnly++;
    }
    const date = order?.date || purchaseDate;
    const ref = order?.ref || orderId;
    const orderNumber = orderDisplayNumber(date, ref);

    if (!orderNumber || (data.orderNumber ?? '') === orderNumber) {
      if (orderNumber) stats.alreadySet++;
      continue;
    }

    stats.updated++;
    console.log(
      `  Grading ${doc.id}: orderNumber = ${orderNumber}` +
        (order ? '' : ' (order document not found; derived from the grading)'),
    );
    if (!isDryRun) {
      batch.update(doc.ref, { orderNumber });
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
  console.log(`Total gradings:              ${stats.total}`);
  console.log(`Manual (no orderId):         ${stats.manual}`);
  console.log(`Order document found:        ${stats.fromOrder}`);
  console.log(`Order document missing:      ${stats.fromGradingOnly}`);
  console.log(`Already correct:             ${stats.alreadySet}`);
  console.log(`Updated:                     ${stats.updated}`);
  if (isDryRun) console.log('(dry run — nothing was saved)');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
