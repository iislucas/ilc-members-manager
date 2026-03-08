/*
School License Processing (SKU: LIS-SCH-YRL, LIS-SCH-MTH)

Handles parsing and processing school license renewals.
  LIS-SCH-YRL  annual  → extends license by 12 months
  LIS-SCH-MTH  monthly → extends license by 1 month
*/

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { School, SquareSpaceOrder, SquareSpaceLineItem, SquareSpaceCustomization } from '../data-model';
import { computeRenewalAndExpiration, SubscriptionResult } from './common';

export interface SchoolLicenseInfo {
  schoolId: string;
  email: string;
  memberId: string;
  orderDate: string; // YYYY-MM-DD, from order createdOn
}

// Parse school license info from a line item's customization fields.
// Pure function for easy testing.
export function parseSchoolLicenseInfo(
  orderData: SquareSpaceOrder,
  lineItem: SquareSpaceLineItem
): SchoolLicenseInfo {
  const customizations: SquareSpaceCustomization[] = lineItem.customizations || [];

  let schoolId = '';
  let email = '';
  let memberId = '';

  for (const field of customizations) {
    if (!field.label || !field.value) continue;
    const labelLower = field.label.toLowerCase();

    if (labelLower.includes('school id')) {
      schoolId = field.value.trim();
    } else if (labelLower.includes('member id') || labelLower === 'memberid') {
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

  return { schoolId, email, memberId, orderDate };
}

// Process a school license renewal:
// find the school by schoolId, validate, update schoolLicenseRenewalDate
// and schoolLicenseExpires.
//
// renewalMonths: how many months to extend the license by (12 = annual,
// 1 = monthly).
export async function processSchoolLicense(
  orderId: string,
  info: SchoolLicenseInfo,
  renewalMonths: number,
  db: admin.firestore.Firestore
): Promise<SubscriptionResult> {
  if (!info.schoolId) {
    const issue = `[School License] Order ${orderId} is missing a School ID in the form response `
      + `Cannot process school license renewal without a School ID.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  // Look up the school by schoolId
  logger.info(`[School License] Looking for school with ID: ${info.schoolId} for order ${orderId}`);
  const schoolQuery = await db.collection('schools')
    .where('schoolId', '==', info.schoolId)
    .limit(1)
    .get();

  if (schoolQuery.empty) {
    const issue = `[School License] School ID ${info.schoolId} not found in database for order ${orderId}.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  const schoolDocRef = schoolQuery.docs[0].ref;
  const schoolData = schoolQuery.docs[0].data() as Partial<School>;

  // Compute the actual renewal and expiration dates
  const { renewalDate, expirationDate } = computeRenewalAndExpiration(
    schoolData.schoolLicenseExpires || '',
    info.orderDate,
    renewalMonths
  );

  // Idempotency: check if the school already has a license expiring at or after new expiration
  if (schoolData.schoolLicenseExpires && schoolData.schoolLicenseExpires >= expirationDate) {
    const issue = `[School License] School ${info.schoolId} already has school license expiring on `
      + `${schoolData.schoolLicenseExpires}, which is at or after the new expiration ${expirationDate}. `
      + `This may be a duplicate renewal. No update made.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  logger.info(`[School License] Updating school ${info.schoolId} (doc ${schoolDocRef.id}): `
    + `schoolLicenseRenewalDate=${renewalDate}, schoolLicenseExpires=${expirationDate}`);

  await schoolDocRef.update({
    schoolLicenseRenewalDate: renewalDate,
    schoolLicenseExpires: expirationDate,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return { kind: 'success', renewalDate, expirationDate };
}
