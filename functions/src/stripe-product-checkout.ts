/**
 * Stripe Checkout callable for purchasing Class, Workshop, and Event products.
 *
 * Uses dynamic Stripe line item pricing (price_data.unit_amount) configured
 * on the Firestore Product document, supporting fine-grained price intersections
 * for membership status, instructor status, attendance mode, and video access.
 */

import Stripe from 'stripe';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins, getMemberByEmail, hasActiveMembership } from './common';
import { environment } from './environment/environment';
import { getStripeClient, stripeSecretKey } from './stripe-common';
import {
  CreateProductCheckoutSessionRequest,
  CreateCheckoutSessionResult,
} from './stripe-types';
import { Product, firestoreDocToProduct, getPricingTierKey } from './data-model/events';
import { Member } from './data-model/members';

function requireAllowedOrigin(origin: unknown): string {
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
    throw new HttpsError(
      'invalid-argument',
      'A recognised app origin is required.',
    );
  }
  return origin;
}

export const createProductCheckoutSession = onCall<
  CreateProductCheckoutSessionRequest,
  Promise<CreateCheckoutSessionResult>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  const data = request.data;
  if (!data || !data.productId) {
    throw new HttpsError('invalid-argument', 'productId is required.');
  }

  const origin = requireAllowedOrigin(data.origin);
  const db = admin.firestore();

  // 1. Fetch Product from Firestore
  const productSnap = await db.collection('products').doc(data.productId).get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', 'Product not found.');
  }

  const product: Product = firestoreDocToProduct(productSnap);

  const role = data.role || 'non_member';
  const attendance = data.attendance || 'in_person';
  const includeVideo = Boolean(data.includeVideo);

  // 2. Resolve member / customer
  let customerId: string | undefined;
  let memberDocId: string | undefined;
  let memberId: string | undefined;
  let member: Member | undefined;

  const emailToLookup = request.auth?.token?.email || data.attendeeDetails?.email;
  if (emailToLookup) {
    try {
      member = await getMemberByEmail(emailToLookup, db);
      memberDocId = member.docId;
      memberId = member.memberId;
    } catch {
      // Guest attendee or unlinked member email
    }
  }

  // 3. Verify role authorization
  if (role === 'member') {
    if (!member || !hasActiveMembership(member)) {
      throw new HttpsError(
        'permission-denied',
        'Active membership is required to register at the member rate.',
      );
    }
  } else if (role === 'instructor') {
    const today = new Date().toISOString().split('T')[0];
    const hasActiveLicense = Boolean(
      member?.instructorId &&
      member.instructorLicenseExpires &&
      (member.instructorLicenseExpires === 'life' ||
       member.instructorLicenseExpires === '9999-12-31' ||
       member.instructorLicenseExpires >= today)
    );
    if (!hasActiveLicense) {
      throw new HttpsError(
        'permission-denied',
        'Active instructor license is required to register at the instructor rate.',
      );
    }
  }

  // 4. Validate product global configuration flags (Hierarchy: Anyone/Public >= Members >= Instructors)
  if (role === 'non_member' && !product.allowNonMembers) {
    throw new HttpsError('failed-precondition', 'Registration is not open to non-members.');
  }
  if (role === 'member' && !product.allowMembers && !product.allowNonMembers) {
    throw new HttpsError('failed-precondition', 'Registration is not open to general members.');
  }
  if (role === 'instructor' && !product.allowInstructors && !product.allowMembers && !product.allowNonMembers) {
    throw new HttpsError('failed-precondition', 'Registration is not open to instructors.');
  }
  if (attendance === 'in_person' && !product.allowInPerson) {
    throw new HttpsError('failed-precondition', 'In-person attendance is not available.');
  }
  if (attendance === 'online' && !product.allowOnline) {
    throw new HttpsError('failed-precondition', 'Online attendance is not available.');
  }
  if (attendance === 'video_only' && !product.allowVideoOnly) {
    throw new HttpsError('failed-precondition', 'Video-only access is not available.');
  }
  if (includeVideo && !product.allowVideo && attendance !== 'video_only') {
    throw new HttpsError('failed-precondition', 'Video recording add-on is not available.');
  }

  // 5. Resolve the pricing tier
  let tierKey = getPricingTierKey(role, attendance, includeVideo);
  let tier = product.tiers[tierKey];

  if ((!tier || !tier.enabled) && (role === 'member' || role === 'instructor')) {
    // If no special tier for member/instructor, fall back to standard non_member tier
    tierKey = getPricingTierKey('non_member', attendance, includeVideo);
    tier = product.tiers[tierKey];
  }

  if (!tier || !tier.enabled) {
    throw new HttpsError(
      'failed-precondition',
      'The selected registration option is currently unavailable.',
    );
  }

  const priceInCents = Math.round((tier.price ?? 0) * 100);
  if (priceInCents < 50 && priceInCents !== 0) {
    // Stripe minimum charge is usually 50 cents (USD) for paid transactions
    throw new HttpsError('invalid-argument', 'Amount is below minimum chargeable threshold.');
  }

  const stripe = getStripeClient();

  // 6. Ensure Stripe customer is created / linked
  if (member && emailToLookup) {
    try {
      if (member.stripeCustomerId) {
        customerId = member.stripeCustomerId;
      } else {
        const existing = await stripe.customers.list({
          email: emailToLookup,
          limit: 1,
        });
        if (existing.data.length > 0) {
          customerId = existing.data[0].id;
        } else {
          const created = await stripe.customers.create({
            email: emailToLookup,
            name: data.attendeeDetails?.name || member.name || undefined,
            metadata: {
              memberDocId: member.docId,
              memberId: member.memberId,
            },
          });
          customerId = created.id;
        }
        await db.collection('members').doc(member.docId).update({
          stripeCustomerId: customerId,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      logger.warn('Could not sync Stripe customer for member', { emailToLookup, error: e });
    }
  }

  // 7. Build dynamic line item description
  const attendanceLabel = attendance === 'in_person'
    ? 'In-Person'
    : (attendance === 'online' ? 'Online' : 'Recording Only');
  const videoLabel = includeVideo && attendance !== 'video_only' ? ' + Video Recording' : '';
  const roleLabel = role === 'non_member'
    ? 'Non-Member'
    : (role === 'instructor' ? 'Instructor' : 'Member');
  const lineItemDescription = `${product.title} - ${attendanceLabel}${videoLabel} (${roleLabel})`;

  const successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/products/${product.docId}`;

  const metadata: Record<string, string> = {
    orderType: 'event_registration',
    productId: product.docId,
    eventDocId: product.eventDocId || '',
    role,
    attendance,
    includeVideo: includeVideo ? 'true' : 'false',
    attendeeName: data.attendeeDetails?.name || '',
    attendeeEmail: data.attendeeDetails?.email || '',
    attendeePhone: data.attendeeDetails?.phone || '',
    attendeeNotes: data.attendeeDetails?.notes || '',
    memberDocId: memberDocId || '',
    memberId: memberId || '',
  };

  const lineItemPriceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
    currency: (product.currency || 'usd').toLowerCase(),
    unit_amount: priceInCents,
    product_data: {
      name: product.title,
      description: lineItemDescription,
    },
  };

  // If a pre-existing Stripe Product ID was linked, or an environment default is configured, attach it directly
  const stripeProductId = product.stripeProductId || environment.stripe?.hqRegistrationForEventStripeProductId;
  if (stripeProductId) {
    lineItemPriceData.product = stripeProductId;
    delete lineItemPriceData.product_data;
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    line_items: [
      {
        price_data: lineItemPriceData,
        quantity: 1,
      },
    ],
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
  };

  if (customerId) {
    sessionParams.customer = customerId;
    sessionParams.customer_update = {
      address: 'auto',
      name: 'auto',
    };
  } else if (data.attendeeDetails?.email) {
    sessionParams.customer_email = data.attendeeDetails.email;
  }

  if (memberDocId) {
    sessionParams.client_reference_id = memberDocId;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) {
    throw new HttpsError('internal', 'Stripe did not return a checkout URL.');
  }

  logger.info('createProductCheckoutSession created session', {
    sessionId: session.id,
    productId: product.docId,
    eventDocId: product.eventDocId,
    priceInCents,
    memberDocId,
  });

  return { checkoutUrl: session.url, sessionId: session.id };
});
