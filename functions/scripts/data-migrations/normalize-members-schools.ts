import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  MembershipType,
  initMember,
  initSchool,
} from '../../src/data-model';

/*
 Data migration script to normalize members and schools.

 This script performs the following:
 1. Normalizes `membershipType` on all members: "LifeByPartner" is mapped to
    "Life"; any other value not matching the current MembershipType enum
    (Annual, Life, Deceased, Inactive) is set to "Annual"; and a note is
    appended recording the previous value.
 2. Ensures `publicClassGoogleCalendarId` is an empty string on all members
    (not undefined/null).
 3. Ensures `schoolClassGoogleCalendarId` is an empty string on all schools
    (not undefined/null).
 4. Ensures all default fields from initMember() / initSchool() are present on
    every document, filling in any missing fields with their default values.

 Usage:
   cd functions
   pnpm run normalize-members-schools --project ilc-paris-class-tracker --dry-run

 If running against the default local emulator or you have GCLOUD_PROJECT set:
   pnpm run normalize-members-schools --dry-run

 Remove --dry-run to actually save changes.
*/

const VALID_MEMBERSHIP_TYPES = new Set<string>(Object.values(MembershipType));

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

const projectId = argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Error: Project ID is required. Use --project or GCLOUD_PROJECT env var.',
  );
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function run() {
  console.log(`Normalizing members and schools for project: ${projectId}`);
  const isDryRun = argv['dry-run'];
  if (isDryRun) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  let batch = db.batch();
  let batchCount = 0;

  async function commitBatchIfNeeded(force = false) {
    if (batchCount > 0 && (force || batchCount >= 100)) {
      if (!isDryRun) {
        await batch.commit();
      }
      batch = db.batch();
      batchCount = 0;
    }
  }

  // ─── Stats ───
  type FieldHist = { count: number; exampleDocIds: string[] };
  const stats = {
    totalMembers: 0,
    membersUpdated: 0,
    membershipTypeNormalized: 0,
    memberCalendarIdFixed: 0,
    memberDefaultsApplied: 0,
    membershipTypeChanges: {} as Record<string, number>, // old value -> count
    memberFieldsAdded: {} as Record<string, FieldHist>, // field name -> count + examples

    totalSchools: 0,
    schoolsUpdated: 0,
    schoolCalendarIdFixed: 0,
    schoolDefaultsApplied: 0,
    schoolFieldsAdded: {} as Record<string, FieldHist>, // field name -> count + examples
  };

  function trackFieldAdded(hist: Record<string, FieldHist>, field: string, docId: string) {
    if (!hist[field]) {
      hist[field] = { count: 0, exampleDocIds: [] };
    }
    hist[field].count++;
    if (hist[field].exampleDocIds.length < 5) {
      hist[field].exampleDocIds.push(docId);
    }
  }

  // ─── 1. Process Members ───
  console.log('\n--- Processing Members ---');
  const membersSnap = await db.collection('members').get();
  stats.totalMembers = membersSnap.size;
  console.log(`Found ${stats.totalMembers} members.`);

  const memberDefaults = initMember();
  // Fields we never want to overwrite from defaults (they are unique per member).
  const memberSkipDefaultKeys = new Set(['docId', 'lastUpdated']);

  for (const doc of membersSnap.docs) {
    const rawData = doc.data();
    rawData.docId = doc.id;
    let needsUpdate = false;
    const update: Record<string, any> = {};

    // 1a. Normalize membershipType
    const currentType = rawData.membershipType as string | undefined;
    if (currentType !== undefined && !VALID_MEMBERSHIP_TYPES.has(currentType)) {
      // "LifeByPartner" maps to Life; everything else maps to Annual.
      const newType = currentType === 'LifeByPartner' ? MembershipType.Life : MembershipType.Annual;
      update.membershipType = newType;

      // Append a note recording the old value.
      const existingNotes = (rawData.notes as string) || '';
      const migrationNote = `[Migration 2026-03-03] Previous membershipType was "${currentType}".`;
      update.notes = existingNotes
        ? `${existingNotes}\n${migrationNote}`
        : migrationNote;

      console.log(
        `  ⚠ Member ${doc.id} (${rawData.memberId || 'no-id'}): membershipType "${currentType}" → "${newType}"`,
      );
      needsUpdate = true;
      stats.membershipTypeNormalized++;
      stats.membershipTypeChanges[currentType] =
        (stats.membershipTypeChanges[currentType] || 0) + 1;
    }

    // 1b. Ensure publicClassGoogleCalendarId is an empty string (not missing/null).
    if (
      rawData.publicClassGoogleCalendarId === undefined ||
      rawData.publicClassGoogleCalendarId === null
    ) {
      update.publicClassGoogleCalendarId = '';
      needsUpdate = true;
      stats.memberCalendarIdFixed++;
    }

    // 1c. Apply default fields for any missing keys.
    for (const [key, defaultValue] of Object.entries(memberDefaults)) {
      if (memberSkipDefaultKeys.has(key)) continue;
      if (rawData[key] === undefined) {
        update[key] = defaultValue;
        needsUpdate = true;
        stats.memberDefaultsApplied++;
        trackFieldAdded(stats.memberFieldsAdded, key, rawData.docId);
      }
    }

    if (needsUpdate) {
      batch.update(doc.ref, update);
      batchCount++;
      stats.membersUpdated++;
      await commitBatchIfNeeded();
    }
  }

  // ─── 2. Process Schools ───
  console.log('\n--- Processing Schools ---');
  const schoolsSnap = await db.collection('schools').get();
  stats.totalSchools = schoolsSnap.size;
  console.log(`Found ${stats.totalSchools} schools.`);

  const schoolDefaults = initSchool();
  const schoolSkipDefaultKeys = new Set(['docId', 'lastUpdated']);

  for (const doc of schoolsSnap.docs) {
    const rawData = doc.data();
    let needsUpdate = false;
    const update: Record<string, any> = {};

    // 2a. Ensure schoolClassGoogleCalendarId is an empty string (not missing/null).
    if (
      rawData.schoolClassGoogleCalendarId === undefined ||
      rawData.schoolClassGoogleCalendarId === null
    ) {
      update.schoolClassGoogleCalendarId = '';
      needsUpdate = true;
      stats.schoolCalendarIdFixed++;
    }

    // 2b. Apply default fields for any missing keys.
    for (const [key, defaultValue] of Object.entries(schoolDefaults)) {
      if (schoolSkipDefaultKeys.has(key)) continue;
      if (rawData[key] === undefined) {
        update[key] = defaultValue;
        needsUpdate = true;
        stats.schoolDefaultsApplied++;
        trackFieldAdded(stats.schoolFieldsAdded, key, `${rawData.schoolId || '?'} (${doc.id})`);
      }
    }

    if (needsUpdate) {
      batch.update(doc.ref, update);
      batchCount++;
      stats.schoolsUpdated++;
      await commitBatchIfNeeded();
    }
  }

  // ─── Commit remaining ───
  await commitBatchIfNeeded(true);

  // ─── Summary ───
  console.log('\n========================================');
  console.log('  Migration Summary');
  console.log('========================================');
  console.log(`Members:  ${stats.totalMembers} total, ${stats.membersUpdated} updated`);
  console.log(`  - membershipType normalized:        ${stats.membershipTypeNormalized}`);
  console.log(`  - calendar ID set to empty string:  ${stats.memberCalendarIdFixed}`);
  console.log(`  - missing default fields filled:    ${stats.memberDefaultsApplied}`);
  if (Object.keys(stats.membershipTypeChanges).length > 0) {
    console.log(`  - Old membershipType values converted:`);
    for (const [oldVal, count] of Object.entries(stats.membershipTypeChanges)) {
      const target = oldVal === 'LifeByPartner' ? 'Life' : 'Annual';
      console.log(`      "${oldVal}" → "${target}": ${count}`);
    }
  }
  if (Object.keys(stats.memberFieldsAdded).length > 0) {
    console.log(`  - Default fields added (field → count [example docIds]):`);
    for (const [field, info] of Object.entries(stats.memberFieldsAdded).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`      ${field}: ${info.count}  e.g. ${info.exampleDocIds.join(', ')}`);
    }
  }
  console.log(`Schools:  ${stats.totalSchools} total, ${stats.schoolsUpdated} updated`);
  console.log(`  - calendar ID set to empty string:  ${stats.schoolCalendarIdFixed}`);
  console.log(`  - missing default fields filled:    ${stats.schoolDefaultsApplied}`);
  if (Object.keys(stats.schoolFieldsAdded).length > 0) {
    console.log(`  - Default fields added (field → count [example docIds]):`);
    for (const [field, info] of Object.entries(stats.schoolFieldsAdded).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`      ${field}: ${info.count}  e.g. ${info.exampleDocIds.join(', ')}`);
    }
  }

  if (isDryRun) {
    console.log('\n(Dry run — no changes were made)');
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
