import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { gradingProgression, previousGradingLevel, PaymentStatus } from '../../src/data-model';

/*
 Data migration: backfill grading manager rename, paid flag, and level snapshot.

 Three idempotent passes over every /gradings document:

   1. gradingManagerIds — the canonical replacement for the legacy
      `assistantInstructorIds`. Copies the legacy value across when the new field
      is missing. The legacy field is intentionally LEFT in place for now (removed
      in a later cleanup migration).

   2. paymentStatus / paymentNote — how the grading was paid for. Existing
      gradings predate the field; they are treated as paid. A doc missing
      `paymentStatus` is set to 'paid-by-squarespace' when it has an `orderId`
      (it came from an order), otherwise 'paid-other'; `paymentNote` is set to ''.
      Order-created gradings are written 'paid-by-squarespace' by the order
      processor going forward.

   3. studentLevelAtAcceptance / applicationLevelAtAcceptance — a snapshot of the
      student's levels when the grading was accepted. Going forward the grading
      trigger captures the real member levels at acceptance. For historical docs
      we BEST-EFFORT infer them from the level being graded: the student must have
      held the progression entry immediately before `level`
      (previousGradingLevel), from which we derive the implied student/application
      levels. Only filled for gradings that have been accepted or beyond
      (awaiting-instructor-grading / passed / not-passed) and only when both
      snapshot fields are currently empty.

 The script is idempotent: re-running it makes no further changes.

 Usage:
   cd functions
   pnpm run backfill-grading-managers-paid-level --project ilc-paris-class-tracker --dry-run

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

// Statuses at which a grading has been accepted (so a level snapshot makes
// sense). Mirrors GradingStatus values for AwaitingGrading/Passed/NotPassed.
const ACCEPTED_STATUSES = new Set([
  'awaiting-instructor-grading',
  'passed',
  'not-passed',
]);

// Derive the student & application levels implied by holding `heldProgressionLevel`
// (a `gradingProgression` entry such as 'Student 6' or 'Application 3'). Returns
// the highest student/application level achieved up to and including that entry.
function deriveLevels(heldProgressionLevel: string): {
  studentLevel: string;
  applicationLevel: string;
} {
  let studentLevel = '';
  let applicationLevel = '';
  if (!heldProgressionLevel) return { studentLevel, applicationLevel };
  const idx = gradingProgression.indexOf(heldProgressionLevel);
  if (idx < 0) return { studentLevel, applicationLevel };
  for (let i = 0; i <= idx; i++) {
    const entry = gradingProgression[i];
    if (entry.startsWith('Student ')) {
      studentLevel = entry.substring('Student '.length); // 'Entry' or '1'..'11'
    } else if (entry.startsWith('Application ')) {
      applicationLevel = entry.substring('Application '.length); // '1'..'6'
    }
  }
  return { studentLevel, applicationLevel };
}

async function run() {
  const isDryRun = argv['dry-run'];
  console.log(`Backfilling grading manager/paid/level fields for project: ${projectId}`);
  if (isDryRun) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  const stats = {
    total: 0,
    updated: 0,
    managerIdsFilled: 0,
    paymentStatusFilled: 0,
    levelSnapshotFilled: 0,
  };

  const snap = await db.collection('gradings').get();
  stats.total = snap.size;
  console.log(`Found ${stats.total} gradings.`);

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    // Pass 1: gradingManagerIds <- assistantInstructorIds (copy when missing).
    if (data.gradingManagerIds === undefined) {
      update.gradingManagerIds = Array.isArray(data.assistantInstructorIds)
        ? data.assistantInstructorIds
        : [];
      stats.managerIdsFilled++;
    }

    // Pass 2: paymentStatus for pre-existing gradings — order-sourced gradings
    // (orderId set) are treated as paid by Squarespace; the rest as paid-other.
    if (data.paymentStatus === undefined) {
      const orderId = (data.orderId as string) || '';
      update.paymentStatus = orderId
        ? PaymentStatus.PaidBySquarespace
        : PaymentStatus.PaidOther;
      if (data.paymentNote === undefined) update.paymentNote = '';
      stats.paymentStatusFilled++;
    }

    // Pass 3: level snapshot for accepted-or-beyond gradings, when empty.
    // Gate on the *source* (a previous level exists) rather than only on the
    // snapshot being empty: gradings for the first progression entry ('Student
    // Entry') legitimately derive an empty snapshot, so a plain !hasSnapshot
    // check would re-write them every run. Skipping when `held` is empty keeps
    // the script idempotent (those gradings keep the default '' snapshot).
    const status = (data.status as string) || '';
    const level = (data.level as string) || '';
    const hasSnapshot =
      !!(data.studentLevelAtAcceptance as string) ||
      !!(data.applicationLevelAtAcceptance as string);
    const held = level ? previousGradingLevel(level) : '';
    if (ACCEPTED_STATUSES.has(status) && held && !hasSnapshot) {
      const { studentLevel, applicationLevel } = deriveLevels(held);
      update.studentLevelAtAcceptance = studentLevel;
      update.applicationLevelAtAcceptance = applicationLevel;
      stats.levelSnapshotFilled++;
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
  console.log(`Total gradings:               ${stats.total}`);
  console.log(`Updated:                      ${stats.updated}`);
  console.log(`gradingManagerIds filled:     ${stats.managerIdsFilled}`);
  console.log(`paymentStatus filled:         ${stats.paymentStatusFilled}`);
  console.log(`level snapshot filled:        ${stats.levelSnapshotFilled}`);
  if (isDryRun) console.log('(dry run — nothing was saved)');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
