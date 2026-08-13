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
import { allowedOrigins, getMemberByEmail } from './common';
import { getStripeClient, stripeSecretKey } from './stripe-common';
import {
  CancelSubscriptionRenewalRequest,
  CancelSubscriptionRenewalResult,
  CreateCustomerPortalSessionRequest,
  CreateCustomerPortalSessionResult,
  ResumeSubscriptionRenewalRequest,
  ResumeSubscriptionRenewalResult,
} from './stripe-types';
import { Member } from './data-model';

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

function unixSecondsToDateString(seconds: number | null | undefined): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toISOString().split('T')[0];
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
): Promise<void> {
  if (member.isAdmin) return;

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
  const member = await getCallerMember(request.auth?.token?.email, db);
  const stripe = getStripeClient();

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    throw new HttpsError('not-found', 'Subscription not found in Stripe.');
  }

  await verifySubscriptionOwnership(subscription, member);

  const updatedSub = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  const periodEnd = unixSecondsToDateString(
    getSubscriptionCurrentPeriodEnd(updatedSub),
  );
  const today = new Date().toISOString().split('T')[0];

  // Update member doc
  const memberRef = db.collection('members').doc(member.docId);
  const updates: Record<string, unknown> = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (member.membershipSubscriptionId === subscriptionId) {
    updates['membershipNextAutoRenewDate'] = '';
  }
  if (member.instructorLicenseSubscriptionId === subscriptionId) {
    updates['instructorLicenseNextAutoRenewDate'] = '';
  }
  if (member.classVideoLibrarySubscriptionId === subscriptionId) {
    updates['classVideoLibraryNextAutoRenewDate'] = '';
  }

  if (member.stripeSubscriptions && member.stripeSubscriptions[subscriptionId]) {
    updates[`stripeSubscriptions.${subscriptionId}.cancelAtPeriodEnd`] = true;
    updates[`stripeSubscriptions.${subscriptionId}.nextAutoRenewDate`] = '';
    updates[`stripeSubscriptions.${subscriptionId}.canceledAt`] = today;
  }

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
  const member = await getCallerMember(request.auth?.token?.email, db);
  const stripe = getStripeClient();

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    throw new HttpsError('not-found', 'Subscription not found in Stripe.');
  }

  await verifySubscriptionOwnership(subscription, member);

  const updatedSub = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });

  const nextAutoRenewDate = unixSecondsToDateString(
    getSubscriptionCurrentPeriodEnd(updatedSub),
  );

  // Update member doc
  const memberRef = db.collection('members').doc(member.docId);
  const updates: Record<string, unknown> = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (member.membershipSubscriptionId === subscriptionId) {
    updates['membershipNextAutoRenewDate'] = nextAutoRenewDate;
  }
  if (member.instructorLicenseSubscriptionId === subscriptionId) {
    updates['instructorLicenseNextAutoRenewDate'] = nextAutoRenewDate;
  }
  if (member.classVideoLibrarySubscriptionId === subscriptionId) {
    updates['classVideoLibraryNextAutoRenewDate'] = nextAutoRenewDate;
  }

  if (member.stripeSubscriptions && member.stripeSubscriptions[subscriptionId]) {
    updates[`stripeSubscriptions.${subscriptionId}.cancelAtPeriodEnd`] = false;
    updates[`stripeSubscriptions.${subscriptionId}.nextAutoRenewDate`] =
      nextAutoRenewDate;
    updates[`stripeSubscriptions.${subscriptionId}.canceledAt`] = '';
  }

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
  const member = await getCallerMember(request.auth?.token?.email, db);
  const stripe = getStripeClient();

  let customerId = member.stripeCustomerId;

  // If the member doesn't have a recorded Stripe customer ID, look up or create one in Stripe
  if (!customerId) {
    const existing = await stripe.customers.list({
      email: member.emails[0] || request.auth?.token?.email,
      limit: 1,
    });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const created = await stripe.customers.create({
        email: member.emails[0] || request.auth?.token?.email,
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
      .collection('members')
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
