/*
Instructor / Group Leader License Processing (SKU: LIS-YEAR-GL)

Handles parsing and processing annual instructor and group leader
license renewals.
*/

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member, InstructorLicenseType, SquareSpaceOrder, SquareSpaceLineItem, SquareSpaceCustomization } from '../data-model';
import { computeRenewalAndExpiration, SubscriptionResult } from './common';
import { inferMemberIdFromOrder } from './infer-member';

export interface InstructorLicenseInfo {
  memberId: string;
  email: string;
  orderDate: string; // YYYY-MM-DD, from order createdOn
}

// Parse instructor / group leader license info from a line item's
// customization fields. Pure function for easy testing.
export function parseInstructorLicenseInfo(
  orderData: SquareSpaceOrder,
  lineItem: SquareSpaceLineItem
): InstructorLicenseInfo {
  const customizations: SquareSpaceCustomization[] = lineItem.customizations || [];

  let memberId = '';
  let email = '';

  for (const field of customizations) {
    if (!field.label || !field.value) continue;
    const labelLower = field.label.toLowerCase();

    if (labelLower.includes('member id')) {
      memberId = field.value.trim();
    } else if (labelLower.includes('email')) {
      email = field.value.trim();
    }
  }

  if (!email) {
    email = orderData.customerEmail || '';
  }

  const orderDate = orderData.createdOn
    ? orderData.createdOn.substring(0, 10)
    : new Date().toISOString().substring(0, 10);

  return { memberId, email, orderDate };
}

// Process an instructor / group leader license renewal line item:
// find the member by memberId, validate, update instructorLicenseRenewalDate
// and instructorLicenseExpires.
export async function processInstructorLicense(
  orderData: SquareSpaceOrder,
  orderId: string,
  lineItem: SquareSpaceLineItem,
  db: admin.firestore.Firestore
): Promise<SubscriptionResult> {
  const info = parseInstructorLicenseInfo(orderData, lineItem);

  // If the admin manually set ilcAppMemberIdInferred on the line item, it
  // overrides whatever member ID the user may have entered in the form.
  // Otherwise, if the form member ID is missing, attempt automatic inference.
  let skipValidation = false;
  if (lineItem.ilcAppMemberIdInferred) {
    logger.info(`[License] Order ${orderId}: using admin-set ilcAppMemberIdInferred "${lineItem.ilcAppMemberIdInferred}"` +
      (info.memberId ? ` (overriding form-provided "${info.memberId}")` : ''));
    info.memberId = lineItem.ilcAppMemberIdInferred;
    skipValidation = true;
  } else if (!info.memberId) {
    const inference = await inferMemberIdFromOrder(
      orderData,
      { memberId: '', email: info.email, name: '', dateOfBirth: '', country: '', isNewMember: undefined },
      db,
      lineItem
    );
    if (inference.memberId) {
      logger.info(`[License] Order ${orderId}: inferred member ID "${inference.memberId}" — ${inference.reason}`);
      info.memberId = inference.memberId;
    } else {
      const issue = `[License] Order ${orderId} is missing a Member ID in the form response `
        + `and automatic inference failed: ${inference.reason}`;
      logger.warn(issue);
      return { kind: 'error', message: issue };
    }
  }

  // Look up the member by memberId
  logger.info(`[License] Looking for member with ID: ${info.memberId} for order ${orderId}`);
  const memberQuery = await db.collection('members')
    .where('memberId', '==', info.memberId)
    .limit(1)
    .get();

  if (memberQuery.empty) {
    const issue = `[License] Member ID ${info.memberId} not found in database for order ${orderId}.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  const memberDocRef = memberQuery.docs[0].ref;
  const memberData = memberQuery.docs[0].data() as Partial<Member>;

  // Validate email — skip when member ID was manually set by an admin.
  if (!skipValidation && info.email) {
    const memberEmails = (memberData.emails || []).map(e => e.toLowerCase());
    const providedEmailLower = info.email.toLowerCase();
    if (!memberEmails.includes(providedEmailLower)) {
      const issue = `[License] Order ${orderId}: email mismatch for member ${info.memberId}: `
        + `order provided "${info.email}" but member has emails [${memberData.emails?.join(', ')}]`;
      logger.warn(issue);
      return { kind: 'error', message: issue };
    }
  }

  // Compute the actual renewal and expiration dates
  const { renewalDate, expirationDate } = computeRenewalAndExpiration(
    memberData.instructorLicenseExpires || '',
    info.orderDate
  );

  // Idempotency: check if the member already has a license expiring at or after new expiration
  if (memberData.instructorLicenseExpires && memberData.instructorLicenseExpires >= expirationDate) {
    const issue = `[License] Member ${info.memberId} already has instructor license expiring on `
      + `${memberData.instructorLicenseExpires}, which is at or after the new expiration ${expirationDate}. `
      + `This may be a duplicate renewal. No update made.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  logger.info(`[License] Updating member ${info.memberId} (doc ${memberDocRef.id}): `
    + `instructorLicenseRenewalDate=${renewalDate}, instructorLicenseExpires=${expirationDate}`);

  await memberDocRef.update({
    instructorLicenseRenewalDate: renewalDate,
    instructorLicenseExpires: expirationDate,
    instructorLicenseType: InstructorLicenseType.Annual,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return { kind: 'success', renewalDate, expirationDate };
}
