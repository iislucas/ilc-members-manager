import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/**
 * Script to clean fix instructor license timing for public instructors, so 
 * they can appear in the public instructor list when their license is valid, 
 * based on a query. 
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/credentials.json \
 *   pnpm exec ts-node functions/scripts/fix-instructor-licenses.ts --project <PROJECT_ID> [--dry-run]
 */

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    default: 'ilc-paris-class-tracker',
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

// Import after init so db is ready
import { updateInstructorPublicProfile } from '../src/mirror-instructors-to-public-profile';
import { Member } from '../src/data-model';

async function run() {
  console.log(`Fixing instructor licenses for project: ${projectId}`);
  if (argv['dry-run']) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const db = admin.firestore();
  const membersSnap = await db.collection('members').get();
  console.log(`Found ${membersSnap.docs.length} members to process.`);

  let processedCount = 0;

  for (const doc of membersSnap.docs) {
    const member = doc.data() as Member;
    member.id = doc.id;

    if (!argv['dry-run']) {
      await updateInstructorPublicProfile({ previous: undefined, member });
    }
    processedCount++;
  }

  console.log(`\nFinished running fix-instructor-licenses.`);
  console.log(`- ${processedCount} members processed and re-mirrored.`);
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
