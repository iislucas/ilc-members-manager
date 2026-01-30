import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { InstructorPublicData, Member, StudentLevel, ApplicationLevel, MasterLevel } from '../src/data-model';

/**
 * Script to initialize 'instructorsPublic' collection from the 'members' collection.
 * 
 * Usage: 
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/credentials.json \
 *   pnpm exec ts-node functions/scripts/init-instructors-public.ts --project <PROJECT_ID> [--dry-run] [--cleanup]
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
  .option('cleanup', {
    type: 'boolean',
    description: 'If true, will remove instructors from instructorsPublic if they no longer qualify',
    default: false,
  })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error('Error: Project ID is required. Use --project or GCLOUD_PROJECT env var.');
  process.exit(1);
}

admin.initializeApp({
  projectId,
});

const db = admin.firestore();

function isInstructor(member: Member): boolean {
  const today = new Date().toISOString().split('T')[0];
  // Logic should match functions/src/mirror-instructors.ts
  return member.instructorId !== '' && member.instructorLicenseExpires >= today;
}

async function run() {
  console.log(`Initialising instructorsPublic for project: ${projectId}`);
  if (argv['dry-run']) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const membersSnap = await db.collection('members').get();
  console.log(`Found ${membersSnap.size} members to process.`);

  const qualifyingInstructorIds = new Set<string>();
  let updatedCount = 0;
  let skippedCount = 0;

  for (const doc of membersSnap.docs) {
    const member = doc.data() as Member;
    
    if (isInstructor(member)) {
      qualifyingInstructorIds.add(member.instructorId);
      console.log(`Member ${member.name} (${member.instructorId}) qualifies as instructor.`);
      
      const instructorData: InstructorPublicData = {
        id: member.instructorId,
        name: member.name,
        memberId: member.memberId,
        instructorWebsite: member.instructorWebsite || '',
        studentLevel: member.studentLevel || StudentLevel.None,
        applicationLevel: member.applicationLevel || ApplicationLevel.None,
        mastersLevels: member.mastersLevels || [],
        instructorId: member.instructorId,
        publicRegionOrCity: member.publicRegionOrCity || '',
        publicCountyOrState: member.publicCountyOrState || '',
        country: member.country || '',
        publicEmail: member.publicEmail || '',
        publicPhone: member.publicPhone || '',
      };

      if (!argv['dry-run']) {
        await db.collection('instructorsPublic').doc(member.instructorId).set(instructorData);
      }
      updatedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(`\nProcessed ${membersSnap.size} members:`);
  console.log(`- ${updatedCount} instructors updated/created`);
  console.log(`- ${skippedCount} members skipped (not qualifying)`);

  if (argv.cleanup) {
    console.log('\nCleaning up orphaned instructors in instructorsPublic...');
    const instructorsSnap = await db.collection('instructorsPublic').get();
    let removedCount = 0;

    for (const doc of instructorsSnap.docs) {
      if (!qualifyingInstructorIds.has(doc.id)) {
        console.log(`Removing orphaned instructor document: ${doc.id}`);
        if (!argv['dry-run']) {
          await doc.ref.delete();
        }
        removedCount++;
      }
    }
    console.log(`Removed ${removedCount} orphaned instructor(s).`);
  }

  console.log('\nFinished.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
