import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  InstructorPublicData,
  Member,
  StudentLevel,
  ApplicationLevel,
  MasterLevel,
} from '../src/data-model';

/**
 * Script to initialize 'instructors' collection from the 'members' collection.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/credentials.json \
 *   pnpm exec ts-node functions/scripts/init-instructors.ts --project <PROJECT_ID> [--dry-run] [--cleanup]
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
    description:
      'If true, will remove instructors from instructors collection if they no longer qualify',
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

function isInstructor(member: Member): boolean {
  const today = new Date().toISOString().split('T')[0];
  // Logic should match functions/src/mirror-instructors.ts
  return member.instructorId !== '' && member.instructorLicenseExpires >= today;
}

async function run() {
  console.log(`Initialising instructors for project: ${projectId}`);
  if (argv['dry-run']) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const membersSnap = await db.collection('members').get();
  console.log(`Found ${membersSnap.size} members to process.`);

  const members = membersSnap.docs.map((doc) => {
    const data = doc.data() as Member;
    data.id = doc.id;
    return data;
  });

  const qualifyingInstructorIds = new Set<string>();
  const studentsByInstructorId = new Map<string, Member[]>();

  for (const member of members) {
    if (member.sifuInstructorId) {
      if (!studentsByInstructorId.has(member.sifuInstructorId)) {
        studentsByInstructorId.set(member.sifuInstructorId, []);
      }
      studentsByInstructorId.get(member.sifuInstructorId)!.push(member);
    }
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let totalStudentsCount = 0;

  for (const member of members) {
    if (isInstructor(member)) {
      qualifyingInstructorIds.add(member.id);
      console.log(
        `Member ${member.name} (${member.instructorId}) qualifies as instructor. Doc ID: ${member.id}`,
      );

      const instructorData: InstructorPublicData = {
        id: member.id, // Key is Member Doc ID
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
        await db.collection('instructors').doc(member.id).set(instructorData);
      }

      const students = studentsByInstructorId.get(member.instructorId) || [];
      console.log(`  - Found ${students.length} students for this instructor.`);

      for (const student of students) {
        if (!argv['dry-run']) {
          await db
            .collection('instructors')
            .doc(member.id)
            .collection('members')
            .doc(student.id)
            .set(student);
        }
        totalStudentsCount++;
      }

      if (argv.cleanup) {
        const studentSubcollection = await db
          .collection('instructors')
          .doc(member.id)
          .collection('members')
          .get();
        const currentStudentIds = new Set(students.map((s) => s.id));

        for (const studentDoc of studentSubcollection.docs) {
          if (!currentStudentIds.has(studentDoc.id)) {
            console.log(
              `  - Removing orphaned student ${studentDoc.id} from instructor ${member.id}`,
            );
            if (!argv['dry-run']) {
              await studentDoc.ref.delete();
            }
          }
        }
      }

      updatedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(`\nProcessed ${membersSnap.size} members:`);
  console.log(`- ${updatedCount} instructors updated/created`);
  console.log(`- ${totalStudentsCount} student records updated/created`);
  console.log(`- ${skippedCount} members skipped (not qualifying)`);

  if (argv.cleanup) {
    console.log(
      '\nCleaning up orphaned instructors in instructors collection...',
    );
    const instructorsSnap = await db.collection('instructors').get();
    let removedCount = 0;

    for (const doc of instructorsSnap.docs) {
      if (!qualifyingInstructorIds.has(doc.id)) {
        console.log(`Removing orphaned instructor document: ${doc.id}`);
        if (!argv['dry-run']) {
          // Note: This only deletes the parent doc, not the subcollections.
          // Firestore doesn't automatically delete subcollections.
          // In a script like this, we should potentially delete them or at least notify.
          const studentsSnap = await doc.ref.collection('members').get();
          for (const sDoc of studentsSnap.docs) {
            await sDoc.ref.delete();
          }
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
