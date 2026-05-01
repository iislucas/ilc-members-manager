import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { School } from './data-model';
import { ensureSchoolCountersAreAtLeast } from './counters';
import { refreshACLAdminStatus } from './on-member-update';

const db = admin.firestore();

/**
 * Resolves a list of instructor IDs to their primary account emails
 * by querying the members collection directly.
 */
async function resolveInstructorEmails(instructorIds: string[]): Promise<string[]> {
  const emails: string[] = [];
  const validIds = instructorIds.filter(id => !!id);
  
  if (validIds.length === 0) return [];

  // Firestore "in" query limited to 30 items. 
  // Managers list is expected to be small, but let's be safe.
  const chunks = [];
  for (let i = 0; i < validIds.length; i += 30) {
    chunks.push(validIds.slice(i, i + 30));
  }

  for (const chunk of chunks) {
    const q = db.collection('members').where('instructorId', 'in', chunk);
    const snapshot = await q.get();
    snapshot.forEach(doc => {
      const member = doc.data();
      if (member.emails && member.emails.length > 0) {
        emails.push(...member.emails);
      }
    });
  }

  return emails;
}

// @deprecated — ownerEmails/managerEmails on School documents are being
// phased out. Security rules now use the ACL's schoolDocIds field instead.
// This function is kept temporarily for backward compatibility.
async function updateSchoolEmails(schoolId: string, school: School) {
  const ownerEmails = await resolveInstructorEmails([school.ownerInstructorId]);
  const managerEmails = await resolveInstructorEmails(school.managerInstructorIds || []);

  logger.info(`Updating school ${schoolId} with ${ownerEmails.length} ownerEmails and ${managerEmails.length} managerEmails.`);

  if (JSON.stringify(school.ownerEmails) === JSON.stringify(ownerEmails) && 
      JSON.stringify(school.managerEmails) === JSON.stringify(managerEmails)) {
    logger.info(`Emails for school ${schoolId} are already up to date.`);
    return;
  }

  await db.collection('schools').doc(schoolId).update({
    ownerEmails,
    managerEmails
  });
}

async function populateSchoolMembers(schoolDocId: string, schoolId: string) {
  if (!schoolId) return;
  const snapshot = await db.collection('members').where('primarySchoolId', '==', schoolId).get();

  const chunks: admin.firestore.WriteBatch[] = [];
  let i = 0;
  snapshot.docs.forEach((doc) => {
    if (i % 500 === 0) chunks.push(db.batch());
    const batch = chunks[chunks.length - 1];
    const ref = db.collection('schools').doc(schoolDocId).collection('members').doc(doc.id);
    batch.set(ref, doc.data());
    i++;
  });

  for (const batch of chunks) {
    await batch.commit();
  }
}

// Finds all emails with an ACL document that references the given school
// docId in their schoolDocIds array, so their ACLs can be refreshed.
async function findEmailsWithSchoolInACL(schoolDocId: string): Promise<Set<string>> {
  const emails = new Set<string>();
  const aclSnap = await db.collection('acl')
    .where('schoolDocIds', 'array-contains', schoolDocId)
    .get();
  for (const doc of aclSnap.docs) {
    emails.add(doc.id); // ACL doc ID is the email
  }
  return emails;
}

export const onSchoolCreated = onDocumentCreated(
  'schools/{schoolId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const school = snap.data() as School;
    await updateSchoolEmails(snap.id, school);
    await ensureSchoolCountersAreAtLeast(school);

    if (school.schoolId) {
      await populateSchoolMembers(snap.id, school.schoolId);
    }

    // Refresh ACLs of the new school's owner/managers so they get
    // this school in their schoolDocIds.
    const ownerEmails = await resolveInstructorEmails([school.ownerInstructorId]);
    const managerEmails = await resolveInstructorEmails(school.managerInstructorIds || []);
    const affectedEmails = new Set([...ownerEmails, ...managerEmails]);
    for (const email of affectedEmails) {
      if (email) {
        await refreshACLAdminStatus(email);
      }
    }
  }
);

export const onSchoolUpdated = onDocumentUpdated(
  'schools/{schoolId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const schoolAfter = snap.after.data() as School;
    const schoolBefore = snap.before.data() as School;

    const ownershipChanged =
      schoolAfter.ownerInstructorId !== schoolBefore.ownerInstructorId ||
      JSON.stringify(schoolAfter.managerInstructorIds) !== JSON.stringify(schoolBefore.managerInstructorIds);

    if (ownershipChanged || !schoolAfter.ownerEmails || !schoolAfter.managerEmails) {
      await updateSchoolEmails(snap.after.id, schoolAfter);
    }

    if (schoolAfter.schoolId !== schoolBefore.schoolId) {
      await ensureSchoolCountersAreAtLeast(schoolAfter);
    }

    // When school license expiry or ownership changes, refresh the
    // ACLs of all affected emails so their schoolDocIds and
    // schoolLicenseExpires fields stay in sync.
    const licenseChanged =
      schoolAfter.schoolLicenseExpires !== schoolBefore.schoolLicenseExpires;
    if (licenseChanged || ownershipChanged) {
      // Find emails that currently reference this school in their ACL,
      // plus resolve the new owner/manager instructor IDs to emails.
      const [existingEmails, newOwnerEmails, newManagerEmails] = await Promise.all([
        findEmailsWithSchoolInACL(snap.after.id),
        resolveInstructorEmails([schoolAfter.ownerInstructorId]),
        resolveInstructorEmails(schoolAfter.managerInstructorIds || []),
      ]);

      const affectedEmails = new Set([
        ...existingEmails,
        ...newOwnerEmails,
        ...newManagerEmails,
      ]);

      for (const email of affectedEmails) {
        if (email) {
          await refreshACLAdminStatus(email);
        }
      }
    }
  }
);
