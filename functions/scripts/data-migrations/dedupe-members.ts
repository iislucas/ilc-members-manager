/*
Usage: 

NOTE: GOOGLE_APPLICATION_CREDENTIALS should be set in your environment if not using default credentials.

pnpm exec ts-node functions/scripts/dedupe-members.ts --project <PROJECT_ID> [--dry-run]

*/

import * as firebase from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('project', {
      type: 'string',
      description: 'Firebase Project ID',
      demandOption: false,
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Preview changes without executing them',
      default: false,
    })
    .help()
    .parseSync();

  const projectId = argv.project || process.env.GCLOUD_PROJECT;
  const dryRun = argv['dry-run'];

  console.log(`Project ID: ${projectId}`);
  console.log(`Dry Run: ${dryRun}`);

  const app = firebase.initializeApp({
    projectId,
  });
  const db = firebase.firestore();

  try {
    console.log('Fetching members...');
    const membersSnap = await db.collection('members').get();
    console.log(`Found ${membersSnap.size} members.`);

    const memberIdGroups: { [memberId: string]: string[] } = {};
    const emptyMemberIdDocIds: string[] = [];

    membersSnap.forEach((doc) => {
      const data = doc.data();
      const memberId = data.memberId;
      if (!memberId || memberId.trim() === '') {
        emptyMemberIdDocIds.push(doc.id);
      } else {
        if (!memberIdGroups[memberId]) {
          memberIdGroups[memberId] = [];
        }
        memberIdGroups[memberId].push(doc.id);
      }
    });

    const duplicateGroups = Object.entries(memberIdGroups).filter(
      ([_, docIds]) => docIds.length > 1,
    );

    if (duplicateGroups.length === 0 && emptyMemberIdDocIds.length === 0) {
      console.log('No duplicate or empty memberID entries found.');
      return;
    }

    if (emptyMemberIdDocIds.length > 0) {
      console.log(
        `Found ${emptyMemberIdDocIds.length} members with empty memberId:`,
      );
      for (const docId of emptyMemberIdDocIds) {
        console.log(`- DocID: ${docId}`);
        if (!dryRun) {
          const docRef = db.collection('members').doc(docId);
          const docSnap = await docRef.get();
          if (docSnap.exists) {
            const data = docSnap.data();
            console.log(`  Moving doc ${docId} to members_duplicates...`);
            await db
              .collection('members_duplicates')
              .doc(docId)
              .set({
                ...data,
                movedAt: firebase.firestore.FieldValue.serverTimestamp(),
                reason: 'empty_member_id',
              });
            console.log(`  Deleting doc ${docId} from members...`);
            await docRef.delete();
          }
        }
      }
    }

    if (duplicateGroups.length > 0) {
      console.log(
        `Found ${duplicateGroups.length} duplicate memberID entries:`,
      );
      for (const [memberId, docIds] of duplicateGroups) {
        console.log(
          `- memberId: ${memberId} (Found in docs: ${docIds.join(', ')})`,
        );

        if (!dryRun) {
          for (const docId of docIds) {
            const docRef = db.collection('members').doc(docId);
            const docSnap = await docRef.get();

            if (docSnap.exists) {
              const data = docSnap.data();
              console.log(`  Moving doc ${docId} to members_duplicates...`);
              await db
                .collection('members_duplicates')
                .doc(docId)
                .set({
                  ...data,
                  movedAt: firebase.firestore.FieldValue.serverTimestamp(),
                  reason: 'duplicate_member_id',
                });
              console.log(`  Deleting doc ${docId} from members...`);
              await docRef.delete();
            }
          }
        }
      }
    }

    if (dryRun) {
      console.log('\n[DRY RUN] No changes were made to the database.');
    } else {
      console.log('\nSuccessfully moved duplicate entries.');
    }
  } catch (error) {
    console.error('Error during deduplication:', error);
  } finally {
    await app.delete();
  }
}

main();
