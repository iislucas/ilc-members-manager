import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { firestoreDocToSchool, firestoreDocToMember } from '../src/data-model';

/**
 * Script to migrate old data fields to the new schema permanently.
 * - schools: owner -> ownerInstructorId, managers -> managerInstructorIds
 * - members: sifuInstructorId -> primaryInstructorId, managingOrgId -> primarySchoolId
 * 
 * Usage:
 *   cd functions
 *   pnpm run migrate-old-fields --project <YOUR_PROJECT_ID> --dry-run
 * 
 * If running against the default local emulator or you have GCLOUD_PROJECT set:
 *   pnpm run migrate-old-fields --dry-run
 * 
 * Remove --dry-run to actually save changes.
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

const projectId = argv.project || process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Error: Project ID is required. Use --project or GCLOUD_PROJECT env var.',
  );
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function run() {
  console.log(`Migrating old fields for project: ${projectId}`);
  if (argv['dry-run']) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  let batch = db.batch();
  let batchCount = 0;

  async function commitBatchIfNeeded(force = false) {
    if (batchCount > 0 && (force || batchCount >= 500)) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  // 1. Migrate schools
  console.log('\n--- Migrating Schools ---');
  const schoolsSnap = await db.collection('schools').get();
  let migratedSchools = 0;
  const legacySchoolDocIdMap = new Map<string, string>();

  for (const doc of schoolsSnap.docs) {
    const rawData = doc.data();
    const school = firestoreDocToSchool(doc as any);

    // We only need to write if the *raw* document contains old fields
    // or if the docId is missing (which happens if it wasn't set).
    let needsUpdate = false;
    const update: any = { ...school };

    // We don't save docId explicitly inside SchoolFirebaseDoc per the data-model
    delete update.docId;

    // Restore lastUpdated as a Timestamp, fixing it if it was accidentally converted to a string
    if (typeof rawData.lastUpdated === 'string') {
      update.lastUpdated = admin.firestore.Timestamp.fromDate(new Date(rawData.lastUpdated));
      needsUpdate = true;
    } else if (rawData.lastUpdated) {
      update.lastUpdated = rawData.lastUpdated;
    } else {
      update.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
    }

    if (rawData.owner !== undefined) {
      update.owner = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }

    if (rawData.managers !== undefined) {
      update.managers = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }

    // If the doc didn't have the new fields, firestoreDocToSchool populated them 
    // from the old ones. But if the raw data didn't have the new fields natively, we must write.
    if (!rawData.ownerInstructorId && school.ownerInstructorId) needsUpdate = true;
    if (!rawData.managerInstructorIds && school.managerInstructorIds?.length) needsUpdate = true;

    // Check if the school's docId is equal to its schoolId, meaning it's a legacy auto-assigned ID
    const isLegacyId = doc.id === school.schoolId || doc.id.startsWith('SCH-');

    if (isLegacyId) {
      console.log(`Migrating legacy school document ${doc.id} to auto-generated ID`);
      const newDocRef = db.collection('schools').doc();
      legacySchoolDocIdMap.set(doc.id, newDocRef.id);

      if (!argv['dry-run']) {
        delete update.owner;
        delete update.managers;
        batch.set(newDocRef, update);
        batchCount++;
        await commitBatchIfNeeded();

        // Copy the 'members' subcollection
        const membersSubSnap = await doc.ref.collection('members').get();
        for (const subDoc of membersSubSnap.docs) {
          batch.set(newDocRef.collection('members').doc(subDoc.id), subDoc.data());
          batchCount++;
          await commitBatchIfNeeded();

          batch.delete(subDoc.ref);
          batchCount++;
          await commitBatchIfNeeded();
        }

        // Delete the original legacy doc
        batch.delete(doc.ref);
        batchCount++;
        await commitBatchIfNeeded();
      }
      migratedSchools++;
    } else if (needsUpdate) {
      console.log(`Migrating fields for school ${doc.id}`);
      if (!argv['dry-run']) {
        batch.update(doc.ref, update);
        batchCount++;
        await commitBatchIfNeeded();
      }
      migratedSchools++;
    }
  }

  // 2. Migrate members
  console.log('\n--- Migrating Members ---');
  const membersSnap = await db.collection('members').get();
  let migratedMembers = 0;

  for (const doc of membersSnap.docs) {
    const rawData = doc.data();
    const member = firestoreDocToMember(doc);

    let needsUpdate = false;
    const update: any = { ...member };
    delete update.docId; // Not explicitly saved in DB

    // Restore lastUpdated as a Timestamp, fixing it if it was accidentally converted to a string
    if (typeof rawData.lastUpdated === 'string') {
      update.lastUpdated = admin.firestore.Timestamp.fromDate(new Date(rawData.lastUpdated));
      needsUpdate = true;
    } else if (rawData.lastUpdated) {
      update.lastUpdated = rawData.lastUpdated;
    } else {
      update.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
    }

    if (rawData.sifuInstructorId !== undefined) {
      update.sifuInstructorId = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }

    if (rawData.managingOrgId !== undefined) {
      update.managingOrgId = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }

    // The previous plan mapped schoolId -> schoolDocId too
    if (member.primarySchoolId && !member.primarySchoolDocId) {
      if (legacySchoolDocIdMap.has(member.primarySchoolId)) {
        // It was just migrated to an auto-ID in this script run!
        update.primarySchoolDocId = legacySchoolDocIdMap.get(member.primarySchoolId);
        needsUpdate = true;
      } else {
        // Perform the lookup if we don't have a docId yet
        const schoolSnap = await db.collection('schools').where('schoolId', '==', member.primarySchoolId).limit(1).get();
        if (!schoolSnap.empty) {
          update.primarySchoolDocId = schoolSnap.docs[0].id;
          needsUpdate = true;
        }
      }
    } else if (member.primarySchoolDocId && legacySchoolDocIdMap.has(member.primarySchoolDocId)) {
      // If it had the old string cached as its docId from earlier testing
      update.primarySchoolDocId = legacySchoolDocIdMap.get(member.primarySchoolDocId);
      needsUpdate = true;
    }

    if (!rawData.primaryInstructorId && member.primaryInstructorId) needsUpdate = true;
    if (!rawData.primarySchoolId && member.primarySchoolId) needsUpdate = true;

    if (needsUpdate) {
      console.log(`Migrating member ${doc.id}`);
      if (!argv['dry-run']) {
        batch.update(doc.ref, update);
        batchCount++;
        await commitBatchIfNeeded();
      }
      migratedMembers++;
    }
  }

  if (!argv['dry-run']) {
    console.log('Committing final batch...');
    await commitBatchIfNeeded(true);
  }

  console.log('\nDone!');
  console.log(`Migrated ${migratedSchools} schools.`);
  console.log(`Migrated ${migratedMembers} members.`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
