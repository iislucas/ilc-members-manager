/* Pre-auth cloud function: checks an email's status to guide the login flow.
 *
 * This is intentionally callable WITHOUT authentication. It determines:
 * 1. Whether the email has a member record (via the ACL collection).
 * 2. Whether a Firebase Auth account already exists.
 * 3. Whether the email appears to be Google-managed.
 *
 * Security note: this reveals whether an email is in the member database.
 * For a membership organisation this is an acceptable trade-off to provide
 * a much clearer login UX.
 */

import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins } from './common';
import { CheckEmailStatusResult } from './data-model';

const GOOGLE_EMAIL_DOMAINS = ['gmail.com', 'googlemail.com'];

export const checkEmailStatus = onCall<
  { email: string },
  Promise<CheckEmailStatusResult>
>({ cors: allowedOrigins }, async (request) => {
  const email = request.data?.email?.trim().toLowerCase();
  if (!email) {
    return { hasMemberRecord: false, hasAuthAccount: false, isGoogleManaged: false };
  }

  logger.info('checkEmailStatus called', { email });

  const db = admin.firestore();

  // 1. Check ACL collection for a member record.
  const aclDoc = await db.collection('acl').doc(email).get();
  const hasMemberRecord =
    aclDoc.exists &&
    ((aclDoc.data() as { memberDocIds?: string[] })?.memberDocIds?.length ?? 0) > 0;

  // 2. Check Firebase Auth for an existing account and Google provider.
  let hasAuthAccount = false;
  let hasGoogleProvider = false;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    hasAuthAccount = true;
    hasGoogleProvider = userRecord.providerData.some(
      (p) => p.providerId === 'google.com',
    );
  } catch {
    // User not found in Firebase Auth — expected for new members.
  }

  // 3. Determine if the email is Google-managed.
  const domain = email.split('@')[1] || '';
  const isGoogleDomain = GOOGLE_EMAIL_DOMAINS.includes(domain);
  const isGoogleManaged = isGoogleDomain || hasGoogleProvider;

  return { hasMemberRecord, hasAuthAccount, isGoogleManaged };
});
