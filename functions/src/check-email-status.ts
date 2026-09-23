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

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins } from './common';
import { CheckEmailStatusResult } from './data-model/system';

const GOOGLE_EMAIL_DOMAINS = ['gmail.com', 'googlemail.com'];

// In-memory sliding-window rate limiter per client IP to hinder automated email enumeration
const ipRequests = new Map<string, number[]>();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30;

export function isCheckEmailRateLimited(ip: string, now = Date.now()): boolean {
  if (!ip || ip === 'unknown') return false;
  const timestamps = ipRequests.get(ip) || [];
  const validTimestamps = timestamps.filter((t) => now - t < WINDOW_MS);
  if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    ipRequests.set(ip, validTimestamps);
    return true;
  }
  validTimestamps.push(now);
  ipRequests.set(ip, validTimestamps);
  if (ipRequests.size > 5000) {
    for (const [k, times] of ipRequests.entries()) {
      if (times.every((t) => now - t >= WINDOW_MS)) {
        ipRequests.delete(k);
      }
    }
  }
  return false;
}

export const checkEmailStatus = onCall<
  { email: string },
  Promise<CheckEmailStatusResult>
>({ cors: allowedOrigins }, async (request) => {
  const clientIp = request.rawRequest?.ip || 'unknown';
  if (isCheckEmailRateLimited(clientIp)) {
    logger.warn('checkEmailStatus: rate limit exceeded', { ip: clientIp });
    throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
  }

  const email = request.data?.email?.trim().toLowerCase();
  if (!email) {
    return { hasMemberRecord: false, hasAuthAccount: false, isGoogleManaged: false };
  }

  logger.info('checkEmailStatus called', { email });

  const db = admin.firestore();

  // 1. Check ACL collection for a member record.
  const aclDoc = await db.collection('acl').doc(email).get();
  let hasMemberRecord =
    aclDoc.exists &&
    ((aclDoc.data() as { memberDocIds?: string[] })?.memberDocIds?.length ?? 0) > 0;

  // Fallback: Check members collection directly if not found in ACL
  if (!hasMemberRecord) {
    const rawEmail = request.data?.email?.trim();
    let memberQuery = await db.collection('members')
      .where('emails', 'array-contains', email)
      .limit(1)
      .get();

    if (memberQuery.empty && rawEmail && rawEmail !== email) {
      memberQuery = await db.collection('members')
        .where('emails', 'array-contains', rawEmail)
        .limit(1)
        .get();
    }

    if (!memberQuery.empty) {
      hasMemberRecord = true;
    }
  }

  // 2. Check Firebase Auth for an existing account and providers.
  let hasAuthAccount = false;
  let hasGoogleProvider = false;
  let hasPasswordProvider = false;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    hasAuthAccount = true;
    hasGoogleProvider = userRecord.providerData.some(
      (p) => p.providerId === 'google.com',
    );
    hasPasswordProvider =
      userRecord.providerData.some((p) => p.providerId === 'password') ||
      !!userRecord.passwordHash;
  } catch {
    // User not found in Firebase Auth — expected for new members.
  }

  // 3. Determine if the email is Google-managed.
  const domain = email.split('@')[1] || '';
  const isGoogleDomain = GOOGLE_EMAIL_DOMAINS.includes(domain);
  const isGoogleManaged = isGoogleDomain || hasGoogleProvider;

  return {
    hasMemberRecord,
    hasAuthAccount,
    isGoogleManaged,
    hasPasswordProvider,
    hasGoogleProvider,
  };
});
