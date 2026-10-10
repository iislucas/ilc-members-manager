/* order-change.ts
 *
 * Pure helpers for deciding whether a write to an /orders document needs any
 * downstream processing.
 *
 * Emails are stored normalised (trimmed + lower-cased; see
 * data-model/email.ts). The `normalize-emails` backfill and any future
 * normalising writes may rewrite an order's email fields (e.g.
 * `customerEmail`, `billingAddress.email`) without changing anything else.
 * Such a write must NOT re-run order processing (membership renewals, video
 * library access, fulfilment, ...), so the order trigger skips it.
 */

import { normalizeEmail } from '../data-model/email';

// Recursively canonicalises a Firestore document value so that two documents
// that differ only in the case/whitespace of email-like strings compare equal.
// Strings containing '@' are normalised with normalizeEmail(); object keys are
// sorted so the comparison does not depend on key order.
function canonicalize(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.includes('@') ? normalizeEmail(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return value;
}

// True when `before` and `after` both exist, differ, and the ONLY differences
// are in the case/surrounding whitespace of email strings. Identical rewrites
// (nothing changed) return false so they keep their previous behaviour, and
// creates/deletes are never "email-case only" changes.
export function isEmailCaseOnlyChange(
  before: object | undefined,
  after: object | undefined,
): boolean {
  if (!before || !after) return false;
  const rawBefore = JSON.stringify(canonicalizeKeys(before));
  const rawAfter = JSON.stringify(canonicalizeKeys(after));
  if (rawBefore === rawAfter) return false;
  return JSON.stringify(canonicalize(before)) === JSON.stringify(canonicalize(after));
}

// Like canonicalize() but only sorts object keys (no email normalisation), to
// detect whether a write changed anything at all.
function canonicalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalizeKeys(obj[key]);
    }
    return out;
  }
  return value;
}
