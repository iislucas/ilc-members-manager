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
import { InstructorLicenseType, achievedGradingLevels, normalizeGradingLevel, toGradingLevel } from './data-model/curriculum';
import {
  AttendeeRole,
  AttendanceType,
  computeEffectiveCapacityUsage,
  decodeQuestionResponsesFromMetadata,
  EventAddOnKind,
  EventCapacity,
  EventRegistration,
  EventRegistrationStatus,
  EventRegistrationUpgrade,
  firestoreDocToEventRegistration,
  firestoreDocToIlcEvent,
  firestoreDocToProduct,
  formatRegistrationPackageSummary,
  IlcEvent,
  initEventRegistration,
  mergeImmutableQuestionResponses,
  normalizeCapacityMap,
  PaymentChoice,
  PricingTierType,
  Product,
  RegistrationPaymentMethod,
} from './data-model/events';
import { FirestoreCollection, FirestoreSubcollection } from './data-model/collections';
import { Grading, GradingStatus, PaymentStatus, initGrading, isGradingPaid, unpaidGradingsInProgressionOrder } from './data-model/gradings';
import { Member, MemberUpdates, MemberSubscriptionItem, MembershipType, firestoreDocToMember, initMember, SubscriptionItemType, SubscriptionStatus, SubscriptionInterval } from './data-model/members';
import { NotificationKind } from './data-model/notifications';
import { MemberOrder, MemberOrderKind, MemberOrderType, MemberOrderPaymentStatus, MemberOrderFulfillmentStatus, OrderItemCategory, StripeOrder, StripeOrderType, StripeOrderLineItem, StripeCheckoutMode, OrderStatus, OrderKind } from './data-model/orders';
import { initSchool, School } from './data-model/schools';
import { VideoGrant, VideoGrantKind, firestoreDocToVideoItem } from './data-model/vod';
import { assignNextMemberId, assignNextInstructorId, assignNextSchoolId } from './counters';
import { resolveCountryCode, resolveCountryName } from './country-codes';
import { createMemberNotification } from './notifications';
import { getMemberByEmail } from './common';
import { normalizeEmail, normalizeEmails, emailListIncludes } from './data-model/email';
import { environment } from './environment/environment.js';
import { sendTransactionalEmail } from './email-dispatcher.js';
import { TransactionalEmailKey } from './data-model/mail';

import { getSubscriptionCurrentPeriodEnd } from './stripe-subscriptions';
import { resolveEventVideoGrantTargets } from './proposed-events';

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
  const email = normalizeEmail(order.customerEmail);
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
  if (metaType === 'vod') {
    return OrderItemCategory.Vod;
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

/** Human-readable amount for a line item, e.g. "USD 80.00", for alert text. */
function formatOrderAmount(lineItem: StripeOrderLineItem): string {
  const amount = lineItem.amountTotal;
  if (amount === undefined || amount === null) return 'an unknown amount';
  const currency = (lineItem.currency || 'usd').toUpperCase();
  return `${currency} ${(amount / 100).toFixed(2)}`;
}

/** Human-readable total of several line items, e.g. "USD 160.00". */
function formatTotalAmount(items: StripeOrderLineItem[]): string {
  const known = items.filter((i) => i.amountTotal !== undefined && i.amountTotal !== null);
  if (known.length === 0) return 'an unknown amount';
  const currency = (known[0].currency || 'usd').toUpperCase();
  const total = known.reduce((sum, i) => sum + (i.amountTotal ?? 0), 0);
  return `${currency} ${(total / 100).toFixed(2)}`;
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

/** A grading line item that could not be applied normally. */
type GradingPaymentProblemReport = {
  problem: GradingPaymentProblem;
  amountPaid: string;
  gradingDocId: string;
};

// Raises the alert for an order's grading payments that could not be applied
// normally: every issue is recorded on the order (which puts it in front of the
// admin team — see NotificationService.syncOrderIssueNotifications), and the
// student gets ONE notification for the whole order, however many items it had.
async function reportGradingPaymentProblems(
  db: admin.firestore.Firestore,
  member: Member,
  orderDocId: string,
  reports: GradingPaymentProblemReport[],
): Promise<void> {
  if (reports.length === 0) return;
  const contactEmail = environment.email.contact;
  const who = member.memberId || member.docId;
  const described = reports.map((r) => ({
    ...r,
    ...describeGradingPaymentProblem(r.problem, who, r.amountPaid),
  }));

  for (const d of described) {
    logger.error('Grading payment needs review', {
      memberDocId: member.docId,
      memberId: member.memberId,
      orderDocId,
      gradingDocId: d.gradingDocId,
      problem: d.problem.kind,
      level: d.problem.level,
    });
    await flagOrderForAdmins(db, orderDocId, d.issue);
  }

  const lines = described.map(
    (d) => `- You paid ${d.amountPaid} for **${d.problem.level || 'a grading'}**, but ${d.explanation}.`,
  );
  try {
    await createMemberNotification(db, member.docId, {
      kind: NotificationKind.OrderNeedsAttention,
      markdown:
        `⚠️ **Your grading payment needs checking.**\n\n${lines.join('\n')}\n\n` +
        `We have recorded the payment against a grading held for review, so nothing is lost. ` +
        `Our admin team has been alerted and will be in touch. ` +
        `If you do not hear back, or this does not look right, please contact ` +
        `[${contactEmail}](mailto:${contactEmail}) quoting order ${orderDocId}.`,
      createdAt: new Date().toISOString(),
      dismissed: false,
      data: {
        orderDocId,
        orderRef: orderDocId,
        status: OrderStatus.NeedsManualProcessing,
        issues: described.map((d) => d.issue),
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

// Sends the student ONE confirmation email for an order's grading purchases,
// listing every level bought, however many there were.
async function sendGradingConfirmationEmail(
  db: admin.firestore.Firestore,
  member: Member,
  fulfilled: GradingFulfillment[],
): Promise<void> {
  const recipientEmail = member.emails?.[0];
  if (!recipientEmail || fulfilled.length === 0) return;
  const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';
  try {
    await sendTransactionalEmail(db, {
      to: recipientEmail,
      templateKey: TransactionalEmailKey.GradingPaymentConfirmation,
      replacements: {
        name: member.name || 'ILC Student',
        memberId: member.memberId || '',
        gradingLevel: fulfilled.map((f) => f.level).join(', '),
        gradingEventName: 'Official ILC Grading',
        gradingDate: new Date().toISOString().split('T')[0],
        amount: formatTotalAmount(fulfilled.map((f) => f.lineItem)),
        gradingUrl: `${appBase}/gradings`,
        appBase,
      },
    });
  } catch (emailErr) {
    logger.error('Failed to send grading payment confirmation email', { emailErr, memberDocId: member.docId });
  }
}

/**
 * The level the purchase page charged for on the `index`-th grading line item
 * of an order, or '' when it did not record one (the line-item description is
 * then used instead). A multi-level purchase records every level, in line-item
 * order, as a comma-separated `gradingLevels`; a single-level purchase (and
 * orders placed before multi-level purchases existed) records `gradingLevel`.
 */
export function gradingLevelForItem(order: StripeOrder, index: number): string {
  const levels = (order.metadata?.['gradingLevels'] || '')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => !!l);
  if (levels.length > 0) return levels[index] || '';
  return index === 0 ? order.metadata?.['gradingLevel'] || '' : '';
}

/**
 * Fulfills a grading purchase. The payment applies to the level that was
 * bought: an unpaid grading record for that level is marked paid, and when no
 * record exists one is created. Buying a level above the student's current one
 * is normal — that is how a grading is booked in advance. One order may buy
 * several levels; this is called once per grading line item.
 *
 * Two cases cannot be fulfilled that way and raise an alert to both the student
 * and the admins instead: paying for a level already achieved, and paying for a
 * level already paid for. The grading is still created in those cases, flagged
 * `RequiresReview` so the payment is never lost and an admin can resolve it.
 */
/** What fulfilling one grading line item did. */
type GradingFulfillment = {
  gradingDocId: string;
  // The level, canonical when recognised, else the purchased label.
  level: string;
  lineItem: StripeOrderLineItem;
  // A grading was created by this run (false when settling an existing unpaid
  // grading, or when the order was already processed).
  created: boolean;
  // Set when the payment couldn't be applied normally; reported per order.
  problem: GradingPaymentProblemReport | null;
};

async function fulfillGradingForMember(
  db: admin.firestore.Firestore,
  member: Member,
  lineItem: StripeOrderLineItem,
  orderDocId: string,
  metadataLevel = '',
): Promise<GradingFulfillment> {
  const purchaseDate = new Date().toISOString().split('T')[0];
  // The purchase page records the level it charged for in the order metadata;
  // trust that over parsing the line-item description when it is present.
  const rawLevel = (metadataLevel.trim() || lineItem.description || '').trim();
  // The syllabus level bought, read from any spelling ('Student Level 3',
  // 'GRADING : Entry Level', …), or null when the item names none.
  const level = toGradingLevel(rawLevel);
  const amountPaid = formatOrderAmount(lineItem);

  // Check if a grading was already created (or settled) by this order for this
  // level, to prevent duplicates when an order is reprocessed. An order may buy
  // several levels, so the check is per level.
  const existingQuery = await db
    .collection('gradings')
    .where('orderId', '==', orderDocId)
    .get();
  const existingForLevel = existingQuery.docs.find(
    (d) =>
      normalizeGradingLevel((d.data() as Grading).level || '') ===
      (level ?? rawLevel),
  );
  if (existingForLevel) {
    return {
      gradingDocId: existingForLevel.id,
      level: level ?? rawLevel,
      lineItem,
      created: false,
      problem: null,
    };
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
  const atPurchasedLevel = level
    ? gradings.filter((g) => toGradingLevel(g.level) === level)
    : [];

  // The student already has a grading for this level that they had not paid
  // for: this payment settles it. (Failed attempts are excluded — that level is
  // governed by the free-retake flow — so paying again books a fresh grading.)
  const unpaidExisting = unpaidGradingsInProgressionOrder(atPurchasedLevel)[0];
  if (unpaidExisting) {
    await unpaidExisting.ref.update({
      orderId: orderDocId,
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
    return {
      gradingDocId: unpaidExisting.id,
      level: level ?? rawLevel,
      lineItem,
      created: false,
      problem: null,
    };
  }

  // Otherwise a grading is created for the level bought. Buying ahead of the
  // current level is fine; only these cases need a human to look.
  let problem: GradingPaymentProblem | null = null;
  if (!level) {
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
    gradingPurchaseDate: purchaseDate,
    level: level ?? rawLevel,
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

  // Alerts and the confirmation email are sent once per order by the caller.
  return {
    gradingDocId: createdRef.id,
    level: level ?? rawLevel,
    lineItem,
    created: true,
    problem: problem ? { problem, amountPaid, gradingDocId: createdRef.id } : null,
  };
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
  const spouseEmail = normalizeEmail(order.metadata?.['spouseEmail']);
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
    const spouseData = existingSpouseDoc.data() as Member;
    const spouseMemberDocId = existingSpouseDoc.id;
    const spouseRef = db.collection(FirestoreCollection.Members).doc(spouseMemberDocId);

    const updates: MemberUpdates = {
      membershipType: MembershipType.Life,
      currentMembershipExpires: '9999-12-31',
      membershipNextAutoRenewDate: '',
      lastRenewalDate: orderDate,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Never overwrite firstMembershipStarted if already set
    if (!spouseData.firstMembershipStarted || spouseData.firstMembershipStarted.trim() === '') {
      updates.firstMembershipStarted = orderDate;
    }
    if (spouseDob && !spouseData.dateOfBirth) {
      updates.dateOfBirth = spouseDob;
    }
    if (spouseEmail && !emailListIncludes(spouseData.emails, spouseEmail)) {
      updates.emails = normalizeEmails([...(spouseData.emails || []), spouseEmail]);
    }

    // Auto-assign member ID if existing member does not have one
    if (!spouseData.memberId || spouseData.memberId.trim() === '') {
      const countryInput = spouseData.country || spouseCountry;
      const countryCode = resolveCountryCode(countryInput);
      if (countryCode) {
        try {
          const newMemberId = await assignNextMemberId(countryCode, db);
          updates.memberId = newMemberId;
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

  const newSpouseDocRef = db.collection(FirestoreCollection.Members).doc();
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

function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonCapacityMap(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeCapacityMap(parsed);
  } catch {
    return {};
  }
}

function parseMetadataNonNegInt(raw: string | undefined): number {
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Fulfills an event registration purchased through Stripe Checkout.
 * Atomically records registration in /events/{eventDocId}/registrations and updates
 * live capacityCounts + inPersonRegistrationsCount on /events/{eventDocId}.
 * If a member is associated, also mirrors to /members/{memberDocId}/registrations,
 * sends confirmation notification/email, and provisions VOD grants for event recordings
 * and any catalog video/series add-ons.
 */
export async function fulfillEventRegistration(
  db: admin.firestore.Firestore,
  order: StripeOrder,
  orderDocId: string,
  member?: Member | null,
): Promise<void> {
  const eventDocId = order.metadata?.['eventDocId'] || '';
  const productId = order.metadata?.['productId'] || '';
  const role = (order.metadata?.['role'] || AttendeeRole.NonMember) as AttendeeRole;
  const attendance = (order.metadata?.['attendance'] || AttendanceType.InPerson) as AttendanceType;
  const hasVideoAccess =
    order.metadata?.['includeVideo'] === 'true' || attendance === AttendanceType.VideoOnly;
  const name = order.metadata?.['attendeeName'] || order.customerName || '';
  const email = normalizeEmail(order.metadata?.['attendeeEmail'] || order.customerEmail);
  const phone = order.metadata?.['attendeePhone'] || '';
  const notes = order.metadata?.['attendeeNotes'] || '';
  const amountPaidCents = order.amountTotal || 0;
  const currency = order.currency || 'usd';

  const optionId = order.metadata?.['optionId'] || '';
  const optionLabel = order.metadata?.['optionLabel'] || '';
  const selectedSuboptions = parseJsonStringArray(order.metadata?.['selectedSuboptions']);
  const selectedAddOnIds = parseJsonStringArray(order.metadata?.['selectedAddOnIds']);
  const selectedAddOnLabels = parseJsonStringArray(order.metadata?.['selectedAddOnLabels']);
  const metadataCapacityUsage = parseJsonCapacityMap(order.metadata?.['capacityUsage']);
  const paymentChoice =
    order.metadata?.['paymentChoice'] === PaymentChoice.Deposit
      ? PaymentChoice.Deposit
      : PaymentChoice.Full;
  const metaTotalPriceCents = parseMetadataNonNegInt(
    order.metadata?.['totalPriceCents'] ?? order.metadata?.['agreedTotalCents'],
  );
  const metaDepositCents = parseMetadataNonNegInt(order.metadata?.['depositCents']);
  const cashDueAtDoorCents = parseMetadataNonNegInt(order.metadata?.['cashDueAtDoorCents']);
  const metadataQuestionResponses = decodeQuestionResponsesFromMetadata(order.metadata);

  const memberDocId = member?.docId || order.metadata?.['memberDocId'] || '';
  const memberId = member?.memberId || order.metadata?.['memberId'] || '';

  const isUpgrade = order.metadata?.['isUpgrade'] === 'true';
  const existingRegistrationDocId = order.metadata?.['existingRegistrationDocId'] || '';
  const targetDocId =
    isUpgrade && existingRegistrationDocId ? existingRegistrationDocId : orderDocId;

  // Load Product up front if available so we know rule capacities & catalog add-on specs
  let product: Product | undefined;
  let prodExists = false;
  if (productId) {
    try {
      const prodSnap = await db.collection(FirestoreCollection.Products).doc(productId).get();
      if (prodSnap.exists) {
        prodExists = true;
        product = firestoreDocToProduct(prodSnap);
      }
    } catch (e) {
      logger.warn('Failed to load product for fulfillment', { productId, error: e });
    }
  }

  const pricingTierType =
    (order.metadata?.['pricingTierType'] as PricingTierType) || PricingTierType.Standard;
  const paymentMethod = RegistrationPaymentMethod.Stripe;
  const nowIso = new Date().toISOString();

  let alreadyProcessed = false;
  let savedRegistration: EventRegistration | null = null;
  let loadedEvent: IlcEvent | null = null;

  const buildMergedRegistrationAndCounts = (
    existing: EventRegistration | null,
    currentEvent: IlcEvent | null,
  ): {
    registration: EventRegistration;
    updatedCapacityCounts: Record<string, number>;
    inPersonDelta: number;
  } => {
    let finalAttendance = attendance;
    let finalHasVideoAccess = hasVideoAccess;
    let finalAmountPaidCents = amountPaidCents;
    let finalSelectedAddOnIds = [...selectedAddOnIds];
    let finalSelectedAddOnLabels = [...selectedAddOnLabels];
    let upgradeHistory: EventRegistrationUpgrade[] = [];

    if (isUpgrade && existing) {
      const metaTotal = order.metadata?.['totalAmountPaidCents']
        ? parseInt(order.metadata['totalAmountPaidCents'], 10)
        : undefined;
      finalAmountPaidCents =
        typeof metaTotal === 'number' && !isNaN(metaTotal)
          ? metaTotal
          : (existing.amountPaidCents || 0) + amountPaidCents;

      finalHasVideoAccess = existing.hasVideoAccess || hasVideoAccess;
      finalSelectedAddOnIds = Array.from(
        new Set([...existing.selectedAddOnIds, ...selectedAddOnIds]),
      );
      finalSelectedAddOnLabels = Array.from(
        new Set([...existing.selectedAddOnLabels, ...selectedAddOnLabels]),
      );

      if (!optionId) {
        if (
          (existing.attendance === AttendanceType.InPerson &&
            attendance === AttendanceType.Online) ||
          (existing.attendance === AttendanceType.Online &&
            attendance === AttendanceType.InPerson) ||
          existing.attendance === AttendanceType.InPersonAndOnline ||
          attendance === AttendanceType.InPersonAndOnline
        ) {
          finalAttendance = AttendanceType.InPersonAndOnline;
        } else if (attendance === AttendanceType.VideoOnly) {
          finalAttendance = existing.attendance;
        } else {
          finalAttendance = attendance;
        }
      } else {
        finalAttendance = attendance;
      }

      upgradeHistory = [
        ...(existing.upgradeHistory || []),
        {
          timestamp: nowIso,
          previousAttendance: existing.attendance,
          previousHasVideoAccess: existing.hasVideoAccess,
          upgradeAmountCents: amountPaidCents,
          stripeSessionId: order.checkoutSessionId || '',
        },
      ];
    }

    const status =
      cashDueAtDoorCents > 0
        ? EventRegistrationStatus.DepositPaid
        : EventRegistrationStatus.Paid;
    const totalPriceCents =
      metaTotalPriceCents > 0
        ? metaTotalPriceCents
        : finalAmountPaidCents + cashDueAtDoorCents;
    const depositPaidCents =
      cashDueAtDoorCents > 0
        ? metaDepositCents > 0
          ? metaDepositCents
          : finalAmountPaidCents
        : existing?.depositPaidCents || 0;

    const registration: EventRegistration = {
      ...initEventRegistration(),
      docId: targetDocId,
      eventDocId,
      productId,
      orderDocId: targetDocId,
      stripeSessionId: order.checkoutSessionId || existing?.stripeSessionId || '',
      registeredAt: existing?.registeredAt || order.created || nowIso,
      name,
      email,
      phone,
      notes,
      memberDocId,
      memberId,
      studentLevel: member?.studentLevel || existing?.studentLevel || '',
      applicationLevel: member?.applicationLevel || existing?.applicationLevel || '',
      role,
      attendance: finalAttendance,
      hasVideoAccess: finalHasVideoAccess,
      optionId: optionId || existing?.optionId || '',
      optionLabel: optionLabel || existing?.optionLabel || '',
      selectedSuboptions:
        selectedSuboptions.length > 0
          ? selectedSuboptions
          : existing && existing.optionId === optionId
            ? existing.selectedSuboptions
            : [],
      selectedAddOnIds: finalSelectedAddOnIds,
      selectedAddOnLabels: finalSelectedAddOnLabels,
      capacityUsage: metadataCapacityUsage,
      paymentChoice,
      totalPriceCents,
      depositPaidCents,
      questionResponses: mergeImmutableQuestionResponses(
        existing?.questionResponses ?? [],
        metadataQuestionResponses,
      ),
      amountPaidCents: finalAmountPaidCents,
      amountDueCents: cashDueAtDoorCents,
      currency,
      status,
      paymentMethod,
      pricingTierType,
      paidAt: cashDueAtDoorCents > 0 ? '' : order.created || nowIso,
      paidInFullOffline: existing?.paidInFullOffline ?? false,
      autoGrantedAddOnIds: existing?.autoGrantedAddOnIds ?? [],
      lastUpdated: nowIso,
      upgradeHistory,
    };

    const capacities: EventCapacity[] =
      currentEvent && currentEvent.capacities.length > 0
        ? currentEvent.capacities
        : product?.pricingRules.capacities || [];

    const currentCounts = normalizeCapacityMap(
      currentEvent && Object.keys(currentEvent.capacityCounts).length > 0
        ? currentEvent.capacityCounts
        : product?.capacityCounts || {},
    );

    const prevActive =
      existing &&
      existing.status !== EventRegistrationStatus.Cancelled &&
      existing.status !== EventRegistrationStatus.Refunded;
    const prevHeld = prevActive ? computeEffectiveCapacityUsage(existing, capacities) : {};
    const nextHeld = computeEffectiveCapacityUsage(registration, capacities);

    const updatedCapacityCounts: Record<string, number> = { ...currentCounts };
    for (const cap of capacities) {
      const used = updatedCapacityCounts[cap.id] || 0;
      const prevUnits = prevHeld[cap.id] || 0;
      const nextUnits = nextHeld[cap.id] || 0;
      const projected = Math.max(0, used - prevUnits) + nextUnits;
      if (nextUnits > prevUnits && projected > cap.limit) {
        logger.warn('Fulfilling paid Stripe event registration that exceeded capacity limit', {
          eventDocId,
          capacityId: cap.id,
          limit: cap.limit,
          projected,
          orderDocId: targetDocId,
        });
      }
      if (projected > 0) {
        updatedCapacityCounts[cap.id] = projected;
      } else {
        delete updatedCapacityCounts[cap.id];
      }
    }

    const wasInPerson = Boolean(
      prevActive &&
        (existing.attendance === AttendanceType.InPerson ||
          existing.attendance === AttendanceType.InPersonAndOnline),
    );
    const willBeInPerson =
      finalAttendance === AttendanceType.InPerson ||
      finalAttendance === AttendanceType.InPersonAndOnline;
    const inPersonDelta = (willBeInPerson ? 1 : 0) - (wasInPerson ? 1 : 0);

    return { registration, updatedCapacityCounts, inPersonDelta };
  };

  const isDuplicateSession = (existing: EventRegistration): boolean => {
    if (!order.checkoutSessionId) return false;
    return (
      existing.stripeSessionId === order.checkoutSessionId ||
      (existing.upgradeHistory || []).some(
        (u) => u.stripeSessionId && u.stripeSessionId === order.checkoutSessionId,
      )
    );
  };

  if (typeof db.runTransaction === 'function') {
    await db.runTransaction(async (tx) => {
      let existing: EventRegistration | null = null;
      let txEvent: IlcEvent | null = null;
      let eventSnapExists = false;

      if (eventDocId) {
        const eventRef = db.collection(FirestoreCollection.Events).doc(eventDocId);
        const eventRegRef = eventRef
          .collection(FirestoreSubcollection.Registrations)
          .doc(targetDocId);
        const [evSnap, regSnap] = await Promise.all([tx.get(eventRef), tx.get(eventRegRef)]);
        if (evSnap.exists) {
          eventSnapExists = true;
          txEvent = firestoreDocToIlcEvent(evSnap);
          loadedEvent = txEvent;
        }
        if (regSnap.exists) {
          existing = firestoreDocToEventRegistration(regSnap);
          if (isDuplicateSession(existing)) {
            alreadyProcessed = true;
            return;
          }
        }
      }

      const { registration, updatedCapacityCounts, inPersonDelta } =
        buildMergedRegistrationAndCounts(existing, txEvent);
      savedRegistration = registration;

      if (eventDocId) {
        const eventRef = db.collection(FirestoreCollection.Events).doc(eventDocId);
        const eventRegRef = eventRef
          .collection(FirestoreSubcollection.Registrations)
          .doc(targetDocId);
        tx.set(eventRegRef, registration, { merge: true });

        if (eventSnapExists && txEvent) {
          tx.update(eventRef, {
            capacityCounts: updatedCapacityCounts,
            inPersonRegistrationsCount: Math.max(
              0,
              (txEvent.inPersonRegistrationsCount ?? 0) + inPersonDelta,
            ),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      if (prodExists && productId && product) {
        const prodRef = db.collection(FirestoreCollection.Products).doc(productId);
        tx.update(prodRef, {
          capacityCounts: updatedCapacityCounts,
          inPersonRegistrationsCount: Math.max(
            0,
            product.inPersonRegistrationsCount + inPersonDelta,
          ),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      if (memberDocId) {
        const memberRegRef = db
          .collection(FirestoreCollection.Members)
          .doc(memberDocId)
          .collection(FirestoreSubcollection.Registrations)
          .doc(targetDocId);
        tx.set(memberRegRef, registration, { merge: true });
      }
    });
  } else {
    // Fallback for lightweight mocks without db.runTransaction
    let existing: EventRegistration | null = null;
    if (eventDocId) {
      try {
        const regSnap = await db
          .collection(FirestoreCollection.Events)
          .doc(eventDocId)
          .collection(FirestoreSubcollection.Registrations)
          .doc(targetDocId)
          .get();
        if (regSnap.exists) {
          existing = firestoreDocToEventRegistration(regSnap);
          if (isDuplicateSession(existing)) {
            alreadyProcessed = true;
          }
        }
      } catch (err) {
        logger.warn('Error reading existing registration in fulfillment fallback:', err);
      }
    }

    if (!alreadyProcessed) {
      const { registration } = buildMergedRegistrationAndCounts(existing, null);
      savedRegistration = registration;
      const batch = db.batch();
      if (eventDocId) {
        const eventRegRef = db
          .collection(FirestoreCollection.Events)
          .doc(eventDocId)
          .collection(FirestoreSubcollection.Registrations)
          .doc(targetDocId);
        batch.set(eventRegRef, registration, { merge: true });
      }
      if (memberDocId) {
        const memberRegRef = db
          .collection(FirestoreCollection.Members)
          .doc(memberDocId)
          .collection(FirestoreSubcollection.Registrations)
          .doc(targetDocId);
        batch.set(memberRegRef, registration, { merge: true });
      }
      await batch.commit();
    }
  }

  if (alreadyProcessed || !savedRegistration) {
    logger.info('Event registration already applied for Stripe session, skipping duplicate', {
      targetDocId,
      checkoutSessionId: order.checkoutSessionId,
      eventDocId,
    });
    return;
  }

  const finalReg: EventRegistration = savedRegistration;

  logger.info('Recorded EventRegistration', {
    orderDocId: targetDocId,
    isUpgrade,
    eventDocId,
    email,
    memberDocId,
    optionId: finalReg.optionId,
    attendance: finalReg.attendance,
    status: finalReg.status,
    hasVideoAccess: finalReg.hasVideoAccess,
    totalAmountPaidCents: finalReg.amountPaidCents,
    amountDueCents: finalReg.amountDueCents,
  });

  // Helper to write a VideoGrant for a resolved set of target video/series IDs
  const writeVideoGrantsForTargetIds = async (
    targetDocIds: string[],
    grantPaidCents: number,
  ): Promise<void> => {
    for (const targetId of targetDocIds) {
      const grant: VideoGrant = {
        docId: targetId,
        videoId: targetId,
        memberDocId: memberDocId || '',
        memberEmail: email,
        grantKind: VideoGrantKind.StripePurchase,
        orderDocId,
        stripeSessionId: order.checkoutSessionId,
        amountPaidCents: grantPaidCents,
        grantedAt: nowIso,
      };

      if (memberDocId) {
        await db
          .collection(FirestoreCollection.Members)
          .doc(memberDocId)
          .collection(FirestoreSubcollection.VideoGrants)
          .doc(targetId)
          .set(grant, { merge: true });
        await db
          .collection(FirestoreCollection.VideoGrants)
          .doc(`${memberDocId}_${targetId}`)
          .set(grant, { merge: true });
      } else if (email) {
        const cleanEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
        await db
          .collection(FirestoreCollection.VideoGrants)
          .doc(`${cleanEmail}_${targetId}`)
          .set(grant, { merge: true });
      }
    }
  };

  // Provision any CatalogVideo / CatalogSeries add-ons immediately
  if (product && finalReg.selectedAddOnIds.length > 0 && (memberDocId || email)) {
    for (const addOnId of finalReg.selectedAddOnIds) {
      const addOn = product.pricingRules.addOns.find((a) => a.id === addOnId);
      if (!addOn) continue;
      let catalogTargetId = '';
      if (addOn.spec.kind === EventAddOnKind.CatalogVideo && addOn.spec.videoId) {
        catalogTargetId = addOn.spec.videoId;
      } else if (addOn.spec.kind === EventAddOnKind.CatalogSeries && addOn.spec.seriesId) {
        catalogTargetId = addOn.spec.seriesId;
      }
      if (!catalogTargetId) continue;

      try {
        const { targetDocIds } = await resolveEventVideoGrantTargets(db, catalogTargetId);
        await writeVideoGrantsForTargetIds(targetDocIds, 0);
      } catch (catalogErr) {
        logger.error('Failed to provision catalog VOD add-on grant', {
          catalogErr,
          addOnId,
          catalogTargetId,
          orderDocId,
        });
      }
    }
  }

  if (eventDocId) {
    try {
      let event: IlcEvent | null = loadedEvent;
      if (!event) {
        const eventSnap = await db.collection(FirestoreCollection.Events).doc(eventDocId).get();
        if (eventSnap.exists) {
          event = firestoreDocToIlcEvent(eventSnap);
        }
      }

      if (event) {
        const eventTitle = event.title || product?.title || 'Event';
        const purchaseDetailsMarkdown =
          product?.purchaseDetailsMarkdown || event.purchaseDetailsMarkdown || '';
        const inPersonDetailsMarkdown =
          product?.inPersonDetailsMarkdown || event.inPersonDetailsMarkdown || '';
        const onlineJoiningLink =
          product?.onlineJoiningLink || event.onlineJoiningLink || '';
        const recordedVideoId = product?.recordedVideoId || event.recordedVideoId || '';

        const packageSummary = formatRegistrationPackageSummary({
          optionLabel: finalReg.optionLabel,
          attendance: finalReg.attendance,
          selectedSuboptions: finalReg.selectedSuboptions,
          selectedAddOnLabels: finalReg.selectedAddOnLabels,
        });

        // 1. Send confirmation notification to member (when linked) & email to attendee
        if (memberDocId) {
          const optSummary = packageSummary ? ` (${packageSummary})` : '';
          let message = isUpgrade
            ? `Your registration for **[${eventTitle}](/events/${eventDocId})** has been upgraded${optSummary}!`
            : `You are registered for **[${eventTitle}](/events/${eventDocId})**${optSummary}!`;
          if (finalReg.amountDueCents > 0) {
            const dueFormatted = (finalReg.amountDueCents / 100).toFixed(2);
            message += `\n\n**Remaining Balance Due at Door:** ${currency.toUpperCase()} ${dueFormatted}.`;
          }
          if (
            finalReg.attendance === AttendanceType.Online ||
            finalReg.attendance === AttendanceType.InPersonAndOnline
          ) {
            if (purchaseDetailsMarkdown) {
              message += `\n\n### Online Joining Details\n${purchaseDetailsMarkdown}\n\nYou can also find these details at any time on the [event page](/events/${eventDocId}).`;
            } else if (onlineJoiningLink) {
              message += `\n\nYour online joining link is: [Join Zoom Meeting](${onlineJoiningLink})\n\nYou can also find this link at any time on the [event page](/events/${eventDocId}).`;
            } else {
              message += `\n\nYour online joining details will appear on the [event page](/events/${eventDocId}) prior to the class.`;
            }
          }
          if (
            finalReg.attendance === AttendanceType.InPerson ||
            finalReg.attendance === AttendanceType.InPersonAndOnline
          ) {
            if (inPersonDetailsMarkdown) {
              message += `\n\n### In-Person Instructions\n${inPersonDetailsMarkdown}\n\nYou can also find these details at any time on the [event page](/events/${eventDocId}).`;
            } else {
              message += `\n\nWe look forward to seeing you in person! Details are available on the [event page](/events/${eventDocId}).`;
            }
          }

          await createMemberNotification(db, memberDocId, {
            kind: NotificationKind.EventRegistrationConfirmed,
            markdown: message,
            createdAt: nowIso,
            dismissed: false,
            data: {
              orderDocId,
              eventId: eventDocId,
              attendance: finalReg.attendance,
              purchaseDetailsMarkdown,
              inPersonDetailsMarkdown,
              onlineJoiningLink,
            },
          });
        }

        if (email) {
          try {
            const startDate = event.start ? event.start.split('T')[0] : '';
            const endDate = event.end ? event.end.split('T')[0] : '';
            const dates =
              startDate === endDate || !endDate
                ? startDate || ''
                : `${startDate} - ${endDate}`;
            const hasOnline = Boolean(event.onlineJoiningLink && event.onlineJoiningLink.trim());
            const baseInstructions =
              inPersonDetailsMarkdown ||
              purchaseDetailsMarkdown ||
              'See event page for full details.';
            const specialInstructions =
              finalReg.amountDueCents > 0
                ? `Remaining Balance Due at Door: ${currency.toUpperCase()} ${(finalReg.amountDueCents / 100).toFixed(2)}.\n\n${baseInstructions}`
                : baseInstructions;
            await sendTransactionalEmail(db, {
              to: email,
              memberDocId: memberDocId || undefined,
              templateKey: TransactionalEmailKey.EventRegistrationConfirmation,
              replacements: {
                name: name || (memberDocId ? 'ILC Member' : 'ILC Attendee'),
                eventTitle: eventTitle || 'ILC Workshop',
                eventDates: dates,
                eventLocation: event.location || (hasOnline ? 'Online' : 'TBD'),
                attendanceType: isUpgrade ? `${packageSummary} (Upgraded)` : packageSummary,
                onlineJoiningLink: onlineJoiningLink || 'Details on event page',
                specialInstructions,
                amount: ((amountPaidCents || finalReg.amountPaidCents || 0) / 100).toFixed(2),
                receiptUrl: '',
                appBase: environment.links?.appBase || 'https://app.iliqchuan.com',
              },
            });
          } catch (emailErr) {
            logger.error('Failed to send event registration confirmation email', {
              emailErr,
              email,
              eventDocId,
            });
          }
        }

        // 2. Provision EventRecording video grant if recording is already uploaded
        if (finalReg.hasVideoAccess && recordedVideoId && (memberDocId || email)) {
          const { targetDocIds, primaryWatchVideoId } = await resolveEventVideoGrantTargets(
            db,
            recordedVideoId,
          );
          await writeVideoGrantsForTargetIds(targetDocIds, amountPaidCents);

          logger.info('Auto-provisioned VideoGrant for event registration', {
            memberDocId,
            recordedVideoId,
            targetCount: targetDocIds.length,
            eventDocId,
          });

          if (memberDocId && primaryWatchVideoId) {
            await createMemberNotification(db, memberDocId, {
              kind: NotificationKind.EventVideoAvailable,
              markdown: `The class video recording for **[${eventTitle}](/events/${eventDocId})** is ready! You can [watch it now](/videos/${encodeURIComponent(primaryWatchVideoId)}).`,
              createdAt: nowIso,
              dismissed: false,
              data: {
                eventId: eventDocId,
                videoId: primaryWatchVideoId,
              },
            });
          }
        }
      }
    } catch (err) {
      logger.error('Failed to process post-registration notifications or video grants', {
        err,
        eventDocId,
        orderDocId,
      });
    }
  }
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
  const memberRef = db.collection(FirestoreCollection.Members).doc(member.docId);
  const memberUpdates: MemberUpdates = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Cache customer ID if present
  if (order.stripeCustomerId && !member.stripeCustomerId) {
    memberUpdates.stripeCustomerId = order.stripeCustomerId;
  }

  // Position of the next grading line item among the order's grading items,
  // used to look up its level in the `gradingLevels` metadata.
  let gradingItemIndex = 0;
  // What each grading line item did, so the student is told once per order.
  const gradingResults: GradingFulfillment[] = [];
  for (const item of order.lineItems) {
    const category = categorizeLineItem(item, order.metadata);
    const descLower = item.description.toLowerCase();

    if (category === OrderItemCategory.Membership) {
      if (descLower.includes('life')) {
        memberUpdates.membershipType = MembershipType.Life;
        memberUpdates.currentMembershipExpires = '9999-12-31';
        memberUpdates.membershipNextAutoRenewDate = '';
        memberUpdates.lastRenewalDate = orderDate;

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
        memberUpdates.membershipType = MembershipType.Annual;
        memberUpdates.lastRenewalDate = orderDate;
        memberUpdates.currentMembershipExpires = newExpires;

        if (order.mode === StripeCheckoutMode.Subscription && order.subscriptionId) {
          memberUpdates.membershipSubscriptionId = order.subscriptionId;
          memberUpdates.membershipNextAutoRenewDate = newExpires;
        }
      }

      // If the member does not already have a memberId, auto-assign one based on country.
      if (!member.memberId || member.memberId.trim() === '') {
        const countryInput = member.country || order.billingAddress?.country || '';
        const countryCode = resolveCountryCode(countryInput);
        if (countryCode) {
          try {
            const newMemberId = await assignNextMemberId(countryCode, db);
            memberUpdates.memberId = newMemberId;
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
          const contactEmail = environment.email.contact;
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
          memberUpdates.country = resolvedCountry;
          member.country = resolvedCountry;
        }
      }

      // Record first membership start date ONLY if not already set (never overwrite)
      if (!member.firstMembershipStarted || member.firstMembershipStarted.trim() === '') {
        memberUpdates.firstMembershipStarted = orderDate;
        member.firstMembershipStarted = orderDate;
      }
    } else if (category === OrderItemCategory.InstructorLicense) {
      if (member.instructorLicenseType === InstructorLicenseType.Life || descLower.includes('life')) {
        memberUpdates.instructorLicenseRenewalDate = orderDate;
        memberUpdates.instructorLicenseExpires = '9999-12-31';
        memberUpdates.instructorLicenseType = InstructorLicenseType.Life;
        memberUpdates.instructorLicenseNextAutoRenewDate = '';
      } else {
        const yearsToAdd =
          item.quantity && item.quantity > 0 ? item.quantity : 1;
        const newExpires = extendDateByYears(
          member.instructorLicenseExpires,
          yearsToAdd,
          orderDate,
        );
        memberUpdates.instructorLicenseRenewalDate = orderDate;
        memberUpdates.instructorLicenseExpires = newExpires;
        memberUpdates.instructorLicenseType = InstructorLicenseType.Annual;
        member.instructorLicenseExpires = newExpires;
        member.instructorLicenseType = InstructorLicenseType.Annual;

        if (
          order.mode === StripeCheckoutMode.Subscription &&
          order.subscriptionId
        ) {
          memberUpdates.instructorLicenseSubscriptionId =
            order.subscriptionId;
          memberUpdates.instructorLicenseNextAutoRenewDate = newExpires;
          member.instructorLicenseSubscriptionId = order.subscriptionId;
          member.instructorLicenseNextAutoRenewDate = newExpires;
        }
      }

      // Assign instructor ID if member does not already have one
      if (!member.instructorId || member.instructorId.trim() === '') {
        try {
          const newInstructorId = await assignNextInstructorId(db);
          memberUpdates.instructorId = newInstructorId;
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

      memberUpdates.classVideoLibrarySubscription = true;
      memberUpdates.classVideoLibraryLastRenewalDate = orderDate;
      memberUpdates.classVideoLibraryExpirationDate = newExpires;

      if (order.mode === StripeCheckoutMode.Subscription && order.subscriptionId) {
        memberUpdates.classVideoLibrarySubscriptionId =
          order.subscriptionId;
        memberUpdates.classVideoLibraryNextAutoRenewDate = newExpires;
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
        targetSchoolRef = db.collection(FirestoreCollection.Schools).doc(schoolDocId);
      } else if (schoolId) {
        const sQuery = await db
          .collection(FirestoreCollection.Schools)
          .where('schoolId', '==', schoolId)
          .limit(1)
          .get();
        if (!sQuery.empty) {
          targetSchoolRef = sQuery.docs[0].ref;
        }
      } else if (!isNewSchool && member.instructorId) {
        const sQuery = await db
          .collection(FirestoreCollection.Schools)
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
          const sData = sDoc.data() as School | undefined;
          const currentExp = sData?.schoolLicenseExpires || '';
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

      const newSchoolDocRef = db.collection(FirestoreCollection.Schools).doc();
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
        ownerEmails: normalizeEmails(member.emails),
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
        memberUpdates.primarySchoolDocId = newSchoolDocRef.id;
        memberUpdates.primarySchoolId = newSchoolId;
      }
    } else if (category === OrderItemCategory.Grading) {
      gradingResults.push(
        await fulfillGradingForMember(
          db,
          member,
          item,
          orderDocId,
          gradingLevelForItem(order, gradingItemIndex),
        ),
      );
      gradingItemIndex++;
    } else if (category === OrderItemCategory.Vod || order.metadata?.['videoId'] || order.metadata?.['seriesId']) {
      let videoId = (order.metadata?.['videoId'] || '').replace(/^prod_/, '');
      let seriesId = (order.metadata?.['seriesId'] || '').replace(/^prod_/, '');

      if (!videoId && !seriesId && item.productId) {
        const prodId = item.productId;
        try {
          const [prodSnap, seriesProdSnap] = await Promise.all([
            db.collection(FirestoreCollection.Videos).where('stripeProductId', '==', prodId).limit(1).get(),
            db.collection(FirestoreCollection.Videos).where('seriesStripeProductId', '==', prodId).limit(1).get(),
          ]);
          if (!prodSnap.empty) {
            videoId = prodSnap.docs[0].id;
          } else if (!seriesProdSnap.empty) {
            const v = firestoreDocToVideoItem(seriesProdSnap.docs[0]);
            seriesId = v.seriesId || v.forVodPageId || seriesProdSnap.docs[0].id;
          } else {
            videoId = prodId.replace(/^prod_/, '');
          }
        } catch (err) {
          logger.warn('Failed to query videos for stripeProductId:', { prodId, err });
          videoId = prodId.replace(/^prod_/, '');
        }
      }

      // If targetType was explicitly passed as series, ensure seriesId is populated
      if (order.metadata?.['targetType'] === 'series' && videoId && !seriesId) {
        seriesId = videoId;
      }

      const grantTargetIds = new Set<string>();
      if (videoId) {
        grantTargetIds.add(videoId);
      }
      if (seriesId) {
        grantTargetIds.add(seriesId);
        try {
          const [bySeriesId, byVodPageId] = await Promise.all([
            db.collection(FirestoreCollection.Videos).where('seriesId', '==', seriesId).get(),
            db.collection(FirestoreCollection.Videos).where('forVodPageId', '==', seriesId).get(),
          ]);
          for (const doc of [...bySeriesId.docs, ...byVodPageId.docs]) {
            grantTargetIds.add(doc.id);
          }
        } catch (err) {
          logger.warn('Failed to expand series episodes for seriesId:', { seriesId, err });
        }
      }

      const isGift = order.metadata?.['isGift'] === 'true';
      const recipientEmail = normalizeEmail(order.metadata?.['recipientEmail']);
      const recipientName = (order.metadata?.['recipientName'] || '').trim();
      const giftMessage = (order.metadata?.['giftMessage'] || '').trim();
      const buyerName = member.name || order.customerName || 'A friend';
      const buyerEmail = normalizeEmail(member.emails?.[0] || order.customerEmail);

      let recipientMember: Member | null = null;
      if (isGift && recipientEmail) {
        try {
          recipientMember = await getMemberByEmail(recipientEmail, db);
        } catch {
          // Recipient might not be registered yet
        }
      }

      for (const targetId of grantTargetIds) {
        const targetMemberDocId = isGift ? (recipientMember?.docId || '') : member.docId;
        const targetEmail = isGift ? recipientEmail : normalizeEmail(member.emails?.[0] || order.customerEmail);

        // When fulfilling a series bundle with constituent episodes, only attribute the full purchase amount
        // to the primary purchased target (the series ID, or the standalone videoId). Constituent episode grants
        // provisioned as part of the series bundle should have amountPaidCents: 0 so prices are not multiplied.
        const isPrimaryTarget = seriesId ? targetId === seriesId : targetId === videoId;
        const grantAmountPaidCents = isPrimaryTarget ? (item.amountTotal || order.amountTotal || 0) : 0;

        const grant: VideoGrant = {
          docId: targetId,
          videoId: targetId,
          memberDocId: targetMemberDocId,
          memberEmail: targetEmail,
          grantKind: isGift ? VideoGrantKind.GiftPurchase : VideoGrantKind.StripePurchase,
          orderDocId,
          stripeSessionId: order.checkoutSessionId,
          amountPaidCents: grantAmountPaidCents,
          grantedAt: new Date().toISOString(),
          ...(isGift
            ? {
                giftedByMemberDocId: member.docId,
                giftedByName: buyerName,
                giftedByEmail: buyerEmail,
                giftMessage: giftMessage || undefined,
              }
            : {}),
        };

        if (targetMemberDocId) {
          await db
            .collection(FirestoreCollection.Members)
            .doc(targetMemberDocId)
            .collection(FirestoreSubcollection.VideoGrants)
            .doc(targetId)
            .set(grant);
        }

        const globalGrantKey = targetMemberDocId
          ? `${targetMemberDocId}_${targetId}`
          : `${targetEmail}_${targetId}`;
        await db
          .collection(FirestoreCollection.VideoGrants)
          .doc(globalGrantKey)
          .set(grant);

        logger.info(isGift ? 'Auto-provisioned gifted VideoGrant' : 'Auto-provisioned VideoGrant for member', {
          memberDocId: targetMemberDocId,
          recipientEmail: targetEmail,
          targetId,
          orderDocId,
          isGift,
        });

        if (isGift) {
          const videoTitle = item.description || 'Video on Demand';
          const messageSnippet = giftMessage ? `\n\n> "${giftMessage}"` : '';

          if (recipientMember) {
            await createMemberNotification(db, recipientMember.docId, {
              kind: NotificationKind.VideoGiftReceived,
              markdown: `🎁 **${buyerName}** gifted you access to [**${videoTitle}**](/videos/${targetId})!${messageSnippet}`,
              createdAt: new Date().toISOString(),
              dismissed: false,
              data: {
                videoId: targetId,
                seriesId: seriesId || undefined,
                title: videoTitle,
                grantKind: VideoGrantKind.GiftPurchase,
                giftedByName: buyerName,
                giftMessage: giftMessage || undefined,
                videoUrl: `/videos/${targetId}`,
              },
            });
          }

          if (recipientEmail) {
            try {
              const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';
              const videoUrl = `${appBase}/videos/${targetId}`;
              await sendTransactionalEmail(db, {
                to: recipientEmail,
                templateKey: TransactionalEmailKey.VodGiftReceived,
                replacements: {
                  name: recipientMember?.name || recipientName || 'ILC Member',
                  giverName: buyerName,
                  videoTitle,
                  videoUrl,
                  giftMessage: giftMessage || 'Enjoy the video!',
                  appBase,
                },
              });
            } catch (emailErr) {
              logger.error('Failed to send vodGiftReceived email during fulfillment', {
                emailErr,
                recipientEmail,
                targetId,
              });
            }
          }
        }
      }
    } else if (category === OrderItemCategory.Event || order.metadata?.['orderType'] === 'event_registration') {
      await fulfillEventRegistration(db, order, orderDocId, member);
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

    const newSubscription: MemberSubscriptionItem = {
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

    memberUpdates.stripeSubscriptions = {
      ...(member.stripeSubscriptions || {}),
      [subKey]: newSubscription,
    };
  }

  // One alert and one confirmation email per order, however many gradings it
  // bought. Re-processing an order fulfills nothing new, so sends nothing.
  await reportGradingPaymentProblems(
    db,
    member,
    orderDocId,
    gradingResults.flatMap((r) => (r.problem ? [r.problem] : [])),
  );
  await sendGradingConfirmationEmail(
    db,
    member,
    gradingResults.filter((r) => r.created && !r.problem),
  );

  await memberRef.update(memberUpdates);
  logger.info('FulfillStripeOrder updated member record', {
    memberDocId: member.docId,
    orderDocId,
  });

  // Send email confirmations for orders processed via Stripe (excluding events and gradings which send specific confirmations)
  const isEvent = order.lineItems.some(
    (l) =>
      categorizeLineItem(l, order.metadata) === OrderItemCategory.Event ||
      order.metadata?.['orderType'] === 'event_registration',
  );
  const isGrading = order.lineItems.some(
    (l) => categorizeLineItem(l, order.metadata) === OrderItemCategory.Grading,
  );
  const isVod = order.lineItems.some(
    (l) =>
      categorizeLineItem(l, order.metadata) === OrderItemCategory.Vod ||
      Boolean(order.metadata?.['videoId']) ||
      Boolean(order.metadata?.['seriesId']),
  );
  const recipientEmail = member.emails?.[0] || order.customerEmail || '';

  if (recipientEmail && !isEvent && !isGrading) {
    try {
      const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';
      const itemsSummary = order.lineItems.map((l) => l.description || 'ILC Purchase').join(', ');
      const totalAmount = order.amountTotal ? (order.amountTotal / 100).toFixed(2) : '0.00';
      const currency = (order.currency || 'usd').toUpperCase();

      if (order.stripeOrderType === StripeOrderType.Renewal) {
        const planName = order.lineItems[0]?.description || 'ILC Subscription';
        await sendTransactionalEmail(db, {
          to: recipientEmail,
          templateKey: TransactionalEmailKey.SubscriptionRenewal,
          replacements: {
            name: member.name || order.customerName || 'ILC Member',
            planName,
            amount: `${totalAmount} ${currency}`,
            renewalDate: orderDate || new Date().toISOString().split('T')[0],
            nextRenewalDate:
              memberUpdates.membershipNextAutoRenewDate ||
              memberUpdates.instructorLicenseNextAutoRenewDate ||
              memberUpdates.classVideoLibraryNextAutoRenewDate ||
              'Next billing cycle',
            receiptUrl: '',
            appBase,
          },
        });
      } else if (isVod) {
        const vodItem = order.lineItems.find(
          (l) => categorizeLineItem(l, order.metadata) === OrderItemCategory.Vod,
        );
        const videoTitle =
          vodItem?.description ||
          order.metadata?.['videoTitle'] ||
          order.lineItems[0]?.description ||
          'Video on Demand';
        const videoId = order.metadata?.['videoId'] || '';
        const isGiftOrder = order.metadata?.['isGift'] === 'true';
        const giftRecipient = order.metadata?.['recipientName'] || order.metadata?.['recipientEmail'] || '';
        const displayTitle = isGiftOrder && giftRecipient ? `${videoTitle} (Gift for ${giftRecipient})` : videoTitle;

        await sendTransactionalEmail(db, {
          to: recipientEmail,
          templateKey: TransactionalEmailKey.VodPurchaseConfirmation,
          replacements: {
            name: member.name || order.customerName || 'ILC Member',
            videoTitle: displayTitle,
            videoUrl: videoId ? `${appBase}/videos/${videoId}` : `${appBase}/videos`,
            amount: `${totalAmount} ${currency}`,
            receiptUrl: '',
            appBase,
          },
        });
      } else {
        await sendTransactionalEmail(db, {
          to: recipientEmail,
          templateKey: TransactionalEmailKey.OrderConfirmation,
          replacements: {
            name: member.name || order.customerName || 'Valued Customer',
            orderNumber: orderDocId,
            orderDate: orderDate || new Date().toISOString().split('T')[0],
            amount: totalAmount,
            currency,
            itemsSummary,
            receiptUrl: '',
            appBase,
          },
        });
      }
    } catch (emailErr) {
      logger.error('Failed to dispatch Stripe order confirmation email', { emailErr, orderDocId, recipientEmail });
    }
  }
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

  const memberRef = db.collection(FirestoreCollection.Members).doc(member.docId);
  const updates: MemberUpdates = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (member.membershipSubscriptionId === subscription.id) {
    updates.membershipNextAutoRenewDate = nextAutoRenewDate;
    if (isActive && periodEnd) {
      if (!member.currentMembershipExpires || member.currentMembershipExpires < periodEnd) {
        updates.currentMembershipExpires = periodEnd;
      }
    }
  }
  if (member.instructorLicenseSubscriptionId === subscription.id) {
    updates.instructorLicenseNextAutoRenewDate = nextAutoRenewDate;
    if (isActive && periodEnd) {
      if (!member.instructorLicenseExpires || member.instructorLicenseExpires < periodEnd) {
        updates.instructorLicenseExpires = periodEnd;
      }
    }
  }
  if (member.classVideoLibrarySubscriptionId === subscription.id) {
    updates.classVideoLibraryNextAutoRenewDate = nextAutoRenewDate;
    if (isActive && periodEnd) {
      updates.classVideoLibrarySubscription = true;
      if (!member.classVideoLibraryExpirationDate || member.classVideoLibraryExpirationDate < periodEnd) {
        updates.classVideoLibraryExpirationDate = periodEnd;
      }
    } else if (status === 'canceled' || status === 'unpaid') {
      const today = new Date().toISOString().split('T')[0];
      if (member.classVideoLibraryExpirationDate && member.classVideoLibraryExpirationDate < today) {
        updates.classVideoLibrarySubscription = false;
      }
    }
  }

  if (member.stripeSubscriptions && member.stripeSubscriptions[subscription.id]) {
    const existingSub = member.stripeSubscriptions[subscription.id];
    const updatedSub: MemberSubscriptionItem = {
      ...existingSub,
      status: status as SubscriptionStatus,
      ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
      nextAutoRenewDate,
      cancelAtPeriodEnd,
    };
    updates.stripeSubscriptions = {
      ...member.stripeSubscriptions,
      [subscription.id]: updatedSub,
    };
  }

  await memberRef.update(updates);
  logger.info('Synced subscription status to member', {
    memberDocId: member.docId,
    subscriptionId: subscription.id,
    status,
    nextAutoRenewDate,
  });
}
