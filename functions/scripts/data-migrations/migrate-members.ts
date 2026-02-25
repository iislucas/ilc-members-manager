import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/**
 * Migration script to refactor members collection from email-keyed IDs to auto-generated IDs.
 * Also populates the new 'acl' collection mapping emails to member IDs.
 * 
 * Usage: 
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/credentials.json \
 *   pnpm exec ts-node functions/scripts/migrate-members.ts --project <PROJECT_ID>
 */

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    demandOption: false,
  })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT;

admin.initializeApp({
  projectId,
});

const db = admin.firestore();

async function migrate() {
  const membersSnap = await db.collection('members').get();
  console.log(`Found ${membersSnap.size} members to migrate.`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const doc of membersSnap.docs) {
    const data = doc.data();
    const emailId = doc.id;

    // Check if it's already an auto-ID (non-email)
    if (!emailId.includes('@')) {
      console.log(`Skipping ${emailId} - already using auto-ID or not an email.`);
      skippedCount++;
      continue;
    }

    console.log(`Migrating: ${emailId}`);

    // Generate a new member document with an auto-ID
    const newMemberRef = db.collection('members').doc();
    const newMemberId = newMemberRef.id;

    // Transition email string to emails array
    const newMemberData = {
      ...data,
      emails: [emailId],
      isAdmin: !!data.isAdmin,
    };
    
    // Remove the old 'email' property if it's present in the document object
    if ('email' in newMemberData) {
      delete (newMemberData as any).email;
    }

    // Create or update the ACL document for the email
    const aclRef = db.collection('acl').doc(emailId);

    const batch = db.batch();
    
    // 1. Create the new member record
    batch.set(newMemberRef, newMemberData);
    
    // 2. Add the member ID to the ACL mapping and sync structural fields
    const aclUpdate: {
      memberDocIds: admin.firestore.FieldValue;
      instructorIds?: admin.firestore.FieldValue;
      isAdmin?: boolean;
    } = {
      memberDocIds: admin.firestore.FieldValue.arrayUnion(newMemberId),
    };
    if (data.instructorId) {
      aclUpdate.instructorIds = admin.firestore.FieldValue.arrayUnion(
        data.instructorId,
      );
    }
    aclUpdate.isAdmin = !!data.isAdmin;

    batch.set(aclRef, aclUpdate, { merge: true });

    // 3. Delete the old email-keyed record
    batch.delete(doc.ref);

    await batch.commit();
    migratedCount++;
    console.log(`Successfully migrated ${emailId} -> ${newMemberId}`);
  }

  console.log('--- Migration Summary ---');
  console.log(`Total: ${membersSnap.size}`);
  console.log(`Migrated: ${migratedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log('-------------------------');

  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
