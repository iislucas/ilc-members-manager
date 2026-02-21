import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Member } from '../src/data-model';

/**
 * Script to fix various member data issues.
 *
 * This script:
 * 1. Finds all member docs where the document ID accidentally matches the `memberId` field.
 *    For these, it creates a new doc with a Firestore-generated ID, copies the data, and deletes the old doc.
 * 2. Populates `instructors/{instructorMemberDocId}` with public instructor data for ALL members that have an `instructorId`, regardless of license status.
 * 3. Deletes any old `instructors/{instructorId}` documents, as they were keyed incorrectly by the string ID instead of the Firestore member DocID.
 * 4. Finds all members with a sifuInstructorId (students).
 * 5. Writes the student under the correct path (instructors/{instructorMemberDocId}/members/...)
 * 6. Removes any entries under the old incorrect path (instructors/{instructorId}/members/...)
 * 7. Scans all `instructors/{docId}/members` to remove stray entries where the member is no longer a student of that instructor.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/credentials.json \
 *   pnpm exec ts-node functions/scripts/fix-members.ts --project <PROJECT_ID> [--dry-run]
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
  console.log(`Fixing members for project: ${projectId}`);
  if (argv['dry-run']) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  // Load all members
  const membersSnap = await db.collection('members').get();
  console.log(`Found ${membersSnap.size} members.`);

  const members: (Member & { _oldId?: string })[] = [];

  let memberIdDocKeyFixCount = 0;

  for (const doc of membersSnap.docs) {
    const data = doc.data() as Member & { _oldId?: string };
    data.id = doc.id;

    // Check if doc is keyed by memberId
    if (data.memberId && doc.id === data.memberId) {
      console.log(`  ⚠ Member doc keyed by memberId: ${doc.id}. Creating new document...`);
      data._oldId = doc.id;
      if (!argv['dry-run']) {
        const newDocRef = db.collection('members').doc();
        // Update id to the new generated one
        data.id = newDocRef.id;

        // Remove internal tracker field before saving data
        const { _oldId, ...saveData } = data;

        await newDocRef.set(saveData);
        await doc.ref.delete();
        console.log(`  ✓ Moved to new docId: ${data.id}`);
      } else {
        console.log(`  ✓ (Dry run) Would move to new auto-generated docId`);
        // For dry run, we simulate the ID change so rest of script functions correctly
        data.id = 'dry_run_generated_id_' + data.memberId;
      }
      memberIdDocKeyFixCount++;
    }

    members.push(data);
  }

  console.log(`\nFixed ${memberIdDocKeyFixCount} member docs incorrectly keyed by memberId.\n`);

  // Build a map: instructorId string -> member docId
  const instructorIdToDocId = new Map<string, string>();
  for (const member of members) {
    if (member.instructorId) {
      instructorIdToDocId.set(member.instructorId, member.id);
    }
  }
  console.log(`Found ${instructorIdToDocId.size} members with an instructorId.`);

  let instructorDocsFixedCount = 0;
  let instructorDocsRemovedOldCount = 0;

  for (const member of members) {
    if (!member.instructorId) continue;

    // We want all instructors to have a basic public doc regardless of expired license.
    const correctInstructorDocRef = db.collection('instructors').doc(member.id);
    const instructorData = {
      name: member.name,
      memberId: member.memberId,
      instructorWebsite: member.instructorWebsite || '',
      studentLevel: member.studentLevel || '',
      applicationLevel: member.applicationLevel || '',
      mastersLevels: member.mastersLevels || [],
      instructorId: member.instructorId,
      publicRegionOrCity: member.publicRegionOrCity || '',
      publicCountyOrState: member.publicCountyOrState || '',
      country: member.country || '',
      publicEmail: member.publicEmail || '',
      publicPhone: member.publicPhone || '',
      tags: member.tags || [],
    };

    console.log(`  ✓ Instructor "${member.name}" (${member.id}) -> instructors/${member.id} populated.`);
    if (!argv['dry-run']) {
      await correctInstructorDocRef.set(instructorData);
    }
    instructorDocsFixedCount++;

    if (member.instructorId !== member.id) {
      const oldInstructorIdRef = db.collection('instructors').doc(member.instructorId);
      const oldInstructorSnap = await oldInstructorIdRef.get();
      if (oldInstructorSnap.exists) {
        console.log(`  ✗ Removing old incorrectly keyed instructor doc at instructors/${member.instructorId}`);
        if (!argv['dry-run']) {
          await oldInstructorIdRef.delete();
        }
        instructorDocsRemovedOldCount++;
      }
    }

    if (member._oldId && member._oldId !== member.id && member._oldId !== member.instructorId) {
      const oldIdRef = db.collection('instructors').doc(member._oldId);
      const oldIdSnap = await oldIdRef.get();
      if (oldIdSnap.exists) {
        console.log(`  ✗ Removing old oldId-keyed instructor doc at instructors/${member._oldId}`);
        if (!argv['dry-run']) {
          await oldIdRef.delete();
        }
        instructorDocsRemovedOldCount++;
      }
    }
  }

  // Cleanup stray instructor documents entirely
  const validInstructorDocIds = new Set<string>();
  for (const member of members) {
    if (member.instructorId) {
      validInstructorDocIds.add(member.id);
    }
  }

  const instructorsSnapForCleanup = await db.collection('instructors').get();
  for (const instructorDoc of instructorsSnapForCleanup.docs) {
    if (!validInstructorDocIds.has(instructorDoc.id)) {
      console.log(`  ✗ Removing stray or incorrectly keyed instructor doc entirely at instructors/${instructorDoc.id}`);
      if (!argv['dry-run']) {
        await instructorDoc.ref.delete();
      }
      instructorDocsRemovedOldCount++;
    }
  }

  // Find students (members with sifuInstructorId set)
  const studentsWithSifu = members.filter((m) => m.sifuInstructorId);
  console.log(`Found ${studentsWithSifu.length} members with a sifuInstructorId.`);

  let fixedCount = 0;
  let skippedCount = 0;
  let removedOldCount = 0;
  let missingInstructorCount = 0;

  for (const student of studentsWithSifu) {
    const sifuInstructorId = student.sifuInstructorId;
    const instructorDocId = instructorIdToDocId.get(sifuInstructorId);

    if (!instructorDocId) {
      console.warn(
        `  ⚠ Student "${student.name}" (${student.id}) has sifuInstructorId="${sifuInstructorId}" but no member with that instructorId was found. Skipping.`,
      );
      missingInstructorCount++;
      continue;
    }

    // The correct path
    const correctRef = db
      .collection('instructors')
      .doc(instructorDocId)
      .collection('members')
      .doc(student.id);

    // Write to the correct path
    console.log(
      `  ✓ "${student.name}" (${student.id}) -> instructors/${instructorDocId}/members/${student.id}`,
    );
    if (!argv['dry-run']) {
      // Remove internal tracking field before saving
      const { _oldId, ...studentData } = student;
      await correctRef.set(studentData);
    }
    fixedCount++;

    // Remove the old incorrect entry if it was stored by instructorId
    const oldInstructorIdRef = db
      .collection('instructors')
      .doc(sifuInstructorId)
      .collection('members')
      .doc(student._oldId || student.id);

    if (sifuInstructorId !== instructorDocId) {
      const oldSnap = await oldInstructorIdRef.get();
      if (oldSnap.exists) {
        console.log(
          `  ✗ Removing old entry at instructors/${sifuInstructorId}/members/${student._oldId || student.id}`,
        );
        if (!argv['dry-run']) {
          await oldInstructorIdRef.delete();
        }
        removedOldCount++;
      }
    } else {
      skippedCount++;
    }

    // Also remove the old incorrect entry under the correct instructor DocID but with the old student ID
    if (student._oldId) {
      const oldStudentDocRef = db
        .collection('instructors')
        .doc(instructorDocId)
        .collection('members')
        .doc(student._oldId);

      const oldStudentSnap = await oldStudentDocRef.get();
      if (oldStudentSnap.exists) {
        console.log(
          `  ✗ Removing old student ID entry at instructors/${instructorDocId}/members/${student._oldId}`,
        );
        if (!argv['dry-run']) {
          await oldStudentDocRef.delete();
        }
        removedOldCount++;
      }
    }
  }

  // Cleanup stray students
  let strayMembersRemovedCount = 0;

  const membersById = new Map<string, Member>();
  for (const m of members) {
    membersById.set(m.id, m);
  }

  const instructorsSnap = await db.collection('instructors').get();
  for (const instructorDoc of instructorsSnap.docs) {
    const instructorDocId = instructorDoc.id;
    const instructorMembersSnap = await instructorDoc.ref.collection('members').get();

    for (const studentDoc of instructorMembersSnap.docs) {
      const studentId = studentDoc.id;
      const actualStudent = membersById.get(studentId);

      let shouldDelete = false;

      if (!actualStudent) {
        // Student doesn't exist anymore
        shouldDelete = true;
      } else if (!actualStudent.sifuInstructorId) {
        // Student has no sifuInstructorId
        shouldDelete = true;
      } else {
        const expectedInstructorDocId = instructorIdToDocId.get(actualStudent.sifuInstructorId);
        if (expectedInstructorDocId !== instructorDocId) {
          shouldDelete = true; // Belongs to a different instructor or none if not found
        }
      }

      if (shouldDelete) {
        console.log(`  ✗ Removing stray student entry at instructors/${instructorDocId}/members/${studentId}`);
        if (!argv['dry-run']) {
          await studentDoc.ref.delete();
        }
        strayMembersRemovedCount++;
      }
    }
  }

  console.log(`\nDone!`);
  console.log(`- ${memberIdDocKeyFixCount} member docs re-keyed with new auto-generated doc keys`);
  console.log(`- ${instructorDocsFixedCount} instructor public docs populated at correct paths`);
  console.log(`- ${instructorDocsRemovedOldCount} old incorrectly keyed instructor docs removed`);
  console.log(`- ${fixedCount} students mirrored to correct paths`);
  console.log(`- ${removedOldCount} old incorrect student entries removed`);
  console.log(`- ${strayMembersRemovedCount} stray student entries removed from instructors/*/members`);
  console.log(`- ${missingInstructorCount} students with missing instructor (skipped)`);
  if (argv['dry-run']) {
    console.log('\n(Dry run — no changes were made)');
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
