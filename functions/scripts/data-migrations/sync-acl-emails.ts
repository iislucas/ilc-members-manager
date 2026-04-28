/*. Script to synchronize member emails with the ACL collection.

Loads all members and ACLs into memory, then valuates how many ACL documents 
have memberDocIds corresponding to a Member document that does not list that 
ACL doc's email. Finally, it ensures that every ACL document lists every 
memberDocId for every member that contains that email.

Usage:

cd functions
pnpm run sync-acl-emails --project <YOUR_PROJECT_ID>        # Dry run
pnpm run sync-acl-emails --fix --project <YOUR_PROJECT_ID>  # Actualize changes

*/

import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';


const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    demandOption: false,
  })
  .option('fix', {
    type: 'boolean',
    description: 'Apply fixes to ACLs',
    default: false,
  })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT;

if (!projectId) {
  console.error(
    'Error: Project ID is required. Use --project or GCLOUD_PROJECT env var.'
  );
  process.exit(1);
}

admin.initializeApp({
  projectId,
});

const db = admin.firestore();

async function run() {
  console.log(`Starting ACL Sync for project: ${projectId}`);
  if (argv['fix']) {
    console.log('--- FIX MODE: Changes WILL be written to Firestore ---');
  } else {
    console.log('--- DRY RUN: No fixes will be applied (pass --fix to apply) ---');
  }

  // 1. Load all members
  console.log('Loading all members...');
  const membersSnap = await db.collection('members').get();
  const members = new Map<string, any>();
  membersSnap.forEach((snap) => members.set(snap.id, snap.data()));
  console.log(`Loaded ${members.size} members.`);

  // 2. Load all ACLs
  console.log('Loading all ACLs...');
  const aclSnap = await db.collection('acl').get();
  const acls = new Map<string, any>();
  aclSnap.forEach((snap) => acls.set(snap.id, snap.data()));
  console.log(`Loaded ${acls.size} ACL documents.`);

  // 3. Calculate expected ACL memberDocIds mapping
  const expectedAclMembers = new Map<string, Set<string>>(); // email -> Set of memberDocIds

  for (const [memberDocId, memberData] of members.entries()) {
    const emails: string[] = memberData.emails || [];
    for (const email of emails) {
      if (!email) continue;
      const cleanEmail = email.toLowerCase().trim();
      if (!expectedAclMembers.has(cleanEmail)) {
        expectedAclMembers.set(cleanEmail, new Set<string>());
      }
      expectedAclMembers.get(cleanEmail)!.add(memberDocId);
    }
  }

  // 4. Evaluate issues and fix
  let aclsWithExtraneousMembers = 0;
  let totalExtraneousMemberRefs = 0;
  let aclsWithMissingMembers = 0;
  let totalMissingMemberRefs = 0;
  let aclsToCreate = 0;

  let batch = db.batch();
  let batchCount = 0;

  async function commitBatchIfNeeded(force = false) {
    if (batchCount > 0 && (force || batchCount >= 500)) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Check existing ACLs
  const emailsProcessed = new Set<string>();

  for (const [email, aclData] of acls.entries()) {
    emailsProcessed.add(email);
    const expectedIdsSet = expectedAclMembers.get(email) || new Set<string>();
    const expectedIds = Array.from(expectedIdsSet).sort();

    const currentIds: string[] = aclData.memberDocIds || [];
    const currentIdsSet = new Set(currentIds);

    const extraneousIds = currentIds.filter(id => !expectedIdsSet.has(id));
    const missingIds = expectedIds.filter(id => !currentIdsSet.has(id));

    if (extraneousIds.length > 0) {
      aclsWithExtraneousMembers++;
      totalExtraneousMemberRefs += extraneousIds.length;
      console.log(`[Extraneous] ACL '${email}' has memberDocIds that do not list this email:`, extraneousIds);
    }

    if (missingIds.length > 0) {
      aclsWithMissingMembers++;
      totalMissingMemberRefs += missingIds.length;
      console.log(`[Missing] ACL '${email}' is missing memberDocIds that list this email:`, missingIds);
    }

    if (extraneousIds.length > 0 || missingIds.length > 0) {
      if (argv['fix']) {
        batch.update(db.collection('acl').doc(email), {
          memberDocIds: expectedIds
        });
        batchCount++;
        await commitBatchIfNeeded();
        console.log(`  -> Fixed ACL '${email}' (set to ${expectedIds.length} memberDocIds).`);
      }
    }
  }

  // Check for expected ACLs that don't exist yet
  for (const [email, expectedIdsSet] of expectedAclMembers.entries()) {
    if (!emailsProcessed.has(email)) {
      aclsToCreate++;
      const expectedIds = Array.from(expectedIdsSet).sort();
      console.log(`[Create] ACL '${email}' does not exist but is referenced by members:`, expectedIds);

      if (argv['fix']) {
        batch.set(db.collection('acl').doc(email), {
          memberDocIds: expectedIds,
          instructorIds: [],
          isAdmin: false
        });
        batchCount++;
        await commitBatchIfNeeded();
        console.log(`  -> Created ACL '${email}'.`);
      }
    }
  }

  if (argv['fix']) {
    await commitBatchIfNeeded(true);
  }

  console.log('\n======================================');
  console.log('Summary of discrepancies:');
  console.log(`ACL docs with extraneous memberDocIds: ${aclsWithExtraneousMembers}`);
  console.log(`Total extraneous memberDocIds across all ACLs: ${totalExtraneousMemberRefs}`);
  console.log(`ACL docs missing memberDocIds: ${aclsWithMissingMembers}`);
  console.log(`Total missing memberDocIds across all ACLs: ${totalMissingMemberRefs}`);
  console.log(`Missing ACL docs that need to be created: ${aclsToCreate}`);
  console.log('======================================');

  if (!argv['fix']) {
    console.log('Run with --fix to actualize these changes.');
  } else {
    console.log('Fixes applied successfully.');
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
