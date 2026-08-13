/*
Migrates member documents in Firestore from legacy `subscriptions` field to `stripeSubscriptions`.
Merges any existing `subscriptions` map into `stripeSubscriptions` and removes the old `subscriptions` field.

Usage:
  pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' scripts/data-migrations/migrate-subscriptions-to-stripe-subscriptions.ts [--dry-run]
*/

import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('dry-run', {
    type: 'boolean',
    description: 'If true, no results will be written back to Firestore',
    default: false,
  })
  .parseSync();

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const isDryRun = argv['dry-run'];

  console.log(`\n🔄 Migrating members subscriptions → stripeSubscriptions (dryRun: ${isDryRun})...`);

  const membersSnap = await db.collection('members').get();
  console.log(`Loaded ${membersSnap.size} total member documents.`);

  let updatedCount = 0;
  const batchSize = 100;
  let batch = db.batch();
  let inBatch = 0;

  for (const doc of membersSnap.docs) {
    const data = doc.data();
    const legacySubs = data['subscriptions'];
    const currentStripeSubs = data['stripeSubscriptions'] || {};

    if (legacySubs !== undefined) {
      const mergedStripeSubs = {
        ...(typeof legacySubs === 'object' && legacySubs !== null ? legacySubs : {}),
        ...currentStripeSubs,
      };

      console.log(`- Member ${doc.id} (${data.name || data.emails?.[0] || 'unknown'}): migrating subscriptions (${Object.keys(legacySubs || {}).length} items) → stripeSubscriptions (${Object.keys(mergedStripeSubs).length} items)`);

      if (!isDryRun) {
        batch.update(doc.ref, {
          stripeSubscriptions: mergedStripeSubs,
          subscriptions: admin.firestore.FieldValue.delete(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
        inBatch++;
        if (inBatch >= batchSize) {
          await batch.commit();
          console.log(`  💾 Committed batch of ${inBatch} updates.`);
          batch = db.batch();
          inBatch = 0;
        }
      }
      updatedCount++;
    }
  }

  if (!isDryRun && inBatch > 0) {
    await batch.commit();
    console.log(`  💾 Committed final batch of ${inBatch} updates.`);
  }

  console.log(`\n✅ Migration complete: updated ${updatedCount} member documents.`);
}

main().catch(console.error);
