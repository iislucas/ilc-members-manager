/**
 * Stripe Order Fulfillment and Member Subcollection Synchronization.
 *
 * Handles:
 *  1. Resolving the member associated with a Stripe event/order.
 *  2. Mirroring orders to `/members/{memberDocId}/orders/{orderDocId}`.
 *  3. Updating member subscription status, expiry dates, and nextAutoRenewDate.
 *  4. Auto-provisioning grading documents for purchased gradings.
 */

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import Stripe from 'stripe';
import {
  Member,
  MemberOrder,
  MemberOrderKind,
  MemberOrderType,
  MemberOrderPaymentStatus,
  MemberOrderFulfillmentStatus,
  OrderItemCategory,
  MembershipType,
  InstructorLicenseType,
  Grading,
  GradingStatus,
  PaymentStatus,
  firestoreDocToMember,
  initGrading,
  isGradingPaid,
  gradingProgression,
  achievedGradingLevels,
  unpaidGradingsInProgressionOrder,
  normalizeGradingLevel,
  orderDisplayNumber,
  initMember,
  initSchool,
  School,
  StripeOrder,
  StripeOrderLineItem,
  StripeCheckoutMode,
  SubscriptionItemType,
  SubscriptionStatus,
  SubscriptionInterval,
  VideoGrant,
  VideoGrantKind,
  NotificationKind,
  OrderStatus,
} from './data-model';
import { canonicalizeGradingLevel } from './level-utils';
import { assignNextMemberId, assignNextInstructorId, assignNextSchoolId } from './counters';
import { resolveCountryCode, resolveCountryName } from './country-codes';
import { createMemberNotification } from './notifications';
import { environment } from './environment/environment.js';

import { getSubscriptionCurrentPeriodEnd } from './stripe-subscriptions';

function unixSecondsToDateString(seconds: number | null | undefined): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toISOString().split('T')[0];
}

/**
 * Add N years to an existing date string (YYYY-MM-DD), ensuring that if the
 * current date has not yet passed, the extension starts from the current
 * expiry rather than resetting from the reference date (order date/today).
 */
export function extendDateByYears(
  currentDateStr: string | null | undefined,
  yearsToAdd = 1,
  referenceDateStr?: string,
): string {
  if (currentDateStr === '9999-12-31') return '9999-12-31';
  const todayStr = referenceDateStr || new Date().toISOString().split('T')[0];
  const cleanedCurrent = currentDateStr ? currentDateStr.split('T')[0].trim() : '';
  const baseDateStr =
    cleanedCurrent && cleanedCurrent >= todayStr ? cleanedCurrent : todayStr;
  const d = new Date(baseDateStr + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + (yearsToAdd || 1));
  return d.toISOString().split('T')[0];
}

/**
 * Add N months to an existing date string (YYYY-MM-DD), ensuring that if the
 * current date has not yet passed, the extension starts from the current
 * expiry rather than resetting from the reference date (order date/today).
 */
export function extendDateByMonths(
  currentDateStr: string | null | undefined,
  monthsToAdd = 1,
  referenceDateStr?: string,
): string {
  const todayStr = referenceDateStr || new Date().toISOString().split('T')[0];
  const cleanedCurrent = currentDateStr ? currentDateStr.split('T')[0].trim() : '';
  const baseDateStr =
    cleanedCurrent && cleanedCurrent >= todayStr ? cleanedCurrent : todayStr;
  const d = new Date(baseDateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + (monthsToAdd || 1));
  return d.toISOString().split('T')[0];
}

/**
 * Resolves a Member document from order metadata, customer ID, or email.
 */
export async function resolveMemberForStripeOrder(
  db: admin.firestore.Firestore,
  order: StripeOrder,
): Promise<Member | null> {
  // 1. Direct memberDocId metadata or clientReferenceId
  const memberDocId =
    order.metadata?.['memberDocId'] || order.clientReferenceId || undefined;
  if (memberDocId) {
    const doc = await db.collection('members').doc(memberDocId).get();
    if (doc.exists) {
      return firestoreDocToMember(doc);
    }
  }

  // 2. Lookup by stripeCustomerId
  if (order.stripeCustomerId) {
    const query = await db
      .collection('members')
      .where('stripeCustomerId', '==', order.stripeCustomerId)
      .limit(1)
      .get();
    if (!query.empty) {
      const doc = query.docs[0];
      return firestoreDocToMember(doc);
    }
  }

  // 3. Lookup by customerEmail in ACL / members
  const email = order.customerEmail?.toLowerCase().trim();
  if (email) {
    const aclDoc = await db.collection('acl').doc(email).get();
    if (aclDoc.exists) {
      const memberDocIds = (aclDoc.data()?.memberDocIds as string[]) || [];
      if (memberDocIds.length > 0) {
        const doc = await db.collection('members').doc(memberDocIds[0]).get();
        if (doc.exists) {
          return firestoreDocToMember(doc);
        }
      }
    }

    const membersQuery = await db
      .collection('members')
      .where('emails', 'array-contains', email)
      .limit(1)
      .get();
    if (!membersQuery.empty) {
      const doc = membersQuery.docs[0];
      return firestoreDocToMember(doc);
    }
  }

  return null;
}

/**
 * Categorize a line item based on description, product ID, or metadata.
 */
export function categorizeLineItem(
  item: StripeOrderLineItem,
  orderMetadata?: Record<string, string>,
): OrderItemCategory {
  const metaType = (orderMetadata?.['orderType'] || '').toLowerCase();
  if (metaType === 'license' || metaType === 'instructor_license') {
    return OrderItemCategory.InstructorLicense;
  }
  if (metaType === 'grading') {
    return OrderItemCategory.Grading;
  }
  if (metaType === 'membership') {
    return OrderItemCategory.Membership;
  }
  if (metaType === 'video' || metaType === 'video_library') {
    return OrderItemCategory.VideoLibrary;
  }
  if (metaType === 'school' || metaType === 'school_license') {
    return OrderItemCategory.SchoolLicense;
  }

  const desc = (item.description || '').toLowerCase();
  const prod = (item.productId ?? '').toLowerCase();

  if (
    desc.includes('video library') ||
    desc.includes('class video') ||
    desc.includes('vid-library') ||
    prod.includes('video_library')
  ) {
    return OrderItemCategory.VideoLibrary;
  }
  if (
    desc.includes('vod') ||
    desc.includes('on demand') ||
    prod.startsWith('vod_') ||
    prod.startsWith('prod_vod')
  ) {
    return OrderItemCategory.Vod;
  }
  if (
    desc.includes('grading') ||
    desc.includes('examination') ||
    prod.includes('grading')
  ) {
    return OrderItemCategory.Grading;
  }
  if (desc.includes('school') || prod.includes('school')) {
    return OrderItemCategory.SchoolLicense;
  }
  if (
    desc.includes('instructor') ||
    desc.includes('license') ||
    prod.includes('instructor') ||
    prod.includes('license')
  ) {
    return OrderItemCategory.InstructorLicense;
  }
  if (
    desc.includes('membership') ||
    desc.includes('member') ||
    prod.includes('membership')
  ) {
    return OrderItemCategory.Membership;
  }
  if (desc.includes('event') || desc.includes('workshop')) {
    return OrderItemCategory.Event;
  }
  return OrderItemCategory.Other;
}

export function categorizeSubscriptionItem(
  item: StripeOrderLineItem,
  orderMetadata?: Record<string, string>,
): SubscriptionItemType {
  const cat = categorizeLineItem(item, orderMetadata);
  if (cat === OrderItemCategory.InstructorLicense) {
    return SubscriptionItemType.InstructorLicense;
  }
  if (cat === OrderItemCategory.SchoolLicense) {
    return SubscriptionItemType.SchoolLicense;
  }
  if (cat === OrderItemCategory.VideoLibrary) {
    return SubscriptionItemType.VideoLibrary;
  }
  return SubscriptionItemType.Membership;
}

/**
 * Creates/mirrors a MemberOrder in the member's subcollection `/members/{memberDocId}/orders/{orderDocId}`.
 */
export async function mirrorOrderToMemberSubcollection(
  db: admin.firestore.Firestore,
  member: Member,
  order: StripeOrder,
  orderDocId: string,
): Promise<void> {
  const memberOrderRef = db
    .collection('members')
    .doc(member.docId)
    .collection('orders')
    .doc(orderDocId);

  const description =
    order.lineItems
      .map((item) => item.description)
      .filter(Boolean)
      .join(', ') || `Stripe ${order.stripeOrderType}`;

  const memberOrder: MemberOrder = {
    docId: orderDocId,
    orderDocId: orderDocId,
    memberDocId: member.docId,
    memberId: member.memberId || '',
    orderKind: MemberOrderKind.Stripe,
    orderType: (order.stripeOrderType as unknown as MemberOrderType) || MemberOrderType.Checkout,
    orderNumber: order.invoiceId || order.stripeObjectId || '',
    date: order.created ? order.created.split('T')[0] : new Date().toISOString().split('T')[0],
    created: order.created || new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    amountTotal: order.amountTotal ?? 0,
    currency: order.currency || 'usd',
    paymentStatus: (order.paymentStatus as unknown as MemberOrderPaymentStatus) ?? null,
    fulfillmentStatus: MemberOrderFulfillmentStatus.Fulfilled,
    description,
    lineItems: order.lineItems.map((item) => ({
      productId: item.productId || '',
      priceId: item.priceId || '',
      description: item.description || '',
      quantity: item.quantity || 1,
      amountTotal: item.amountTotal || 0,
      currency: item.currency || 'usd',
      category: categorizeLineItem(item, order.metadata),
    })),
    subscriptionId: order.subscriptionId || '',
    stripeInvoiceId: order.invoiceId || '',
    stripeReceiptUrl: order.receiptUrl || '',
  };

  const sanitized = Object.fromEntries(
    Object.entries(memberOrder).filter(([_, v]) => v !== undefined),
  );

  await memberOrderRef.set(sanitized, { merge: true });
  logger.info('Mirrored order to member subcollection', {
    memberDocId: member.docId,
    orderDocId,
  });
}

/**
 * Extract grading level from line item description (e.g. "Student Level 3", "Application 2").
 */
function extractGradingLevel(description: string): string {
  const normalized = description.trim();
  const match = normalized.match(
    /(student\s*level\s*\d+|application\s*level\s*\d+|student\s*\d+|application\s*\d+|entry)/i,
  );
  if (match) {
    return canonicalizeGradingLevel(match[1]);
  }
  return canonicalizeGradingLevel(normalized);
}

/** Human-readable amount for a line item, e.g. "USD 80.00", for alert text. */
function formatOrderAmount(lineItem: StripeOrderLineItem): string {
  const amount = lineItem.amountTotal;
  if (amount === undefined || amount === null) return 'an unknown amount';
  const currency = (lineItem.currency || 'usd').toUpperCase();
  return `${currency} ${(amount / 100).toFixed(2)}`;
}

/** The address a member is asked to write to when a purchase needs a human. */
function supportContactEmail(): string {
  return environment.email?.from || 'web-helper-team@iliqchuan.com';
}

/**
 * Flags an order for the admin team. Admin clients surface orders whose
 * `ilcAppOrderStatus` needs attention (see NotificationService.syncOrderIssueNotifications),
 * so recording the issue here is what puts it in front of an admin.
 */
async function flagOrderForAdmins(
  db: admin.firestore.Firestore,
  orderDocId: string,
  issue: string,
): Promise<void> {
  try {
    await db
      .collection('orders')
      .doc(orderDocId)
      .set(
        {
          ilcAppOrderStatus: OrderStatus.NeedsManualProcessing,
          ilcAppOrderIssues: admin.firestore.FieldValue.arrayUnion(issue),
        },
        { merge: true },
      );
  } catch (err) {
    logger.error('Failed to flag order for admin attention', { orderDocId, issue, err });
  }
}

/** Why a grading payment could not be applied normally. */
type GradingPaymentProblem =
  | { kind: 'already-achieved'; level: string }
  | { kind: 'already-purchased'; level: string }
  | { kind: 'unknown-level'; level: string };

/**
 * Raises the alert for a grading payment that could not be applied normally:
 * one notification for the student, and the order flagged so it reaches the
 * admin team's feed (admin clients surface orders needing attention — see
 * NotificationService.syncOrderIssueNotifications).
 */
function describeGradingPaymentProblem(
  problem: GradingPaymentProblem,
  who: string,
  amountPaid: string,
): { issue: string; explanation: string } {
  switch (problem.kind) {
    case 'already-achieved':
      return {
        issue:
          `Grading payment for a level already achieved: member ${who} paid ${amountPaid} for ` +
          `"${problem.level}", which is at or below their current level.`,
        explanation: `your record already shows **${problem.level}** as achieved, so this payment may be a duplicate`,
      };
    case 'already-purchased':
      return {
        issue:
          `Duplicate grading payment: member ${who} paid ${amountPaid} for "${problem.level}", ` +
          `which they have already paid for.`,
        explanation: `you have already paid for your **${problem.level}** grading`,
      };
    case 'unknown-level':
      return {
        issue:
          `Grading payment for an unrecognised level: member ${who} paid ${amountPaid} for ` +
          `"${problem.level || 'an unnamed item'}", which is not a level in the grading progression.`,
        explanation: `we could not match "${problem.level || 'the item purchased'}" to a level in the grading progression`,
      };
  }
}

async function reportGradingPaymentProblem(
  db: admin.firestore.Firestore,
  member: Member,
  orderDocId: string,
  problem: GradingPaymentProblem,
  amountPaid: string,
  gradingDocId: string,
): Promise<void> {
  const contactEmail = supportContactEmail();
  const who = member.memberId || member.docId;
  const { issue, explanation } = describeGradingPaymentProblem(problem, who, amountPaid);

  const held = gradingDocId
    ? ' We have recorded the payment against a grading held for review, so nothing is lost.'
    : '';

  logger.error('Grading payment needs review', {
    memberDocId: member.docId,
    memberId: member.memberId,
    orderDocId,
    gradingDocId,
    problem: problem.kind,
    level: problem.level,
  });

  await flagOrderForAdmins(db, orderDocId, issue);

  try {
    await createMemberNotification(db, member.docId, {
      kind: NotificationKind.OrderNeedsAttention,
      markdown:
        `⚠️ **Your grading payment needs checking.** You paid ${amountPaid} for ` +
        `**${problem.level || 'a grading'}**, but ${explanation}.${held} ` +
        `Our admin team has been alerted and will be in touch. ` +
        `If you do not hear back, or this does not look right, please contact ` +
        `[${contactEmail}](mailto:${contactEmail}) quoting order ${orderDocId}.`,
      createdAt: new Date().toISOString(),
      dismissed: false,
      data: {
        orderDocId,
        orderRef: orderDocId,
        status: OrderStatus.NeedsManualProcessing,
        issues: [issue],
      },
    });
  } catch (notifErr) {
    logger.error('Failed to notify member of grading payment problem', {
      notifErr,
      memberDocId: member.docId,
      orderDocId,
    });
  }
}

/**
 * Fulfills a grading purchase. The payment applies to the level that was
 * bought: an unpaid grading record for that level is marked paid, and when no
 * record exists one is created. Buying a level above the student's current one
 * is normal — that is how a grading is booked in advance.
 *
 * Two cases cannot be fulfilled that way and raise an alert to both the student
 * and the admins instead: paying for a level already achieved, and paying for a
 * level already paid for. The grading is still created in those cases, flagged
 * `RequiresReview` so the payment is never lost and an admin can resolve it.
 */
async function fulfillGradingForMember(
  db: admin.firestore.Firestore,
  member: Member,
  order: StripeOrder,
  lineItem: StripeOrderLineItem,
  orderDocId: string,
  metadataLevel = '',
): Promise<string> {
  const purchaseDate = new Date().toISOString().split('T')[0];
  // Shown on the grading to everyone who can see it, including instructors who
  // cannot read the order document.
  const orderNumber = orderDisplayNumber(
    order.created || purchaseDate,
    order.invoiceId || order.stripeObjectId || '',
  );
  // The purchase page records the level it charged for in the order metadata;
  // trust that over parsing the line-item description when it is present.
  const rawLevel = metadataLevel.trim()
    ? canonicalizeGradingLevel(metadataLevel.trim())
    : extractGradingLevel(lineItem.description);
  const level = normalizeGradingLevel(rawLevel);
  const amountPaid = formatOrderAmount(lineItem);

  // Check if a grading was already created for this order to prevent duplicates
  const existingQuery = await db
    .collection('gradings')
    .where('orderId', '==', orderDocId)
    .limit(1)
    .get();
  if (!existingQuery.empty) {
    return existingQuery.docs[0].id;
  }

  const memberGradings = await db
    .collection('gradings')
    .where('studentMemberDocId', '==', member.docId)
    .get();
  const gradings = memberGradings.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    ...(doc.data() as Grading),
  }));
  const atPurchasedLevel = gradings.filter(
    (g) => normalizeGradingLevel(g.level) === level,
  );

  // The student already has a grading for this level that they had not paid
  // for: this payment settles it. (Failed attempts are excluded — that level is
  // governed by the free-retake flow — so paying again books a fresh grading.)
  const unpaidExisting = unpaidGradingsInProgressionOrder(atPurchasedLevel)[0];
  if (unpaidExisting) {
    await unpaidExisting.ref.update({
      orderId: orderDocId,
      orderNumber,
      gradingPurchaseDate: purchaseDate,
      paymentStatus: PaymentStatus.PaidByStripe,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info('Grading payment settled an existing unpaid grading', {
      memberDocId: member.docId,
      gradingDocId: unpaidExisting.id,
      level,
      orderDocId,
    });
    return unpaidExisting.id;
  }

  // Otherwise a grading is created for the level bought. Buying ahead of the
  // current level is fine; only these cases need a human to look.
  let problem: GradingPaymentProblem | null = null;
  if (!level || !gradingProgression.includes(level)) {
    problem = { kind: 'unknown-level', level: rawLevel };
  } else if (achievedGradingLevels(member.studentLevel, member.applicationLevel).has(level)) {
    problem = { kind: 'already-achieved', level };
  } else if (atPurchasedLevel.some((g) => isGradingPaid(g))) {
    problem = { kind: 'already-purchased', level };
  }

  const newGrading: Grading = {
    ...initGrading(),
    studentMemberDocId: member.docId,
    studentMemberId: member.memberId,
    gradingInstructorId: member.primaryInstructorId || '',
    schoolDocId: member.primarySchoolDocId || '',
    schoolId: member.primarySchoolId || '',
    orderId: orderDocId,
    orderNumber,
    gradingPurchaseDate: purchaseDate,
    level: level || rawLevel,
    // A flagged grading is held for admin review rather than presented to the
    // student as their next step (see onGradingCreated, which skips the
    // "grading purchased" notification for RequiresReview).
    status: problem ? GradingStatus.RequiresReview : GradingStatus.AwaitingRequest,
    reviewIssue: problem
      ? describeGradingPaymentProblem(
          problem,
          member.memberId || member.docId,
          amountPaid,
        ).issue
      : '',
    paymentStatus: PaymentStatus.PaidByStripe,
    lastUpdated: new Date().toISOString(),
  };

  const createdRef = await db.collection('gradings').add(newGrading);

  // Append gradingDocId to member
  await db
    .collection('members')
    .doc(member.docId)
    .update({
      gradingDocIds: admin.firestore.FieldValue.arrayUnion(createdRef.id),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

  logger.info('Created grading from grading payment', {
    memberDocId: member.docId,
    gradingDocId: createdRef.id,
    level,
    orderDocId,
    heldForReview: !!problem,
  });

  if (problem) {
    await reportGradingPaymentProblem(
      db,
      member,
      orderDocId,
      problem,
      amountPaid,
      createdRef.id,
    );
  }

  return createdRef.id;
}

/**
 * Processes spouse lifetime membership when a "Life with Spouse" option is purchased.
 * Looks up an existing member by email, ACL, or name + DOB.
 * If found: updates the member's membership to Life (9999-12-31).
 * If not found: creates a new Member with Life membership and assigns a Member ID.
 */
export async function fulfillSpouseLifeMembership(
  db: admin.firestore.Firestore,
  order: StripeOrder,
  orderDocId: string,
  primaryMember: Member,
): Promise<string | null> {
  const spouseEmail = (order.metadata?.['spouseEmail'] || '').trim().toLowerCase();
  const spouseName = (order.metadata?.['spouseName'] || '').trim();
  const spouseDob = (order.metadata?.['spouseDob'] || '').trim();
  const spouseCountry = (
    order.metadata?.['spouseCountry'] ||
    primaryMember.country ||
    order.billingAddress?.country ||
    ''
  ).trim();

  // If no spouse information was provided in metadata, nothing to fulfill.
  if (!spouseName && !spouseEmail) {
    return null;
  }

  const orderDate = order.created
    ? order.created.split('T')[0]
    : new Date().toISOString().split('T')[0];

  // 1. Try to lookup existing member
  let existingSpouseDoc: admin.firestore.DocumentSnapshot | null = null;

  // 1a. Lookup by email in ACL
  if (spouseEmail) {
    const aclDoc = await db.collection('acl').doc(spouseEmail).get();
    if (aclDoc.exists) {
      const memberDocIds = (aclDoc.data()?.memberDocIds as string[]) || [];
      if (memberDocIds.length > 0) {
        const doc = await db.collection('members').doc(memberDocIds[0]).get();
        if (doc.exists) {
          existingSpouseDoc = doc;
        }
      }
    }
    // 1b. Lookup by emails array in members
    if (!existingSpouseDoc) {
      const emailQuery = await db
        .collection('members')
        .where('emails', 'array-contains', spouseEmail)
        .limit(1)
        .get();
      if (!emailQuery.empty) {
        existingSpouseDoc = emailQuery.docs[0];
      }
    }
  }

  // 1c. Lookup by name and dateOfBirth
  if (!existingSpouseDoc && spouseName && spouseDob) {
    const nameDobQuery = await db
      .collection('members')
      .where('name', '==', spouseName)
      .where('dateOfBirth', '==', spouseDob)
      .limit(1)
      .get();
    if (!nameDobQuery.empty) {
      existingSpouseDoc = nameDobQuery.docs[0];
    }
  }

  // 1d. Lookup by name alone if unique (and not matching primary member)
  if (!existingSpouseDoc && spouseName) {
    const nameQuery = await db
      .collection('members')
      .where('name', '==', spouseName)
      .limit(2)
      .get();
    if (nameQuery.docs.length === 1 && nameQuery.docs[0].id !== primaryMember.docId) {
      existingSpouseDoc = nameQuery.docs[0];
    }
  }

  // 2. If existing member found, update to Life membership
  if (existingSpouseDoc && existingSpouseDoc.exists) {
    const spouseData = existingSpouseDoc.data() as Partial<Member>;
    const spouseMemberDocId = existingSpouseDoc.id;
    const spouseRef = db.collection('members').doc(spouseMemberDocId);

    const updates: Record<string, unknown> = {
      membershipType: MembershipType.Life,
      currentMembershipExpires: '9999-12-31',
      membershipNextAutoRenewDate: '',
      lastRenewalDate: orderDate,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Never overwrite firstMembershipStarted if already set
    if (!spouseData.firstMembershipStarted || spouseData.firstMembershipStarted.trim() === '') {
      updates['firstMembershipStarted'] = orderDate;
    }
    if (spouseDob && !spouseData.dateOfBirth) {
      updates['dateOfBirth'] = spouseDob;
    }
    if (spouseEmail && !(spouseData.emails || []).map((e) => e.toLowerCase()).includes(spouseEmail)) {
      updates['emails'] = admin.firestore.FieldValue.arrayUnion(spouseEmail);
    }

    // Auto-assign member ID if existing member does not have one
    if (!spouseData.memberId || spouseData.memberId.trim() === '') {
      const countryInput = spouseData.country || spouseCountry;
      const countryCode = resolveCountryCode(countryInput);
      if (countryCode) {
        try {
          const newMemberId = await assignNextMemberId(countryCode, db);
          updates['memberId'] = newMemberId;
          spouseData.memberId = newMemberId;
        } catch (e) {
          logger.error('Failed to assign member ID for existing spouse member', { error: e });
        }
      }
    }

    await spouseRef.update(updates);
    logger.info('Updated existing member to Life Membership for spouse order', {
      spouseMemberDocId,
      spouseName: spouseData.name || spouseName,
      orderDocId,
    });

    const updatedSpouseMember: Member = {
      ...initMember(),
      ...spouseData,
      docId: spouseMemberDocId,
      membershipType: MembershipType.Life,
      currentMembershipExpires: '9999-12-31',
    };
    await mirrorOrderToMemberSubcollection(db, updatedSpouseMember, order, orderDocId);
    return spouseMemberDocId;
  }

  // 3. Otherwise, create a new member record for the spouse
  const countryInput = spouseCountry || primaryMember.country || '';
  const countryCode = resolveCountryCode(countryInput);
  const resolvedCountry = countryCode ? resolveCountryName(countryCode) : countryInput;
  let newMemberId = '';

  if (countryCode) {
    try {
      newMemberId = await assignNextMemberId(countryCode, db);
    } catch (e) {
      logger.error('Failed to assign member ID for new spouse member', {
        countryCode,
        error: e,
      });
    }
  }

  const newSpouseDocRef = db.collection('members').doc();
  const newSpouseMember: Member = {
    ...initMember(),
    docId: newSpouseDocRef.id,
    memberId: newMemberId,
    name: spouseName,
    country: resolvedCountry,
    emails: spouseEmail ? [spouseEmail] : [],
    dateOfBirth: spouseDob,
    membershipType: MembershipType.Life,
    firstMembershipStarted: orderDate,
    lastRenewalDate: orderDate,
    currentMembershipExpires: '9999-12-31',
    lastUpdated: new Date().toISOString(),
  };

  const sanitized = Object.fromEntries(
    Object.entries(newSpouseMember).filter(([_, v]) => v !== undefined),
  );

  await newSpouseDocRef.set({
    ...sanitized,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info('Created new Life Membership for spouse', {
    spouseMemberDocId: newSpouseDocRef.id,
    memberId: newMemberId,
    name: spouseName,
    orderDocId,
  });

  await mirrorOrderToMemberSubcollection(db, newSpouseMember, order, orderDocId);
  return newSpouseDocRef.id;
}

/**
 * Fulfills digital products and synchronizes subscription dates on the Member document.
 */
export async function fulfillStripeOrder(
  db: admin.firestore.Firestore,
  member: Member,
  order: StripeOrder,
  orderDocId: string,
): Promise<void> {
  const orderDate = order.created
    ? order.created.split('T')[0]
    : new Date().toISOString().split('T')[0];
  const memberRef = db.collection('members').doc(member.docId);
  const memberUpdates: Record<string, unknown> = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Cache customer ID if present
  if (order.stripeCustomerId && !member.stripeCustomerId) {
    memberUpdates['stripeCustomerId'] = order.stripeCustomerId;
  }

  for (const item of order.lineItems) {
    const category = categorizeLineItem(item, order.metadata);
    const descLower = item.description.toLowerCase();

    if (category === OrderItemCategory.Membership) {
      if (descLower.includes('life')) {
        memberUpdates['membershipType'] = MembershipType.Life;
        memberUpdates['currentMembershipExpires'] = '9999-12-31';
        memberUpdates['membershipNextAutoRenewDate'] = '';
        memberUpdates['lastRenewalDate'] = orderDate;

        if (
          descLower.includes('spouse') ||
          order.metadata?.['spouseName'] ||
          order.metadata?.['spouseEmail']
        ) {
          await fulfillSpouseLifeMembership(db, order, orderDocId, member);
        }
      } else {
        const newExpires = extendDateByYears(
          member.currentMembershipExpires,
          1,
          orderDate,
        );
        memberUpdates['membershipType'] = MembershipType.Annual;
        memberUpdates['lastRenewalDate'] = orderDate;
        memberUpdates['currentMembershipExpires'] = newExpires;

        if (order.mode === StripeCheckoutMode.Subscription && order.subscriptionId) {
          memberUpdates['membershipSubscriptionId'] = order.subscriptionId;
          memberUpdates['membershipNextAutoRenewDate'] = newExpires;
        }
      }

      // If the member does not already have a memberId, auto-assign one based on country.
      if (!member.memberId || member.memberId.trim() === '') {
        const countryInput = member.country || order.billingAddress?.country || '';
        const countryCode = resolveCountryCode(countryInput);
        if (countryCode) {
          try {
            const newMemberId = await assignNextMemberId(countryCode, db);
            memberUpdates['memberId'] = newMemberId;
            member.memberId = newMemberId;
            logger.info('Assigned new member ID for Stripe membership purchase', {
              memberDocId: member.docId,
              memberId: newMemberId,
              countryCode,
              orderDocId,
            });
          } catch (e) {
            logger.error('Failed to assign member ID for Stripe membership purchase', {
              memberDocId: member.docId,
              countryCode,
              orderDocId,
              error: e,
            });
          }
        } else {
          const contactEmail = environment.email?.from || 'web-helper-team@iliqchuan.com';
          const errorMsg = `Could not resolve country "${countryInput}" to a valid country code in countryCodeList to assign member ID for member ${member.docId}. Please contact ${contactEmail}.`;
          logger.error(errorMsg, {
            memberDocId: member.docId,
            memberCountry: member.country,
            billingCountry: order.billingAddress?.country,
            orderDocId,
            contactEmail,
          });

          try {
            await createMemberNotification(db, member.docId, {
              kind: NotificationKind.OrderNeedsAttention,
              markdown: `We were unable to verify your country of residence to assign your official ILC Member ID. Please update your country in [your profile](/myProfile) or contact support at [${contactEmail}](mailto:${contactEmail}).`,
              createdAt: new Date().toISOString(),
              dismissed: false,
              data: {
                orderDocId,
                orderRef: orderDocId,
                status: OrderStatus.NeedsManualProcessing,
                issues: [`Unresolved country "${countryInput}". Member ID could not be auto-assigned.`],
              },
            });
          } catch (notifErr) {
            logger.error('Failed to create notification for unresolved country', { notifErr, memberDocId: member.docId });
          }
        }

        // If the member record had no country populated, update it from the resolved billing country
        if (!member.country && countryCode) {
          const resolvedCountry = resolveCountryName(countryCode);
          memberUpdates['country'] = resolvedCountry;
          member.country = resolvedCountry;
        }
      }

      // Record first membership start date ONLY if not already set (never overwrite)
      if (!member.firstMembershipStarted || member.firstMembershipStarted.trim() === '') {
        memberUpdates['firstMembershipStarted'] = orderDate;
        member.firstMembershipStarted = orderDate;
      }
    } else if (category === OrderItemCategory.InstructorLicense) {
      if (member.instructorLicenseType === InstructorLicenseType.Life || descLower.includes('life')) {
        memberUpdates['instructorLicenseRenewalDate'] = orderDate;
        memberUpdates['instructorLicenseExpires'] = '9999-12-31';
        memberUpdates['instructorLicenseType'] = InstructorLicenseType.Life;
        memberUpdates['instructorLicenseNextAutoRenewDate'] = '';
      } else {
        const yearsToAdd =
          item.quantity && item.quantity > 0 ? item.quantity : 1;
        const newExpires = extendDateByYears(
          member.instructorLicenseExpires,
          yearsToAdd,
          orderDate,
        );
        memberUpdates['instructorLicenseRenewalDate'] = orderDate;
        memberUpdates['instructorLicenseExpires'] = newExpires;
        memberUpdates['instructorLicenseType'] = InstructorLicenseType.Annual;
        member.instructorLicenseExpires = newExpires;
        member.instructorLicenseType = InstructorLicenseType.Annual;

        if (
          order.mode === StripeCheckoutMode.Subscription &&
          order.subscriptionId
        ) {
          memberUpdates['instructorLicenseSubscriptionId'] =
            order.subscriptionId;
          memberUpdates['instructorLicenseNextAutoRenewDate'] = newExpires;
          member.instructorLicenseSubscriptionId = order.subscriptionId;
          member.instructorLicenseNextAutoRenewDate = newExpires;
        }
      }

      // Assign instructor ID if member does not already have one
      if (!member.instructorId || member.instructorId.trim() === '') {
        try {
          const newInstructorId = await assignNextInstructorId(db);
          memberUpdates['instructorId'] = newInstructorId;
          member.instructorId = newInstructorId;
          logger.info(
            'Assigned new instructor ID for Stripe instructor license purchase',
            {
              memberDocId: member.docId,
              instructorId: newInstructorId,
              orderDocId,
            },
          );
        } catch (e) {
          logger.error(
            'Failed to assign instructor ID for Stripe instructor license purchase',
            {
              memberDocId: member.docId,
              orderDocId,
              error: e,
            },
          );
        }
      }
    } else if (category === OrderItemCategory.VideoLibrary) {
      const isYearly = descLower.includes('year') || descLower.includes('annual');
      const newExpires = isYearly
        ? extendDateByYears(member.classVideoLibraryExpirationDate, 1, orderDate)
        : extendDateByMonths(member.classVideoLibraryExpirationDate, 1, orderDate);

      memberUpdates['classVideoLibrarySubscription'] = true;
      memberUpdates['classVideoLibraryLastRenewalDate'] = orderDate;
      memberUpdates['classVideoLibraryExpirationDate'] = newExpires;

      if (order.mode === StripeCheckoutMode.Subscription && order.subscriptionId) {
        memberUpdates['classVideoLibrarySubscriptionId'] =
          order.subscriptionId;
        memberUpdates['classVideoLibraryNextAutoRenewDate'] = newExpires;
      }
    } else if (category === OrderItemCategory.SchoolLicense) {
      const isYearly = descLower.includes('year') || descLower.includes('annual');
      const isNewSchool =
        order.metadata?.['isNewSchool'] === 'true' ||
        (!order.metadata?.['schoolDocId'] && !!order.metadata?.['schoolName']);
      const schoolDocId =
        !isNewSchool ? (order.metadata?.['schoolDocId'] || member.primarySchoolDocId || '') : '';
      const schoolId = !isNewSchool ? (order.metadata?.['schoolId'] || '') : '';

      let targetSchoolRef: admin.firestore.DocumentReference | null = null;
      if (schoolDocId) {
        targetSchoolRef = db.collection('schools').doc(schoolDocId);
      } else if (schoolId) {
        const sQuery = await db
          .collection('schools')
          .where('schoolId', '==', schoolId)
          .limit(1)
          .get();
        if (!sQuery.empty) {
          targetSchoolRef = sQuery.docs[0].ref;
        }
      } else if (!isNewSchool && member.instructorId) {
        const sQuery = await db
          .collection('schools')
          .where('ownerInstructorId', '==', member.instructorId)
          .limit(1)
          .get();
        if (!sQuery.empty) {
          targetSchoolRef = sQuery.docs[0].ref;
        }
      }

      if (targetSchoolRef) {
        const sDoc = await targetSchoolRef.get();
        if (sDoc.exists) {
          const sData = sDoc.data() || {};
          const currentExp = (sData['schoolLicenseExpires'] as string) || '';
          const newExpires = isYearly
            ? extendDateByYears(currentExp, 1, orderDate)
            : extendDateByMonths(currentExp, 1, orderDate);
          await targetSchoolRef.update({
            schoolLicenseRenewalDate: orderDate,
            schoolLicenseExpires: newExpires,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          });
          logger.info('Updated school license for existing school', {
            schoolDocId: targetSchoolRef.id,
            newExpires,
          });
          continue;
        }
      }

      // If not renewing an existing school, create a new school entry
      const newExpires = isYearly
        ? extendDateByYears('', 1, orderDate)
        : extendDateByMonths('', 1, orderDate);

      let newSchoolId = '';
      try {
        newSchoolId = await assignNextSchoolId(db);
      } catch (err) {
        logger.error('Failed to assign next school ID for new school order', {
          error: err,
          orderDocId,
        });
      }

      const newSchoolDocRef = db.collection('schools').doc();
      const newSchool: School = {
        ...initSchool(),
        docId: newSchoolDocRef.id,
        schoolId: newSchoolId,
        schoolName: (order.metadata?.['schoolName'] || '').trim() || 'New School',
        schoolCountry: (order.metadata?.['schoolCountry'] || member.country || '').trim(),
        schoolCity: (order.metadata?.['schoolCity'] || '').trim(),
        schoolCountyOrState: (order.metadata?.['schoolCountyOrState'] || '').trim(),
        schoolAddress: (order.metadata?.['schoolAddress'] || '').trim(),
        schoolZipCode: (order.metadata?.['schoolZipCode'] || '').trim(),
        schoolWebsite: (order.metadata?.['schoolWebsite'] || '').trim(),
        ownerMemberDocId: member.docId,
        ownerInstructorId: member.instructorId || '',
        managerInstructorIds: [],
        ownerEmails: member.emails && member.emails.length > 0 ? member.emails : [],
        managerEmails: [],
        schoolLicenseRenewalDate: orderDate,
        schoolLicenseExpires: newExpires,
        lastUpdated: new Date().toISOString(),
      };

      const sanitized = Object.fromEntries(
        Object.entries(newSchool).filter(([_, v]) => v !== undefined),
      );

      await newSchoolDocRef.set({
        ...sanitized,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info('Created new school from Stripe order', {
        schoolDocId: newSchoolDocRef.id,
        schoolId: newSchoolId,
        schoolName: newSchool.schoolName,
        ownerMemberDocId: member.docId,
        orderDocId,
      });

      if (!member.primarySchoolDocId) {
        memberUpdates['primarySchoolDocId'] = newSchoolDocRef.id;
        memberUpdates['primarySchoolId'] = newSchoolId;
      }
    } else if (category === OrderItemCategory.Grading) {
      await fulfillGradingForMember(
        db,
        member,
        order,
        item,
        orderDocId,
        order.metadata?.['gradingLevel'] || '',
      );
    } else if (category === OrderItemCategory.Vod || order.metadata?.['videoId']) {
      const videoId = (order.metadata?.['videoId'] || item.productId || '').replace(/^prod_/, '');
      if (videoId) {
        const grant: VideoGrant = {
          docId: videoId,
          videoId,
          memberDocId: member.docId,
          memberEmail: member.emails?.[0] || order.customerEmail || '',
          grantKind: VideoGrantKind.StripePurchase,
          orderDocId,
          stripeSessionId: order.checkoutSessionId,
          amountPaidCents: item.amountTotal || order.amountTotal || 0,
          grantedAt: new Date().toISOString(),
        };
        await db
          .collection('members')
          .doc(member.docId)
          .collection('videoGrants')
          .doc(videoId)
          .set(grant);
        await db
          .collection('video_grants')
          .doc(`${member.docId}_${videoId}`)
          .set(grant);
        logger.info('Auto-provisioned VideoGrant for member', {
          memberDocId: member.docId,
          videoId,
          orderDocId,
        });
      }
    }
  }

  // If order was a subscription, record into subscriptions map
  if (order.subscriptionId && order.mode === StripeCheckoutMode.Subscription) {
    const subKey = order.subscriptionId;
    const isYearly = order.lineItems.some((l) => {
      const d = l.description.toLowerCase();
      return d.includes('year') || d.includes('annual');
    });
    const interval = isYearly ? SubscriptionInterval.Year : SubscriptionInterval.Month;
    const periodEnd = isYearly
      ? extendDateByYears(orderDate, 1, orderDate)
      : extendDateByMonths(orderDate, 1, orderDate);

    memberUpdates[`stripeSubscriptions.${subKey}`] = {
      subscriptionId: order.subscriptionId,
      type: categorizeSubscriptionItem(order.lineItems[0] || { description: '', productId: null, priceId: null, quantity: null, amountTotal: 0, currency: 'usd' }, order.metadata),
      status: SubscriptionStatus.Active,
      planName: order.lineItems[0]?.description || 'Subscription',
      amount: order.amountTotal || 0,
      currency: order.currency || 'usd',
      interval,
      currentPeriodStart: orderDate,
      currentPeriodEnd: periodEnd,
      nextAutoRenewDate: periodEnd,
      cancelAtPeriodEnd: false,
      canceledAt: '',
      stripePriceId: order.lineItems[0]?.priceId || '',
      stripeProductId: order.lineItems[0]?.productId || '',
    };
  }

  await memberRef.update(memberUpdates);
  logger.info('FulfillStripeOrder updated member record', {
    memberDocId: member.docId,
    orderDocId,
  });
}

/**
 * Handle subscription lifecycle updates (customer.subscription.updated, deleted).
 */
export async function syncSubscriptionStatusToMember(
  db: admin.firestore.Firestore,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;

  const memberDocIdMeta = subscription.metadata?.['memberDocId'];
  let member: Member | null = null;

  if (memberDocIdMeta) {
    const doc = await db.collection('members').doc(memberDocIdMeta).get();
    if (doc.exists) member = firestoreDocToMember(doc);
  }

  if (!member && customerId) {
    const query = await db
      .collection('members')
      .where('stripeCustomerId', '==', customerId)
      .limit(1)
      .get();
    if (!query.empty) {
      member = firestoreDocToMember(query.docs[0]);
    }
  }

  if (!member) {
    logger.warn('syncSubscriptionStatusToMember: Member not found', {
      subscriptionId: subscription.id,
      customerId,
    });
    return;
  }

  const periodEnd = unixSecondsToDateString(
    getSubscriptionCurrentPeriodEnd(subscription),
  );
  const cancelAtPeriodEnd = subscription.cancel_at_period_end;
  const nextAutoRenewDate = cancelAtPeriodEnd ? '' : periodEnd;
  const status = subscription.status;
  const isActive = status === 'active' || status === 'trialing';

  const memberRef = db.collection('members').doc(member.docId);
  const updates: Record<string, unknown> = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (member.membershipSubscriptionId === subscription.id) {
    updates['membershipNextAutoRenewDate'] = nextAutoRenewDate;
    if (isActive && periodEnd) {
      if (!member.currentMembershipExpires || member.currentMembershipExpires < periodEnd) {
        updates['currentMembershipExpires'] = periodEnd;
      }
    }
  }
  if (member.instructorLicenseSubscriptionId === subscription.id) {
    updates['instructorLicenseNextAutoRenewDate'] = nextAutoRenewDate;
    if (isActive && periodEnd) {
      if (!member.instructorLicenseExpires || member.instructorLicenseExpires < periodEnd) {
        updates['instructorLicenseExpires'] = periodEnd;
      }
    }
  }
  if (member.classVideoLibrarySubscriptionId === subscription.id) {
    updates['classVideoLibraryNextAutoRenewDate'] = nextAutoRenewDate;
    if (isActive && periodEnd) {
      updates['classVideoLibrarySubscription'] = true;
      if (!member.classVideoLibraryExpirationDate || member.classVideoLibraryExpirationDate < periodEnd) {
        updates['classVideoLibraryExpirationDate'] = periodEnd;
      }
    } else if (status === 'canceled' || status === 'unpaid') {
      const today = new Date().toISOString().split('T')[0];
      if (member.classVideoLibraryExpirationDate && member.classVideoLibraryExpirationDate < today) {
        updates['classVideoLibrarySubscription'] = false;
      }
    }
  }

  if (member.stripeSubscriptions && member.stripeSubscriptions[subscription.id]) {
    updates[`stripeSubscriptions.${subscription.id}.status`] = status;
    if (periodEnd) {
      updates[`stripeSubscriptions.${subscription.id}.currentPeriodEnd`] = periodEnd;
    }
    updates[`stripeSubscriptions.${subscription.id}.nextAutoRenewDate`] =
      nextAutoRenewDate;
    updates[`stripeSubscriptions.${subscription.id}.cancelAtPeriodEnd`] =
      cancelAtPeriodEnd;
  }

  await memberRef.update(updates);
  logger.info('Synced subscription status to member', {
    memberDocId: member.docId,
    subscriptionId: subscription.id,
    status,
    nextAutoRenewDate,
  });
}
