/*
 * Backfill ACL Expiry Dates Script
 *
 * Iterates all ACL documents and recomputes the expiry date fields
 * (membershipExpires, instructorLicenseExpires, schoolLicenseExpires)
 * based on the current member and school data. This is a one-time
 * migration script for populating these fields on existing ACL docs.
 *
 * The script reuses refreshACLAdminStatus() from on-member-update.ts
 * which already computes all three fields.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/backfill-acl-expiry.ts [--project <PROJECT_ID>] [--dry-run]
 *
 * Examples:
 *   pnpm exec ts-node scripts/backfill-acl-expiry.ts --dry-run                            # preview (default credentials)
 *   pnpm exec ts-node scripts/backfill-acl-expiry.ts --project ilc-paris-class-tracker     # apply to prod
 */
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ACL, Member } from '../src/data-model';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'Preview changes without writing to Firestore',
  })
  .parseSync();

const projectId =
  argv.project ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

// ── Expiry helpers (copied from on-member-update.ts to avoid import issues) ──

function getMembershipExpiry(data: FirebaseFirestore.DocumentData): string {
  const type = data.membershipType;
  if (type === 'Life') return 'life';
  if (type === 'Annual') return data.currentMembershipExpires || '';
  return '';
}

function getInstructorLicenseExpiry(data: FirebaseFirestore.DocumentData): string {
  if (!data.instructorId) return '';
  const type = data.instructorLicenseType;
  if (type === 'Life') return 'life';
  if (type === 'Annual') return data.instructorLicenseExpires || '';
  return '';
}

function bestExpiry(values: string[]): string {
  let best = '';
  for (const v of values) {
    if (v === 'life') return 'life';
    if (v && v > best) best = v;
  }
  return best;
}
// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = argv['dry-run'];

  console.log(`\n🔑 Backfill ACL expiry dates for project: ${projectId}`);
  if (isDryRun) {
    console.log('🔍 DRY RUN — no changes will be written\n');
  } else {
    console.log('🔧 LIVE MODE — changes will be written to Firestore\n');
  }

  // 1. Pre-load all collections into memory.
  console.log('⏳ Loading all collections...');

  const [aclSnap, membersSnap, schoolsSnap] = await Promise.all([
    db.collection('acl').get(),
    db.collection('members').get(),
    db.collection('schools').get(),
  ]);

  console.log(`  📋 ACL docs:    ${aclSnap.size}`);
  console.log(`  👤 Members:     ${membersSnap.size}`);
  console.log(`  🏫 Schools:     ${schoolsSnap.size}`);

  // 2. Build in-memory lookup maps.

  // Members by docId.
  const membersById = new Map<string, FirebaseFirestore.DocumentData>();
  for (const doc of membersSnap.docs) {
    membersById.set(doc.id, doc.data());
  }

  // Schools indexed by ownerInstructorId and managerInstructorIds.
  // Each map entry is instructorId → list of school license expiry strings.
  const schoolsByOwner = new Map<string, string[]>();
  const schoolsByManager = new Map<string, string[]>();

  for (const doc of schoolsSnap.docs) {
    const school = doc.data();
    const expiry = school.schoolLicenseExpires || 'life';

    if (school.ownerInstructorId) {
      const list = schoolsByOwner.get(school.ownerInstructorId) || [];
      list.push(expiry);
      schoolsByOwner.set(school.ownerInstructorId, list);
    }

    const managerIds: string[] = school.managerInstructorIds || [];
    for (const mgr of managerIds) {
      if (mgr) {
        const list = schoolsByManager.get(mgr) || [];
        list.push(expiry);
        schoolsByManager.set(mgr, list);
      }
    }
  }

  console.log(`  🔗 School owner entries:   ${schoolsByOwner.size}`);
  console.log(`  🔗 School manager entries: ${schoolsByManager.size}`);
  console.log('');

  // Helper: get best school license expiry from in-memory maps.
  function getSchoolLicenseExpiry(instructorIds: string[]): string {
    const expiries: string[] = [];
    for (const id of instructorIds) {
      if (!id) continue;
      const ownerExpiries = schoolsByOwner.get(id);
      if (ownerExpiries) expiries.push(...ownerExpiries);
      const mgrExpiries = schoolsByManager.get(id);
      if (mgrExpiries) expiries.push(...mgrExpiries);
    }
    return bestExpiry(expiries);
  }

  // 3. Process each ACL document.
  let updatedCount = 0;
  let skippedCount = 0;
  let alreadyCorrectCount = 0;
  let errorCount = 0;

  const BATCH_SIZE = 100;
  let batch = db.batch();
  let batchCount = 0;

  async function flushBatch() {
    if (batchCount === 0) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  }

  for (const aclDoc of aclSnap.docs) {
    const email = aclDoc.id;
    const aclData = aclDoc.data() as ACL;

    if (!aclData.memberDocIds || aclData.memberDocIds.length === 0) {
      skippedCount++;
      continue;
    }

    try {
      // Look up linked members from the in-memory map.
      const membershipExpiries: string[] = [];
      const instructorExpiries: string[] = [];
      const instructorIds: string[] = [];

      for (const docId of aclData.memberDocIds) {
        const d = membersById.get(docId);
        if (!d) continue;
        membershipExpiries.push(getMembershipExpiry(d));
        instructorExpiries.push(getInstructorLicenseExpiry(d));
        if (d.instructorId) {
          instructorIds.push(d.instructorId);
        }
      }

      const newMembershipExpires = bestExpiry(membershipExpiries);
      const newInstructorLicenseExpires = bestExpiry(instructorExpiries);
      const newSchoolLicenseExpires = getSchoolLicenseExpiry(instructorIds);

      // Check if anything actually changed.
      const oldMembership = aclData.membershipExpires || '';
      const oldInstructor = aclData.instructorLicenseExpires || '';
      const oldSchool = aclData.schoolLicenseExpires || '';

      if (
        oldMembership === newMembershipExpires &&
        oldInstructor === newInstructorLicenseExpires &&
        oldSchool === newSchoolLicenseExpires
      ) {
        alreadyCorrectCount++;
        continue;
      }

      // Log the change.
      const changes: string[] = [];
      if (oldMembership !== newMembershipExpires) {
        changes.push(`membership: "${oldMembership}" → "${newMembershipExpires}"`);
      }
      if (oldInstructor !== newInstructorLicenseExpires) {
        changes.push(`instructor: "${oldInstructor}" → "${newInstructorLicenseExpires}"`);
      }
      if (oldSchool !== newSchoolLicenseExpires) {
        changes.push(`school: "${oldSchool}" → "${newSchoolLicenseExpires}"`);
      }
      console.log(`  📝 ${email}: ${changes.join(', ')}`);

      // Queue the update in the current batch.
      if (!isDryRun) {
        batch.update(db.collection('acl').doc(email), {
          membershipExpires: newMembershipExpires,
          instructorLicenseExpires: newInstructorLicenseExpires,
          schoolLicenseExpires: newSchoolLicenseExpires,
        });
        batchCount++;
        if (batchCount >= BATCH_SIZE) {
          await flushBatch();
        }
      }

      updatedCount++;
    } catch (err) {
      errorCount++;
      console.error(`  ❌ Error processing ${email}:`, err);
    }
  }

  // Flush any remaining updates.
  if (!isDryRun) {
    await flushBatch();
  }

  // 4. Summary.
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Summary${isDryRun ? ' (DRY RUN)' : ''}:`);
  console.log(`  Total ACL docs:     ${aclSnap.size}`);
  console.log(`  Already correct:    ${alreadyCorrectCount}`);
  console.log(`  Updated:            ${updatedCount}`);
  console.log(`  Skipped (no links): ${skippedCount}`);
  console.log(`  Errors:             ${errorCount}`);
  console.log('='.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
