/*
Annual Membership Renewal Processing (SKU: MEM-YEAR-*)

Handles parsing membership renewal info, processing renewals for
existing members, and registering brand-new members.
*/

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member, MembershipType, initMember, SquareSpaceOrder, SquareSpaceLineItem, SquareSpaceCustomization } from '../data-model';
import { resolveCountryCode, resolveCountryName } from '../country-codes';
import { assignNextMemberId } from '../counters';
import { MembershipPurchaseInfo, parseMembershipPurchaseInfo, computeRenewalAndExpiration, SubscriptionResult } from './common';
import { inferMemberIdFromOrder } from './infer-member';
import { snapshotPreOrderDates } from './snapshot-pre-order-dates';

export interface MembershipRenewalInfo {
  member: MembershipPurchaseInfo;
  renewalDate: string; // YYYY-MM-DD, from order createdOn
  expirationDate: string; // YYYY-MM-DD, renewalDate + 1 year
}

// Parse membership renewal info from a line item's customization fields.
// This is a pure function (no side effects) for easy testing.
export function parseMembershipRenewalInfo(
  orderData: SquareSpaceOrder,
  lineItem: SquareSpaceLineItem
): MembershipRenewalInfo {
  const customizations: SquareSpaceCustomization[] = lineItem.customizations || [];

  const member = parseMembershipPurchaseInfo(customizations, orderData, '');

  if (lineItem.ilcAppCountryOverride) {
    // The override is expected to be a country name from our approved list.
    // For backward compatibility, also accept a country code and resolve it.
    member.country = resolveCountryName(lineItem.ilcAppCountryOverride);
  }

  // Compute renewal and expiration dates from order creation date.
  // Memberships are annual; expiration is exactly 1 year from the renewal date.
  const renewalDate = orderData.createdOn
    ? orderData.createdOn.substring(0, 10)
    : new Date().toISOString().substring(0, 10);

  const renewalDateObj = new Date(renewalDate + 'T00:00:00Z');
  renewalDateObj.setUTCFullYear(renewalDateObj.getUTCFullYear() + 1);
  const expirationDate = renewalDateObj.toISOString().substring(0, 10);

  return {
    member,
    renewalDate,
    expirationDate,
  };
}

// Process a membership renewal line item: find the member, validate,
// update lastRenewalDate and currentMembershipExpires.
export async function processMembershipRenewal(
  orderData: SquareSpaceOrder,
  orderId: string,
  lineItem: SquareSpaceLineItem,
  db: admin.firestore.Firestore
): Promise<SubscriptionResult> {
  const info = parseMembershipRenewalInfo(orderData, lineItem);

  if (info.member.isNewMember) {
    return await processNewMemberRegistration(orderData, orderId, info, db);
  }

  // If the admin manually set ilcAppMemberIdInferred on the line item, it
  // overrides whatever member ID the user may have entered in the form.
  // Otherwise, if the form member ID is missing, attempt automatic inference.
  let skipValidation = false;
  if (lineItem.ilcAppMemberIdInferred) {
    logger.info(`[Membership] Order ${orderId}: using admin-set ilcAppMemberIdInferred "${lineItem.ilcAppMemberIdInferred}"` +
      (info.member.memberId ? ` (overriding form-provided "${info.member.memberId}")` : ''));
    info.member.memberId = lineItem.ilcAppMemberIdInferred;
    skipValidation = true;
  } else if (!info.member.memberId) {
    const inference = await inferMemberIdFromOrder(orderData, info.member, db, lineItem);
    if (inference.memberId) {
      logger.info(`[Membership] Order ${orderId}: inferred member ID "${inference.memberId}" — ${inference.reason}`);
      info.member.memberId = inference.memberId;
    } else {
      const issue = `[Membership] Order ${orderId} is missing a Member ID in the form response `
        + `and automatic inference failed: ${inference.reason}`;
      logger.warn(issue);
      return { kind: 'error', message: issue };
    }
  }

  // Look up the member by memberId
  logger.info(`[Membership] Looking for member with ID: ${info.member.memberId} for order ${orderId}`);
  const memberQuery = await db.collection('members')
    .where('memberId', '==', info.member.memberId)
    .limit(1)
    .get();

  // TODO: set limit to 2 and add a check for multiple members, fail is we find multiple members.

  if (memberQuery.empty) {
    const issue = `[Membership] Member ID ${info.member.memberId} not found in database for order ${orderId}.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  const memberDocRef = memberQuery.docs[0].ref;
  const memberData = memberQuery.docs[0].data() as Partial<Member>;

  // Validate that the member matches the order details.
  // Skip validation when the member ID was manually set by an admin
  // (via ilcAppMemberIdInferred) since the admin has already verified the match.
  if (!skipValidation) {
    const validationIssues: string[] = [];

    if (info.member.email) {
      const memberEmails = (memberData.emails || []).map(e => e.toLowerCase());
      const providedEmailLower = info.member.email.toLowerCase();
      if (!memberEmails.includes(providedEmailLower)) {
        validationIssues.push(
          `Email mismatch: order provided "${info.member.email}" but member ${info.member.memberId} has emails [${memberData.emails?.join(', ')}]`
        );
      }
    }

    if (info.member.name) {
      const memberNameLower = (memberData.name || '').toLowerCase().trim();
      const providedNameLower = info.member.name.toLowerCase().trim();
      if (memberNameLower !== providedNameLower) {
        validationIssues.push(
          `Name mismatch: order provided "${info.member.name}" but member ${info.member.memberId} has name "${memberData.name}"`
        );
      }
    }

    if (validationIssues.length > 0) {
      const issue = `[Membership] Order ${orderId} validation issues for member ${info.member.memberId}: `
        + validationIssues.join('; ');
      logger.warn(issue);
      return { kind: 'error', message: issue };
    }
  }

  // Snapshot the member's current dates before we change them (write-once).
  snapshotPreOrderDates(lineItem,
    memberData.lastRenewalDate || '',
    memberData.currentMembershipExpires || '');

  // Compute the actual renewal and expiration dates considering the
  // member's current expiration (so early renewals extend from expiry).
  const { renewalDate, expirationDate } = computeRenewalAndExpiration(
    memberData.currentMembershipExpires || '',
    info.renewalDate
  );

  // Update the member's renewal date and expiration
  logger.info(`[Membership] Updating member ${info.member.memberId} (doc ${memberDocRef.id}): `
    + `lastRenewalDate=${renewalDate}, currentMembershipExpires=${expirationDate}`);

  await memberDocRef.update({
    lastRenewalDate: renewalDate,
    currentMembershipExpires: expirationDate,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return { kind: 'success', renewalDate, expirationDate };
}

// Create a new member document when a membership order is for a new member.
// Uses initMember() as the base and populates fields from the order form.
// Auto-assigns a member ID based on the country code.
async function processNewMemberRegistration(
  orderData: SquareSpaceOrder,
  orderId: string,
  info: MembershipRenewalInfo,
  db: admin.firestore.Firestore
): Promise<SubscriptionResult> {
  const pInfo = info.member;

  if (!pInfo.name) {
    const issue = `[Membership] Order ${orderId} is for a new member but name is missing. Cannot register.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  if (!pInfo.country) {
    const issue = `[Membership] Order ${orderId} is for a new member but country is missing. Cannot register.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  const countryCode = resolveCountryCode(pInfo.country);
  if (!countryCode) {
    const issue = `[Membership] Order ${orderId} is for a new member but country "${pInfo.country}" could not be resolved to a country code. Please register manually.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  let newMemberId: string;
  try {
    newMemberId = await assignNextMemberId(countryCode, db);
  } catch (e) {
    const issue = `[Membership] Failed to assign ID for new member in country ${countryCode} for order ${orderId}: ${e}`;
    logger.error(issue);
    return { kind: 'error', message: issue };
  }

  const newMember: Member = {
    ...initMember(),
    memberId: newMemberId,
    name: pInfo.name,
    country: pInfo.country,
    emails: pInfo.email ? [pInfo.email] : [],
    dateOfBirth: pInfo.dateOfBirth,
    membershipType: MembershipType.Annual,
    firstMembershipStarted: info.renewalDate,
    lastRenewalDate: info.renewalDate,
    currentMembershipExpires: info.expirationDate,
  };

  const docRef = db.collection('members').doc();
  newMember.docId = docRef.id;

  logger.info(`[Membership] Creating new member ${newMemberId} (doc ${docRef.id}) for order ${orderId}: name=${pInfo.name}`);

  await docRef.set({
    ...newMember,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return { kind: 'success', renewalDate: info.renewalDate, expirationDate: info.expirationDate };
}
