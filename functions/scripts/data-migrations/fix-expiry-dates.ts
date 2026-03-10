/*
Fix Expiry Dates

Some members and schools have expiry dates set much later than one year after
their last renewal date. This script detects those cases and moves the expiry
back to exactly one year after the last renewal date.

Affected fields:
  - Members: currentMembershipExpires (based on lastRenewalDate)
  - Members: instructorLicenseExpires (based on instructorLicenseRenewalDate)
  - Schools: schoolLicenseExpires (based on schoolLicenseRenewalDate)

Usage:

  NOTE: GOOGLE_APPLICATION_CREDENTIALS should be set in your environment if not
  using default credentials.

  # Preview changes:
  pnpm exec ts-node functions/scripts/data-migrations/fix-expiry-dates.ts \
    --project ilc-paris-class-tracker --dry-run

  # Apply changes:
  pnpm exec ts-node functions/scripts/data-migrations/fix-expiry-dates.ts \
    --project ilc-paris-class-tracker
*/

import * as firebase from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function parseToDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return d;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

// ---------------------------------------------------------------------------
// Core logic: check one (renewal, expiry) pair
// ---------------------------------------------------------------------------

interface ExpiryFix {
  label: string;
  id: string;
  renewalDate: string;
  oldExpiry: string;
  newExpiry: string;
}

/**
 * If `expiryStr` is more than one year after `renewalStr`, return the corrected
 * expiry (exactly one year after the renewal). Otherwise return null.
 */
function checkExpiry(
  renewalStr: string | undefined,
  expiryStr: string | undefined,
): string | null {
  if (!renewalStr || !expiryStr) return null;

  const renewal = parseToDate(renewalStr);
  const expiry = parseToDate(expiryStr);
  if (!renewal || !expiry) return null;

  const oneYearAfterRenewal = addYears(renewal, 1);
  if (expiry.getTime() > oneYearAfterRenewal.getTime()) {
    return formatDate(oneYearAfterRenewal);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('project', {
      type: 'string',
      description: 'Firebase Project ID',
      demandOption: false,
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Preview changes without executing them',
      default: false,
    })
    .help()
    .parseSync();

  const projectId = argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const dryRun = argv['dry-run'];

  console.log(`Project ID: ${projectId}`);
  console.log(`Dry Run:    ${dryRun}`);
  console.log();

  const app = firebase.initializeApp({ projectId });
  const db = firebase.firestore();

  try {
    // ------------------------------------------------------------------
    // Members
    // ------------------------------------------------------------------
    console.log('Fetching members...');
    const membersSnap = await db.collection('members').get();
    const memberFixes: ExpiryFix[] = [];
    const memberUpdates = new Map<string, Record<string, any>>();

    for (const doc of membersSnap.docs) {
      const m = doc.data() as any;
      const memberId = m.memberId || doc.id;

      // 1. Membership expiry
      const fixedMembership = checkExpiry(m.lastRenewalDate, m.currentMembershipExpires);
      if (fixedMembership) {
        memberFixes.push({
          label: 'Membership',
          id: memberId,
          renewalDate: m.lastRenewalDate,
          oldExpiry: m.currentMembershipExpires,
          newExpiry: fixedMembership,
        });
        const update = memberUpdates.get(doc.id) || {};
        update.currentMembershipExpires = fixedMembership;
        memberUpdates.set(doc.id, update);
      }

      // 2. Instructor license expiry
      const fixedInstructor = checkExpiry(m.instructorLicenseRenewalDate, m.instructorLicenseExpires);
      if (fixedInstructor) {
        memberFixes.push({
          label: 'Instructor License',
          id: memberId,
          renewalDate: m.instructorLicenseRenewalDate,
          oldExpiry: m.instructorLicenseExpires,
          newExpiry: fixedInstructor,
        });
        const update = memberUpdates.get(doc.id) || {};
        update.instructorLicenseExpires = fixedInstructor;
        memberUpdates.set(doc.id, update);
      }
    }

    // ------------------------------------------------------------------
    // Schools
    // ------------------------------------------------------------------
    console.log('Fetching schools...');
    const schoolsSnap = await db.collection('schools').get();
    const schoolFixes: ExpiryFix[] = [];
    const schoolUpdates = new Map<string, Record<string, any>>();

    for (const doc of schoolsSnap.docs) {
      const s = doc.data() as any;
      const schoolId = s.schoolId || doc.id;

      const fixedSchool = checkExpiry(s.schoolLicenseRenewalDate, s.schoolLicenseExpires);
      if (fixedSchool) {
        schoolFixes.push({
          label: 'School License',
          id: schoolId,
          renewalDate: s.schoolLicenseRenewalDate,
          oldExpiry: s.schoolLicenseExpires,
          newExpiry: fixedSchool,
        });
        schoolUpdates.set(doc.id, { schoolLicenseExpires: fixedSchool });
      }
    }

    // ------------------------------------------------------------------
    // Report
    // ------------------------------------------------------------------
    const allFixes = [...memberFixes, ...schoolFixes]
      .sort((a, b) => a.newExpiry.localeCompare(b.newExpiry));

    if (allFixes.length === 0) {
      console.log('\nNo expiry dates need fixing. All are within one year of their last renewal.');
    } else {
      console.log(`\nFound ${allFixes.length} expiry date(s) to fix:\n`);
      for (const fix of allFixes) {
        console.log(
          `  [${fix.label}] ${fix.id}: ` +
          `renewal=${fix.renewalDate}, ` +
          `expiry ${fix.oldExpiry} -> ${fix.newExpiry}`
        );
      }
      console.log();
      console.log(`  Members to update:  ${memberUpdates.size}`);
      console.log(`  Schools to update:  ${schoolUpdates.size}`);
    }

    // ------------------------------------------------------------------
    // Apply (unless dry-run)
    // ------------------------------------------------------------------
    if (dryRun) {
      console.log('\n[DRY RUN] No changes were made to the database.');
    } else if (allFixes.length > 0) {
      let batchedWrites = 0;
      let batch = db.batch();

      for (const [docId, update] of memberUpdates.entries()) {
        batch.update(db.collection('members').doc(docId), {
          ...update,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        });
        batchedWrites++;
        if (batchedWrites >= 450) {
          await batch.commit();
          batch = db.batch();
          batchedWrites = 0;
        }
      }

      for (const [docId, update] of schoolUpdates.entries()) {
        batch.update(db.collection('schools').doc(docId), {
          ...update,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        });
        batchedWrites++;
        if (batchedWrites >= 450) {
          await batch.commit();
          batch = db.batch();
          batchedWrites = 0;
        }
      }

      if (batchedWrites > 0) {
        await batch.commit();
      }

      console.log('\nSuccessfully applied expiry date fixes.');
    }
  } catch (error) {
    console.error('Error fixing expiry dates:', error);
  } finally {
    await app.delete();
  }
}

main();
