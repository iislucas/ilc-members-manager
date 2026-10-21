/* auth.ts
 *
 * Shared (frontend + functions) constants for the "prove the email first"
 * sign-in model. See functions/src/auth-blocking.ts for how they are enforced.
 */

// Reasons the auth blocking functions reject a sign-in or account creation.
// They appear inside the client-side error message.
export enum AuthBlockReason {
  // Email/password sign-up was attempted: new accounts must start from an
  // email link (or Google), which proves the email first.
  UnverifiedSignUp = 'UNVERIFIED_SIGNUP',
  // Password sign-in to an account whose email is unverified, or whose
  // password was not set by someone who had proven the email.
  PasswordNotTrusted = 'PASSWORD_NOT_TRUSTED',
}

// Custom claim marking an account's password as trusted: it was set by a user
// who had proven the email (via setAccountPassword), or the account was
// already a verified password account when this model was introduced
// (functions/scripts/data-migrations/trust-verified-passwords-21-oct-2026.ts).
// Password sign-in is refused without it.
export const TRUSTED_PASSWORD_CLAIM = 'passwordTrusted';

export const MIN_PASSWORD_LENGTH = 6;
