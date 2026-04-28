import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/*
Downloads the minimal Firestore data needed to reproduce the member-edit
permission scenario for two specific users:
  - brett.drinkwater@iliqchuan.com  (reported unable to edit own profile)
  - moilucasdixon@gmail.com          (able to edit own profile)

For each login email we fetch:
  /acl/{email}
  /members/{memberDocId}   (for every memberDocId in the ACL)
  /schools/{schoolDocId}   (the primarySchoolDocId from the member, if any)

The data is written as a JSON fixture to
  tests/fixtures/user-edit-permissions.json

Usage:
  cd functions
  pnpm exec ts-node scripts/download-user-test-data.ts --project ilc-paris-class-tracker

The script is READ-ONLY – it never writes to Firestore.
*/

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    demandOption: false,
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

const TARGET_EMAILS = [
  'brett.drinkwater@iliqchuan.com',
  'moilucasdixon@gmail.com',
];

interface DownloadedUserData {
  email: string;
  acl: Record<string, unknown> | null;
  members: { docId: string; data: Record<string, unknown> }[];
  schools: { docId: string; data: Record<string, unknown> }[];
}

async function downloadUserData(email: string): Promise<DownloadedUserData> {
  console.log(`\n--- Fetching data for ${email} ---`);

  // 1. ACL
  const aclSnap = await db.collection('acl').doc(email).get();
  const acl = aclSnap.exists ? (aclSnap.data() as Record<string, unknown>) : null;
  console.log(`  ACL: ${acl ? JSON.stringify(acl) : 'NOT FOUND'}`);

  if (!acl) {
    return { email, acl, members: [], schools: [] };
  }

  const memberDocIds: string[] = (acl.memberDocIds as string[]) || [];
  console.log(`  memberDocIds: [${memberDocIds.join(', ')}]`);

  // 2. Members
  const members: { docId: string; data: Record<string, unknown> }[] = [];
  const schoolDocIdsToFetch = new Set<string>();

  for (const docId of memberDocIds) {
    const memberSnap = await db.collection('members').doc(docId).get();
    if (memberSnap.exists) {
      const data = memberSnap.data() as Record<string, unknown>;
      members.push({ docId, data });
      console.log(`  Member ${docId}: name="${data.name}", memberId="${data.memberId}", isAdmin=${data.isAdmin}`);
      console.log(`    emails: ${JSON.stringify(data.emails)}`);
      console.log(`    primarySchoolId: "${data.primarySchoolId}", primarySchoolDocId: "${data.primarySchoolDocId}"`);

      if (data.primarySchoolDocId && data.primarySchoolDocId !== '') {
        schoolDocIdsToFetch.add(data.primarySchoolDocId as string);
      }
    } else {
      console.log(`  Member ${docId}: NOT FOUND (dangling reference)`);
    }
  }

  // 3. Schools
  const schools: { docId: string; data: Record<string, unknown> }[] = [];
  for (const schoolDocId of schoolDocIdsToFetch) {
    const schoolSnap = await db.collection('schools').doc(schoolDocId).get();
    if (schoolSnap.exists) {
      const data = schoolSnap.data() as Record<string, unknown>;
      schools.push({ docId: schoolDocId, data });
      console.log(`  School ${schoolDocId}: name="${data.schoolName}", schoolId="${data.schoolId}"`);
      console.log(`    ownerEmail: "${data.ownerEmail}", managerEmails: ${JSON.stringify(data.managerEmails)}`);
    } else {
      console.log(`  School ${schoolDocId}: NOT FOUND (dangling reference)`);
    }
  }

  return { email, acl, members, schools };
}

// Converts Firestore Timestamps to ISO strings for JSON serialization.
function sanitizeTimestamps(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // Firestore Timestamp
  if (obj instanceof admin.firestore.Timestamp) {
    return obj.toDate().toISOString();
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeTimestamps);
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = sanitizeTimestamps(v);
  }
  return result;
}

async function run() {
  console.log(`Downloading test fixture data from project: ${projectId}`);

  const allData: DownloadedUserData[] = [];
  for (const email of TARGET_EMAILS) {
    const data = await downloadUserData(email);
    allData.push(data);
  }

  // Sanitize timestamps before JSON.stringify
  const sanitized = sanitizeTimestamps(allData);

  // Write fixture
  const fixtureDir = path.resolve(__dirname, '../../tests/fixtures');
  if (!fs.existsSync(fixtureDir)) {
    fs.mkdirSync(fixtureDir, { recursive: true });
  }
  const fixturePath = path.join(fixtureDir, 'user-edit-permissions.json');
  fs.writeFileSync(fixturePath, JSON.stringify(sanitized, null, 2), 'utf-8');

  console.log(`\n✅ Fixture written to: ${fixturePath}`);

  // Print analysis summary
  console.log('\n======================================');
  console.log('ANALYSIS OF THE FIRESTORE RULES ISSUE');
  console.log('======================================');

  for (const userData of allData) {
    console.log(`\n--- ${userData.email} ---`);
    if (!userData.acl) {
      console.log('  ❌ No ACL doc exists. This user would be unable to log in (no member profiles).');
      continue;
    }

    for (const member of userData.members) {
      const memberData = member.data;
      const emails = (memberData.emails as string[]) || [];
      const primarySchoolDocId = (memberData.primarySchoolDocId as string) || '';

      // Check if email is in member.emails (needed for isOwner() in firestore rules)
      const emailInMemberEmails = emails.map(e => e.toLowerCase()).includes(userData.email.toLowerCase());
      console.log(`  Member ${member.docId}:`);
      console.log(`    email in member.emails? ${emailInMemberEmails ? '✅ YES' : '❌ NO'}`);

      // Check if memberDocId is in ACL.memberDocIds (alternative path for isOwner())
      const memberDocIds = (userData.acl.memberDocIds as string[]) || [];
      const docIdInAcl = memberDocIds.includes(member.docId);
      console.log(`    docId in ACL.memberDocIds? ${docIdInAcl ? '✅ YES' : '❌ NO'}`);
      console.log(`    isOwner() would resolve: ${emailInMemberEmails || docIdInAcl ? '✅ TRUE' : '❌ FALSE'}`);

      // Check if the user is an admin
      const isAdmin = memberData.isAdmin === true;
      console.log(`    isAdmin? ${isAdmin ? '✅ YES' : '❌ NO'}`);

      // Check school manager path
      if (primarySchoolDocId) {
        const school = userData.schools.find(s => s.docId === primarySchoolDocId);
        if (school) {
          const ownerEmail = (school.data.ownerEmail as string) || '';
          const managerEmails = (school.data.managerEmails as string[]) || [];
          const isOwner = ownerEmail.toLowerCase() === userData.email.toLowerCase();
          const isManager = managerEmails.map(e => e.toLowerCase()).includes(userData.email.toLowerCase());
          console.log(`    School "${school.data.schoolName}" (${primarySchoolDocId}):`);
          console.log(`      isSchoolOwner? ${isOwner ? '✅ YES' : '❌ NO'}`);
          console.log(`      isSchoolManager? ${isManager ? '✅ YES' : '❌ NO'}`);
          console.log(`      isManagerOfMemberSchool() would resolve: ${isOwner || isManager ? '✅ TRUE' : '❌ FALSE'}`);
        } else {
          console.log(`    ⚠️  primarySchoolDocId="${primarySchoolDocId}" but school NOT FOUND in fetched data`);
        }
      } else {
        console.log(`    primarySchoolDocId is empty (no school-manager path)`);
      }

      // Summary: Can this user update their own member doc?
      // Firestore rule for update:
      //   allow write: if isValidEdit() && (isAdmin() || isManagerOfMemberSchool());
      //   allow update: if isValidEdit() && isOwner() && affectedKeys...
      console.log(`    -->`);
      console.log(`    Can update own profile via owner-update rule? ${(emailInMemberEmails || docIdInAcl) ? '✅ YES (if only touching owner-allowed fields)' : '❌ NO'}`);
      console.log(`    Can update via admin/manager-write rule? ${isAdmin ? '✅ YES (admin)' : '❌ NO (not admin, need school manager check)'}`);
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
