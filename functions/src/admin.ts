import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { environment } from './environment/environment';

admin.initializeApp();

const allowedOrigins = environment.domains;
if (process.env.GCLOUD_PROJECT) {
  allowedOrigins.push(`https://${process.env.GCLOUD_PROJECT}.web.app`);
}

interface AdminData {
  uid: string;
  email: string;
}

export const addAdmin = onCall({ cors: allowedOrigins }, async (request) => {
  // Check if the user making the request is already an admin
  if (request.auth?.token.admin !== true) {
    throw new HttpsError(
      'permission-denied',
      'Only admins can add other admins.'
    );
  }

  const data = request.data as AdminData;
  logger.info('addAdmin data', data);
  // Set the admin claim on the target user
  // TODO: catch errors, and make sure that failure here resultsi the UI having a message that tells the user that the user trying to be added as admin does not exit, and then make sure to also set the isAdmin boolean gets set to false.
  await admin.auth().setCustomUserClaims(data.uid, { admin: true });

  return { message: `Success! ${data.email} is now an admin.` };
});

export const removeAdmin = onCall({ cors: allowedOrigins }, async (request) => {
  // Check if the user making the request is already an admin
  if (request.auth?.token.admin !== true) {
    throw new HttpsError(
      'permission-denied',
      'Only admins can remove other admins.'
    );
  }

  const data = request.data as AdminData;

  logger.info('removeAdmin data', data);
  // Check if this is the last admin
  const admins = await admin
    .firestore()
    .collection('members')
    .where('isAdmin', '==', true)
    .get();
  if (admins.docs.length === 1 && admins.docs[0].id === data.uid) {
    throw new HttpsError(
      'failed-precondition',
      'You cannot remove the last admin.'
    );
  }

  // Remove the admin claim on the target user
  await admin.auth().setCustomUserClaims(data.uid, { admin: false });

  return { message: `Success! ${data.email} is no longer an admin.` };
});
