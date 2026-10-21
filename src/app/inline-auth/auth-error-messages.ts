/* auth-error-messages.ts
 *
 * Firebase auth error codes turned into something a member can act on.
 *
 * A raw code like `auth/invalid-credential` tells the user nothing, and the
 * one thing that actually unblocks most sign-in failures — sending themselves
 * a password reset link — is exactly what the code fails to suggest. So each
 * message names what went wrong and, where a reset would fix it, says so; the
 * caller pairs that with the reset action via `isPasswordResettable`.
 *
 * The code is kept in the fallback text on purpose: an unrecognised failure is
 * something the user will report to us, and the code is what makes it
 * diagnosable.
 */

import { AuthBlockReason } from '../../../functions/src/data-model/auth';

/**
 * Failures a password reset can actually fix.
 *
 * With email-enumeration protection enabled (as it is on this project) a wrong
 * password, an unknown email and a password-less account all arrive as the
 * single code `auth/invalid-credential`; the older, more specific codes are
 * listed too because the setting can be turned off per project.
 */
const PASSWORD_RESETTABLE = new Set<string>([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/wrong-password',
  'auth/user-not-found',
  'auth/missing-password',
  // Rate limiting is triggered by repeated wrong passwords, so the user who
  // hits it is precisely the one who should stop guessing and reset instead.
  'auth/too-many-requests',
]);

export function isPasswordResettable(code: string | undefined): boolean {
  return !!code && PASSWORD_RESETTABLE.has(code);
}

/** A human explanation of a failed password sign-in. */
export function signInErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return "That email and password don't match an account. If you're not sure of your password, send yourself a reset link below.";
    case 'auth/missing-password':
      return 'Please enter your password.';
    case 'auth/invalid-email':
      return "That doesn't look like a valid email address. Please check it and try again.";
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact us for help.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts from this device. Please wait a few minutes, or send yourself a password reset link below.';
    case 'auth/network-request-failed':
      return 'We could not reach the server. Please check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Password sign-in is not enabled for this account. Please try signing in with Google, or contact us for help.';
    default:
      return `Sign in failed (${code || 'unknown error'}). Please check your connection and try again.`;
  }
}

/**
 * The reason an auth blocking function refused a request, if it did.
 *
 * Blocking-function rejections (functions/src/auth-blocking.ts) reach the
 * client as `auth/internal-error`, with the reason embedded in the message.
 */
export function authBlockReasonOf(message: string | undefined): AuthBlockReason | null {
  if (!message) return null;
  for (const reason of Object.values(AuthBlockReason)) {
    if (message.includes(reason)) return reason;
  }
  return null;
}

/**
 * Shown when a password sign-in is refused because the email hasn't been
 * proven yet, or the password was set before it was. The way forward is an
 * email link, which the caller offers alongside this message.
 */
export const PASSWORD_NOT_TRUSTED_MESSAGE =
  "For your security, this account needs to confirm its email address before a password " +
  "can be used. We'll email you a sign-in link; once you're in, you can choose a new password.";

/** A human explanation of a failure to send, or to finish, an email sign-in link. */
export function emailLinkErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'This sign-in link has expired or has already been used. Please request a new one.';
    case 'auth/invalid-email':
      return "That email doesn't match the address the sign-in link was sent to. Please check it and try again.";
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many sign-in emails have been requested. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'We could not reach the server. Please check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Email sign-in links are not available right now. Please try signing in with Google, or contact us for help.';
    default:
      return `We could not complete email sign-in (${code || 'unknown error'}). Please try again in a moment.`;
  }
}

/** A human explanation of a failed Google sign-in. */
export function googleSignInErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Please allow pop-ups for this site and try again.';
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in window was closed before sign-in finished. Please try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists for this email with a different sign-in method. Please use a password or an email sign-in link instead.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact us for help.';
    case 'auth/network-request-failed':
      return 'We could not reach the server. Please check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not available right now. Please use a password instead.';
    default:
      return `Google sign-in failed (${code || 'unknown error'}). Please try again, or use a password instead.`;
  }
}

/** A human explanation of a failed password reset request. */
export function passwordResetErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-email':
      return "That doesn't look like a valid email address. Please check it and try again.";
    case 'auth/user-not-found':
      // Only reachable with email-enumeration protection off; the wording
      // still avoids confirming whether the address is registered.
      return 'If an account exists for that email, a reset link is on its way. Please check your inbox and spam folder.';
    case 'auth/too-many-requests':
      return 'Too many reset requests from this device. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'We could not reach the server. Please check your connection and try again.';
    default:
      return `We could not send the reset link (${code || 'unknown error'}). Please try again in a moment.`;
  }
}
