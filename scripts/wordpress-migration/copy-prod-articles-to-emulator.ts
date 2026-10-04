import * as admin from 'firebase-admin';

// Initialize production app (using ADC)
const prodApp = admin.initializeApp(
  {
    projectId: 'ilc-paris-class-tracker',
  },
  'prod-app',
);
const prodDb = prodApp.firestore();

// Target emulator
process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8080';
const emuApp = admin.initializeApp(
  {
    projectId: 'ilc-paris-class-tracker',
  },
  'emulator-app',
);
const emuDb = emuApp.firestore();

async function copyCollection(collName: string) {
  console.log(`[Sync] Reading ${collName} from production...`);
  const snap = await prodDb.collection(collName).get();
  console.log(`[Sync] Found ${snap.size} documents in production ${collName}.`);

  const batch = emuDb.batch();
  let count = 0;
  for (const doc of snap.docs) {
    batch.set(emuDb.collection(collName).doc(doc.id), doc.data());
    count++;
  }
  await batch.commit();
  console.log(`[Sync] Successfully copied ${count} documents to emulator ${collName}.`);
}

async function main() {
  for (const coll of ['articles-post', 'members-post', 'instructors-post']) {
    await copyCollection(coll);
  }
  console.log('[Sync] All production articles copied to emulator successfully!');
}

main().catch((err) => {
  console.error('[Sync] Error copying articles:', err);
  process.exit(1);
});
