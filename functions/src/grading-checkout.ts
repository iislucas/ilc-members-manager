/* grading-checkout.ts
 *
 * `createGradingCheckoutSession`: the only way to buy gradings online. The
 * browser says which levels it wants; the server decides everything that
 * matters:
 *
 *  - the caller must be signed in, manage the member profile, and that member
 *    must have an active membership;
 *  - the levels must be exactly the next ones this member can buy, in order
 *    (a prefix of `upcomingGradingPayments`, skipping a free retake) — so only
 *    syllabus levels (student and application) can ever be bought;
 *  - the price for each level is looked up by the server in the live Stripe
 *    catalogue (`findGradingPrice`), never taken from the browser, and all
 *    prices must share one currency (Stripe Checkout cannot mix currencies);
 *  - the order metadata that grading fulfillment trusts (`gradingLevel`,
 *    `gradingLevels`, `orderType`) is written here and nowhere else.
 *
 * The generic `createStripeCheckoutSession` refuses grading prices, so this is
 * the single path.
 */

import Stripe from 'stripe';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { allowedOrigins, getUserMemberDocIds } from './common';
import { getStripeClient, stripeSecretKey } from './stripe-common';
import { fetchStripeProducts } from './stripe-products';
import { requireAllowedOrigin, stripeCustomerForMember } from './stripe-checkout';
import {
  CreateCheckoutSessionResult,
  CreateGradingCheckoutSessionRequest,
} from './stripe-types';
import { FirestoreCollection } from './data-model/collections';
import { GradingLevel, gradingProgression, toGradingLevel } from './data-model/curriculum';
import {
  Grading,
  freeRetakeLevel,
  upcomingGradingPayments,
} from './data-model/gradings';
import { findGradingPrice, GradingPrice } from './data-model/grading-prices';
import { Member, firestoreDocToMember, hasActiveMembership } from './data-model/members';

// Validates the requested levels: a non-empty, duplicate-free list of syllabus
// levels no longer than the progression. Returns them in canonical form.
export function parseRequestedLevels(raw: unknown): GradingLevel[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > gradingProgression.length) {
    throw new HttpsError('invalid-argument', 'Choose between one and all remaining grading levels.');
  }
  const levels = raw.map((r) => (typeof r === 'string' ? toGradingLevel(r) : null));
  if (levels.some((l) => l === null)) {
    throw new HttpsError('invalid-argument', 'Only student and application grading levels can be purchased.');
  }
  const canonical = levels as GradingLevel[];
  if (new Set(canonical).size !== canonical.length) {
    throw new HttpsError('invalid-argument', 'Each grading level can only be bought once per order.');
  }
  return canonical;
}

// Checks `requested` is exactly the first N levels this member can buy next.
export function checkLevelsArePurchasable(
  member: Member,
  gradings: Grading[],
  requested: GradingLevel[],
): void {
  const upcoming = upcomingGradingPayments(
    member.studentLevel,
    member.applicationLevel,
    gradings,
    freeRetakeLevel(member.studentLevel, member.applicationLevel, gradings),
  ).map((p) => p.level);
  const expected = upcoming.slice(0, requested.length);
  if (expected.length !== requested.length || expected.some((l, i) => l !== requested[i])) {
    throw new HttpsError(
      'failed-precondition',
      `These gradings can't be bought now. The next levels available are: ${upcoming.slice(0, 3).join(', ') || 'none'}.`,
    );
  }
}

// Resolves each level's price from the catalogue, checking they are all on
// sale and share one currency. Throws when any is missing.
export function pricesForLevels(
  products: Awaited<ReturnType<typeof fetchStripeProducts>>['products'],
  levels: GradingLevel[],
): GradingPrice[] {
  const prices = levels.map((level) => ({ level, match: findGradingPrice(products, level) }));
  const missing = prices.filter((p) => !p.match).map((p) => p.level);
  if (missing.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `Grading fees for ${missing.join(', ')} are not available right now.`,
    );
  }
  const matched = prices.map((p) => p.match as GradingPrice);
  const currencies = new Set(matched.map((m) => m.price.currency.toLowerCase()));
  if (currencies.size > 1) {
    throw new HttpsError(
      'failed-precondition',
      'These gradings are priced in different currencies, so they must be bought in separate orders.',
    );
  }
  return matched;
}

export const createGradingCheckoutSession = onCall<
  CreateGradingCheckoutSessionRequest,
  Promise<CreateCheckoutSessionResult>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  const email = request.auth?.token?.email;
  if (!email) {
    throw new HttpsError('unauthenticated', 'You must be signed in to purchase a grading.');
  }
  const origin = requireAllowedOrigin(request.data?.origin);
  const levels = parseRequestedLevels(request.data?.levels);
  const memberDocId = request.data?.memberDocId;
  if (typeof memberDocId !== 'string' || !memberDocId) {
    throw new HttpsError('invalid-argument', 'memberDocId is required.');
  }

  const db = admin.firestore();
  if (!(await getUserMemberDocIds(email, db)).includes(memberDocId)) {
    throw new HttpsError('permission-denied', 'You cannot buy gradings for this member.');
  }
  const memberSnap = await db.collection(FirestoreCollection.Members).doc(memberDocId).get();
  if (!memberSnap.exists) {
    throw new HttpsError('not-found', 'Member not found.');
  }
  const member = firestoreDocToMember(memberSnap);
  if (!hasActiveMembership(member, new Date().toISOString().split('T')[0])) {
    throw new HttpsError('failed-precondition', 'An active membership is required to purchase a grading.');
  }

  const gradingsSnap = await db
    .collection(FirestoreCollection.Gradings)
    .where('studentMemberDocId', '==', memberDocId)
    .get();
  const gradings = gradingsSnap.docs.map((d) => ({ ...(d.data() as Grading), docId: d.id }));
  checkLevelsArePurchasable(member, gradings, levels);

  const stripe = getStripeClient();
  const { products } = await fetchStripeProducts(stripe);
  const prices = pricesForLevels(products, levels);
  const customerId = await stripeCustomerForMember(stripe, db, member, email);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    line_items: prices.map((p) => ({ price: p.price.id, quantity: 1 })),
    allow_promotion_codes: true,
    success_url: `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/next-grading`,
    customer: customerId,
    customer_update: { address: 'auto', name: 'auto' },
    client_reference_id: memberDocId,
    metadata: {
      memberDocId,
      memberId: member.memberId || '',
      orderType: 'grading',
      // Line-item order; grading fulfillment maps item i to gradingLevels[i].
      gradingLevel: levels[0],
      gradingLevels: levels.join(','),
    },
  };
  const session = await stripe.checkout.sessions.create(sessionParams);
  if (!session.url) {
    throw new HttpsError('internal', 'Stripe did not return a checkout URL.');
  }
  logger.info('createGradingCheckoutSession created session', {
    sessionId: session.id,
    memberDocId,
    levels,
  });
  return { checkoutUrl: session.url, sessionId: session.id };
});
