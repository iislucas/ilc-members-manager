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
  initGrading,
  StripeOrder,
  StripeOrderLineItem,
  StripeCheckoutMode,
  SubscriptionItemType,
  SubscriptionStatus,
  SubscriptionInterval,
} from './data-model';
import { canonicalizeGradingLevel } from './level-utils';

import { getSubscriptionCurrentPeriodEnd } from './stripe-subscriptions';

function unixSecondsToDateString(seconds: number | null | undefined): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toISOString().split('T')[0];
}

/**
 * Add N years to an existing date string (YYYY-MM-DD), ensuring that if the
 * current date has not yet passed, the extension starts from the current
 * expiry rather than resetting from today.
 */
function extendDateByYears(currentDateStr: string, yearsToAdd = 1): string {
  const todayStr = new Date().toISOString().split('T')[0];
  const baseDateStr =
    currentDateStr && currentDateStr >= todayStr ? currentDateStr : todayStr;
  const d = new Date(baseDateStr + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + yearsToAdd);
  return d.toISOString().split('T')[0];
}

/**
 * Add N months to an existing date string (YYYY-MM-DD).
 */
function extendDateByMonths(currentDateStr: string, monthsToAdd = 1): string {
  const todayStr = new Date().toISOString().split('T')[0];
  const baseDateStr =
    currentDateStr && currentDateStr >= todayStr ? currentDateStr : todayStr;
  const d = new Date(baseDateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + monthsToAdd);
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
      return { ...doc.data(), docId: doc.id } as Member;
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
      return { ...doc.data(), docId: doc.id } as Member;
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
          return { ...doc.data(), docId: doc.id } as Member;
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
      return { ...doc.data(), docId: doc.id } as Member;
    }
  }

  return null;
}

/**
 * Categorize a line item based on description, product ID, or metadata.
 */
function categorizeLineItem(
  item: StripeOrderLineItem,
): OrderItemCategory {
  const desc = item.description.toLowerCase();
  const prod = (item.productId ?? '').toLowerCase();

  if (desc.includes('membership') || prod.includes('membership')) {
    return OrderItemCategory.Membership;
  }
  if (
    desc.includes('license') ||
    desc.includes('instructor') ||
    prod.includes('license')
  ) {
    return OrderItemCategory.InstructorLicense;
  }
  if (desc.includes('grading') || prod.includes('grading')) {
    return OrderItemCategory.Grading;
  }
  if (
    desc.includes('video library') ||
    desc.includes('video') ||
    prod.includes('video')
  ) {
    return OrderItemCategory.VideoLibrary;
  }
  if (desc.includes('event') || desc.includes('workshop')) {
    return OrderItemCategory.Event;
  }
  return OrderItemCategory.Other;
}

function categorizeSubscriptionItem(
  item: StripeOrderLineItem,
): SubscriptionItemType {
  const cat = categorizeLineItem(item);
  if (cat === OrderItemCategory.InstructorLicense) {
    return SubscriptionItemType.InstructorLicense;
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
    memberId: member.memberId,
    orderKind: MemberOrderKind.Stripe,
    orderType: order.stripeOrderType as unknown as MemberOrderType,
    orderNumber: order.invoiceId || order.stripeObjectId || '',
    date: order.created.split('T')[0],
    created: order.created,
    lastUpdated: new Date().toISOString(),
    amountTotal: order.amountTotal,
    currency: order.currency,
    paymentStatus: (order.paymentStatus as unknown as MemberOrderPaymentStatus) ?? null,
    fulfillmentStatus: MemberOrderFulfillmentStatus.Fulfilled,
    description,
    lineItems: order.lineItems.map((item) => ({
      productId: item.productId,
      priceId: item.priceId,
      description: item.description,
      quantity: item.quantity,
      amountTotal: item.amountTotal,
      currency: item.currency,
      category: categorizeLineItem(item),
    })),
    subscriptionId: order.subscriptionId,
    stripeInvoiceId: order.invoiceId,
  };

  await memberOrderRef.set(memberOrder, { merge: true });
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

/**
 * Automatically creates a Grading record when a member purchases a grading.
 */
async function autoCreateGradingForMember(
  db: admin.firestore.Firestore,
  member: Member,
  lineItem: StripeOrderLineItem,
  orderDocId: string,
): Promise<string> {
  const purchaseDate = new Date().toISOString().split('T')[0];
  const level = extractGradingLevel(lineItem.description);

  // Check if a grading was already created for this order to prevent duplicates
  const existingQuery = await db
    .collection('gradings')
    .where('orderId', '==', orderDocId)
    .limit(1)
    .get();
  if (!existingQuery.empty) {
    return existingQuery.docs[0].id;
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
    level,
    status: GradingStatus.AwaitingRequest,
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

  logger.info('Auto-created grading for member', {
    memberDocId: member.docId,
    gradingDocId: createdRef.id,
    level,
  });

  return createdRef.id;
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
  const today = new Date().toISOString().split('T')[0];
  const memberRef = db.collection('members').doc(member.docId);
  const memberUpdates: Record<string, unknown> = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Cache customer ID if present
  if (order.stripeCustomerId && !member.stripeCustomerId) {
    memberUpdates['stripeCustomerId'] = order.stripeCustomerId;
  }

  for (const item of order.lineItems) {
    const category = categorizeLineItem(item);
    const descLower = item.description.toLowerCase();

    if (category === OrderItemCategory.Membership) {
      if (descLower.includes('life')) {
        memberUpdates['membershipType'] = MembershipType.Life;
        memberUpdates['currentMembershipExpires'] = '9999-12-31';
        memberUpdates['membershipNextAutoRenewDate'] = '';
      } else {
        const newExpires = extendDateByYears(
          member.currentMembershipExpires,
          1,
        );
        memberUpdates['membershipType'] = MembershipType.Annual;
        memberUpdates['lastRenewalDate'] = today;
        memberUpdates['currentMembershipExpires'] = newExpires;

        if (order.mode === StripeCheckoutMode.Subscription && order.subscriptionId) {
          memberUpdates['membershipSubscriptionId'] = order.subscriptionId;
          memberUpdates['membershipNextAutoRenewDate'] = newExpires;
        }
      }
    } else if (category === OrderItemCategory.InstructorLicense) {
      const newExpires = extendDateByYears(
        member.instructorLicenseExpires,
        1,
      );
      memberUpdates['instructorLicenseRenewalDate'] = today;
      memberUpdates['instructorLicenseExpires'] = newExpires;
      memberUpdates['instructorLicenseType'] = InstructorLicenseType.Annual;

      if (order.mode === StripeCheckoutMode.Subscription && order.subscriptionId) {
        memberUpdates['instructorLicenseSubscriptionId'] =
          order.subscriptionId;
        memberUpdates['instructorLicenseNextAutoRenewDate'] = newExpires;
      }
    } else if (category === OrderItemCategory.VideoLibrary) {
      const isYearly = descLower.includes('year') || descLower.includes('annual');
      const newExpires = isYearly
        ? extendDateByYears(member.classVideoLibraryExpirationDate, 1)
        : extendDateByMonths(member.classVideoLibraryExpirationDate, 1);

      memberUpdates['classVideoLibrarySubscription'] = true;
      memberUpdates['classVideoLibraryLastRenewalDate'] = today;
      memberUpdates['classVideoLibraryExpirationDate'] = newExpires;

      if (order.mode === StripeCheckoutMode.Subscription && order.subscriptionId) {
        memberUpdates['classVideoLibrarySubscriptionId'] =
          order.subscriptionId;
        memberUpdates['classVideoLibraryNextAutoRenewDate'] = newExpires;
      }
    } else if (category === OrderItemCategory.Grading) {
      await autoCreateGradingForMember(db, member, item, orderDocId);
    }
  }

  // If order was a subscription, record into subscriptions map
  if (order.subscriptionId && order.mode === StripeCheckoutMode.Subscription) {
    const subKey = order.subscriptionId;
    const isYearly = order.lineItems.some((l) =>
      l.description.toLowerCase().includes('year'),
    );
    const interval = isYearly ? SubscriptionInterval.Year : SubscriptionInterval.Month;
    const periodEnd = isYearly
      ? extendDateByYears(today, 1)
      : extendDateByMonths(today, 1);

    memberUpdates[`subscriptions.${subKey}`] = {
      subscriptionId: order.subscriptionId,
      type: categorizeSubscriptionItem(order.lineItems[0] || { description: '', productId: null, priceId: null, quantity: null, amountTotal: 0, currency: 'usd' }),
      status: SubscriptionStatus.Active,
      planName: order.lineItems[0]?.description || 'Subscription',
      amount: order.amountTotal || 0,
      currency: order.currency || 'usd',
      interval,
      currentPeriodStart: today,
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
    if (doc.exists) member = { ...doc.data(), docId: doc.id } as Member;
  }

  if (!member && customerId) {
    const query = await db
      .collection('members')
      .where('stripeCustomerId', '==', customerId)
      .limit(1)
      .get();
    if (!query.empty) {
      member = { ...query.docs[0].data(), docId: query.docs[0].id } as Member;
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

  const memberRef = db.collection('members').doc(member.docId);
  const updates: Record<string, unknown> = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (member.membershipSubscriptionId === subscription.id) {
    updates['membershipNextAutoRenewDate'] = nextAutoRenewDate;
  }
  if (member.instructorLicenseSubscriptionId === subscription.id) {
    updates['instructorLicenseNextAutoRenewDate'] = nextAutoRenewDate;
  }
  if (member.classVideoLibrarySubscriptionId === subscription.id) {
    updates['classVideoLibraryNextAutoRenewDate'] = nextAutoRenewDate;
  }

  if (member.stripeSubscriptions && member.stripeSubscriptions[subscription.id]) {
    updates[`subscriptions.${subscription.id}.status`] = status;
    updates[`subscriptions.${subscription.id}.currentPeriodEnd`] = periodEnd;
    updates[`subscriptions.${subscription.id}.nextAutoRenewDate`] =
      nextAutoRenewDate;
    updates[`subscriptions.${subscription.id}.cancelAtPeriodEnd`] =
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
