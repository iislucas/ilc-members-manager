/* auth-link-return.ts
 *
 * URL construction, legacy-link upgrading, and open-redirect sanitization for
 * the minimal `/auth/complete` email sign-in & password-reset landing view.
 */

export enum EmailLinkIntent {
  SignIn = 'sign-in',
  ResetPassword = 'reset-password',
}

/** Query parameters Firebase appends to an email sign-in link's continue URL. */
export const EMAIL_LINK_QUERY_PARAMS = [
  'apiKey',
  'oobCode',
  'mode',
  'lang',
  'continueUrl',
  'tenantId',
] as const;

const INTERNAL_PARSE_ORIGIN = 'https://ilc.internal';

/**
 * Validates and normalizes an untrusted `returnTo` / `returnUrl` parameter into
 * a safe internal relative path (without leading slash, ready for
 * `RoutingService.navigateTo`), or `''` (Home) if empty, external, or pointing
 * back at `/login` or `/auth/complete`.
 */
export function sanitizeInternalReturnPath(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Reject control characters, backslashes, protocol schemes, and protocol-relative URLs.
  if (
    /[\u0000-\u001f\u007f\\]/.test(trimmed) ||
    trimmed.startsWith('//') ||
    /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
  ) {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withLeadingSlash, INTERNAL_PARSE_ORIGIN);
  } catch {
    return '';
  }

  if (parsed.origin !== INTERNAL_PARSE_ORIGIN) {
    return '';
  }

  // Strip any lingering Firebase action params from the destination URL.
  for (const param of EMAIL_LINK_QUERY_PARAMS) {
    parsed.searchParams.delete(param);
  }

  const normalizedPathname = parsed.pathname.replace(/\/+/g, '/');
  if (
    normalizedPathname === '/' ||
    normalizedPathname === '/login' ||
    normalizedPathname === '/auth/complete'
  ) {
    return '';
  }

  const relativePath = normalizedPathname.startsWith('/')
    ? normalizedPathname.substring(1)
    : normalizedPathname;
  return `${relativePath}${parsed.search}`;
}

/**
 * Builds the `/auth/complete` continue URL passed to `sendSignInLinkToEmail`.
 * Captures the current page (or `/login`'s `returnUrl`) as `returnTo` so the
 * user lands back where they started once sign-in (and optional password reset)
 * finishes.
 */
export function buildAuthCompleteActionUrl(
  currentHref: string,
  intent: EmailLinkIntent = EmailLinkIntent.SignIn,
): string {
  const current = new URL(currentHref);
  for (const param of EMAIL_LINK_QUERY_PARAMS) {
    current.searchParams.delete(param);
  }

  let returnTo = '';
  const cleanPathname = current.pathname.replace(/\/+/g, '/');
  if (cleanPathname === '/login') {
    returnTo = sanitizeInternalReturnPath(current.searchParams.get('returnUrl'));
  } else if (cleanPathname === '/auth/complete') {
    returnTo = sanitizeInternalReturnPath(current.searchParams.get('returnTo'));
  } else if (cleanPathname !== '/') {
    returnTo = sanitizeInternalReturnPath(`${cleanPathname}${current.search}`);
  }

  const actionUrl = new URL('/auth/complete', current.origin);
  if (returnTo) {
    actionUrl.searchParams.set('returnTo', `/${returnTo}`);
  }
  if (intent === EmailLinkIntent.ResetPassword) {
    actionUrl.searchParams.set('intent', EmailLinkIntent.ResetPassword);
  }
  return actionUrl.toString();
}

/**
 * Rewrites an incoming legacy email sign-in link (e.g. `/login?oobCode=...&mode=signIn`
 * or `/become-a-member?oobCode=...&mode=signIn` sent before `/auth/complete`
 * existed) onto `/auth/complete` while preserving all Firebase action query
 * parameters and recording the original path in `returnTo`.
 *
 * Returns the new relative URL (`pathname + search`) if rewritten, or `null` if
 * no rewrite applies.
 */
export function upgradeLegacyEmailLinkUrl(currentHref: string): string | null {
  let url: URL;
  try {
    url = new URL(currentHref);
  } catch {
    return null;
  }

  if (url.searchParams.get('mode') !== 'signIn' || !url.searchParams.get('oobCode')) {
    return null;
  }

  const cleanPathname = url.pathname.replace(/\/+/g, '/');
  if (cleanPathname === '/auth/complete') {
    return null;
  }

  // Extract any non-Firebase destination context before moving onto /auth/complete.
  const destCandidate = new URL(url.toString());
  for (const param of EMAIL_LINK_QUERY_PARAMS) {
    destCandidate.searchParams.delete(param);
  }

  let returnTo = '';
  if (cleanPathname === '/login') {
    returnTo = sanitizeInternalReturnPath(destCandidate.searchParams.get('returnUrl'));
  } else if (cleanPathname !== '/') {
    returnTo = sanitizeInternalReturnPath(`${cleanPathname}${destCandidate.search}`);
  }

  const upgraded = new URL('/auth/complete', url.origin);
  if (returnTo) {
    upgraded.searchParams.set('returnTo', `/${returnTo}`);
  }
  for (const param of EMAIL_LINK_QUERY_PARAMS) {
    const val = url.searchParams.get(param);
    if (val !== null) {
      upgraded.searchParams.set(param, val);
    }
  }
  return `${upgraded.pathname}${upgraded.search}`;
}
