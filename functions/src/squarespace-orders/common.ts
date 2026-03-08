/*
Shared types and utility functions used by multiple Squarespace order
processing modules (membership, life-membership, instructor-license, etc.).

Exports:
  - SubscriptionResult
      Discriminated union for subscription processing outcomes.
      kind 'success' carries renewalDate + expirationDate;
      kind 'error' carries a message string.
  - GradingResult
      Discriminated union for grading order processing outcomes.
      kind 'success' carries the gradingDocId of the created document;
      kind 'error' carries a message string.
  - MembershipPurchaseInfo / parseMembershipPurchaseInfo
      A person-level structure for membership orders (member or spouse).
  - computeRenewalAndExpiration
      Date arithmetic for annual subscriptions.
*/

import { SquareSpaceOrder, SquareSpaceCustomization } from '../data-model';

// Shared error shape used by all processing result types.
export type ProcessingError = { kind: 'error'; message: string };

// Discriminated union returned by subscription processing functions
// (membership, license, video library).
export type SubscriptionResult =
  | { kind: 'success'; renewalDate: string; expirationDate: string }
  | ProcessingError;

// Discriminated union returned by grading order processing.
// Gradings are one-time purchases, not subscriptions, so the success
// shape carries the created grading document ID instead of dates.
export type GradingResult =
  | { kind: 'success'; gradingDocId: string }
  | ProcessingError;

// A single person's membership purchase details, extracted from
// Squarespace order customization fields.  Used for both the primary
// member and the spouse in life-membership orders.
export interface MembershipPurchaseInfo {
  memberId: string;
  email: string;
  name: string;
  dateOfBirth: string;
  country: string; // Raw country value from form (name or code)
  isNewMember: boolean | undefined;
}

// Parse a single person's membership purchase info from customization
// fields.  `prefix` controls which fields to match:
//   ''       → match fields that do NOT contain "spouse"
//   'Spouse' → match fields that DO contain "spouse"
export function parseMembershipPurchaseInfo(
  customizations: SquareSpaceCustomization[],
  orderData: SquareSpaceOrder,
  prefix: string
): MembershipPurchaseInfo {
  let memberId = '';
  let email = '';
  let name = '';
  let dateOfBirth = '';
  let country = '';
  let isNewMember: boolean | undefined = undefined;

  const prefixFilter = prefix ? prefix.toLowerCase() : '';

  for (const field of customizations) {
    if (!field.label || !field.value) continue;
    const labelLower = field.label.toLowerCase();

    const isSpouseField = labelLower.includes('spouse');
    if (prefixFilter === 'spouse' && !isSpouseField) continue;
    if (prefixFilter !== 'spouse' && isSpouseField) continue;

    const val = field.value.trim();

    if (labelLower.includes('member id')) {
      memberId = val;
    } else if (labelLower.includes('email')) {
      email = val;
    } else if (labelLower.includes('date of birth')) {
      dateOfBirth = val;
    } else if (labelLower.includes('country')) {
      country = val;
    } else if (labelLower.includes('name')) {
      name = val;
    } else if (labelLower.includes('new member')) {
      isNewMember = !val.toLowerCase().includes('renew');
    }
  }

  // Fallbacks
  if (!email && prefixFilter !== 'spouse') {
    email = orderData.customerEmail || '';
  }

  // Default to billing address if no country was specified at all
  if (!country && orderData.billingAddress?.country) {
    country = orderData.billingAddress.country;
  }

  return { memberId, email, name, dateOfBirth, country, isNewMember };
}

// Compute renewal and expiration dates for subscriptions.
//
// The new renewal date is the later of the current expiration date or the
// order date (so that early renewals extend from the current expiration,
// while late renewals start from the order date).
//
// The new expiration date is `months` months after the new renewal date
// (defaults to 12, i.e. 1 year).
//
// @param currentExpiration - YYYY-MM-DD of the current expiration, or empty.
// @param orderDate - YYYY-MM-DD of the order / purchase date.
// @param months - number of months to add (default 12).
// @returns { renewalDate, expirationDate } both in YYYY-MM-DD.
export function computeRenewalAndExpiration(
  currentExpiration: string,
  orderDate: string,
  months: number = 12
): { renewalDate: string; expirationDate: string } {
  // Renewal date is the later of the current expiration or the order date.
  let renewalDate = orderDate;
  if (currentExpiration && currentExpiration > orderDate) {
    renewalDate = currentExpiration;
  }
  // Expiration is `months` months after the renewal date.
  const renewalDateObj = new Date(renewalDate + 'T00:00:00Z');
  renewalDateObj.setUTCMonth(renewalDateObj.getUTCMonth() + months);
  const expirationDate = renewalDateObj.toISOString().substring(0, 10);
  return { renewalDate, expirationDate };
}
