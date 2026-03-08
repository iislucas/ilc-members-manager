/*
Video Library Access Processing (SKU: VID-LIBRARY)

Grants classVideoLibrarySubscription to members based on order
custom forms or user email.
*/

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member, SquareSpaceOrder, SquareSpaceLineItem, SquareSpaceCustomization } from '../data-model';
import { SubscriptionResult } from './common';
import { inferMemberIdFromOrder } from './infer-member';

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

  // Compute expiration date: 1 month from order creation date.
  // Video library subscriptions are monthly.
  const purchaseDate = orderData.createdOn
    ? orderData.createdOn.substring(0, 10)
    : new Date().toISOString().substring(0, 10);
  const expirationDateObj = new Date(purchaseDate + 'T00:00:00Z');
  expirationDateObj.setUTCMonth(expirationDateObj.getUTCMonth() + 1);
  const expirationDate = expirationDateObj.toISOString().substring(0, 10);

  // Idempotency: skip if the member already has a subscription expiring at or after
  // this new expiration (indicates a duplicate or already-processed order).
  if (memberData && memberData.classVideoLibrarySubscription === true
    && memberData.classVideoLibraryExpirationDate
    && memberData.classVideoLibraryExpirationDate >= expirationDate) {
    const issue = `[Video Library] Member ${memberDocRef.id} already has video library subscription `
      + `expiring ${memberData.classVideoLibraryExpirationDate}, which is at or after ${expirationDate}. No action needed.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  logger.info(`[Video Library] Granting video library subscription to member ${memberDocRef.id} based on order ${orderId}, `
    + `expires ${expirationDate}.`);
  await memberDocRef.update({
    classVideoLibrarySubscription: true,
    classVideoLibraryExpirationDate: expirationDate,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return { kind: 'success', renewalDate: purchaseDate, expirationDate };
}
