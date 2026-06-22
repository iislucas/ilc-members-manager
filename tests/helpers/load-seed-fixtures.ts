/*
 * Shared loader for the emulator-driven e2e tests.
 *
 * Reads a seed directory (top-level collection files + a subcollections/ folder,
 * same format as functions/scripts/export-anonymized-data.ts) and writes the
 * documents into the given Firestore instance via the firebase-admin SDK.
 *
 * The directory is chosen by the SEED_FIXTURE_DIR env var, defaulting to the
 * committed slice in tests/fixtures/seed. Point it at another curated dataset to
 * run the same tests against different data. (The raw tmp/seed-data export is not
 * directly loadable — see tests/fixtures/seed/README.md.)
 *
 * `maxMembers` bounds how many member docs are written. Each member write fans
 * out into the onMember* Cloud Function triggers (ACL sync, view mirrors), so
 * e2e tests that share the emulator with timing-sensitive specs should keep this
 * small rather than loading the whole fixture.
 */
import type * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

type RawDoc = Record<string, unknown> & { id?: string };

/** Absolute path to the active seed dataset (honours SEED_FIXTURE_DIR). */
export function seedFixtureDir(): string {
  const configured = process.env['SEED_FIXTURE_DIR'];
  return path.resolve(process.cwd(), configured ?? 'tests/fixtures/seed');
}

// Firestore Timestamps are serialised as {_seconds, _nanoseconds} plain objects.
// Restore them so converters that call .toDate() keep working. Mirrors
// restoreTimestamps in functions/scripts/seed-emulator.ts.
function restoreTimestamps(value: unknown, Timestamp: typeof admin.firestore.Timestamp): unknown {
  if (Array.isArray(value)) return value.map((v) => restoreTimestamps(v, Timestamp));
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('_seconds' in v && '_nanoseconds' in v) {
      return new Timestamp(v['_seconds'] as number, v['_nanoseconds'] as number);
    }
    return Object.fromEntries(
      Object.entries(v).map(([k, vv]) => [k, restoreTimestamps(vv, Timestamp)]),
    );
  }
  return value;
}

// Map a fixture filename to its Firestore collection path:
//   members.json                       -> members
//   schools__abc123__gradings.json     -> schools/abc123/gradings
function collectionPathFromFile(basename: string): string {
  if (basename.includes('__')) {
    const [parent, parentId, sub] = basename.split('__');
    return `${parent}/${parentId}/${sub}`;
  }
  return basename;
}

async function seedFile(
  db: admin.firestore.Firestore,
  Timestamp: typeof admin.firestore.Timestamp,
  filePath: string,
  limit: number,
): Promise<number> {
  let docs = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RawDoc[];
  const collectionPath = collectionPathFromFile(path.basename(filePath, '.json'));
  if (collectionPath === 'members' && docs.length > limit) docs = docs.slice(0, limit);
  let batch = db.batch();
  let pending = 0;
  let written = 0;
  for (const doc of docs) {
    const { id, ...rawData } = doc;
    if (!id || typeof id !== 'string') continue; // seeder skips id-less docs
    batch.set(db.doc(`${collectionPath}/${id}`), restoreTimestamps(rawData, Timestamp) as RawDoc);
    written++;
    if (++pending % 499 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (pending % 499 !== 0) await batch.commit();
  return written;
}

/**
 * Load the active seed dataset into `db`. Top-level collections are written
 * before subcollections so parent docs exist first. `maxMembers` caps the
 * members collection (default 25). Returns per-collection document counts.
 */
export async function loadSeedFixtures(
  db: admin.firestore.Firestore,
  Timestamp: typeof admin.firestore.Timestamp,
  opts: { dir?: string; maxMembers?: number } = {},
): Promise<Record<string, number>> {
  const dir = opts.dir ?? seedFixtureDir();
  const maxMembers = opts.maxMembers ?? 25;
  if (!fs.existsSync(dir)) {
    throw new Error(`Seed fixture dir not found: ${dir} (set SEED_FIXTURE_DIR?)`);
  }
  const topLevel = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
  const subDir = path.join(dir, 'subcollections');
  const sub = fs.existsSync(subDir)
    ? fs.readdirSync(subDir).filter((f) => f.endsWith('.json')).map((f) => path.join(subDir, f))
    : [];

  const counts: Record<string, number> = {};
  for (const filePath of [...topLevel.sort(), ...sub.sort()]) {
    const key = collectionPathFromFile(path.basename(filePath, '.json'));
    counts[key] = await seedFile(db, Timestamp, filePath, maxMembers);
  }
  return counts;
}
