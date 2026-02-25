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
    description: 'Apply fixes to mismatched ACLs',
    default: true,
  })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT;

admin.initializeApp({
  projectId,
});

const db = admin.firestore();

async function fixAcl() {
  console.log('Fetching members that are admins or have an instructorId...');
  const [adminSnap, instructorSnap] = await Promise.all([
    db.collection('members').where('isAdmin', '==', true).get(),
    db.collection('members').where('instructorId', '!=', '').get()
  ]);

  const membersToCheck = new Map<string, any>();
  adminSnap.forEach(snap => membersToCheck.set(snap.id, snap.data()));
  instructorSnap.forEach(snap => membersToCheck.set(snap.id, snap.data()));

  const emailsToCheck = new Set<string>();
  for (const data of membersToCheck.values()) {
    for (const email of data.emails || []) {
      if (email) emailsToCheck.add(email);
    }
  }

  const aclSnap = await db.collection('acl').get();
  console.log(`Checking ${aclSnap.size} ACL entries, focusing on relevant profiles.`);

  let fixCount = 0;

  for (const doc of aclSnap.docs) {
    const data = doc.data();
    const email = doc.id;
    const currentMemberDocIds = data.memberDocIds || [];
    const currentInstructorIds = data.instructorIds || [];
    const currentIsAdmin = !!data.isAdmin;

    // Skip checking if this ACL has no admin/instructor stuff and isn't linked to one
    if (!emailsToCheck.has(email) && !currentIsAdmin && currentInstructorIds.length === 0) {
      continue;
    }

    const memberRefs = currentMemberDocIds.map((id: string) => db.collection('members').doc(id));

    let memberSnaps: admin.firestore.DocumentSnapshot[] = [];
    if (memberRefs.length > 0) {
      memberSnaps = await db.getAll(...memberRefs);
    }

    let anyAdmin = false;
    const newInstructorIds = new Set<string>();

    for (const snap of memberSnaps) {
      if (snap.exists) {
        const memberData = snap.data();
        if (memberData) {
          if (memberData.isAdmin) anyAdmin = true;
          if (memberData.instructorId) newInstructorIds.add(memberData.instructorId);
        }
      }
    }

    const calculatedInstructorIds = Array.from(newInstructorIds).sort();
    const sortedCurrentInstructorIds = [...currentInstructorIds].sort();

    const isAdminDiff = anyAdmin !== currentIsAdmin;
    const instructorIdsDiff = JSON.stringify(calculatedInstructorIds) !== JSON.stringify(sortedCurrentInstructorIds);

    if (isAdminDiff || instructorIdsDiff) {
      console.log(`Mismatch found for ${email}:`);
      if (isAdminDiff) console.log(`  isAdmin: expected ${anyAdmin}, got ${currentIsAdmin}`);
      if (instructorIdsDiff) console.log(`  instructorIds: expected ${JSON.stringify(calculatedInstructorIds)}, got ${JSON.stringify(sortedCurrentInstructorIds)}`);

      if (argv.fix) {
        await doc.ref.update({
          isAdmin: anyAdmin,
          instructorIds: calculatedInstructorIds,
        });
        console.log(`  Fixed ACL for ${email}.`);
        fixCount++;
      }
    }
  }

  console.log('--- Summary ---');
  console.log(`Total ACLs checked: ${aclSnap.size}`);
  if (argv.fix) {
    console.log(`Total ACLs fixed: ${fixCount}`);
  } else {
    console.log(`Found mismatches. Run with --fix to apply corrections.`);
  }
}

fixAcl().catch((err) => {
  console.error('Failed to verify/fix ACLs:', err);
  process.exit(1);
});
