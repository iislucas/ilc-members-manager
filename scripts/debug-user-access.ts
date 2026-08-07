/*
 * Debug User Access Script (READ-ONLY)
 *
 * Diagnoses authentication, authorization (ACL), member profiles, instructor status,
 * schools, notifications, and resource storage access for any user.
 *
 * Usage:
 *   pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' ../scripts/debug-user-access.ts <user-email-or-memberId>
 *
 * Example:
 *   pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' ../scripts/debug-user-access.ts tim@zxdpdx.com
 *   pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' ../scripts/debug-user-access.ts US544
 */

import * as admin from 'firebase-admin';
import { Member, ACL, MemberNotification } from '../functions/src/data-model';

const inputQuery = (process.argv[2] || '').trim();
const projectId = 'ilc-paris-class-tracker';

if (!inputQuery) {
  console.error('Error: Please provide an email address or Member ID to investigate.');
  console.error('Example: pnpm --prefix functions exec ts-node -O \'{"module":"commonjs"}\' ../scripts/debug-user-access.ts user@example.com');
  process.exit(1);
}

admin.initializeApp({
  projectId,
  storageBucket: 'ilc-paris-class-tracker.firebasestorage.app',
});
const db = admin.firestore();
const auth = admin.auth();

async function main() {
  console.log(`\n=======================================================`);
  console.log(`🔍 Diagnosing User Access: "${inputQuery}"`);
  console.log(`   Project: ${projectId}`);
  console.log(`=======================================================\n`);

  const isEmail = inputQuery.includes('@');
  const targetEmail = isEmail ? inputQuery.toLowerCase() : '';

  // 1. Firebase Auth
  if (targetEmail) {
    console.log(`--- 1. Firebase Auth ---`);
    try {
      const userRecord = await auth.getUserByEmail(targetEmail);
      console.log(`✅ Auth user found:`, {
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        displayName: userRecord.displayName,
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime,
      });
    } catch (err: any) {
      console.log(`❌ Auth record not found for ${targetEmail}: ${err.message}`);
    }
  }

  // 2. Member Profile(s)
  console.log(`\n--- 2. Member Documents ---`);
  let memberDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (isEmail) {
    const byEmailSnap = await db.collection('members').where('emails', 'array-contains', targetEmail).get();
    memberDocs = byEmailSnap.docs;
  } else {
    const byIdSnap = await db.collection('members').where('memberId', '==', inputQuery.toUpperCase()).get();
    memberDocs = byIdSnap.docs;
  }

  console.log(`Found ${memberDocs.length} matching member record(s):`);
  const allEmails = new Set<string>();

  for (const doc of memberDocs) {
    const data = doc.data() as Member;
    console.log(`\n  Member [${doc.id}]:`);
    console.log(`    Name:                         ${data.name}`);
    console.log(`    Member ID:                    ${data.memberId}`);
    console.log(`    Membership Type:              ${data.membershipType}`);
    console.log(`    Membership Expiration:        ${data.currentMembershipExpires || '(none)'}`);
    console.log(`    Instructor ID:                ${data.instructorId || '(none)'}`);
    console.log(`    Instructor License Type:      ${data.instructorLicenseType || '(none)'}`);
    console.log(`    Instructor License Expiration:${data.instructorLicenseExpires || '(none)'}`);
    console.log(`    Emails:                       [${(data.emails || []).join(', ')}]`);
    console.log(`    Is Admin:                     ${data.isAdmin}`);

    for (const e of data.emails || []) {
      if (e) allEmails.add(e.toLowerCase().trim());
    }

    // Notifications
    const notifsSnap = await db.collection('members').doc(doc.id).collection('notifications').orderBy('createdAt', 'desc').limit(10).get();
    console.log(`    Recent notifications (${notifsSnap.size}):`);
    for (const nDoc of notifsSnap.docs) {
      const nData = nDoc.data() as MemberNotification;
      console.log(`      • [${nData.kind}] ${nData.createdAt} (dismissed: ${nData.dismissed}) - ${nData.markdown?.slice(0, 80)}`);
    }
  }

  if (targetEmail) {
    allEmails.add(targetEmail);
  }

  // 3. ACL Documents
  console.log(`\n--- 3. ACL Documents for Associated Emails ---`);
  for (const email of allEmails) {
    const aclDoc = await db.collection('acl').doc(email).get();
    if (!aclDoc.exists) {
      console.log(`  ❌ /acl/${email} does NOT exist`);
    } else {
      const acl = aclDoc.data() as ACL;
      console.log(`  ✅ /acl/${email}:`, JSON.stringify(acl, null, 2));

      // Consistency checks
      if (acl.instructorIds && acl.instructorIds.length > 0 && !acl.instructorLicenseExpires) {
        console.log(`     ⚠️  WARNING: ACL has instructorIds [${acl.instructorIds.join(', ')}] but instructorLicenseExpires is empty!`);
      }
    }
  }

  // 4. Storage Resources Check
  console.log(`\n--- 4. Available Instructor Resources in Storage ---`);
  try {
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix: 'resources/instructors/' });
    console.log(`Found ${files.length} file(s) under resources/instructors/:`);
    for (const f of files) {
      console.log(`  - ${f.name}`);
    }
  } catch (err: any) {
    console.log(`Storage listing error:`, err.message);
  }

  console.log(`\n=======================================================\n`);
}

main().catch(console.error);
