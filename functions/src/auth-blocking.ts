/* auth-blocking.ts
 *
 * "Prove the email first": Identity Platform blocking functions and the
 * password-setting callable that together ensure a password can only be used
 * if it was chosen by someone who had shown they control the account's email.
 *
 * Why: with plain email/password sign-up, anyone can create an account for an
 * address they don't own and choose its password. Even if they can't use it
 * until the email is verified, the owner gets a confusing "verify your email"
 * message, finds their address already taken, and — worst case — clicks that
 * verification link, which would make the stranger's password valid.
 *
 * The rules enforced here:
 * 1. `beforeUserCreated` — new accounts must arrive with a verified email.
 *    Email-link sign-in (clicking a link sent to the inbox) and Google both
 *    do; email/password sign-up does not, so it is rejected.
 * 2. `beforeUserSignedIn` — a password sign-in needs a verified email AND the
 *    `passwordTrusted` custom claim. The claim is granted only by
 *    `setAccountPassword` (called by a verified user) or by the one-time
 *    migration for accounts that were already verified password accounts.
 *    A password chosen before verification never gets it, even if the email
 *    is verified later — the blocking event can't tell us whether the
 *    password predates verification, so trust is granted, never inferred.
 * 3. `setAccountPassword` — a verified user chooses a password; the server
 *    sets it and grants `passwordTrusted`.
 *
 * Errors thrown from blocking functions reach the client as
 * `auth/internal-error` with the reason (an AuthBlockReason) inside the error
 * message; see `authBlockReasonOf` in the frontend's auth-error-messages.ts.
 */

import { beforeUserCreated, beforeUserSignedIn, AuthBlockingEvent, HttpsError as IdentityHttpsError } from 'firebase-functions/v2/identity';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { allowedOrigins, verifiedAuthEmail } from './common';
import { AuthBlockReason, MIN_PASSWORD_LENGTH, TRUSTED_PASSWORD_CLAIM } from './data-model/auth';

// Sign-in method reported for email/password sign-ins (credential.signInMethod,
// or the suffix of the blocking event type).
export const PASSWORD_SIGN_IN_METHOD = 'password';

// The method used for this sign-in/creation: 'password', 'emailLink',
// 'google.com', ... or '' if it can't be determined.
export function signInMethodOf(event: AuthBlockingEvent): string {
  if (event.credential?.signInMethod) {
    return event.credential.signInMethod;
  }
  // e.g. 'providers/cloud.auth/eventTypes/user.beforeSignIn:password'
  const suffix = (event.eventType || '').split(':').pop() || '';
  return suffix.includes('/') ? '' : suffix;
}

export function beforeCreateHandler(event: AuthBlockingEvent): void {
  if (event.data?.emailVerified) {
    return;
  }
  logger.warn('Rejected account creation with an unverified email', {
    method: signInMethodOf(event),
    email: event.data?.email,
  });
  throw new IdentityHttpsError('permission-denied', AuthBlockReason.UnverifiedSignUp);
}

export function beforeSignInHandler(event: AuthBlockingEvent): void {
  const user = event.data;
  if (!user || signInMethodOf(event) !== PASSWORD_SIGN_IN_METHOD) {
    return;
  }
  const trusted = user.customClaims?.[TRUSTED_PASSWORD_CLAIM] === true;
  if (!user.emailVerified || !trusted) {
    logger.info('Rejected password sign-in: email unverified or password not trusted', {
      uid: user.uid,
      emailVerified: user.emailVerified,
      trusted,
    });
    throw new IdentityHttpsError('permission-denied', AuthBlockReason.PasswordNotTrusted);
  }
}

export const beforeCreate = beforeUserCreated((event) => beforeCreateHandler(event));
export const beforeSignIn = beforeUserSignedIn((event) => beforeSignInHandler(event));

export interface SetAccountPasswordRequest {
  password: string;
}

export async function setAccountPasswordHandler(
  request: CallableRequest<SetAccountPasswordRequest>,
): Promise<{ success: true }> {
  const email = verifiedAuthEmail(request);
  if (!request.auth || !email) {
    throw new HttpsError('unauthenticated', 'You must be signed in with a verified email to set a password.');
  }
  const password = request.data?.password;
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpsError('invalid-argument', `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const uid = request.auth.uid;
  const user = await admin.auth().getUser(uid);
  await admin.auth().updateUser(uid, { password });
  await admin.auth().setCustomUserClaims(uid, {
    ...(user.customClaims || {}),
    [TRUSTED_PASSWORD_CLAIM]: true,
  });
  logger.info('Password set by verified user', { uid });
  return { success: true };
}

export const setAccountPassword = onCall<SetAccountPasswordRequest, Promise<{ success: true }>>(
  { cors: allowedOrigins },
  (request) => setAccountPasswordHandler(request),
);
