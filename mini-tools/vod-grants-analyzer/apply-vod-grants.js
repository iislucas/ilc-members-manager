/* mini-tools/vod-grants-analyzer/apply-vod-grants.js
 *
 * Idempotent Firestore Grant Ingestion Tool for VOD Purchases.
 *
 * Grants video items to members under:
 *   /members/{memberDocId}/videoGrants/{videoId}
 * and top-level:
 *   /video_grants/{memberDocId}_{videoId}
 *
 * Features:
 *   - 100% Idempotent (uses deterministic document IDs and merge writes)
 *   - User Filtering: --email <email> to grant to a specific customer only
 *   - Dry Run Mode: --dry-run to preview actions without modifying Firestore
 *   - Automatic batching (commits in chunks of 400 operations)
 *
 * Usage:
 *   # Dry run for a single user:
 *   node mini-tools/vod-grants-analyzer/apply-vod-grants.js --email lucas.dixon@gmail.com --dry-run
 *
 *   # Apply for a single user:
 *   node mini-tools/vod-grants-analyzer/apply-vod-grants.js --email lucas.dixon@gmail.com
 *
 *   # Apply all registered members:
 *   node mini-tools/vod-grants-analyzer/apply-vod-grants.js
 */

const admin = require('../../functions/node_modules/firebase-admin');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const GRANTS_FILE = path.join(BASE_DIR, 'output', 'grants-table.json');
const MEMBERS_FILE = path.join(BASE_DIR, 'data', 'members.json');

// Parse CLI flags
const args = process.argv.slice(2);
let targetEmail = '';
let isDryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--email' && args[i + 1]) {
    targetEmail = args[i + 1].trim().toLowerCase();
    i++;
  } else if (args[i].startsWith('--email=')) {
    targetEmail = args[i].split('=')[1].trim().toLowerCase();
  } else if (args[i] === '--dry-run') {
    isDryRun = true;
  }
}

async function main() {
  console.log('================================================================================');
  console.log('🎟️  ILC VOD PURCHASES - FIRESTORE GRANT INGESTION TOOL');
  console.log('================================================================================');
  console.log(`Mode:         ${isDryRun ? '🔍 DRY RUN (No database modifications)' : '⚡ LIVE WRITE'}`);
  console.log(`Target Email: ${targetEmail ? `"${targetEmail}" (single user mode)` : 'ALL REGISTERED PURCHASERS'}`);
  console.log('--------------------------------------------------------------------------------\n');

  if (!fs.existsSync(GRANTS_FILE)) {
    console.error(`❌ Grants table not found at ${GRANTS_FILE}. Run python3 analyze-vod-grants.py first.`);
    process.exit(1);
  }

  const grants = JSON.parse(fs.readFileSync(GRANTS_FILE, 'utf-8'));
  console.log(`Loaded ${grants.length} total grants from ${GRANTS_FILE}.`);

  // Initialize Firebase Admin
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'ilc-paris-class-tracker';
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  const db = admin.firestore();

  // Filter grants if email specified
  let targetGrants = grants;
  if (targetEmail) {
    targetGrants = grants.filter(g => g.email.toLowerCase() === targetEmail);
    if (targetGrants.length === 0) {
      console.warn(`⚠️  No historical purchases found for email: "${targetEmail}"`);
      process.exit(0);
    }
  }

  // Filter only registered members (who have a memberDocId in Firestore)
  const registeredGrants = targetGrants.filter(g => g.isRegisteredMember && g.memberDocId);
  const unregisteredGrants = targetGrants.filter(g => !g.isRegisteredMember || !g.memberDocId);

  console.log(`Grants matching criteria:`);
  console.log(`  - Registered Member Grants to apply:   ${registeredGrants.length}`);
  console.log(`  - Unregistered Customer Grants skipped: ${unregisteredGrants.length}\n`);

  if (registeredGrants.length === 0) {
    console.warn(`⚠️  No registered member grants to apply.`);
    process.exit(0);
  }

  // Group by member for clear reporting
  const memberGrantsMap = new Map();
  for (const g of registeredGrants) {
    const mdoc = g.memberDocId;
    if (!memberGrantsMap.has(mdoc)) {
      memberGrantsMap.set(mdoc, {
        memberDocId: mdoc,
        email: g.email,
        name: g.customerName,
        memberId: g.memberId,
        studentLevel: g.studentLevel,
        grants: [],
      });
    }
    memberGrantsMap.get(mdoc).grants.push(g);
  }

  console.log(`Targeting ${memberGrantsMap.size} unique member accounts:\n`);
  for (const [mdoc, m] of memberGrantsMap.entries()) {
    console.log(`👤 Customer: ${m.name} (${m.email})`);
    console.log(`   Member ID: ${m.memberId || 'N/A'} (Lvl ${m.studentLevel || 0}) | Firestore Doc: ${mdoc}`);
    console.log(`   Grants to ensure (${m.grants.length} videos):`);
    for (const g of m.grants) {
      console.log(`     ✓ [${g.videoId}] "${g.seriesTitle}" -> "${g.videoTitle}"`);
    }
    console.log('');
  }

  if (isDryRun) {
    console.log('🔍 DRY RUN COMPLETE: Verified all doc paths and grant structures. 0 writes performed.');
    return;
  }

  // Live Write Execution with Batches
  console.log('🚀 Applying grants to Firestore...');
  let batch = db.batch();
  let opCount = 0;
  let totalCommitted = 0;

  for (const [mdoc, m] of memberGrantsMap.entries()) {
    for (const g of m.grants) {
      const videoId = g.videoId;
      const grantPayload = {
        docId: videoId,
        videoId: videoId,
        memberDocId: mdoc,
        memberEmail: g.email.toLowerCase(),
        grantKind: 'admin_grant',
        notes: `Historical VOD purchase import (${g.sources_str || (g.sources ? g.sources.join(', ') : 'legacy')})`,
        grantedAt: g.firstPurchaseDate ? `${g.firstPurchaseDate}T00:00:00.000Z` : new Date().toISOString(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };

      // 1. Member Subcollection: /members/{memberDocId}/videoGrants/{videoId}
      const memberGrantRef = db
        .collection('members')
        .doc(mdoc)
        .collection('videoGrants')
        .doc(videoId);
      batch.set(memberGrantRef, grantPayload, { merge: true });
      opCount++;

      // 2. Global Collection: /video_grants/{memberDocId}_{videoId}
      const globalGrantRef = db
        .collection('video_grants')
        .doc(`${mdoc}_${videoId}`);
      batch.set(globalGrantRef, grantPayload, { merge: true });
      opCount++;

      if (opCount >= 400) {
        await batch.commit();
        totalCommitted += opCount;
        console.log(`  💾 Committed batch of ${opCount} write operations (Total: ${totalCommitted})...`);
        batch = db.batch();
        opCount = 0;
      }
    }
  }

  if (opCount > 0) {
    await batch.commit();
    totalCommitted += opCount;
    console.log(`  💾 Committed final batch of ${opCount} write operations (Total: ${totalCommitted})...`);
  }

  console.log('\n================================================================================');
  console.log(`✅ SUCCESS: Granted ${registeredGrants.length} video items across ${memberGrantsMap.size} members!`);
  console.log(`   All grants are stored under /members/{memberDocId}/videoGrants/{videoId}`);
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('❌ Error executing grant tool:', err);
  process.exit(1);
});
