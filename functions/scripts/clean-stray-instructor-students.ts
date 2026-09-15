/* clean-stray-instructor-students.ts
 *
 * Scans all /instructors/{instructorDocId}/members/{studentDocId} subcollections
 * in Firestore and verifies whether each student actually lists that instructor
 * as their primaryInstructorId.
 *
 * If a student has changed primary instructors or no longer exists, this script
 * deletes the orphaned mirror entry.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/clean-stray-instructor-students.ts [--project <PROJECT_ID>] [--dry-run]
 */

import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Member } from '../src/data-model/members';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    description: 'If true, only report stray records without deleting',
  })
  .parseSync();

const projectId =
  argv.project ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

async function main() {
  console.log(`Auditing instructor student subcollections (Project: ${projectId || 'default'})...`);
  if (argv['dry-run']) {
    console.log('--- DRY RUN MODE: No deletions will be made ---');
  }

  // 1. Fetch all members to build lookup maps
  const membersSnap = await db.collection('members').get();
  console.log(`Loaded ${membersSnap.size} members.`);

  const membersById = new Map<string, Member>();
  const instructorIdToDocId = new Map<string, string>();

  for (const doc of membersSnap.docs) {
    const data = doc.data() as Member;
    data.docId = doc.id;
    membersById.set(doc.id, data);
    if (data.instructorId) {
      instructorIdToDocId.set(String(data.instructorId).trim().toUpperCase(), doc.id);
    }
  }

  // 2. Scan all instructors
  const instructorsSnap = await db.collection('instructors').get();
  console.log(`Found ${instructorsSnap.size} instructors. Scanning student subcollections...`);

  let totalStudentMirrors = 0;
  let strayCount = 0;

  for (const instructorDoc of instructorsSnap.docs) {
    const instructorDocId = instructorDoc.id;
    const subSnap = await instructorDoc.ref.collection('members').get();
    totalStudentMirrors += subSnap.size;

    for (const studentDoc of subSnap.docs) {
      const studentMemberDocId = studentDoc.id;
      const actualMember = membersById.get(studentMemberDocId);

      let shouldDelete = false;
      let reason = '';

      if (!actualMember) {
        shouldDelete = true;
        reason = 'Member record does not exist';
      } else if (!actualMember.primaryInstructorId) {
        shouldDelete = true;
        reason = 'Member has no primaryInstructorId';
      } else {
        const studentPrimaryInstId = String(actualMember.primaryInstructorId).trim().toUpperCase();
        const expectedInstructorDocId = instructorIdToDocId.get(studentPrimaryInstId);
        if (expectedInstructorDocId !== instructorDocId) {
          shouldDelete = true;
          reason = `Member primaryInstructorId (${actualMember.primaryInstructorId}) maps to instructor doc ${expectedInstructorDocId || 'unknown'}, not ${instructorDocId}`;
        }
      }

      if (shouldDelete) {
        strayCount++;
        console.log(
          `  ✗ Stray student ${studentDoc.id} (${actualMember?.memberId || 'no-id'}, ${actualMember?.name || 'unknown'}) in instructors/${instructorDocId}/members/: ${reason}`,
        );
        if (!argv['dry-run']) {
          await studentDoc.ref.delete();
          console.log(`    ✓ Deleted instructors/${instructorDocId}/members/${studentDoc.id}`);
        }
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total instructors scanned: ${instructorsSnap.size}`);
  console.log(`Total student mirror docs: ${totalStudentMirrors}`);
  console.log(`Stray student docs found:  ${strayCount}`);
  if (argv['dry-run'] && strayCount > 0) {
    console.log('(Run without --dry-run to delete stray records)');
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
