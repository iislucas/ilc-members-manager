import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Member, School, firestoreDocToOrder } from '../../src/data-model';

/**
 * Script to review orders and correct the membership, instructor license, and school license
 * expiration dates.
 * 
 * The expiration date for annual licenses will be set to exactly 1 year after the last purchase date.
 * 
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/credentials.json \
 *   pnpm exec ts-node functions/scripts/data-migrations/correct-expiration-dates.ts --project <PROJECT_ID> [--dry-run]
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
    default: true,
  })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Error: Project ID is required. Use --project or GCLOUD_PROJECT env var.',
  );
  process.exit(1);
}

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId });
}
const db = admin.firestore();

function addOneYear(dateStr: string): string {
  // Parses a YYYY-MM-DD or ISO string, adds exactly 1 year, returns YYYY-MM-DD
  const dateStrClean = dateStr.includes('T') ? dateStr.substring(0, 10) : dateStr;
  const date = new Date(dateStrClean);
  // Using setFullYear ensures leap years and overflows are handled correctly.
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().substring(0, 10);
}

// Ensure safe valid date extraction
function extractDate(dateValue: any): string | null {
  if (!dateValue) return null;
  // Handle Firestore Timestamps if they somehow appear
  if (typeof dateValue.toDate === 'function') {
    return dateValue.toDate().toISOString().substring(0, 10);
  }
  // Extract just the part before 'T' if it's an ISO string
  if (typeof dateValue === 'string') {
    return dateValue.includes('T') ? dateValue.substring(0, 10) : dateValue;
  }
  return null;
}

async function run() {
  console.log(`Checking expiration dates for project: ${projectId}`);
  if (argv['dry-run']) {
    console.log('--- DRY RUN MODE: No changes will be saved ---');
  }

  // Maps to store the latest purchase date for each license type per identifier.
  // The identifier can be email, externalId, memberId, schoolId, etc.
  const latestMembershipPurchase = new Map<string, string>();
  const latestInstructorLicensePurchase = new Map<string, string>();
  const latestSchoolLicensePurchase = new Map<string, string>();

  // Helper to add date to maps
  const updateLatest = (map: Map<string, string>, key: string, date: string) => {
    if (!key) return;
    const keyLower = key.toLowerCase().trim();
    const existing = map.get(keyLower);
    if (!existing || date > existing) {
      map.set(keyLower, date);
    }
  };

  console.log('Fetching orders...');
  const ordersSnap = await db.collection('orders').get();
  console.log(`Processing ${ordersSnap.size} orders...`);

  let count = 0;
  for (const doc of ordersSnap.docs) {
    // Convert to strictly typed domain model right away
    const order = firestoreDocToOrder(doc as any);

    // Parse Date
    let rawDate: string | null = null;
    if (order.ilcAppOrderKind === 'ilc-2005-sheets-db-import') {
      rawDate = order.datePaid;
    } else {
      rawDate = order.createdOn;
    }
    const orderDate = extractDate(rawDate);
    if (!orderDate) continue;

    const email = order.ilcAppOrderKind === 'ilc-2005-sheets-db-import'
      ? order.email
      : order.customerEmail;

    // MemberID extraction
    let memberId = '';
    if (order.ilcAppOrderKind === 'ilc-2005-sheets-db-import') {
      memberId = order.externalId;
    }

    if (order.ilcAppOrderKind === 'ilc-2005-sheets-db-import') {
      const paidFor = (order.paidFor || '').toLowerCase();
      const orderType = (order.orderType || '').toLowerCase();
      const purchaseDescr = paidFor + ' ' + orderType;

      const keys = [email, memberId].filter(k => !!k);
      for (const key of keys) {
        if (purchaseDescr.includes('membership')) {
          updateLatest(latestMembershipPurchase, key, orderDate);
        } else if (purchaseDescr.includes('instructor license') || purchaseDescr.includes('instructor')) {
          updateLatest(latestInstructorLicensePurchase, key, orderDate);
        } else if (purchaseDescr.includes('school license') || purchaseDescr.includes('school')) {
          updateLatest(latestSchoolLicensePurchase, key, orderDate);
        }
      }
    } else {
      // Squarespace order processing
      const lineItems = order.lineItems || [];
      for (const item of lineItems) {
        const prodName = (item.productName || item.sku || '').toLowerCase();

        // Also sometimes customer supplies a Member ID in customizations
        let customMemberId = '';
        if (item.customizations) {
          for (const c of item.customizations) {
            if ((c.label || '').toLowerCase().includes('member id')) {
              customMemberId = c.value || '';
            }
          }
        }

        const keys = [email, customMemberId].filter(k => !!k);
        for (const key of keys) {
          if (prodName.includes('membership')) {
            updateLatest(latestMembershipPurchase, key, orderDate);
          } else if (prodName.includes('instructor license') || prodName.includes('instructor')) {
            updateLatest(latestInstructorLicensePurchase, key, orderDate);
          } else if (prodName.includes('school license') || prodName.includes('school')) {
            updateLatest(latestSchoolLicensePurchase, key, orderDate);
          }
        }
      }
    }

    count++;
    if (count % 1000 === 0) {
      console.log(`  Processed ${count} orders...`);
    }
  }

  console.log(`Unique identifiers with membership orders: ${latestMembershipPurchase.size}`);
  console.log(`Unique identifiers with instructor license orders: ${latestInstructorLicensePurchase.size}`);
  console.log(`Unique identifiers with school license orders: ${latestSchoolLicensePurchase.size}`);

  // Fetch all members
  console.log('Fetching members to update...');
  const membersSnap = await db.collection('members').get();
  console.log(`Found ${membersSnap.size} members.`);

  let updatedMembers = 0;
  const batch = db.batch();
  let batchCount = 0;

  async function commitBatchIfNeeded(force = false) {
    if (batchCount > 0 && (batchCount >= 500 || force)) {
      if (!argv['dry-run']) {
        await batch.commit();
      }
      batchCount = 0;
    }
  }

  for (const doc of membersSnap.docs) {
    const member = doc.data() as Member;
    let needsUpdate = false;
    let updates: Partial<Member> = {};

    // Keys to check: all emails and memberId
    const identityKeys = [...(member.emails || []), member.publicEmail, member.memberId]
      .filter(k => !!k)
      .map(k => k.toLowerCase().trim());

    // 1. Check Memberships
    if (member.membershipType === 'Annual') {
      let latestMemDate = '';
      for (const key of identityKeys) {
        const d = latestMembershipPurchase.get(key);
        if (d && d > latestMemDate) latestMemDate = d;
      }
      if (latestMemDate) {
        const newExpiry = addOneYear(latestMemDate);
        if (member.currentMembershipExpires !== newExpiry) {
          console.log(`  [Member Exp] ${member.name} (${member.docId || doc.id}): ${member.currentMembershipExpires} -> ${newExpiry}`);
          updates.currentMembershipExpires = newExpiry;
          needsUpdate = true;
        }
      }
    }

    // 2. Check Instructor Licenses
    if (member.instructorId && member.instructorLicenseType === 'Annual') {
      let latestInstDate = '';
      for (const key of identityKeys) {
        const d = latestInstructorLicensePurchase.get(key);
        if (d && d > latestInstDate) latestInstDate = d;
      }
      if (latestInstDate) {
        const newExpiry = addOneYear(latestInstDate);
        if (member.instructorLicenseExpires !== newExpiry) {
          console.log(`  [Instructor Exp] ${member.name} (${member.docId || doc.id}): ${member.instructorLicenseExpires} -> ${newExpiry}`);
          updates.instructorLicenseExpires = newExpiry;
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      if (!argv['dry-run']) {
        updates.lastUpdated = admin.firestore.FieldValue.serverTimestamp() as any;
        batch.update(doc.ref, updates);
        batchCount++;
      }
      updatedMembers++;
      await commitBatchIfNeeded();
    }
  }

  await commitBatchIfNeeded(true); // Commit remaining member updates
  console.log(`Updated expiration dates for ${updatedMembers} members.`);

  // Fetch all schools
  console.log('Fetching schools to update...');
  const schoolsSnap = await db.collection('schools').get();
  console.log(`Found ${schoolsSnap.size} schools.`);

  let updatedSchools = 0;

  for (const doc of schoolsSnap.docs) {
    const school = doc.data() as School;
    let needsUpdate = false;
    let updates: Partial<School> = {};

    // For schools, we use emails (owner, manager), schoolId
    const identityKeys = [school.schoolId, school.ownerEmail, ...(school.managerEmails || [])]
      .filter(k => !!k)
      .map(k => k.toLowerCase().trim());

    // 3. Check School Licenses
    let latestSchoolDate = '';
    for (const key of identityKeys) {
      const d = latestSchoolLicensePurchase.get(key);
      if (d && d > latestSchoolDate) latestSchoolDate = d;
    }
    if (latestSchoolDate) {
      const newExpiry = addOneYear(latestSchoolDate);
      if (school.schoolLicenseExpires !== newExpiry) {
        console.log(`  [School Exp] ${school.schoolName} (${school.docId || doc.id}): ${school.schoolLicenseExpires} -> ${newExpiry}`);
        updates.schoolLicenseExpires = newExpiry;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      if (!argv['dry-run']) {
        updates.lastUpdated = admin.firestore.FieldValue.serverTimestamp() as any;
        batch.update(doc.ref, updates);
        batchCount++;
      }
      updatedSchools++;
      await commitBatchIfNeeded();
    }
  }

  await commitBatchIfNeeded(true); // Commit remaining school updates
  console.log(`Updated expiration dates for ${updatedSchools} schools.`);

  console.log('\nDone!');
  if (argv['dry-run']) {
    console.log('\n(Dry run — no changes were made)');
  }
}

run().catch(console.error);
