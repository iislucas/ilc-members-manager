/*
Grants all members access to the online Class Video Library subscription.

For each member, it sets `classVideoLibrarySubscription` to true and
`classVideoLibraryExpirationDate` to the given date — but only if the
given date is further in the future than the member's current expiration
date (i.e. it never shortens existing access).

Usage:
  cd functions
  pnpm run grant-video-library-access --date YYYY-MM-DD [--project <PROJECT_ID>] [--dry-run]

Examples:
  # Dry run — preview changes without writing to Firestore:
  pnpm run grant-video-library-access --dry-run --date 2026-04-04 --project ilc-paris-class-tracker

  # Apply changes:
  pnpm run grant-video-library-access --date 2026-04-04 --project ilc-paris-class-tracker
*/
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    demandOption: false,
  })
  .option('date', {
    type: 'string',
    description: 'Expiration date to set (YYYY-MM-DD)',
    demandOption: true,
  })
  .option('dry-run', {
    type: 'boolean',
    description: 'If true, no results will be written back to Firestore',
    default: false,
  })
  .parseSync();

// ---------------------------------------------------------------------------
// Date validation
// ---------------------------------------------------------------------------
function isValidDate(dateStr: string): boolean {
  // Must match YYYY-MM-DD format.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  // Must parse to a real calendar date.
  const parsed = new Date(dateStr + 'T00:00:00');
  if (isNaN(parsed.getTime())) {
    return false;
  }
  // Make sure it round-trips (catches e.g. 2026-02-30).
  const [y, m, d] = dateStr.split('-').map(Number);
  return parsed.getFullYear() === y
    && parsed.getMonth() + 1 === m
    && parsed.getDate() === d;
}

const targetDate = argv.date as string;
if (!isValidDate(targetDate)) {
  console.error(`❌ Invalid date: "${targetDate}". Please provide a valid date in YYYY-MM-DD format.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const isDryRun = argv['dry-run'];
  const projectId = argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    console.warn('⚠️ No project ID found. Use --project or set GCLOUD_PROJECT env var.');
    console.warn('Attempting to use default credentials...');
  }

  admin.initializeApp(projectId ? { projectId } : undefined);
  const db = admin.firestore();

  console.log(`\n📺 Grant Class Video Library access up to: ${targetDate}`);
  if (isDryRun) {
    console.log('--- DRY RUN: No data will be modified ---\n');
  }

  console.log('🔍 Fetching all members...');
  const membersSnap = await db.collection('members').get();
  console.log(`✅ Loaded ${membersSnap.size} members.\n`);

  const BATCH_SIZE = 100;
  let alreadyHasLaterDate = 0;
  let extendedCount = 0;
  let newlyGrantedCount = 0;

  let batch = db.batch();
  let batchCount = 0;

  async function commitBatch() {
    if (batchCount > 0) {
      await batch.commit();
      console.log(`   💾 Committed batch of ${batchCount} updates.`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  let permanentAccessCount = 0;

  for (const doc of membersSnap.docs) {
    const data = doc.data();
    const memberName = data.name || 'Unknown';
    const memberId = data.memberId || 'N/A';
    const currentExpiry: string = data.classVideoLibraryExpirationDate || '';
    const currentSub: boolean = data.classVideoLibrarySubscription || false;

    // If the member already has access with no expiration date, they have
    // permanent access — don't add an expiry where none existed.
    if (currentSub && !currentExpiry) {
      permanentAccessCount++;
      continue;
    }

    // If the member already has a later (or equal) expiration date, skip.
    if (currentExpiry && currentExpiry >= targetDate) {
      alreadyHasLaterDate++;
      continue;
    }

    // Determine if this is a new grant or an extension.
    if (!currentSub) {
      newlyGrantedCount++;
      console.log(`🆕 ${memberName} (${memberId}): New access → ${targetDate}`);
    } else {
      extendedCount++;
      console.log(`📆 ${memberName} (${memberId}): Extended ${currentExpiry} → ${targetDate}`);
    }

    if (!isDryRun) {
      batch.update(doc.ref, {
        classVideoLibrarySubscription: true,
        classVideoLibraryExpirationDate: targetDate,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await commitBatch();
      }
    }
  }

  // Commit any remaining updates in the final batch.
  if (!isDryRun) {
    await commitBatch();
  }

  console.log(`\n=====================================================`);
  console.log(`Summary:`);
  console.log(`  Total Members:                 ${membersSnap.size}`);
  console.log(`  Newly Granted Access:          ${newlyGrantedCount}`);
  console.log(`  Extended Expiration:           ${extendedCount}`);
  console.log(`  Already Had Later Expiration:  ${alreadyHasLaterDate}`);
  console.log(`  Permanent Access (unchanged):  ${permanentAccessCount}`);
  if (isDryRun) {
    console.log(`  *** DRY RUN COMPLETED (No data was modified) ***`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error:', e);
    process.exit(1);
  });
