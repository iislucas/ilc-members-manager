import type { RulesTestEnvironment, TokenOptions } from '@firebase/rules-unit-testing';

type AuthenticatedContextFn = RulesTestEnvironment['authenticatedContext'];

/**
 * firestore.rules only trusts the `email` claim when `email_verified == true`
 * (see `hasAuthEmail()`), mirroring real Firebase Auth where an unverified
 * email/password account must not be treated as the owner of that address.
 *
 * Most rules tests model a normal signed-in user whose email IS verified, so
 * rather than repeating `email_verified: true` at every call site this patches
 * `env.authenticatedContext` so that any token carrying an `email` claim gets
 * `email_verified: true` by default. Tests that pass `email_verified`
 * explicitly (e.g. `false`) are left untouched.
 *
 * Returns the ORIGINAL (unpatched) `authenticatedContext`, for tests that need
 * a token whose `email_verified` claim is entirely missing.
 */
export function defaultToVerifiedEmail(env: RulesTestEnvironment): AuthenticatedContextFn {
  const raw: AuthenticatedContextFn = env.authenticatedContext.bind(env);
  env.authenticatedContext = (user_id: string, tokenOptions?: TokenOptions) => {
    if (tokenOptions && 'email' in tokenOptions && !('email_verified' in tokenOptions)) {
      return raw(user_id, { ...tokenOptions, email_verified: true });
    }
    return raw(user_id, tokenOptions);
  };
  return raw;
}
