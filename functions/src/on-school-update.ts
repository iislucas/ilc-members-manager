import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { School } from './data-model';
import { ensureSchoolCountersAreAtLeast } from './counters';

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
  }
);

export const onSchoolUpdated = onDocumentUpdated(
  'schools/{schoolId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const schoolAfter = snap.after.data() as School;
    const schoolBefore = snap.before.data() as School;

    if (schoolAfter.ownerInstructorId !== schoolBefore.ownerInstructorId ||
      JSON.stringify(schoolAfter.managerInstructorIds) !== JSON.stringify(schoolBefore.managerInstructorIds) ||
      !schoolAfter.ownerEmails ||
        !schoolAfter.managerEmails) {
      await updateSchoolEmails(snap.after.id, schoolAfter);
    }

    if (schoolAfter.schoolId !== schoolBefore.schoolId) {
      await ensureSchoolCountersAreAtLeast(schoolAfter);
    }
  }
);
