import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/*
Backfill script to populate `ownerMemberDocId` for all schools in the `schools` collection.
Resolves the owner Member document ID by:
1. `ownerInstructorId` matching a Member's `instructorId`
2. If unresolved, checking `ownerEmails` via the `acl` collection or Member `emails`

Usage (Dry Run):
  cd functions
  pnpm exec ts-node scripts/data-migrations/backfill-school-owner-member-doc-id.ts --project ilc-paris-class-tracker

Usage (Execute):
  cd functions
  pnpm exec ts-node scripts/data-migrations/backfill-school-owner-member-doc-id.ts --project ilc-paris-class-tracker --execute
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

async function resolveMemberDocIdForInstructor(
  instructorId: string,
): Promise<{ memberDocId: string; memberName: string } | null> {
  if (!instructorId || !instructorId.trim()) return null;
  const snap = await db
    .collection('members')
    .where('instructorId', '==', instructorId.trim())
    .limit(1)
    .get();

  if (!snap.empty) {
    const doc = snap.docs[0];
    const data = doc.data();
    return {
      memberDocId: doc.id,
      memberName: data.name || '',
    };
  }
  return null;
}

async function resolveMemberDocIdForEmails(
  emails: string[],
): Promise<{ memberDocId: string; memberName: string } | null> {
  for (const email of emails) {
    if (!email || !email.trim()) continue;
    const cleanEmail = email.trim().toLowerCase();

    // 1. Check ACL
    const aclDoc = await db.collection('acl').doc(cleanEmail).get();
    if (aclDoc.exists) {
      const memberDocIds = (aclDoc.data()?.memberDocIds as string[]) || [];
      if (memberDocIds.length > 0) {
        const mDoc = await db.collection('members').doc(memberDocIds[0]).get();
        if (mDoc.exists) {
          return {
            memberDocId: mDoc.id,
            memberName: mDoc.data()?.name || '',
          };
        }
      }
    }

    // 2. Check Member emails array
    const memberSnap = await db
      .collection('members')
      .where('emails', 'array-contains', cleanEmail)
      .limit(1)
      .get();
    if (!memberSnap.empty) {
      const doc = memberSnap.docs[0];
      return {
        memberDocId: doc.id,
        memberName: doc.data().name || '',
      };
    }
  }
  return null;
}

async function runMigration() {
  console.log(`Starting school ownerMemberDocId backfill on project: ${projectId}`);
  console.log(`Dry run mode: ${!argv.execute}`);

  const snapshot = await db.collection('schools').get();
  console.log(`Found ${snapshot.size} schools to process.\n`);

  let updatedCount = 0;
  let alreadySetCount = 0;
  let unresolvedCount = 0;

  let batch = db.batch();
  let batchSize = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const schoolId = data.schoolId || doc.id;
    const schoolName = data.schoolName || 'Unnamed School';
    const currentOwnerMemberDocId = (data.ownerMemberDocId || '').trim();
    const ownerInstructorId = (data.ownerInstructorId || '').trim();
    const ownerEmails = (data.ownerEmails || []).filter((e: string) => !!e);

    if (currentOwnerMemberDocId) {
      alreadySetCount++;
      continue;
    }

    // Attempt resolution
    let resolved = await resolveMemberDocIdForInstructor(ownerInstructorId);

    if (!resolved && ownerEmails.length > 0) {
      resolved = await resolveMemberDocIdForEmails(ownerEmails);
    }

    if (resolved) {
      console.log(
        `[MATCH] School "${schoolName}" (${schoolId}): linked owner instructor "${ownerInstructorId}" -> memberDocId "${resolved.memberDocId}" (${resolved.memberName})`,
      );

      batch.update(doc.ref, {
        ownerMemberDocId: resolved.memberDocId,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      updatedCount++;
      batchSize++;

      if (batchSize >= 400) {
        if (argv.execute) {
          console.log('Committing batch of 400...');
          await batch.commit();
        }
        batch = db.batch();
        batchSize = 0;
      }
    } else {
      console.warn(
        `[UNRESOLVED] School "${schoolName}" (${schoolId}): ownerInstructorId "${ownerInstructorId}", ownerEmails: [${ownerEmails.join(', ')}]`,
      );
      unresolvedCount++;
    }
  }

  if (batchSize > 0 && argv.execute) {
    console.log(`Committing final batch of ${batchSize}...`);
    await batch.commit();
  }

  console.log('\n================ Migration Summary ================');
  console.log(`Total schools:                   ${snapshot.size}`);
  console.log(`Already had ownerMemberDocId:    ${alreadySetCount}`);
  console.log(`Updated with ownerMemberDocId:   ${updatedCount}`);
  console.log(`Unresolved schools:              ${unresolvedCount}`);
  console.log('===================================================');

  if (!argv.execute && updatedCount > 0) {
    console.log('\nRun with --execute to apply changes to Firestore.');
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error during migration:', err);
    process.exit(1);
  });
