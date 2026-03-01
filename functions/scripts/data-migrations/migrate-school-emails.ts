import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/*
Migrates the `ownerEmail` field in the `schools` collection from a single string 
to an `ownerEmails` array containing all of the emails associated with the owner 
instructor's profile. Also ensures the `managerEmails` array is properly updated 
with all emails from each manager's profile.

Usage (Dry Run):
  cd functions
  pnpm exec ts-node scripts/data-migrations/migrate-school-emails.ts --project ilc-paris-class-tracker

Usage (Execute):
  cd functions
  pnpm exec ts-node scripts/data-migrations/migrate-school-emails.ts --project ilc-paris-class-tracker --execute
*/

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    default: process.env.GCLOUD_PROJECT || 'ilc-paris-class-tracker',
  })
  .option('execute', {
    type: 'boolean',
    description: 'Actually apply the changes to the database',
    default: false,
  })
  .parseSync();

const projectId = argv.project;

admin.initializeApp({ projectId });
const db = admin.firestore();

async function resolveInstructorEmails(instructorIds: string[]): Promise<string[]> {
  const emails: string[] = [];
  const validIds = instructorIds.filter((id) => !!id);

  if (validIds.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < validIds.length; i += 30) {
    chunks.push(validIds.slice(i, i + 30));
  }

  for (const chunk of chunks) {
    const q = db.collection('members').where('instructorId', 'in', chunk);
    const snapshot = await q.get();
    snapshot.forEach(doc => {
      const member = doc.data();
      if (member.emails && member.emails.length > 0) {
        emails.push(...member.emails);
      }
    });
  }

  // Deduplicate and return lowercased emails
  return Array.from(new Set(emails.map(e => e.toLowerCase()))).sort();
}

async function runMigration() {
  console.log(`Starting school emails migration on project: ${projectId}`);
  console.log(`Dry run mode: ${!argv.execute}`);

  const snapshot = await db.collection('schools').get();
  console.log(`Found ${snapshot.size} schools to process.`);

  let fixCount = 0;
  let batch = db.batch();
  let batchSize = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Resolve emails from instructor IDs
    const currentOwnerId = data.ownerInstructorId || '';
    const currentManagerIds = data.managerInstructorIds || [];

    const expectedOwnerEmails = await resolveInstructorEmails([currentOwnerId]);
    const expectedManagerEmails = await resolveInstructorEmails(currentManagerIds);

    const updates: Record<string, any> = {};
    let needsUpdate = false;

    // Check if ownerEmail string field exists, we should delete it.
    if ('ownerEmail' in data) {
      updates['ownerEmail'] = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }

    // Check if ownerEmails matches
    const currentOwnerEmails = (data.ownerEmails || []).slice().sort();
    if (JSON.stringify(currentOwnerEmails) !== JSON.stringify(expectedOwnerEmails)) {
      updates['ownerEmails'] = expectedOwnerEmails;
      needsUpdate = true;
    }

    // Check if managerEmails matches
    const currentManagerEmails = (data.managerEmails || []).slice().sort();
    if (JSON.stringify(currentManagerEmails) !== JSON.stringify(expectedManagerEmails)) {
      updates['managerEmails'] = expectedManagerEmails;
      needsUpdate = true;
    }

    // Safety fallback for new arrays when originally entirely absent
    if (!('ownerEmails' in data) && !needsUpdate) {
      updates['ownerEmails'] = expectedOwnerEmails;
      needsUpdate = true;
    }

    if (needsUpdate) {
      console.log(`School ${doc.id} (${data.schoolName}) requires update.`);
      console.log(`  Updating...`);

      batch.update(doc.ref, updates);
      fixCount++;
      batchSize++;

      if (batchSize >= 400) {
        if (argv.execute) {
          console.log('Committing batch...');
          await batch.commit();
        }
        batch = db.batch();
        batchSize = 0;
      }
    }
  }

  if (batchSize > 0) {
    if (argv.execute) {
      console.log(`Committing final batch of ${batchSize}...`);
      await batch.commit();
    }
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Total schools: ${snapshot.size}`);
  console.log(`Schools needing updates: ${fixCount}`);
  if (argv.execute) {
    console.log(`Successfully migrated ${fixCount} schools.`);
  } else {
    console.log('Run with --execute to apply changes.');
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
