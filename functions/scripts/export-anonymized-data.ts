/*
 * Export Anonymized Data Script
 *
 * Downloads all key collections from the production Firestore database,
 * strips PII (names, emails, phone numbers, addresses), and writes the
 * anonymized data as JSON files to <repo-root>/tmp/seed-data/.
 *
 * The output can then be imported into the local Firebase emulator with
 * the companion script `seed-emulator.ts`.
 *
 * Requires Application Default Credentials (ADC) pointing to the production
 * project. Run `gcloud auth application-default login` if needed.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/export-anonymized-data.ts --project ilc-paris-class-tracker
 */
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// CLI args
// ============================================================
const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project');
const projectId =
  projectIndex !== -1 && args.length > projectIndex + 1
    ? args[projectIndex + 1]
    : process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

if (!projectId) {
  console.error('Error: no project ID. Pass --project <id> or set GCLOUD_PROJECT.');
  process.exit(1);
}

// ============================================================
// Output directory
// ============================================================
const outputDir = path.resolve(__dirname, '../../tmp/seed-data');
// Subcollection JSON files live in their own folder to keep the top-level
// directory (one file per top-level collection) easy to scan. Files keep the
// `{parent}__{parentId}__{subcollection}.json` naming; seed-emulator.ts reads
// them back from here.
const subcollectionsDir = path.join(outputDir, 'subcollections');
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(subcollectionsDir, { recursive: true });

// ============================================================
// Firebase Admin init
// ============================================================
admin.initializeApp({ projectId });
const db = admin.firestore();

// ============================================================
// Anonymisation helpers
// ============================================================

type RawDoc = Record<string, unknown>;

// Email addresses must be lowercase — checkEmailStatus normalises with .toLowerCase()
function memberEmail(memberId: string): string {
  return `member-${memberId.toLowerCase()}@example.com`;
}

function anonymiseMember(doc: RawDoc, memberId: string): RawDoc {
  return {
    ...doc,
    name: `Test Member ${memberId}`,
    emails: [memberEmail(memberId)],
    phone: doc['phone'] ? '555-0000' : '',
    address: doc['address'] ? '123 Test St' : '',
    city: doc['city'] ? 'Test City' : '',
    zipCode: doc['zipCode'] ? '00000' : '',
    countyOrState: doc['countyOrState'] ? 'Test State' : '',
    // publicEmail / publicPhone appear on member AND instructor records
    publicEmail: doc['publicEmail'] ? memberEmail(memberId) : '',
    publicPhone: doc['publicPhone'] ? '555-0000' : '',
    // Clear admin-only free-text notes
    notes: '',
  };
}

function anonymiseInstructor(doc: RawDoc, instructorId: string): RawDoc {
  return {
    ...doc,
    name: `Instructor ${instructorId}`,
    publicEmail: doc['publicEmail'] ? `instructor-${instructorId}@example.com` : '',
    publicPhone: doc['publicPhone'] ? '555-0000' : '',
  };
}

function anonymiseSchool(doc: RawDoc, schoolId: string): RawDoc {
  return {
    ...doc,
    schoolName: `Test School ${schoolId}`,
    // Contact fields
    contactEmail: doc['contactEmail'] ? `school-${schoolId}@example.com` : '',
    contactPhone: doc['contactPhone'] ? '555-0000' : '',
    address: doc['address'] ? '123 Test St' : '',
    city: doc['city'] ? 'Test City' : '',
    zipCode: doc['zipCode'] ? '00000' : '',
  };
}

function anonymiseSheetsOrder(doc: RawDoc): RawDoc {
  const externalId = (doc['externalId'] as string) || '';
  return {
    ...doc,
    firstName: 'Test',
    lastName: `Member${externalId}`,
    email: externalId ? `member-${externalId}@example.com` : 'unknown@example.com',
  };
}

function anonymiseSquarespaceOrder(doc: RawDoc): RawDoc {
  const email = (doc['customerEmail'] as string) || '';
  const anonEmail = email ? `order-${Buffer.from(email).toString('base64').substring(0, 8)}@example.com` : 'unknown@example.com';
  // Anonymise billing address if present
  let billingAddress = doc['billingAddress'];
  if (billingAddress && typeof billingAddress === 'object') {
    billingAddress = {
      ...(billingAddress as Record<string, unknown>),
      firstName: 'Test',
      lastName: 'Customer',
      address1: '123 Test St',
      address2: '',
      city: 'Test City',
      postalCode: '00000',
      phone: '',
    };
  }
  return { ...doc, customerEmail: anonEmail, billingAddress };
}

// ============================================================
// Collection fetchers
// ============================================================

async function fetchCollection(name: string): Promise<Array<{ id: string } & RawDoc>> {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function fetchSubcollection(
  parent: string,
  parentId: string,
  sub: string,
): Promise<Array<{ id: string } & RawDoc>> {
  const snap = await db.collection(parent).doc(parentId).collection(sub).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function save(filename: string, data: unknown): void {
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  Saved ${filePath} (${(Array.isArray(data) ? data.length : 1)} docs)`);
}

// Save a subcollection file into the subcollections/ sub-folder.
function saveSub(filename: string, data: unknown): void {
  const filePath = path.join(subcollectionsDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  Saved ${filePath} (${(Array.isArray(data) ? data.length : 1)} docs)`);
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log(`Exporting anonymized data from project: ${projectId}`);

  // --- Members ---
  console.log('\nFetching members...');
  const rawMembers = await fetchCollection('members');
  const members = rawMembers.map((m) => anonymiseMember(m, (m['memberId'] as string) || m.id));
  save('members.json', members);

  // Build docId -> memberId map for ACL remapping
  const docIdToMemberId = new Map<string, string>();
  for (const m of rawMembers) {
    const memberId = (m['memberId'] as string) || '';
    if (memberId) docIdToMemberId.set(m.id, memberId);
  }

  // --- Schools ---
  console.log('\nFetching schools...');
  const rawSchools = await fetchCollection('schools');
  const schools = rawSchools.map((s) => anonymiseSchool(s, (s['schoolId'] as string) || s.id));
  save('schools.json', schools);

  // School subcollections
  for (const s of rawSchools) {
    const schoolId = (s['schoolId'] as string) || s.id;
    for (const sub of ['members', 'gradings'] as const) {
      const subDocs = await fetchSubcollection('schools', s.id, sub);
      if (subDocs.length > 0) {
        const anonymised =
          sub === 'members'
            ? subDocs.map((m) => anonymiseMember(m, (m['memberId'] as string) || m.id))
            : subDocs;
        saveSub(`schools__${s.id}__${sub}.json`, anonymised);
        console.log(`    schools/${schoolId}/${sub}: ${subDocs.length} docs`);
      }
    }
  }

  // --- Instructors ---
  console.log('\nFetching instructors...');
  const rawInstructors = await fetchCollection('instructors');
  const instructors = rawInstructors.map((i) =>
    anonymiseInstructor(i, (i['instructorId'] as string) || i.id),
  );
  save('instructors.json', instructors);

  // Instructor subcollections
  for (const inst of rawInstructors) {
    const instructorId = (inst['instructorId'] as string) || inst.id;
    for (const sub of ['members', 'gradings'] as const) {
      const subDocs = await fetchSubcollection('instructors', inst.id, sub);
      if (subDocs.length > 0) {
        const anonymised =
          sub === 'members'
            ? subDocs.map((m) => anonymiseMember(m, (m['memberId'] as string) || m.id))
            : subDocs;
        saveSub(`instructors__${inst.id}__${sub}.json`, anonymised);
        console.log(`    instructors/${instructorId}/${sub}: ${subDocs.length} docs`);
      }
    }
  }

  // --- Gradings ---
  console.log('\nFetching gradings...');
  const gradings = await fetchCollection('gradings');
  save('gradings.json', gradings);

  // --- Events ---
  console.log('\nFetching events...');
  const events = await fetchCollection('events');
  save('events.json', events);

  // --- Orders ---
  console.log('\nFetching orders...');
  const rawOrders = await fetchCollection('orders');
  const orders = rawOrders.map((o) => {
    if (o['ilcAppOrderKind'] === 'ilc-2005-sheets-db-import') {
      return anonymiseSheetsOrder(o);
    }
    return anonymiseSquarespaceOrder(o);
  });
  save('orders.json', orders);

  // --- System ---
  console.log('\nFetching system...');
  const system = await fetchCollection('system');
  save('system.json', system);

  // --- ACL ---
  // ACL doc keys are real email addresses, so we remap them to anonymised
  // addresses derived from the linked memberDocIds.
  console.log('\nFetching and anonymising ACL...');
  const rawAcl = await fetchCollection('acl');
  const anonAcl = rawAcl.map((entry) => {
    const memberDocIds = (entry['memberDocIds'] as string[]) || [];
    // Derive the canonical memberId from the first linked member
    const firstMemberId = memberDocIds.length > 0
      ? (docIdToMemberId.get(memberDocIds[0]) ?? memberDocIds[0])
      : null;
    const anonEmail = firstMemberId
      ? memberEmail(firstMemberId)
      : `acl-${entry.id.replace(/[^a-z0-9]/gi, '-').toLowerCase()}@example.com`;
    return { ...entry, id: anonEmail };
  });
  save('acl.json', anonAcl);

  console.log('\nDone. Output written to:', outputDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
