/**
 * Stripe Subscriptions & Customer Portal callables.
 *
 * Provides member-facing actions for managing Stripe subscriptions:
 *  - `cancelSubscriptionRenewal`: Sets `cancel_at_period_end: true` in Stripe and clears nextAutoRenewDate on the member doc.
 *  - `resumeSubscriptionRenewal`: Sets `cancel_at_period_end: false` in Stripe and restores nextAutoRenewDate on the member doc.
 *  - `createCustomerPortalSession`: Generates a Stripe Billing Customer Portal URL for updating payment methods and viewing receipts.
 */

import Stripe from 'stripe';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins, getMemberByEmail, verifiedAuthEmail } from './common';
import { getStripeClient, stripeSecretKey } from './stripe-common';
import {
  CancelSubscriptionRenewalRequest,
  CancelSubscriptionRenewalResult,
  CreateCustomerPortalSessionRequest,
  CreateCustomerPortalSessionResult,
  GetManagedSchoolsBillingResult,
  ManagedSchoolBillingInfo,
  ResumeSubscriptionRenewalRequest,
  ResumeSubscriptionRenewalResult,
} from './stripe-types';
import {
  firestoreDocToMember,
  Member,
  MemberSubscriptionItem,
  MemberUpdates,
  SubscriptionInterval,
  SubscriptionItemType,
  SubscriptionStatus,
} from './data-model/members';
import { FirestoreCollection, FirestoreSubcollection } from './data-model/collections';
import { normalizeEmail } from './data-model/email';
import { ACL } from './data-model/system';
import { firestoreDocToSchool, School } from './data-model/schools';
import {
  MemberOrder,
  OrderItemCategory,
  OrderKind,
  StripeOrder,
  StripeOrderType,
} from './data-model/orders';

export function getSubscriptionCurrentPeriodStart(
  subscription: Stripe.Subscription,
): number | undefined {
  return (
    subscription.items?.data?.[0]?.current_period_start ??
    (subscription as unknown as { current_period_start?: number }).current_period_start ??
    subscription.start_date ??
    undefined
  );
}

export function getSubscriptionCurrentPeriodEnd(
  subscription: Stripe.Subscription,
): number | undefined {
  return (
    subscription.items?.data?.[0]?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    subscription.cancel_at ??
    undefined
  );
}

export function unixSecondsToDateString(seconds: number | null | undefined): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toISOString().split('T')[0];
}

/**
 * Computes the next recurring payment amount (in minor units / cents) from a
 * Stripe Subscription's items and any active repeating/forever discounts.
 * One-time (`duration: 'once'`) discounts are intentionally excluded because
 * they do not apply to subsequent renewal invoices.
 */
export function computeRecurringSubscriptionAmount(
  subscription: Stripe.Subscription,
): number | undefined {
  const items = subscription.items?.data;
  if (!items || items.length === 0) return undefined;

  let hasUnitAmount = false;
  let baseAmount = 0;
  for (const item of items) {
    const unitAmount = item.price?.unit_amount;
    if (typeof unitAmount === 'number') {
      hasUnitAmount = true;
      baseAmount += unitAmount * (item.quantity ?? 1);
    }
  }
  if (!hasUnitAmount) return undefined;

  const periodEnd = getSubscriptionCurrentPeriodEnd(subscription);
  const rawDiscounts: Stripe.Discount[] = [];
  if (Array.isArray(subscription.discounts)) {
    for (const d of subscription.discounts) {
      if (d && typeof d === 'object') {
        rawDiscounts.push(d as Stripe.Discount);
      }
    }
  }
  const legacyDiscount = (subscription as unknown as { discount?: Stripe.Discount | null }).discount;
  if (legacyDiscount && rawDiscounts.length === 0) {
    rawDiscounts.push(legacyDiscount);
  }

  let amount = baseAmount;
  for (const discount of rawDiscounts) {
    const coupon = (discount as unknown as { coupon?: Stripe.Coupon | null }).coupon;
    if (!coupon) continue;
    // Skip one-time discounts since they do not apply to the next renewal payment.
    if (coupon.duration === 'once') continue;
    // Skip repeating discounts that end at or before the next renewal date.
    if (
      coupon.duration === 'repeating' &&
      typeof discount.end === 'number' &&
      typeof periodEnd === 'number' &&
      discount.end <= periodEnd
    ) {
      continue;
    }
    if (typeof coupon.amount_off === 'number' && coupon.amount_off > 0) {
      amount = Math.max(0, amount - coupon.amount_off);
    } else if (typeof coupon.percent_off === 'number' && coupon.percent_off > 0) {
      amount = Math.max(0, Math.round(amount * (1 - coupon.percent_off / 100)));
    }
  }

  return amount;
}

export function inferSubscriptionItemTypeFromStripe(
  subscription: Stripe.Subscription,
  member?: Member | null,
  existing?: Partial<MemberSubscriptionItem>,
): SubscriptionItemType {
  if (existing?.type) return existing.type;
  if (member?.membershipSubscriptionId === subscription.id) {
    return SubscriptionItemType.Membership;
  }
  if (member?.instructorLicenseSubscriptionId === subscription.id) {
    return SubscriptionItemType.InstructorLicense;
  }
  if (member?.classVideoLibrarySubscriptionId === subscription.id) {
    return SubscriptionItemType.VideoLibrary;
  }

  const meta = subscription.metadata || {};
  const metaType = (meta['orderType'] || '').toLowerCase();
  if (metaType === 'school' || metaType === 'school_license' || meta['schoolDocId'] || meta['schoolId']) {
    return SubscriptionItemType.SchoolLicense;
  }
  if (metaType === 'video' || metaType === 'video_library') {
    return SubscriptionItemType.VideoLibrary;
  }
  if (metaType === 'license' || metaType === 'instructor_license') {
    return SubscriptionItemType.InstructorLicense;
  }
  if (metaType === 'membership') {
    return SubscriptionItemType.Membership;
  }

  const firstPrice = subscription.items?.data?.[0]?.price;
  const productObj =
    typeof firstPrice?.product === 'object' && firstPrice.product && 'name' in firstPrice.product
      ? firstPrice.product
      : null;
  const combinedLabel = [
    productObj?.name || '',
    firstPrice?.nickname || '',
    typeof firstPrice?.product === 'string' ? firstPrice.product : '',
  ]
    .join(' ')
    .toLowerCase();

  if (combinedLabel.includes('school')) return SubscriptionItemType.SchoolLicense;
  if (combinedLabel.includes('video library') || combinedLabel.includes('class video')) {
    return SubscriptionItemType.VideoLibrary;
  }
  if (combinedLabel.includes('instructor') || combinedLabel.includes('license')) {
    return SubscriptionItemType.InstructorLicense;
  }
  return SubscriptionItemType.Membership;
}

/**
 * Builds or updates a canonical `MemberSubscriptionItem` from a live Stripe Subscription.
 */
export function buildMemberSubscriptionItemFromStripe(
  subscription: Stripe.Subscription,
  options?: {
    existing?: Partial<MemberSubscriptionItem>;
    member?: Member | null;
    overrides?: Partial<MemberSubscriptionItem>;
  },
): MemberSubscriptionItem {
  const existing = options?.existing;
  const overrides = options?.overrides;
  const periodStart =
    unixSecondsToDateString(getSubscriptionCurrentPeriodStart(subscription)) ||
    existing?.currentPeriodStart ||
    '';
  const periodEnd =
    unixSecondsToDateString(getSubscriptionCurrentPeriodEnd(subscription)) ||
    existing?.currentPeriodEnd ||
    '';
  const status =
    (subscription.status as SubscriptionStatus) ||
    existing?.status ||
    SubscriptionStatus.Active;
  const isActive =
    status === SubscriptionStatus.Active || status === SubscriptionStatus.Trialing;
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const nextAutoRenewDate = !isActive || cancelAtPeriodEnd ? '' : periodEnd;

  const firstItem = subscription.items?.data?.[0];
  const price = firstItem?.price;
  const productObj =
    typeof price?.product === 'object' && price.product && 'name' in price.product
      ? price.product
      : null;
  const productId =
    (typeof price?.product === 'string' ? price.product : productObj?.id) ||
    existing?.stripeProductId ||
    '';
  const planName =
    overrides?.planName ||
    existing?.planName ||
    productObj?.name ||
    price?.nickname ||
    'Subscription';
  const recurringInterval =
    price?.recurring?.interval === 'year'
      ? SubscriptionInterval.Year
      : price?.recurring?.interval === 'month'
        ? SubscriptionInterval.Month
        : overrides?.interval || existing?.interval || SubscriptionInterval.Month;

  const computedAmount = computeRecurringSubscriptionAmount(subscription);
  const amount =
    computedAmount !== undefined
      ? computedAmount
      : (overrides?.amount ?? existing?.amount ?? 0);
  const currency = (
    subscription.currency ||
    price?.currency ||
    overrides?.currency ||
    existing?.currency ||
    'usd'
  ).toLowerCase();

  const type =
    overrides?.type ||
    inferSubscriptionItemTypeFromStripe(subscription, options?.member, existing);

  const schoolDocId =
    overrides?.schoolDocId ||
    existing?.schoolDocId ||
    subscription.metadata?.['schoolDocId'] ||
    undefined;
  const schoolId =
    overrides?.schoolId ||
    existing?.schoolId ||
    subscription.metadata?.['schoolId'] ||
    undefined;
  const schoolName =
    overrides?.schoolName ||
    existing?.schoolName ||
    subscription.metadata?.['schoolName'] ||
    undefined;

  const canceledAt = subscription.canceled_at
    ? unixSecondsToDateString(subscription.canceled_at)
    : cancelAtPeriodEnd
      ? existing?.canceledAt || ''
      : '';

  return {
    subscriptionId: subscription.id,
    type,
    status,
    planName,
    amount,
    currency,
    interval: recurringInterval,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    nextAutoRenewDate,
    cancelAtPeriodEnd,
    canceledAt,
    stripePriceId: price?.id || overrides?.stripePriceId || existing?.stripePriceId || '',
    stripeProductId: productId || overrides?.stripeProductId || '',
    ...(schoolDocId ? { schoolDocId } : {}),
    ...(schoolId ? { schoolId } : {}),
    ...(schoolName ? { schoolName } : {}),
  };
}

async function getCallerMember(
  authEmail: string | undefined,
  db: admin.firestore.Firestore,
): Promise<Member> {
  if (!authEmail) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.',
    );
  }
  return await getMemberByEmail(authEmail, db);
}

/**
 * Verify that the subscription belongs to the authenticated member or that the caller is an admin.
 */
async function verifySubscriptionOwnership(
  subscription: Stripe.Subscription,
  member: Member,
  db: admin.firestore.Firestore,
  authEmail?: string,
): Promise<void> {
  if (authEmail) {
    const aclDoc = await db.collection(FirestoreCollection.Acl).doc(normalizeEmail(authEmail)).get();
    if (aclDoc.exists && aclDoc.data()?.isAdmin === true) {
      return;
    }
  }

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;

  const memberDocIdMeta = subscription.metadata?.['memberDocId'];
  const matchesMemberDoc = memberDocIdMeta && memberDocIdMeta === member.docId;
  const matchesCustomer =
    member.stripeCustomerId && customerId === member.stripeCustomerId;
  const matchesMemberSub =
    member.membershipSubscriptionId === subscription.id ||
    member.instructorLicenseSubscriptionId === subscription.id ||
    member.classVideoLibrarySubscriptionId === subscription.id ||
    (member.stripeSubscriptions && !!member.stripeSubscriptions[subscription.id]);

  if (!matchesMemberDoc && !matchesCustomer && !matchesMemberSub) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to manage this subscription.',
    );
  }
}

export const cancelSubscriptionRenewal = onCall<
  CancelSubscriptionRenewalRequest,
  Promise<CancelSubscriptionRenewalResult>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  const subscriptionId = request.data?.subscriptionId;
  if (
    typeof subscriptionId !== 'string' ||
    !subscriptionId.startsWith('sub_')
  ) {
    throw new HttpsError(
      'invalid-argument',
      'A valid subscriptionId is required.',
    );
  }

  const db = admin.firestore();
  const member = await getCallerMember(verifiedAuthEmail(request), db);
  const stripe = getStripeClient();

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    throw new HttpsError('not-found', 'Subscription not found in Stripe.');
  }

  await verifySubscriptionOwnership(subscription, member, db, verifiedAuthEmail(request));

  const updatedSub = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  const periodEnd = unixSecondsToDateString(
    getSubscriptionCurrentPeriodEnd(updatedSub),
  );
  const today = new Date().toISOString().split('T')[0];

  // Update member doc
  const memberRef = db.collection(FirestoreCollection.Members).doc(member.docId);
  const updates: MemberUpdates = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (member.membershipSubscriptionId === subscriptionId) {
    updates.membershipNextAutoRenewDate = '';
  }
  if (member.instructorLicenseSubscriptionId === subscriptionId) {
    updates.instructorLicenseNextAutoRenewDate = '';
  }
  if (member.classVideoLibrarySubscriptionId === subscriptionId) {
    updates.classVideoLibraryNextAutoRenewDate = '';
  }

  const existingSub = member.stripeSubscriptions?.[subscriptionId];
  const syncedSub = buildMemberSubscriptionItemFromStripe(updatedSub, {
    existing: existingSub,
    member,
  });
  updates.stripeSubscriptions = {
    ...(member.stripeSubscriptions || {}),
    [subscriptionId]: {
      ...syncedSub,
      cancelAtPeriodEnd: true,
      nextAutoRenewDate: '',
      canceledAt: syncedSub.canceledAt || today,
    },
  };

  await memberRef.update(updates);

  logger.info('cancelSubscriptionRenewal succeeded', {
    memberDocId: member.docId,
    subscriptionId,
    periodEnd,
  });

  return { success: true, periodEnd };
});

export const resumeSubscriptionRenewal = onCall<
  ResumeSubscriptionRenewalRequest,
  Promise<ResumeSubscriptionRenewalResult>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  const subscriptionId = request.data?.subscriptionId;
  if (
    typeof subscriptionId !== 'string' ||
    !subscriptionId.startsWith('sub_')
  ) {
    throw new HttpsError(
      'invalid-argument',
      'A valid subscriptionId is required.',
    );
  }

  const db = admin.firestore();
  const member = await getCallerMember(verifiedAuthEmail(request), db);
  const stripe = getStripeClient();

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    throw new HttpsError('not-found', 'Subscription not found in Stripe.');
  }

  await verifySubscriptionOwnership(subscription, member, db, verifiedAuthEmail(request));

  const updatedSub = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });

  const nextAutoRenewDate = unixSecondsToDateString(
    getSubscriptionCurrentPeriodEnd(updatedSub),
  );

  // Update member doc
  const memberRef = db.collection(FirestoreCollection.Members).doc(member.docId);
  const updates: MemberUpdates = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (member.membershipSubscriptionId === subscriptionId) {
    updates.membershipNextAutoRenewDate = nextAutoRenewDate;
  }
  if (member.instructorLicenseSubscriptionId === subscriptionId) {
    updates.instructorLicenseNextAutoRenewDate = nextAutoRenewDate;
  }
  if (member.classVideoLibrarySubscriptionId === subscriptionId) {
    updates.classVideoLibraryNextAutoRenewDate = nextAutoRenewDate;
  }

  const existingSub = member.stripeSubscriptions?.[subscriptionId];
  const syncedSub = buildMemberSubscriptionItemFromStripe(updatedSub, {
    existing: existingSub,
    member,
  });
  updates.stripeSubscriptions = {
    ...(member.stripeSubscriptions || {}),
    [subscriptionId]: {
      ...syncedSub,
      cancelAtPeriodEnd: false,
      nextAutoRenewDate,
      canceledAt: '',
    },
  };

  await memberRef.update(updates);

  logger.info('resumeSubscriptionRenewal succeeded', {
    memberDocId: member.docId,
    subscriptionId,
    nextAutoRenewDate,
  });

  return { success: true, nextAutoRenewDate };
});

export const createCustomerPortalSession = onCall<
  CreateCustomerPortalSessionRequest,
  Promise<CreateCustomerPortalSessionResult>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  const returnUrl = request.data?.returnUrl;
  if (typeof returnUrl !== 'string' || !returnUrl.startsWith('http')) {
    throw new HttpsError('invalid-argument', 'A valid returnUrl is required.');
  }

  const db = admin.firestore();
  const member = await getCallerMember(verifiedAuthEmail(request), db);
  const stripe = getStripeClient();

  let customerId = member.stripeCustomerId;

  // If the member doesn't have a recorded Stripe customer ID, look up or create one in Stripe
  if (!customerId) {
    const existing = await stripe.customers.list({
      email: member.emails[0] || verifiedAuthEmail(request),
      limit: 1,
    });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const created = await stripe.customers.create({
        email: member.emails[0] || verifiedAuthEmail(request),
        name: member.name || undefined,
        metadata: {
          memberDocId: member.docId,
          memberId: member.memberId,
        },
      });
      customerId = created.id;
    }

    // Cache customerId onto member document
    await db
      .collection(FirestoreCollection.Members)
      .doc(member.docId)
      .update({
        stripeCustomerId: customerId,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  logger.info('createCustomerPortalSession created session', {
    memberDocId: member.docId,
    customerId,
    portalUrl: session.url,
  });

  return { url: session.url };
});

function matchesSchoolSubscription(
  sub: MemberSubscriptionItem,
  school: School,
  ownerSchoolCount: number,
  isSchoolOwner: boolean,
): boolean {
  if (sub.type !== SubscriptionItemType.SchoolLicense) return false;
  if (sub.schoolDocId) {
    return sub.schoolDocId === school.docId;
  }
  if (sub.schoolId && school.schoolId) {
    return sub.schoolId === school.schoolId;
  }
  // Legacy fallback: before schoolDocId was persisted on MemberSubscriptionItem,
  // a member who owned exactly one school had an unlinked SchoolLicense subscription.
  return isSchoolOwner && ownerSchoolCount === 1;
}

/**
 * Resolves billing & payer attribution for every school owned or managed by the
 * authenticated caller's ACL record. Fails closed when ACL is missing.
 */
export async function resolveManagedSchoolsBillingForEmail(
  db: admin.firestore.Firestore,
  authEmail: string,
): Promise<GetManagedSchoolsBillingResult> {
  const normalizedEmail = normalizeEmail(authEmail);
  if (!normalizedEmail) {
    throw new HttpsError('unauthenticated', 'Authenticated email required.');
  }

  const aclSnap = await db.collection(FirestoreCollection.Acl).doc(normalizedEmail).get();
  if (!aclSnap.exists) {
    return { schools: {} };
  }

  const acl = aclSnap.data() as ACL;
  const schoolByDocId = new Map<string, School>();

  // 1. Load schools referenced in ACL's cached schoolDocIds
  const aclSchoolDocIds = Array.from(new Set((acl.schoolDocIds || []).filter(Boolean)));
  if (aclSchoolDocIds.length > 0) {
    const snaps = await Promise.all(
      aclSchoolDocIds.map((id) => db.collection(FirestoreCollection.Schools).doc(id).get()),
    );
    for (const snap of snaps) {
      if (snap.exists) {
        const s = firestoreDocToSchool(snap);
        schoolByDocId.set(s.docId, s);
      }
    }
  }

  // 2. Also include schools directly matching ACL memberDocIds or instructorIds
  const aclMemberDocIds = Array.from(new Set((acl.memberDocIds || []).filter(Boolean)));
  for (const mDocId of aclMemberDocIds) {
    const ownedSnap = await db
      .collection(FirestoreCollection.Schools)
      .where('ownerMemberDocId', '==', mDocId)
      .get();
    for (const doc of ownedSnap.docs) {
      const s = firestoreDocToSchool(doc);
      schoolByDocId.set(s.docId, s);
    }
  }

  const aclInstructorIds = Array.from(new Set((acl.instructorIds || []).filter(Boolean)));
  for (const insId of aclInstructorIds) {
    const [ownedByIns, managedByIns] = await Promise.all([
      db.collection(FirestoreCollection.Schools).where('ownerInstructorId', '==', insId).get(),
      db.collection(FirestoreCollection.Schools).where('managerInstructorIds', 'array-contains', insId).get(),
    ]);
    for (const doc of [...ownedByIns.docs, ...managedByIns.docs]) {
      const s = firestoreDocToSchool(doc);
      schoolByDocId.set(s.docId, s);
    }
  }

  if (schoolByDocId.size === 0) {
    return { schools: {} };
  }

  const memberCache = new Map<string, Member>();
  const getCachedMember = async (memberDocId: string): Promise<Member | null> => {
    if (!memberDocId) return null;
    const cached = memberCache.get(memberDocId);
    if (cached) return cached;
    const snap = await db.collection(FirestoreCollection.Members).doc(memberDocId).get();
    if (!snap.exists) return null;
    const m = firestoreDocToMember(snap);
    memberCache.set(m.docId, m);
    return m;
  };

  // Preload members linked to all owner/manager instructorIds across these schools
  const allInstructorIds = Array.from(
    new Set(
      Array.from(schoolByDocId.values())
        .flatMap((s) => [s.ownerInstructorId, ...(s.managerInstructorIds || [])])
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  );
  for (let i = 0; i < allInstructorIds.length; i += 30) {
    const chunk = allInstructorIds.slice(i, i + 30);
    const snap = await db
      .collection(FirestoreCollection.Members)
      .where('instructorId', 'in', chunk)
      .get();
    for (const doc of snap.docs) {
      const m = firestoreDocToMember(doc);
      memberCache.set(m.docId, m);
    }
  }

  const schoolsOut: Record<string, ManagedSchoolBillingInfo> = {};

  for (const school of schoolByDocId.values()) {
    if (school.ownerMemberDocId) {
      await getCachedMember(school.ownerMemberDocId);
    }

    // Check Stripe orders targeting this school (by schoolDocId or schoolId)
    const orderQueries: Promise<admin.firestore.QuerySnapshot>[] = [
      db
        .collection(FirestoreCollection.Orders)
        .where('metadata.schoolDocId', '==', school.docId)
        .get(),
    ];
    if (school.schoolId) {
      orderQueries.push(
        db
          .collection(FirestoreCollection.Orders)
          .where('metadata.schoolId', '==', school.schoolId)
          .get(),
      );
    }
    const orderSnaps = await Promise.all(orderQueries);
    const stripeOrdersById = new Map<string, StripeOrder>();
    for (const qSnap of orderSnaps) {
      for (const doc of qSnap.docs) {
        const data = doc.data() as StripeOrder;
        if (data.ilcAppOrderKind === OrderKind.Stripe) {
          stripeOrdersById.set(doc.id, { ...data, docId: doc.id });
          const orderMemDocId = data.metadata?.['memberDocId'];
          if (orderMemDocId) {
            await getCachedMember(orderMemDocId);
          }
        }
      }
    }

    // Priority 1: Check candidate members' stripeSubscriptions for a matching SchoolLicense subscription
    let matchedSubEntry: { member: Member; sub: MemberSubscriptionItem } | null = null;
    for (const candidate of memberCache.values()) {
      if (!candidate.stripeSubscriptions) continue;
      const isSchoolOwner =
        candidate.docId === school.ownerMemberDocId ||
        Boolean(candidate.instructorId && candidate.instructorId === school.ownerInstructorId);
      const ownerSchoolCount = isSchoolOwner
        ? Array.from(schoolByDocId.values()).filter(
            (s) =>
              s.ownerMemberDocId === candidate.docId ||
              (candidate.instructorId && s.ownerInstructorId === candidate.instructorId),
          ).length
        : 0;

      for (const sub of Object.values(candidate.stripeSubscriptions)) {
        if (!matchesSchoolSubscription(sub, school, ownerSchoolCount, isSchoolOwner)) {
          continue;
        }
        if (!matchedSubEntry) {
          matchedSubEntry = { member: candidate, sub };
          continue;
        }
        const curActive =
          matchedSubEntry.sub.status === SubscriptionStatus.Active ||
          matchedSubEntry.sub.status === SubscriptionStatus.Trialing;
        const nextActive =
          sub.status === SubscriptionStatus.Active ||
          sub.status === SubscriptionStatus.Trialing;
        if (nextActive && !curActive) {
          matchedSubEntry = { member: candidate, sub };
        } else if (
          nextActive === curActive &&
          (sub.currentPeriodEnd || '') > (matchedSubEntry.sub.currentPeriodEnd || '')
        ) {
          matchedSubEntry = { member: candidate, sub };
        }
      }
    }

    if (matchedSubEntry) {
      const { member: payerMember, sub } = matchedSubEntry;
      const isActiveStatus =
        sub.status === SubscriptionStatus.Active ||
        sub.status === SubscriptionStatus.Trialing;
      const isAutoRenewing =
        isActiveStatus && !sub.cancelAtPeriodEnd && Boolean(sub.nextAutoRenewDate);
      schoolsOut[school.docId] = {
        schoolDocId: school.docId,
        schoolId: school.schoolId,
        payerMemberDocId: payerMember.docId,
        payerMemberId: payerMember.memberId || '',
        payerName: payerMember.name || '',
        isAutoRenewing,
        nextAutoRenewDate: isAutoRenewing ? sub.nextAutoRenewDate : '',
        amount: typeof sub.amount === 'number' ? sub.amount : null,
        currency: sub.currency || 'usd',
        interval: sub.interval === SubscriptionInterval.Month ? 'month' : 'year',
        lastPaymentDate: sub.currentPeriodStart || school.schoolLicenseRenewalDate || '',
      };
      continue;
    }

    // Priority 2: Latest paid Stripe order targeting this school
    const paidStripeOrders = Array.from(stripeOrdersById.values())
      .filter((o) => o.stripeOrderType !== StripeOrderType.Cancellation)
      .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    if (paidStripeOrders.length > 0) {
      const latestOrder = paidStripeOrders[0];
      const orderMemDocId = latestOrder.metadata?.['memberDocId'] || '';
      const payerMember = orderMemDocId ? await getCachedMember(orderMemDocId) : null;
      schoolsOut[school.docId] = {
        schoolDocId: school.docId,
        schoolId: school.schoolId,
        payerMemberDocId: payerMember?.docId || '',
        payerMemberId: payerMember?.memberId || '',
        payerName: payerMember?.name || latestOrder.customerName || '',
        isAutoRenewing: false,
        nextAutoRenewDate: '',
        amount: latestOrder.amountTotal ?? null,
        currency: latestOrder.currency || 'usd',
        lastPaymentDate: latestOrder.created
          ? latestOrder.created.split('T')[0]
          : school.schoolLicenseRenewalDate || '',
      };
      continue;
    }

    // Priority 3: Check school owner/managers' mirrored `/members/{id}/orders` for legacy Squarespace/Sheets school license orders
    const schoolCandidates = Array.from(memberCache.values()).filter(
      (m) =>
        m.docId === school.ownerMemberDocId ||
        (m.instructorId &&
          (m.instructorId === school.ownerInstructorId ||
            school.managerInstructorIds?.includes(m.instructorId))),
    );
    let latestMirrorMatch: { member: Member; order: MemberOrder; sortDate: string } | null = null;
    for (const candidate of schoolCandidates) {
      const ordersSnap = await db
        .collection(FirestoreCollection.Members)
        .doc(candidate.docId)
        .collection(FirestoreSubcollection.Orders)
        .get();
      for (const oDoc of ordersSnap.docs) {
        const mo = oDoc.data() as MemberOrder;
        const hasSchoolLine =
          mo.lineItems?.some(
            (li) =>
              li.category === OrderItemCategory.SchoolLicense ||
              (li.description || '').toLowerCase().includes('school'),
          ) || (mo.description || '').toLowerCase().includes('school');
        if (!hasSchoolLine) continue;
        // If description mentions a specific SCH-* ID, ensure it matches this school
        const descText = [
          mo.description || '',
          ...(mo.lineItems || []).map((li) => li.description || ''),
        ].join(' ');
        if (
          school.schoolId &&
          descText.includes('SCH-') &&
          !descText.includes(school.schoolId)
        ) {
          continue;
        }
        const sortDate = (mo.date || mo.created || '').split('T')[0];
        if (!latestMirrorMatch || sortDate > latestMirrorMatch.sortDate) {
          latestMirrorMatch = { member: candidate, order: mo, sortDate };
        }
      }
    }

    if (latestMirrorMatch) {
      schoolsOut[school.docId] = {
        schoolDocId: school.docId,
        schoolId: school.schoolId,
        payerMemberDocId: latestMirrorMatch.member.docId,
        payerMemberId: latestMirrorMatch.member.memberId || '',
        payerName: latestMirrorMatch.member.name || '',
        isAutoRenewing: false,
        nextAutoRenewDate: '',
        amount: latestMirrorMatch.order.amountTotal ?? null,
        currency: latestMirrorMatch.order.currency || 'usd',
        lastPaymentDate: latestMirrorMatch.sortDate || school.schoolLicenseRenewalDate || '',
      };
    }
  }

  return { schools: schoolsOut };
}

export const getManagedSchoolsBilling = onCall<
  Record<string, never>,
  Promise<GetManagedSchoolsBillingResult>
>({ cors: allowedOrigins }, async (request) => {
  const authEmail = verifiedAuthEmail(request);
  if (!authEmail) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.',
    );
  }
  const db = admin.firestore();
  return await resolveManagedSchoolsBillingForEmail(db, authEmail);
});
