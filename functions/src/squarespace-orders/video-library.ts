/*
Video Library Access Processing (SKU: VID-LIBRARY)

Grants classVideoLibrarySubscription to members based on order
custom forms or user email.
*/

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member, SquareSpaceOrder, SquareSpaceLineItem, SquareSpaceCustomization } from '../data-model';
import { computeRenewalAndExpiration, SubscriptionResult } from './common';
import { inferMemberIdFromOrder } from './infer-member';
import { snapshotPreOrderDates } from './snapshot-pre-order-dates';

// Grant video library access to a member based on order data.
export async function processVideoLibraryAccess(
  orderData: SquareSpaceOrder, orderId: string,
  videoItem: SquareSpaceLineItem, db: admin.firestore.Firestore
): Promise<SubscriptionResult> {
  let email = orderData.customerEmail;
  let providedMemberId = '';
  let providedEmail = '';

  const customizations: SquareSpaceCustomization[] = videoItem.customizations || [];
  for (const field of customizations) {
    if (!field.label || !field.value) continue;
    const labelLower = field.label.toLowerCase();

    if (labelLower.includes('email')) {
      providedEmail = field.value.trim();
    } else if (labelLower.includes('member id')) {
      providedMemberId = field.value.trim();
    }
  }

  // Use provided email from form if available
  if (providedEmail) {
    email = providedEmail;
  }

  // If the admin manually set ilcAppMemberIdInferred on the line item, it
  // overrides whatever member ID the user may have entered in the form.
  if (videoItem.ilcAppMemberIdInferred) {
    logger.info(`[Video Library] Order ${orderId}: using admin-set ilcAppMemberIdInferred "${videoItem.ilcAppMemberIdInferred}"` +
      (providedMemberId ? ` (overriding form-provided "${providedMemberId}")` : ''));
    providedMemberId = videoItem.ilcAppMemberIdInferred;
  }

  // If still no member ID, try automatic inference by email + DOB.
  if (!providedMemberId) {
    const inference = await inferMemberIdFromOrder(
      orderData,
      { memberId: '', email, name: '', dateOfBirth: '', country: '', isNewMember: undefined },
      db,
      videoItem
    );
    if (inference.memberId) {
      logger.info(`[Video Library] Order ${orderId}: inferred member ID "${inference.memberId}" — ${inference.reason}`);
      providedMemberId = inference.memberId;
    }
  }

  let memberDocRef: admin.firestore.DocumentReference | null = null;
  let memberData: Partial<Member> | null = null;

  // Try finding by Member ID first
  if (providedMemberId) {
    logger.info(`[Video Library] Looking for member with ID: ${providedMemberId} for order ${orderId}`);
    const memberIdQuery = await db.collection('members')
      .where('memberId', '==', providedMemberId)
      .limit(1)
      .get();
    if (!memberIdQuery.empty) {
      memberDocRef = memberIdQuery.docs[0].ref;
      memberData = memberIdQuery.docs[0].data() as Partial<Member>;
    } else {
      logger.warn(`[Video Library] Member ID ${providedMemberId} not found in database. Falling back to email.`);
    }
  }

  if (!memberDocRef) {
    const issue = `[Video Library] Could not find a member document for order ${orderId} (Member ID: ${providedMemberId}, Email: ${email}) to grant video library access.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  // Snapshot the member's current dates before we change them (write-once).
  snapshotPreOrderDates(videoItem,
    memberData?.classVideoLibraryLastRenewalDate || '',
    memberData?.classVideoLibraryExpirationDate || '');

  // Compute renewal and expiration dates.
  // Video library subscriptions are monthly: each purchase adds 1 month.
  // If the member already has a subscription with a future expiration,
  // extend from that date rather than from the purchase date.
  const purchaseDate = orderData.createdOn
    ? orderData.createdOn.substring(0, 10)
    : new Date().toISOString().substring(0, 10);

  const { renewalDate, expirationDate } = computeRenewalAndExpiration(
    memberData?.classVideoLibraryExpirationDate || '',
    purchaseDate,
    1 // monthly
  );

  logger.info(`[Video Library] Granting video library subscription to member ${memberDocRef.id} based on order ${orderId}, `
    + `renewing from ${renewalDate}, expires ${expirationDate}.`);
  await memberDocRef.update({
    classVideoLibrarySubscription: true,
    classVideoLibraryLastRenewalDate: renewalDate,
    classVideoLibraryExpirationDate: expirationDate,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return { kind: 'success', renewalDate, expirationDate };
}
