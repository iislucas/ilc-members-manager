import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

admin.initializeApp();

interface AdminData {
  uid: string;
  email: string;
}

export const addAdmin = onCall(async (request) => {
  // Check if the user making the request is already an admin
  if (request.auth?.token.admin !== true) {
    throw new HttpsError(
      'permission-denied',
      'Only admins can add other admins.'
    );
  }

  const data = request.data as AdminData;
  // Set the admin claim on the target user
  await admin.auth().setCustomUserClaims(data.uid, { admin: true });

  return { message: `Success! ${data.email} is now an admin.` };
});

export const removeAdmin = onCall(async (request) => {
  // Check if the user making the request is already an admin
  if (request.auth?.token.admin !== true) {
    throw new HttpsError(
      'permission-denied',
      'Only admins can remove other admins.'
    );
  }

  const data = request.data as AdminData;

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
