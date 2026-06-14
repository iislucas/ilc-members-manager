/* backfill-event-schools.ts
 *
 * One-off backfill: populate `schoolId` / `schoolDocId` on existing events that
 * predate the event<->school association feature. For each event that has no
 * schoolId yet but does have a `leadingInstructorId`, we look up that
 * instructor's member record and copy their `primarySchoolId` /
 * `primarySchoolDocId` onto the event.
 *
 * Events that already have a schoolId, or whose leading instructor has no
 * primary school (HQ), are left unchanged.
 *
 * Usage (uses Application Default Credentials, like the other admin scripts):
 *   # dry run — report what would change, write nothing:
 *   pnpm backfill:event-schools
 *   # apply the changes:
 *   pnpm backfill:event-schools --commit
 *   # target a different project (defaults to ilc-paris-class-tracker):
 *   pnpm backfill:event-schools --project=<project-id>
 */

import * as admin from 'firebase-admin';
import { IlcEvent, Member } from '../functions/src/data-model';

const COMMIT = process.argv.includes('--commit');

// Target Firestore project. Override with --project=<id>; defaults to the
// live project.
const DEFAULT_PROJECT = 'ilc-paris-class-tracker';
const projectArg = process.argv.find((a) => a.startsWith('--project='));
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : DEFAULT_PROJECT;

async function main() {
  console.log(`Using project: ${PROJECT_ID}`);
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  // Build a map: instructorId (human-readable) -> { primarySchoolId, primarySchoolDocId }.
  // Members with an instructorId are the instructors that can lead events.
  const membersSnap = await db.collection('members').where('instructorId', '!=', '').get();
  const instructorSchools = new Map<string, { schoolId: string; schoolDocId: string }>();
  for (const doc of membersSnap.docs) {
    const m = doc.data() as Member;
    const instructorId = m.instructorId || '';
    if (!instructorId) continue;
    instructorSchools.set(instructorId, {
      schoolId: m.primarySchoolId || '',
      schoolDocId: m.primarySchoolDocId || '',
    });
  }
  console.log(`Loaded ${instructorSchools.size} instructors with member records.`);

  const eventsSnap = await db.collection('events').get();
  console.log(`Scanning ${eventsSnap.size} events...`);

  let updated = 0;
  let skippedHasSchool = 0;
  let skippedNoInstructor = 0;
  let skippedNoSchool = 0;
  const batch = db.batch();
  let batchCount = 0;

  for (const doc of eventsSnap.docs) {
    const ev = doc.data() as IlcEvent;
    if (ev.schoolId) {
      skippedHasSchool++;
      continue;
    }
    const leadingInstructorId = ev.leadingInstructorId || '';
    if (!leadingInstructorId) {
      skippedNoInstructor++;
      continue;
    }
    const school = instructorSchools.get(leadingInstructorId);
    if (!school || !school.schoolId) {
      skippedNoSchool++;
      continue;
    }

    console.log(
      `  ${doc.id} "${ev.title}" (instructor ${leadingInstructorId}) -> ${school.schoolId}`,
    );
    updated++;
    if (COMMIT) {
      batch.update(doc.ref, {
        schoolId: school.schoolId,
        schoolDocId: school.schoolDocId,
      });
      batchCount++;
      // Firestore batches are limited to 500 writes.
      if (batchCount === 450) {
        await batch.commit();
        batchCount = 0;
      }
    }
  }

  if (COMMIT && batchCount > 0) {
    await batch.commit();
  }

  console.log('\nSummary:');
  console.log(`  ${updated} events ${COMMIT ? 'updated' : 'would be updated'}`);
  console.log(`  ${skippedHasSchool} skipped (already have a schoolId)`);
  console.log(`  ${skippedNoInstructor} skipped (no leading instructor)`);
  console.log(`  ${skippedNoSchool} skipped (instructor has no primary school)`);
  if (!COMMIT) {
    console.log('\nDry run — no changes written. Re-run with --commit to apply.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
