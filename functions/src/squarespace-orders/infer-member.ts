/*
Member ID Inference by Email and Date of Birth.

When a Squarespace order is missing a member ID (a common user error), this
module attempts to infer the correct member by:
  1. Looking up all members whose `emails` array contains the order email.
  2. If exactly one member is found AND the date of birth matches, we infer
     that this must be the correct member.

This module also supports a manually set `ilcAppMemberIdInferred` field on the
order document, which takes priority over automatic inference. Admins can
set this field via the order view UI after doing a manual lookup.

Exports:
  - inferMemberIdFromOrder    Attempts to determine the member ID for an order.
  - lookupMembersByEmail      Finds all members matching a given email address.
*/

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member, SquareSpaceOrder, SquareSpaceLineItem } from '../data-model';
import { MembershipPurchaseInfo } from './common';

/**
 * Normalize a date-of-birth string into YYYY-MM-DD for comparison.
 *
 * Squarespace forms often produce dates like "11/23/1979" (MM/DD/YYYY)
 * while the database stores "1979-11-23" (YYYY-MM-DD). We try both
 * formats.
 */
export function normalizeDateOfBirth(dob: string): string {
  if (!dob) return '';
  const trimmed = dob.trim();

  // Already in YYYY-MM-DD format?
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Try MM/DD/YYYY or M/D/YYYY
  const slashParts = trimmed.split('/');
  if (slashParts.length === 3) {
    const [month, day, year] = slashParts;
    if (year && month && day) {
      return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Try DD-MM-YYYY or DD.MM.YYYY
  const dashParts = trimmed.split(/[-.]/).filter(Boolean);
  if (dashParts.length === 3 && dashParts[2].length === 4) {
    const [day, month, year] = dashParts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Can't parse — return as-is
  return trimmed;
}

/**
 * Lookup all members whose `emails` array contains the given address.
 * Returns an array of matching members (as partial Member objects).
 */
export async function lookupMembersByEmail(
  email: string,
  db: admin.firestore.Firestore
): Promise<{ memberId: string; name: string; dateOfBirth: string; docId: string; emails: string[] }[]> {
  if (!email) return [];

  const emailLower = email.toLowerCase().trim();
  const memberQuery = await db.collection('members')
    .where('emails', 'array-contains', emailLower)
    .get();

  return memberQuery.docs.map(doc => {
    const data = doc.data() as Partial<Member>;
    return {
      memberId: data.memberId || '',
      name: data.name || '',
      dateOfBirth: data.dateOfBirth || '',
      docId: doc.id,
      emails: data.emails || [],
    };
  });
}

/**
 * Attempt to infer the member ID for a line item that is missing one.
 *
 * Priority:
 *   1. If `ilcAppMemberIdInferred` is set on the line item, use that directly.
 *   2. Look up members by email; if exactly one match is found, check DOB.
 *      If DOB also matches, return that member's ID.
 *
 * Returns the inferred memberId string, or '' if inference failed.
 * Also returns a human-readable `reason` string for logging.
 */
export async function inferMemberIdFromOrder(
  orderData: SquareSpaceOrder,
  purchaseInfo: MembershipPurchaseInfo,
  db: admin.firestore.Firestore,
  lineItem?: SquareSpaceLineItem
): Promise<{ memberId: string; reason: string; isManual: boolean }> {
  // Priority 1: manually set inferred member ID on the line item
  const manualId = lineItem?.ilcAppMemberIdInferred;
  if (manualId) {
    logger.info(`[InferMember] Using manually set ilcAppMemberIdInferred: ${manualId}`);
    return { memberId: manualId, reason: `Manually set ilcAppMemberIdInferred: ${manualId}`, isManual: true };
  }

  // Priority 2: automatic inference by email + DOB
  const email = purchaseInfo.email;
  if (!email) {
    return { memberId: '', reason: 'No email available for inference.', isManual: false };
  }

  const matches = await lookupMembersByEmail(email, db);

  if (matches.length === 0) {
    return { memberId: '', reason: `No members found with email "${email}".`, isManual: false };
  }

  if (matches.length > 1) {
    const ids = matches.map(m => m.memberId).join(', ');
    return {
      memberId: '',
      reason: `Multiple members found with email "${email}" (${ids}). Cannot auto-infer.`,
      isManual: false,
    };
  }

  // Exactly one member found — validate DOB if both sides provide one.
  const match = matches[0];

  const normalizedOrderDob = purchaseInfo.dateOfBirth ? normalizeDateOfBirth(purchaseInfo.dateOfBirth) : '';
  const normalizedMemberDob = match.dateOfBirth ? normalizeDateOfBirth(match.dateOfBirth) : '';

  // If both DOBs are present, they must match.
  if (normalizedOrderDob && normalizedMemberDob && normalizedOrderDob !== normalizedMemberDob) {
    return {
      memberId: '',
      reason: `One member found (${match.memberId}) with email "${email}", but date of birth does not match: `
        + `order="${purchaseInfo.dateOfBirth}" (→${normalizedOrderDob}), member="${match.dateOfBirth}" (→${normalizedMemberDob}).`,
      isManual: false,
    };
  }

  // Accept the match: either DOBs match, or one/both sides lack a DOB.
  const dobDetail = normalizedOrderDob && normalizedMemberDob
    ? 'DOB matches'
    : !normalizedOrderDob && !normalizedMemberDob
      ? 'no DOB available on either side'
      : !normalizedOrderDob
        ? 'order has no DOB (skipped DOB check)'
        : 'member has no DOB on file (skipped DOB check)';
  logger.info(`[InferMember] Auto-inferred member ID ${match.memberId} for email "${email}" — email unique, ${dobDetail}.`);
  return {
    memberId: match.memberId,
    reason: `Auto-inferred: email "${email}" is unique (${dobDetail}) → member ${match.memberId}.`,
    isManual: false,
  };
}
