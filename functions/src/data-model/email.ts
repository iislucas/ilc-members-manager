/* Email normalisation helpers shared by the Angular client and Cloud Functions.

INVARIANT: every email address that is written to Firestore (member `emails`,
`/acl/{email}` document ids, event `ownerEmails`/`managerEmails`, registration
`email`, video grant `memberEmail` and email-keyed grant ids, order customer
emails, ...) is stored in its normalised form: trimmed and lower-cased. Code
that compares an email against stored data must normalise the other side with
`normalizeEmail()` too (and Firestore/Storage rules compare against
`request.auth.token.email.lower()`).

This module is intentionally dependency-free so it can be imported from both
`src/` (client) and `functions/src/` (server).
*/

// Returns the canonical (trimmed, lower-cased) form of an email address, or ''
// when the input is empty/missing. It does not validate the address.
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

// Returns the canonical form of a list of email addresses: each entry is
// normalised with `normalizeEmail()`, empty entries are dropped and duplicates
// (after normalisation) are removed, preserving first-occurrence order (so a
// member's primary email stays first).
export function normalizeEmails(
  emails: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of emails ?? []) {
    const normalized = normalizeEmail(email);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

// True when the two email addresses are equal ignoring case and surrounding
// whitespace. Two empty values are not considered equal (an empty email never
// identifies anyone).
export function emailsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeEmail(a);
  return na !== '' && na === normalizeEmail(b);
}

// True when `email` (normalised) is present in `emails` (each normalised).
export function emailListIncludes(
  emails: readonly (string | null | undefined)[] | null | undefined,
  email: string | null | undefined,
): boolean {
  const target = normalizeEmail(email);
  if (!target) return false;
  return (emails ?? []).some((e) => normalizeEmail(e) === target);
}
