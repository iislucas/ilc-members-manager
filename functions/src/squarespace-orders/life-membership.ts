/*
Life Membership Processing (SKU: MEM-LIFE-*)

Handles life memberships for a single member or member + spouse.
Uses the shared MembershipPurchaseInfo to represent each person.
*/

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member, MembershipType, initMember, SquareSpaceOrder, SquareSpaceLineItem, SquareSpaceCustomization } from '../data-model';
import { resolveCountryCode, resolveCountryName } from '../country-codes';
import { assignNextMemberId } from '../counters';
import { MembershipPurchaseInfo, parseMembershipPurchaseInfo, SubscriptionResult } from './common';
import { inferMemberIdFromOrder } from './infer-member';

export interface LifeMembershipInfo {
  member: MembershipPurchaseInfo;
  spouse?: MembershipPurchaseInfo;
  hasSpouse: boolean;
  orderDate: string;
}

export function parseLifeMembershipInfo(
  orderData: SquareSpaceOrder,
  lineItem: SquareSpaceLineItem
): LifeMembershipInfo {
  const customizations: SquareSpaceCustomization[] = lineItem.customizations || [];

  const member = parseMembershipPurchaseInfo(customizations, orderData, '');
  const spouse = parseMembershipPurchaseInfo(customizations, orderData, 'Spouse');

  // Apply country override if set by admin.
  if (lineItem.ilcAppCountryOverride) {
    const resolvedCountry = resolveCountryName(lineItem.ilcAppCountryOverride);
    member.country = resolvedCountry;
    if (spouse.name || spouse.memberId) {
      spouse.country = resolvedCountry;
    }
  }

  const hasSpouse = !!spouse.name || !!spouse.memberId;

  const orderDate = orderData.createdOn
    ? orderData.createdOn.substring(0, 10)
    : new Date().toISOString().substring(0, 10);

  return { member, spouse: hasSpouse ? spouse : undefined, hasSpouse, orderDate };
}

// Create a new Life member document from scratch.
export async function processNewLifeMember(
  orderId: string,
  orderDate: string,
  pInfo: MembershipPurchaseInfo,
  label: 'Member' | 'Spouse',
  db: admin.firestore.Firestore
): Promise<SubscriptionResult> {
  if (!pInfo.name) {
    const issue = `[Life Membership] Order ${orderId} is missing ${label} Name. Cannot process new ${label.toLowerCase()}.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  // Check for name collision
  const nameQuery = await db.collection('members').where('name', '==', pInfo.name).limit(1).get();
  if (!nameQuery.empty) {
    const issue = `[Life Membership] Order ${orderId} is for a new ${label.toLowerCase()} but member with name "${pInfo.name}" already exists. Please process manually.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  if (!pInfo.country) {
    const issue = `[Life Membership] Order ${orderId} is for a new ${label.toLowerCase()} but no country was specified. Cannot process.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  const countryCode = resolveCountryCode(pInfo.country);
  if (!countryCode) {
    const issue = `[Life Membership] Order ${orderId} is for a new ${label.toLowerCase()} but country "${pInfo.country}" could not be resolved to a country code. Please process manually.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  let newMemberId: string;
  try {
    newMemberId = await assignNextMemberId(countryCode, db);
  } catch (e) {
    const issue = `[Life Membership] Order ${orderId}: failed to assign ID for ${label.toLowerCase()} in country ${countryCode}: ${e}`;
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
    membershipType: MembershipType.Life,
    firstMembershipStarted: orderDate,
    lastRenewalDate: orderDate,
    currentMembershipExpires: '9999-12-31',
  };

  const docRef = db.collection('members').doc();
  newMember.docId = docRef.id;

  logger.info(`[Life Membership] Creating new ${label.toLowerCase()} ${newMemberId} (doc ${docRef.id}) for order ${orderId}: name=${pInfo.name}`);

  await docRef.set({
    ...newMember,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return { kind: 'success', renewalDate: orderDate, expirationDate: '9999-12-31' };
}

// Upgrade an existing member to Life membership.
export async function processLifeUpgradeForExistingMember(
  orderId: string,
  orderDate: string,
  pInfo: MembershipPurchaseInfo,
  label: 'Member' | 'Spouse',
  db: admin.firestore.Firestore
): Promise<SubscriptionResult> {
  logger.info(`[Life Membership] Looking for ${label.toLowerCase()} with ID: ${pInfo.memberId} for order ${orderId}`);
  const memberQuery = await db.collection('members')
    .where('memberId', '==', pInfo.memberId)
    .limit(1)
    .get();

  if (memberQuery.empty) {
    const issue = `[Life Membership] ${label} ID ${pInfo.memberId} not found in database for order ${orderId}.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  const memberDocRef = memberQuery.docs[0].ref;
  const memberData = memberQuery.docs[0].data() as Partial<Member>;

  const validationIssues: string[] = [];

  if (pInfo.email) {
    const memberEmails = (memberData.emails || []).map(e => e.toLowerCase());
    if (!memberEmails.includes(pInfo.email.toLowerCase())) {
      validationIssues.push(`Email mismatch for ${label.toLowerCase()}: order provided "${pInfo.email}" but member ${pInfo.memberId} has emails [${memberData.emails?.join(', ')}]`);
    }
  }

  if (pInfo.name) {
    const memberNameLower = (memberData.name || '').toLowerCase().trim();
    if (memberNameLower !== pInfo.name.toLowerCase().trim()) {
      validationIssues.push(`Name mismatch for ${label.toLowerCase()}: order provided "${pInfo.name}" but member ${pInfo.memberId} has name "${memberData.name}"`);
    }
  }

  if (validationIssues.length > 0) {
    const issue = `[Life Membership] Order ${orderId} validation issues for ${label.toLowerCase()} ${pInfo.memberId}: ` + validationIssues.join('; ');
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  if (memberData.currentMembershipExpires === '9999-12-31' && memberData.membershipType === MembershipType.Life) {
    const issue = `[Life Membership] ${label} ${pInfo.memberId} already has a Life membership. This may be a duplicate renewal. No update made.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  logger.info(`[Life Membership] Updating ${label.toLowerCase()} ${pInfo.memberId} (doc ${memberDocRef.id}) to Life Membership`);

  await memberDocRef.update({
    membershipType: MembershipType.Life,
    lastRenewalDate: orderDate,
    currentMembershipExpires: '9999-12-31',
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return { kind: 'success', renewalDate: orderDate, expirationDate: '9999-12-31' };
}

// Validate a single person's info and delegate to the appropriate handler.
export async function processLifeMembershipPerson(
  orderId: string,
  orderDate: string,
  pInfo: MembershipPurchaseInfo,
  label: 'Member' | 'Spouse',
  db: admin.firestore.Firestore,
  orderData?: SquareSpaceOrder,
  lineItem?: SquareSpaceLineItem
): Promise<SubscriptionResult> {
  // Explicit conflicts
  if (pInfo.isNewMember && pInfo.memberId) {
    const issue = `[Life Membership] Order ${orderId} indicates ${label.toLowerCase()} is new, but a Member ID was provided.`;
    logger.warn(issue);
    return { kind: 'error', message: issue };
  }

  // If the admin manually set ilcAppMemberIdInferred on the line item, it
  // overrides whatever member ID the user may have entered in the form.
  if (!pInfo.isNewMember && lineItem?.ilcAppMemberIdInferred) {
    logger.info(`[Life Membership] Order ${orderId}: using admin-set ilcAppMemberIdInferred "${lineItem.ilcAppMemberIdInferred}" for ${label.toLowerCase()}` +
      (pInfo.memberId ? ` (overriding form-provided "${pInfo.memberId}")` : ''));
    pInfo.memberId = lineItem.ilcAppMemberIdInferred;
  }

  // If not a new member and still missing member ID, try automatic inference.
  if (!pInfo.isNewMember && !pInfo.memberId) {
    if (orderData) {
      const inference = await inferMemberIdFromOrder(orderData, pInfo, db, lineItem);
      if (inference.memberId) {
        logger.info(`[Life Membership] Order ${orderId}: inferred ${label.toLowerCase()} member ID "${inference.memberId}" — ${inference.reason}`);
        pInfo.memberId = inference.memberId;
      }
    }
    // If still no member ID after inference attempt, fail.
    if (!pInfo.memberId) {
      const issue = `[Life Membership] Order ${orderId} does not indicate ${label.toLowerCase()} is new, but no Member ID was provided.`;
      logger.warn(issue);
      return { kind: 'error', message: issue };
    }
  }

  if (pInfo.isNewMember) {
    return await processNewLifeMember(orderId, orderDate, pInfo, label, db);
  } else {
    return await processLifeUpgradeForExistingMember(orderId, orderDate, pInfo, label, db);
  }
}

// Orchestrates the processing of a life membership order line item.
// Validates each person (member and optional spouse) and delegates to
// processLifeMembershipPerson.
export async function processLifeMembership(
  orderData: SquareSpaceOrder,
  orderId: string,
  lineItem: SquareSpaceLineItem,
  db: admin.firestore.Firestore
): Promise<SubscriptionResult> {
  const info = parseLifeMembershipInfo(orderData, lineItem);

  const memberResult = await processLifeMembershipPerson(orderId, info.orderDate, info.member, 'Member', db, orderData, lineItem);
  if (memberResult.kind === 'error') return memberResult;

  if (info.hasSpouse && info.spouse) {
    const spouseResult = await processLifeMembershipPerson(orderId, info.orderDate, info.spouse, 'Spouse', db, orderData, lineItem);
    if (spouseResult.kind === 'error') return spouseResult;
  }

  return { kind: 'success', renewalDate: info.orderDate, expirationDate: '9999-12-31' };
}
