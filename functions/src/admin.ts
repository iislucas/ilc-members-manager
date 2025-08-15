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
  try {
    // First, check if the user exists.
    await admin.auth().getUser(data.uid);
    // If the user exists, set the custom claim.
    await admin.auth().setCustomUserClaims(data.uid, { admin: true });
    return { message: `Success! ${data.email} is now an admin.` };
  } catch (error: unknown) {
    logger.error('Error in addAdmin:', error);
    // Check for a specific error code indicating the user was not found.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'auth/user-not-found'
    ) {
      throw new HttpsError(
        'not-found',
        `The user with email ${data.email} does not exist, she needs to signin before you can make her an admin; unsetting the admin field so you can try and save again.`
      );
    }
    // For any other errors, throw a generic error.
    throw new HttpsError(
      'internal',
      'An unexpected error occurred while making the user an admin.'
    );
  }
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
  try {
    await admin.auth().setCustomUserClaims(data.uid, { admin: false });
    return { message: `Success! ${data.email} is no longer an admin.` };
  } catch (error: unknown) {
    logger.error('Error in removeAdmin:', error);
    // If the user doesn't exist, that's fine. The end state is the same.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'auth/user-not-found'
    ) {
      logger.info(`User ${data.email} not found, but they are not an admin.`);
      return {
        message: `User ${data.email} not found, but they are not an admin.`,
      };
    }
    // For any other errors, throw a generic error.
    throw new HttpsError(
      'internal',
      'An unexpected error occurred while removing admin privileges.'
    );
  }
});
