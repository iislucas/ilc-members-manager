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
 * Resolves a list of member IDs (or instructor IDs) to their primary account emails.
 * In this system, the document ID in the 'members' collection is the primary email.
 * However, we need to find the member document by their 'instructorId'.
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
    const q = db.collection('acl').where('instructorIds', 'array-contains-any', chunk);
    const snapshot = await q.get();
    snapshot.forEach(doc => {
      // The document ID of the ACL record is the user's primary account email.
      emails.push(doc.id);
    });
  }

  return emails;
}

async function updateSchoolEmails(schoolId: string, school: School) {
  const ownerEmails = await resolveInstructorEmails([school.owner]);
  const managerEmails = await resolveInstructorEmails(school.managers || []);

  const ownerEmail = ownerEmails.length > 0 ? ownerEmails[0] : '';
  
  logger.info(`Updating school ${schoolId} with ownerEmail: ${ownerEmail} and ${managerEmails.length} managerEmails.`);

  if (school.ownerEmail === ownerEmail && 
      JSON.stringify(school.managerEmails) === JSON.stringify(managerEmails)) {
    logger.info(`Emails for school ${schoolId} are already up to date.`);
    return;
  }

  await db.collection('schools').doc(schoolId).update({
    ownerEmail,
    managerEmails
  });
}

export const onSchoolCreated = onDocumentCreated(
  'schools/{schoolId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const school = snap.data() as School;
    await updateSchoolEmails(snap.id, school);
    await ensureSchoolCountersAreAtLeast(school);
  }
);

export const onSchoolUpdated = onDocumentUpdated(
  'schools/{schoolId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const schoolAfter = snap.after.data() as School;
    const schoolBefore = snap.before.data() as School;

    if (schoolAfter.owner !== schoolBefore.owner ||
        JSON.stringify(schoolAfter.managers) !== JSON.stringify(schoolBefore.managers) ||
        !schoolAfter.ownerEmail ||
        !schoolAfter.managerEmails) {
      await updateSchoolEmails(snap.after.id, schoolAfter);
    }

    if (schoolAfter.schoolId !== schoolBefore.schoolId) {
      await ensureSchoolCountersAreAtLeast(schoolAfter);
    }
  }
);
