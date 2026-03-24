import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins } from './common';
import { Member, MembershipType, InstructorLicenseType } from './data-model';

// Helper to add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export const scheduleAccountDeletion = onCall<{ memberDocId: string }, Promise<{ success: boolean; scheduledDeletionDate: string }>>(
  { cors: allowedOrigins },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }

    const memberDocId = request.data.memberDocId;
    if (!memberDocId) {
      throw new HttpsError('invalid-argument', 'memberDocId is required.');
    }

    const db = admin.firestore();
    const memberSnap = await db.collection('members').doc(memberDocId).get();

    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Member not found.');
    }

    const member = memberSnap.data() as Member;
    const userEmail = request.auth.token.email;

    // Auth check: caller must be in member.emails or admin
    const isAdmin = request.auth.token.email ? await checkIsAdmin(request.auth.token.email) : false;
    const isOwner = member.emails && userEmail && member.emails.includes(userEmail);

    if (!isAdmin && !isOwner) {
      throw new HttpsError('permission-denied', 'You do not have permission to delete this account.');
    }

    const deletionDate = addDays(new Date(), 30);
    const deletionDateStr = deletionDate.toISOString().split('T')[0]; // YYYY-MM-DD

    await db.collection('members').doc(memberDocId).update({
      scheduledDeletionDate: deletionDateStr,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Scheduled deletion for member ${memberDocId} on ${deletionDateStr}`);
    return { success: true, scheduledDeletionDate: deletionDateStr };
  }
);

export const cancelAccountDeletion = onCall<{ memberDocId: string }, Promise<{ success: boolean }>>(
  { cors: allowedOrigins },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }

    const memberDocId = request.data.memberDocId;
    if (!memberDocId) {
      throw new HttpsError('invalid-argument', 'memberDocId is required.');
    }

    const db = admin.firestore();
    const memberSnap = await db.collection('members').doc(memberDocId).get();

    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Member not found.');
    }

    const member = memberSnap.data() as Member;
    const userEmail = request.auth.token.email;

    const isAdmin = request.auth.token.email ? await checkIsAdmin(request.auth.token.email) : false;
    const isOwner = member.emails && userEmail && member.emails.includes(userEmail);

    if (!isAdmin && !isOwner) {
      throw new HttpsError('permission-denied', 'You do not have permission to cancel deletion.');
    }

    await db.collection('members').doc(memberDocId).update({
      scheduledDeletionDate: '',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Cancelled deletion for member ${memberDocId}`);
    return { success: true };
  }
);

async function checkIsAdmin(email: string): Promise<boolean> {
  const db = admin.firestore();
  const aclDoc = await db.collection('acl').doc(email).get();
  if (!aclDoc.exists) return false;
  return aclDoc.data()?.isAdmin === true;
}

export const dailyAccountCleanup = onSchedule('0 0 * * *', async () => {
  const db = admin.firestore();
  const todayIso = new Date().toISOString().split('T')[0];

  logger.info(`Running daily account cleanup for ${todayIso}`);

  const membersSnapshot = await db.collection('members')
    .where('scheduledDeletionDate', '<=', todayIso)
    .where('scheduledDeletionDate', '!=', '')
    .get();

  if (membersSnapshot.empty) {
    logger.info('No accounts to anonymize.');
    return;
  }

  const batch = db.batch();

  membersSnapshot.forEach((doc) => {
    const member = doc.data() as Member;
    logger.info(`Anonymizing member ${doc.id} scheduled for ${member.scheduledDeletionDate}`);

    // Anonymize data
    batch.update(doc.ref, {
      name: 'Deleted Member ' + member.memberId,
      address: '',
      city: '',
      zipCode: '',
      countyOrState: '',
      phone: '',
      emails: [],
      gender: '',
      dateOfBirth: '',
      publicEmail: '',
      publicPhone: '',
      publicRegionOrCity: '',
      publicCountyOrState: '',
      instructorWebsite: '',
      publicClassGoogleCalendarId: '',
      notes: `Account ( ${member.memberId}-${member.instructorId}) deleted on ${todayIso} \n ${member.notes}`,
      membershipType: MembershipType.Inactive,
      instructorId: '', // Clear instructor ID to remove from public profile
      instructorLicenseType: InstructorLicenseType.None,
      scheduledDeletionDate: '', // Clear schedule
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();
  logger.info(`Anonymized ${membersSnapshot.size} accounts.`);
});
