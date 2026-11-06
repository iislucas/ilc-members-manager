/* remembered-login.ts
 *
 * Persists a sign-in this browser has actually completed before so the next
 * visit can start at the same method without guessing or caching pre-auth
 * email attempts.
 */

export type LoginMethod = 'password' | 'google' | 'emailLink';
const LOGIN_METHODS: readonly string[] = ['password', 'google', 'emailLink'];

/**
 * A sign-in this browser has actually completed before.
 *
 * Written only after authentication succeeds, so every field records something
 * observed rather than assumed.
 */
export type RememberedLogin = {
  email: string;
  /** The provider that actually worked last time. */
  method: LoginMethod;
  /** Whether Google sign-in was available for this email when last checked. */
  canUseGoogle: boolean;
};

export const REMEMBERED_LOGIN_KEY = 'ilc-remembered-login';

/** The pre-authentication cache this replaced; removed wherever it lingers. */
export const LEGACY_LOGIN_KEY = 'ilc-login-info';

export function readRememberedLogin(): RememberedLogin | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_LOGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (!parsed || typeof parsed.email !== 'string' || !parsed.email.trim()) {
      return null;
    }
    if (!parsed.method || !LOGIN_METHODS.includes(parsed.method)) return null;
    return {
      email: parsed.email,
      method: parsed.method as LoginMethod,
      canUseGoogle: parsed.canUseGoogle === true,
    };
  } catch {
    return null;
  }
}

export function writeRememberedLogin(info: RememberedLogin): void {
  try {
    localStorage.setItem(REMEMBERED_LOGIN_KEY, JSON.stringify(info));
  } catch {
    // localStorage may be unavailable or full; remembering is best-effort.
  }
}

export function forgetRememberedLogin(): void {
  try {
    localStorage.removeItem(REMEMBERED_LOGIN_KEY);
  } catch {
    // ignore
  }
}

/** One-time cleanup of the cache this replaced. */
export function forgetLegacyLoginCache(): void {
  try {
    localStorage.removeItem(LEGACY_LOGIN_KEY);
  } catch {
    // ignore
  }
}
