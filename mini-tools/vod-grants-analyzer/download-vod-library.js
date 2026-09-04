/* mini-tools/vod-grants-analyzer/download-vod-library.js
 *
 * Downloads all video items from Firestore /videos collection and saves
 * them as a JSON dataset in mini-tools/vod-grants-analyzer/data/videos.json.
 * Also generates summary metrics on the current VOD catalog.
 *
 * Usage:
 *   node mini-tools/vod-grants-analyzer/download-vod-library.js
 */

const admin = require('../../functions/node_modules/firebase-admin');
const fs = require('fs');
const path = require('path');

async function main() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'ilc-paris-class-tracker';
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  const db = admin.firestore();

  const dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  console.log(`📡 Fetching all videos from Firestore (/videos) on project '${projectId}'...`);
  const snap = await db.collection('videos').get();
  console.log(`✅ Retrieved ${snap.size} video documents.`);

  const videos = [];
  snap.forEach(doc => {
    videos.push({
      docId: doc.id,
      ...doc.data()
    });
  });

  const outFile = path.join(dataDir, 'videos.json');
  fs.writeFileSync(outFile, JSON.stringify(videos, null, 2), 'utf-8');
  console.log(`💾 Saved ${videos.length} videos to ${outFile}`);

  // Also fetch member list for email -> memberDocId lookup
  console.log(`📡 Fetching member mapping (email -> docId / memberId / name)...`);
  const membersSnap = await db.collection('members').get();
  console.log(`✅ Retrieved ${membersSnap.size} member documents.`);

  const members = [];
  membersSnap.forEach(doc => {
    const data = doc.data();
    members.push({
      docId: doc.id,
      memberId: data.memberId || '',
      name: data.name || '',
      email: data.email || '',
      emails: data.emails || (data.email ? [data.email] : []),
      studentLevel: data.studentLevel || 0,
      classVideoLibrarySubscription: data.classVideoLibrarySubscription || false,
      classVideoLibraryExpirationDate: data.classVideoLibraryExpirationDate || '',
    });
  });

  const membersFile = path.join(dataDir, 'members.json');
  fs.writeFileSync(membersFile, JSON.stringify(members, null, 2), 'utf-8');
  console.log(`💾 Saved ${members.length} members to ${membersFile}`);

  // Catalog analysis
  const tierCounts = {};
  let published = 0;
  let buyable = 0;
  let trailers = 0;
  let hasPrice = 0;
  let hasStripe = 0;

  for (const v of videos) {
    const tier = v.accessTier || 'none';
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    if (v.isPublished) published++;
    if (v.isBuyable) buyable++;
    if (v.isTrailer) trailers++;
    if (v.priceCents && v.priceCents > 0) hasPrice++;
    if (v.stripeProductId || v.stripePriceId) hasStripe++;
  }

  console.log('\n======================================================');
  console.log('📊 CURRENT VOD CATALOG ANALYSIS');
  console.log('======================================================');
  console.log(`Total video items in database: ${videos.length}`);
  console.log(`Published in catalog:         ${published}`);
  console.log(`Marked as Buyable:            ${buyable}`);
  console.log(`Trailers:                     ${trailers}`);
  console.log(`With explicit price:          ${hasPrice}`);
  console.log(`Linked to Stripe:             ${hasStripe}`);
  console.log('Access Tier Breakdown:');
  for (const [tier, count] of Object.entries(tierCounts)) {
    console.log(`  - ${tier}: ${count}`);
  }
}

main().catch(err => {
  console.error('❌ Error downloading library:', err);
  process.exit(1);
});
