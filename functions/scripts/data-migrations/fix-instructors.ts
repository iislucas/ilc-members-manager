import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/**
 * Script to clean up the 'instructors' collection.
 * It traverses all instructor documents; if a document is considered empty
 * (missing valid public instructor information or lacking a corresponding member document),
 * it removes it along with any 'members' subcollection it might have.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/credentials.json \
 *   pnpm exec ts-node functions/scripts/fix-instructors.ts --project <PROJECT_ID> [--dry-run]
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

admin.initializeApp({
  projectId,
});

const db = admin.firestore();

async function deleteSubcollection(
  docRef: admin.firestore.DocumentReference,
  subcollectionName: string,
  dryRun: boolean,
) {
  const subSnap = await docRef.collection(subcollectionName).get();
  for (const subDoc of subSnap.docs) {
    if (!dryRun) {
      await subDoc.ref.delete();
    }
  }
  return subSnap.size;
}

async function run() {
  console.log(`Fixing instructors for project: ${projectId}`);
  if (argv['dry-run']) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const instructorRefs = await db.collection('instructors').listDocuments();
  console.log(`Found ${instructorRefs.length} instructor document references to process.`);

  let removedCount = 0;
  let removedSubDocsCount = 0;
  let validCount = 0;

  for (const docRef of instructorRefs) {
    const doc = await docRef.get();
    const data = doc.exists ? doc.data() : undefined;

    // Check if it has valid public instructor information
    // A valid instructor should at least have a name and an instructor ID.
    const hasValidInfo =
      data &&
      Object.keys(data).length > 0 &&
      data.name &&
      data.instructorId &&
      data.memberId;

    let hasCorrespondingMember = false;
    if (hasValidInfo) {
      console.log(`Checking for corresponding member document for instructor doc ID '${doc.id}'.`);
      // Check if the corresponding member document exists
      const memberSnap = await db.collection('members').doc(doc.id).get();
      hasCorrespondingMember = memberSnap.exists;
    }
    const isInvalid = !hasValidInfo || !hasCorrespondingMember;

    if (isInvalid) {
      console.log(
        `[REMOVE] Instructor doc ID '${doc.id}' is invalid/empty.`,
      );
      if (!doc.exists) {
        console.log(`  - Document is a "phantom" document (has no data but contains subcollections).`);
      } else {
        console.log(`  - hasValidInfo: ${Boolean(hasValidInfo)}`);
        if (!hasValidInfo) {
          console.log(`  - Data: ${JSON.stringify(data)}`);
        }
        console.log(`  - hasCorrespondingMember: ${hasCorrespondingMember}`);
      }

      // Remove 'members' subcollection
      const numStudentsRemoved = await deleteSubcollection(
        docRef,
        'members',
        Boolean(argv['dry-run']),
      );
      if (numStudentsRemoved > 0) {
        console.log(
          `  - Removed ${numStudentsRemoved} student(s) from 'members' subcollection.`,
        );
        removedSubDocsCount += numStudentsRemoved;
      }

      // Remove the instructor document
      if (!argv['dry-run']) {
        await docRef.delete();
      }
      removedCount++;
    } else {
      validCount++;
    }
  }

  console.log(`\nFinished running fix-instructors.`);
  console.log(`- ${validCount} instructor(s) kept.`);
  console.log(`- ${removedCount} empty/invalid instructor(s) removed.`);
  console.log(`- ${removedSubDocsCount} student doc(s) from subcollections removed.`);

  process.exit(0);
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
