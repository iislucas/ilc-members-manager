import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

export const deleteUser = onDocumentDeleted(
  'members/{memberEmail}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      logger.error('No data found in the deleted member document.');
      return;
    }
    const deletedMember = snap.data();

    const memberEmail = deletedMember.public?.email;
    if (!memberEmail) {
      logger.error('No email address found in the deleted member document.');
      return;
    }

    try {
      const userRecord = await admin.auth().getUserByEmail(memberEmail);
      await admin.auth().deleteUser(userRecord.uid);
      logger.info(`Successfully deleted user with email: ${memberEmail}`);
    } catch (error: unknown) {
      logger.error(`Error deleting user with email ${memberEmail}:`, error);
    }
  }
);
