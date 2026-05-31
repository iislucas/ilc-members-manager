/*
 * Seed Emulator Script
 *
 * Reads anonymized JSON files from <repo-root>/tmp/seed-data/ and imports
 * them into the local Firestore emulator. Top-level collection files are
 * named `{collection}.json`; subcollection files use the naming convention
 * `{collection}__{parentId}__{subcollection}.json`.
 *
 * Requires the Firebase emulator suite to be running:
 *   pnpm emulator:start   (from repo root)
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/seed-emulator.ts [--project ilc-paris-class-tracker]
 */

// Must be set BEFORE firebase-admin is initialised so the SDK connects to
// the local emulators rather than production.
process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8080';
process.env['FIREBASE_AUTH_EMULATOR_HOST'] = '127.0.0.1:9099';

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// CLI args
// ============================================================
const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project');
const projectId =
  projectIndex !== -1 && args.length > projectIndex + 1
    ? args[projectIndex + 1]
    : 'ilc-paris-class-tracker';

admin.initializeApp({ projectId });
const db = admin.firestore();

const seedDir = path.resolve(__dirname, '../../tmp/seed-data');

if (!fs.existsSync(seedDir)) {
  console.error(`Seed directory not found: ${seedDir}`);
  console.error('Run export-anonymized-data.ts first.');
  process.exit(1);
}

// ============================================================
// Helpers
// ============================================================

type RawDoc = Record<string, unknown>;

// Commit a batch and start a fresh one (Firestore limit is 500 ops).
async function flushBatch(
  batch: admin.firestore.WriteBatch,
  count: number,
): Promise<admin.firestore.WriteBatch> {
  if (count > 0) await batch.commit();
  return db.batch();
}

// Firestore Timestamps are exported as {_seconds, _nanoseconds} plain objects
// by firebase-admin's .data(). Restore them to proper Timestamps so that
// firestoreDocToXxx converters (which call .toDate()) work correctly.
function restoreTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreTimestamps);
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('_seconds' in v && '_nanoseconds' in v) {
      return new admin.firestore.Timestamp(v['_seconds'] as number, v['_nanoseconds'] as number);
    }
    return Object.fromEntries(Object.entries(v).map(([k, vv]) => [k, restoreTimestamps(vv)]));
  }
  return value;
}

async function seedCollection(collectionPath: string, docs: RawDoc[]): Promise<void> {
  let batch = db.batch();
  let count = 0;

  for (const doc of docs) {
    const { id, ...rawData } = doc;
    if (!id || typeof id !== 'string') {
      console.warn(`  Skipping doc with missing id in ${collectionPath}`);
      continue;
    }
    const data = restoreTimestamps(rawData) as RawDoc;
    const ref = db.doc(`${collectionPath}/${id}`);
    batch.set(ref, data);
    count++;

    if (count % 499 === 0) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) await batch.commit();
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log(`Seeding Firestore emulator (project: ${projectId}) from ${seedDir}`);

  const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json'));

  // Sort so top-level collections are seeded before subcollections
  files.sort((a, b) => {
    const aSub = a.includes('__');
    const bSub = b.includes('__');
    if (aSub && !bSub) return 1;
    if (!aSub && bSub) return -1;
    return a.localeCompare(b);
  });

  for (const file of files) {
    const filePath = path.join(seedDir, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const docs = JSON.parse(raw) as RawDoc[];

    // Derive the Firestore collection path from the filename.
    // Top-level:     members.json                → members
    // Subcollection: schools__abc123__gradings.json → schools/abc123/gradings
    const basename = path.basename(file, '.json');
    let collectionPath: string;
    if (basename.includes('__')) {
      const parts = basename.split('__');
      // parts = [parentCollection, parentId, subcollection]
      collectionPath = `${parts[0]}/${parts[1]}/${parts[2]}`;
    } else {
      collectionPath = basename;
    }

    console.log(`\nSeeding ${collectionPath} (${docs.length} docs)...`);
    await seedCollection(collectionPath, docs);
    console.log(`  Done.`);
  }

  // --- Seed Firebase Auth accounts ---
  // Create one Auth user per ACL email so the app can be logged into
  // without needing to sign up manually. All accounts use the same
  // test password for convenience.
  const TEST_PASSWORD = 'testpassword123';
  const aclFile = path.join(seedDir, 'acl.json');
  if (fs.existsSync(aclFile)) {
    const aclDocs = JSON.parse(fs.readFileSync(aclFile, 'utf-8')) as RawDoc[];
    console.log(`\nCreating Auth accounts for ${aclDocs.length} ACL emails (password: ${TEST_PASSWORD})...`);
    let created = 0;
    let skipped = 0;
    for (const entry of aclDocs) {
      const email = entry['id'] as string;
      if (!email || !email.includes('@')) continue;
      try {
        await admin.auth().createUser({ email, password: TEST_PASSWORD });
        created++;
      } catch (err: unknown) {
        // 'email-already-exists' means we already seeded; skip silently.
        if ((err as { code?: string }).code !== 'auth/email-already-exists') {
          console.warn(`  Skipped ${email}:`, (err as Error).message);
        }
        skipped++;
      }
    }
    console.log(`  Created: ${created}, already-existed: ${skipped}`);
  }

  console.log('\nAll collections seeded successfully.');
  console.log('\nTest credentials (password for all: testpassword123):');
  console.log('  Admin:   member-us536@example.com');
  console.log('  Regular: member-pl100@example.com');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
