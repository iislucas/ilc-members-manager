import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/*
 Data migration: backfill grading display-name snapshots.

 Two denormalized fields cache the names referenced by a grading so non-admin
 viewers (who cannot read the members/instructors collections) see names rather
 than bare IDs:
   - studentName            — the student member's display name
   - gradingInstructorName  — the primary grading instructor's display name

 Going forward these are kept in sync by the grading triggers
 (functions/src/on-grading-update.ts) on every create/update. This script fills
 them in for gradings written before the triggers existed.

 For each grading it:
   1. Resolves the student name from studentMemberDocId, falling back to a
      lookup by the human-readable studentMemberId.
   2. Resolves the primary instructor's name by finding the member whose
      instructorId matches gradingInstructorId.
   3. Writes the fields only when they are missing or have changed.

 The script is idempotent: re-running it makes no further changes.

 Usage:
   cd functions
   pnpm run backfill-grading-names --project ilc-paris-class-tracker --dry-run

 If running against the local emulator or with GCLOUD_PROJECT set:
   pnpm run backfill-grading-names --dry-run

 Remove --dry-run to actually save changes.
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

const projectId =
  argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Error: Project ID is required. Use --project or GCLOUD_PROJECT env var.',
  );
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

// Cache member-docId → name and instructorId → name lookups so we don't re-read
// the same member across many gradings.
const memberNameByDocId = new Map<string, string>();
async function memberNameFromDocId(docId: string): Promise<string> {
  if (!docId) return '';
  if (memberNameByDocId.has(docId)) return memberNameByDocId.get(docId)!;
  const snap = await db.collection('members').doc(docId).get();
  const name = snap.exists ? (snap.data()?.name as string) || '' : '';
  memberNameByDocId.set(docId, name);
  return name;
}

const memberNameByMemberId = new Map<string, string>();
async function memberNameFromMemberId(memberId: string): Promise<string> {
  if (!memberId) return '';
  if (memberNameByMemberId.has(memberId)) return memberNameByMemberId.get(memberId)!;
  const q = await db
    .collection('members')
    .where('memberId', '==', memberId)
    .limit(1)
    .get();
  const name = q.empty ? '' : (q.docs[0].data()?.name as string) || '';
  memberNameByMemberId.set(memberId, name);
  return name;
}

const instructorNameById = new Map<string, string>();
async function instructorName(instructorId: string): Promise<string> {
  if (!instructorId) return '';
  if (instructorNameById.has(instructorId)) return instructorNameById.get(instructorId)!;
  const q = await db
    .collection('members')
    .where('instructorId', '==', instructorId)
    .limit(1)
    .get();
  const name = q.empty ? '' : (q.docs[0].data()?.name as string) || '';
  instructorNameById.set(instructorId, name);
  return name;
}

async function run() {
  const isDryRun = argv['dry-run'];
  console.log(`Backfilling grading name snapshots for project: ${projectId}`);
  if (isDryRun) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const stats = { total: 0, updated: 0, studentFilled: 0, instructorFilled: 0 };

  const snap = await db.collection('gradings').get();
  stats.total = snap.size;
  console.log(`Found ${stats.total} gradings.`);

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    const studentMemberDocId = (data.studentMemberDocId as string) || '';
    const studentMemberId = (data.studentMemberId as string) || '';
    const gradingInstructorId = (data.gradingInstructorId as string) || '';

    const resolvedStudentName =
      (await memberNameFromDocId(studentMemberDocId)) ||
      (await memberNameFromMemberId(studentMemberId));
    const resolvedInstructorName = await instructorName(gradingInstructorId);

    if ((data.studentName ?? '') !== resolvedStudentName) {
      update.studentName = resolvedStudentName;
      if (resolvedStudentName) stats.studentFilled++;
    }
    if ((data.gradingInstructorName ?? '') !== resolvedInstructorName) {
      update.gradingInstructorName = resolvedInstructorName;
      if (resolvedInstructorName) stats.instructorFilled++;
    }

    if (Object.keys(update).length === 0) continue;

    stats.updated++;
    console.log(`  Grading ${doc.id}: ${Object.keys(update).join(', ')}`);
    if (!isDryRun) {
      batch.update(doc.ref, update);
      batchCount++;
      if (batchCount >= 100) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  if (!isDryRun && batchCount > 0) {
    await batch.commit();
  }

  console.log('\n--- Summary ---');
  console.log(`Total gradings:           ${stats.total}`);
  console.log(`Updated:                  ${stats.updated}`);
  console.log(`studentName filled:       ${stats.studentFilled}`);
  console.log(`gradingInstructorName filled: ${stats.instructorFilled}`);
  if (isDryRun) console.log('(dry run — nothing was saved)');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
