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
import { allowedOrigins, getMemberByEmail, hasActiveMembership, hasActiveInstructorLicense } from './common';
import { environment } from './environment/environment';
import { getStripeClient, stripeSecretKey } from './stripe-common';
import {
  CreateProductCheckoutSessionRequest,
  CreateCheckoutSessionResult,
  UpdateProductRegistrationRequest,
  UpdateProductRegistrationResult,
  RegisterEventInPersonRequest,
  RegisterEventInPersonResult,
  MarkEventRegistrationPaidRequest,
  MarkEventRegistrationPaidResult,
  UnmarkEventRegistrationPaidRequest,
  UnmarkEventRegistrationPaidResult,
} from './stripe-types';
import {
  Product,
  firestoreDocToProduct,
  getPricingTierKey,
  getVideoDelta,
  isEventPast,
  isVideoIncludedForFree,
  hasSpecialRolePrice,
  EventRegistration,
  AttendeeRole,
  AttendanceType,
  PricingTierType,
  RegistrationPaymentMethod,
  EventRegistrationStatus,
  IlcEvent,
} from './data-model/events';
import { FirestoreCollection, FirestoreSubcollection } from './data-model/collections';
import { Member } from './data-model/members';
import { ACL } from './data-model/system';
import { NotificationKind } from './data-model/notifications';
import { createMemberNotification } from './notifications';

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

  const role = data.role || AttendeeRole.NonMember;
  const attendance = data.attendance || AttendanceType.InPerson;
  let includeVideo = Boolean(data.includeVideo);

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

  // 3. Verify role authorization (only checked if event restricts non-members or has special pricing for that role)
  if (!product.allowNonMembers) {
    if (!member || (!hasActiveMembership(member) && !hasActiveInstructorLicense(member))) {
      throw new HttpsError(
        'permission-denied',
        'Active membership is required to register for this event.',
      );
    }
  }

  if (role === AttendeeRole.Member) {
    if (hasSpecialRolePrice(product, AttendeeRole.Member)) {
      if (!member || !hasActiveMembership(member)) {
        throw new HttpsError(
          'permission-denied',
          'Active membership is required to register at the member rate.',
        );
      }
    }
  } else if (role === AttendeeRole.Instructor) {
    if (hasSpecialRolePrice(product, AttendeeRole.Instructor)) {
      if (!member || !hasActiveInstructorLicense(member)) {
        throw new HttpsError(
          'permission-denied',
          'Active instructor license is required to register at the instructor rate.',
        );
      }
    } else if (hasSpecialRolePrice(product, AttendeeRole.Member)) {
      // If there is no dedicated instructor price but there is a special member price,
      // instructors must have active membership or an active instructor license.
      if (!member || (!hasActiveMembership(member) && !hasActiveInstructorLicense(member))) {
        throw new HttpsError(
          'permission-denied',
          'Active membership is required to register at the member rate.',
        );
      }
    }
  }

  // 4. Validate event dates & product global configuration flags
  if (product.eventDocId) {
    try {
      const eventSnap = await db.collection('events').doc(product.eventDocId).get();
      if (eventSnap.exists) {
        const eventData = eventSnap.data();
        if (isEventPast(eventData as { start?: string; end?: string })) {
          if (attendance !== AttendanceType.VideoOnly) {
            throw new HttpsError(
              'failed-precondition',
              'Live registration is closed as this event has already taken place. Only video recording access may be purchased.',
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.warn('Could not verify event past status:', err);
    }
  }

  if (role === AttendeeRole.NonMember && !product.allowNonMembers) {
    throw new HttpsError('failed-precondition', 'Registration is not open to non-members.');
  }
  if (role === AttendeeRole.Member && !product.allowMembers && !product.allowNonMembers) {
    throw new HttpsError('failed-precondition', 'Registration is not open to general members.');
  }
  if (role === AttendeeRole.Instructor && !product.allowInstructors && !product.allowMembers && !product.allowNonMembers) {
    throw new HttpsError('failed-precondition', 'Registration is not open to instructors.');
  }
  if ((attendance === AttendanceType.InPerson || attendance === AttendanceType.InPersonAndOnline) && !product.allowInPerson) {
    throw new HttpsError('failed-precondition', 'In-person attendance is not available.');
  }
  if ((attendance === AttendanceType.Online || attendance === AttendanceType.InPersonAndOnline) && !product.allowOnline) {
    throw new HttpsError('failed-precondition', 'Online attendance is not available.');
  }
  if (attendance === AttendanceType.VideoOnly && !product.allowVideoOnly) {
    throw new HttpsError('failed-precondition', 'Video-only access is not available.');
  }
  if (includeVideo && !product.allowVideo && attendance !== AttendanceType.VideoOnly) {
    throw new HttpsError('failed-precondition', 'Video recording add-on is not available.');
  }

  // 5. Upgrade verification and duplicate registration prevention
  let isUpgradeActive = false;
  let isPayingUnpaidInPerson = false;
  let existingReg: EventRegistration | null = null;
  let creditAppliedCents = 0;

  if (product.eventDocId) {
    if (data.isUpgrade && data.existingRegistrationDocId) {
      const regSnap = await db
        .collection('events')
        .doc(product.eventDocId)
        .collection('registrations')
        .doc(data.existingRegistrationDocId)
        .get();

      if (!regSnap.exists) {
        throw new HttpsError('not-found', 'Existing registration not found for upgrade.');
      }

      existingReg = regSnap.data() as EventRegistration;
      const callerEmail = (emailToLookup || '').toLowerCase().trim();
      const regEmail = (existingReg.email || '').toLowerCase().trim();
      const callerMemberDoc = memberDocId || '';
      const regMemberDoc = existingReg.memberDocId || '';

      const isAuthorized =
        (callerEmail && callerEmail === regEmail) ||
        (callerMemberDoc && regMemberDoc && callerMemberDoc === regMemberDoc) ||
        (request.auth?.token?.admin === true);

      if (!isAuthorized) {
        throw new HttpsError('permission-denied', 'You are not authorized to upgrade this registration.');
      }

      // If user already had video access, they cannot downgrade or drop it
      if (existingReg.hasVideoAccess) {
        includeVideo = true;
      }

      // Check if registration already has all possible entitlements
      const alreadyHasFullLive =
        existingReg.attendance === AttendanceType.InPersonAndOnline ||
        (!product.allowOnline && existingReg.attendance === AttendanceType.InPerson) ||
        (!product.allowInPerson && existingReg.attendance === AttendanceType.Online);
      const alreadyHasVideo = !product.allowVideo || existingReg.hasVideoAccess === true;
      if (alreadyHasFullLive && alreadyHasVideo) {
        throw new HttpsError(
          'failed-precondition',
          'You already have the full registration package for this event. No further upgrades are available.',
        );
      }

      // Hard check: verify that the requested option adds a new entitlement
      const addsVideo = Boolean(includeVideo && !existingReg.hasVideoAccess);
      const hadInPerson =
        existingReg.attendance === AttendanceType.InPerson ||
        existingReg.attendance === AttendanceType.InPersonAndOnline;
      const hadOnline =
        existingReg.attendance === AttendanceType.Online ||
        existingReg.attendance === AttendanceType.InPersonAndOnline;
      const requestingInPerson =
        attendance === AttendanceType.InPerson ||
        attendance === AttendanceType.InPersonAndOnline;
      const requestingOnline =
        attendance === AttendanceType.Online ||
        attendance === AttendanceType.InPersonAndOnline;
      const addsInPerson = requestingInPerson && !hadInPerson;
      const addsOnline = requestingOnline && !hadOnline;
      const upgradesFromVideoOnly =
        existingReg.attendance === AttendanceType.VideoOnly &&
        attendance !== AttendanceType.VideoOnly;

      // Allow paying online in advance for a previously unpaid in-person registration
      isPayingUnpaidInPerson = Boolean(
        existingReg.paymentMethod === RegistrationPaymentMethod.InPerson ||
        existingReg.status === EventRegistrationStatus.PendingInPerson ||
        (existingReg.amountPaidCents === 0 && (existingReg.amountDueCents || 0) > 0)
      );

      if (!addsVideo && !addsInPerson && !addsOnline && !upgradesFromVideoOnly && !isPayingUnpaidInPerson) {
        throw new HttpsError(
          'failed-precondition',
          'The selected registration option does not add any new attendance or video entitlements over your existing registration.',
        );
      }

      creditAppliedCents = existingReg.amountPaidCents || 0;
      isUpgradeActive = true;
    } else {
      // Prevent duplicate registration if attendee already has an active registration for this event
      const regsRef = db
        .collection('events')
        .doc(product.eventDocId)
        .collection('registrations');
      let existingSnap: FirebaseFirestore.QuerySnapshot | null = null;
      if (memberDocId) {
        existingSnap = await regsRef.where('memberDocId', '==', memberDocId).limit(1).get();
      }
      if ((!existingSnap || existingSnap.empty) && emailToLookup) {
        existingSnap = await regsRef.where('email', '==', emailToLookup).limit(1).get();
      }
      if (existingSnap && !existingSnap.empty) {
        throw new HttpsError(
          'already-exists',
          'You already have an active registration for this event. Please select an upgrade option instead.',
        );
      }
    }
  }

  // In-person capacity check
  const isRequestingInPerson =
    attendance === AttendanceType.InPerson || attendance === AttendanceType.InPersonAndOnline;
  const isExistingInPerson =
    existingReg &&
    (existingReg.attendance === AttendanceType.InPerson ||
     existingReg.attendance === AttendanceType.InPersonAndOnline);

  if (isRequestingInPerson && !isExistingInPerson) {
    if (product.maxInPersonAttendees && product.maxInPersonAttendees > 0) {
      const currentCount = product.inPersonRegistrationsCount || 0;
      if (currentCount >= product.maxInPersonAttendees) {
        throw new HttpsError(
          'failed-precondition',
          'In-person attendance is currently sold out for this event.',
        );
      }
    }
  }

  // 6. Resolve the pricing tier (respecting early-bird deadline if configured)
  const tierLookupAttendance: AttendanceType =
    attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : attendance;

  let pricingTierType = PricingTierType.Standard;
  if (product.hasEarlyBird && product.earlyBirdDeadline) {
    const today = new Date().toISOString().split('T')[0];
    if (today <= product.earlyBirdDeadline) {
      pricingTierType = PricingTierType.EarlyBird;
    }
  }

  if (isVideoIncludedForFree(product, role, tierLookupAttendance, pricingTierType)) {
    includeVideo = true;
  }

  let tierKey = getPricingTierKey(role, tierLookupAttendance, includeVideo, pricingTierType);
  let tier = product.tiers[tierKey];

  if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
    // If no special tier for member/instructor, fall back to standard non_member tier
    tierKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, includeVideo, pricingTierType);
    tier = product.tiers[tierKey];
  }

  // If early-bird tier wasn't found or enabled, fall back to standard tier
  if ((!tier || !tier.enabled) && pricingTierType === PricingTierType.EarlyBird) {
    pricingTierType = PricingTierType.Standard;
    tierKey = getPricingTierKey(role, tierLookupAttendance, includeVideo, PricingTierType.Standard);
    tier = product.tiers[tierKey];
    if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      tierKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, includeVideo, PricingTierType.Standard);
      tier = product.tiers[tierKey];
    }
  }

  // If tier with video is not configured but video is included/free, fall back to novideo tier
  if ((!tier || !tier.enabled) && includeVideo) {
    let fallbackNovideoKey = getPricingTierKey(role, tierLookupAttendance, false, pricingTierType);
    tier = product.tiers[fallbackNovideoKey];
    if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      fallbackNovideoKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, false, pricingTierType);
      tier = product.tiers[fallbackNovideoKey];
    }
    if ((!tier || !tier.enabled) && pricingTierType === PricingTierType.EarlyBird) {
      fallbackNovideoKey = getPricingTierKey(role, tierLookupAttendance, false, PricingTierType.Standard);
      tier = product.tiers[fallbackNovideoKey];
      if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
        fallbackNovideoKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, false, PricingTierType.Standard);
        tier = product.tiers[fallbackNovideoKey];
      }
    }
    if (tier && tier.enabled) {
      tierKey = fallbackNovideoKey;
    }
  }

  if (!tier || !tier.enabled) {
    throw new HttpsError(
      'failed-precondition',
      'The selected registration option is currently unavailable.',
    );
  }

  const fullPriceInCents = Math.round((tier.price ?? 0) * 100);
  let priceToChargeInCents = fullPriceInCents;

  if (isUpgradeActive && existingReg) {
    let existingTierPriceInCents = existingReg.amountPaidCents || 0;
    if (existingReg.role && existingReg.attendance && !isPayingUnpaidInPerson) {
      const existingLookupAtt: AttendanceType =
        existingReg.attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : existingReg.attendance;
      let existingKey = getPricingTierKey(existingReg.role, existingLookupAtt, Boolean(existingReg.hasVideoAccess), pricingTierType);
      let existingTier = product.tiers[existingKey];
      if ((!existingTier || !existingTier.enabled) && (existingReg.role === AttendeeRole.Member || existingReg.role === AttendeeRole.Instructor)) {
        existingKey = getPricingTierKey(AttendeeRole.NonMember, existingLookupAtt, Boolean(existingReg.hasVideoAccess), pricingTierType);
        existingTier = product.tiers[existingKey];
      }
      if ((!existingTier || !existingTier.enabled) && pricingTierType === PricingTierType.EarlyBird) {
        existingKey = getPricingTierKey(existingReg.role, existingLookupAtt, Boolean(existingReg.hasVideoAccess), PricingTierType.Standard);
        existingTier = product.tiers[existingKey];
        if ((!existingTier || !existingTier.enabled) && (existingReg.role === AttendeeRole.Member || existingReg.role === AttendeeRole.Instructor)) {
          existingKey = getPricingTierKey(AttendeeRole.NonMember, existingLookupAtt, Boolean(existingReg.hasVideoAccess), PricingTierType.Standard);
          existingTier = product.tiers[existingKey];
        }
      }
      if (existingTier && existingTier.enabled && typeof existingTier.price === 'number') {
        existingTierPriceInCents = Math.round(existingTier.price * 100);
      }
    }
    creditAppliedCents = isPayingUnpaidInPerson ? 0 : Math.max(existingReg.amountPaidCents || 0, existingTierPriceInCents);

    const upgradeDiffCents = fullPriceInCents - creditAppliedCents;
    if (upgradeDiffCents <= 0) {
      throw new HttpsError(
        'failed-precondition',
        'The selected option is not an upgrade. Downgrades and refunds are not supported via checkout.',
      );
    }
    priceToChargeInCents = upgradeDiffCents;
  }

  if (priceToChargeInCents < 50 && priceToChargeInCents !== 0) {
    // Stripe minimum charge is usually 50 cents (USD) for paid transactions
    throw new HttpsError('invalid-argument', 'Amount is below minimum chargeable threshold ($0.50).');
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
  const attendanceLabel =
    attendance === AttendanceType.InPersonAndOnline
      ? 'In-Person & Online'
      : (attendance === AttendanceType.InPerson
          ? 'In-Person'
          : (attendance === AttendanceType.Online ? 'Online' : 'Recording Only'));
  const videoLabel = includeVideo && attendance !== AttendanceType.VideoOnly ? ' + Video Recording' : '';
  const roleLabel = role === AttendeeRole.NonMember
    ? 'Non-Member'
    : (role === AttendeeRole.Instructor ? 'Instructor' : 'Member');
  let lineItemDescription = `${product.title} - ${attendanceLabel}${videoLabel} (${roleLabel})`;
  if (isUpgradeActive) {
    const creditStr = (creditAppliedCents / 100).toFixed(2);
    const currStr = (product.currency || 'usd').toUpperCase();
    lineItemDescription = `Upgrade: ${lineItemDescription} (Credit of ${creditStr} ${currStr} applied)`;
  }

  const successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = product.eventDocId
    ? `${origin}/events/${product.eventDocId}/register`
    : `${origin}/events/${product.docId}/register`;

  const metadata: Record<string, string> = {
    orderType: 'event_registration',
    productId: product.docId,
    eventDocId: product.eventDocId || '',
    role,
    attendance,
    includeVideo: includeVideo ? 'true' : 'false',
    paymentMethod: RegistrationPaymentMethod.Stripe,
    pricingTierType: pricingTierType,
    attendeeName: data.attendeeDetails?.name || '',
    attendeeEmail: data.attendeeDetails?.email || '',
    attendeePhone: data.attendeeDetails?.phone || '',
    attendeeNotes: data.attendeeDetails?.notes || '',
    memberDocId: memberDocId || '',
    memberId: memberId || '',
  };

  if (isUpgradeActive && data.existingRegistrationDocId) {
    metadata['isUpgrade'] = 'true';
    metadata['existingRegistrationDocId'] = data.existingRegistrationDocId;
    metadata['upgradeAmountCents'] = priceToChargeInCents.toString();
    metadata['previouslyPaidCents'] = creditAppliedCents.toString();
    metadata['totalAmountPaidCents'] = fullPriceInCents.toString();
    if (isPayingUnpaidInPerson) {
      metadata['isPayingUnpaidInPerson'] = 'true';
    }
  }

  const lineItemPriceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
    currency: (product.currency || 'usd').toLowerCase(),
    unit_amount: priceToChargeInCents,
    product_data: {
      name: isUpgradeActive ? `${product.title} (Registration Upgrade)` : product.title,
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
    priceInCents: priceToChargeInCents,
    memberDocId,
  });

  return { checkoutUrl: session.url, sessionId: session.id };
});

export const updateProductRegistration = onCall<
  UpdateProductRegistrationRequest,
  Promise<UpdateProductRegistrationResult>
>({ cors: allowedOrigins }, async (request) => {
  const data = request.data;
  if (!data || !data.productId || !data.existingRegistrationDocId) {
    throw new HttpsError(
      'invalid-argument',
      'productId and existingRegistrationDocId are required.',
    );
  }

  if (!data.attendeeDetails?.name?.trim() || !data.attendeeDetails?.email?.trim()) {
    throw new HttpsError(
      'invalid-argument',
      'Attendee name and email are required.',
    );
  }

  const db = admin.firestore();

  // 1. Fetch Product
  const productSnap = await db.collection('products').doc(data.productId).get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', 'Product not found.');
  }
  const product: Product = firestoreDocToProduct(productSnap);
  if (!product.eventDocId) {
    throw new HttpsError('failed-precondition', 'Product is not linked to an event.');
  }

  // 2. Fetch Existing Registration
  const regRef = db
    .collection('events')
    .doc(product.eventDocId)
    .collection('registrations')
    .doc(data.existingRegistrationDocId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    throw new HttpsError('not-found', 'Existing registration not found.');
  }
  const existingReg = regSnap.data() as EventRegistration;

  // 3. Verify Authorization
  const callerEmail = (request.auth?.token?.email || data.attendeeDetails.email || '').toLowerCase().trim();
  const regEmail = (existingReg.email || '').toLowerCase().trim();
  let callerMemberDocId: string | undefined;

  if (callerEmail) {
    try {
      const member = await getMemberByEmail(callerEmail, db);
      callerMemberDocId = member.docId;
    } catch {
      // Unlinked email
    }
  }

  const isAuthorized =
    (callerEmail && callerEmail === regEmail) ||
    (callerMemberDocId && existingReg.memberDocId && callerMemberDocId === existingReg.memberDocId) ||
    (request.auth?.token?.admin === true);

  if (!isAuthorized) {
    throw new HttpsError('permission-denied', 'You are not authorized to update this registration.');
  }

  // 4. Validate Event Dates
  const eventSnap = await db.collection('events').doc(product.eventDocId).get();
  if (eventSnap.exists) {
    const eventData = eventSnap.data();
    if (isEventPast(eventData as { start?: string; end?: string })) {
      if (data.attendance !== AttendanceType.VideoOnly) {
        throw new HttpsError(
          'failed-precondition',
          'Live attendance is closed as this event has already taken place.',
        );
      }
    }
  }

  // 5. Validate Role & Permissions
  const role = data.role || existingReg.role || AttendeeRole.NonMember;
  if (role === AttendeeRole.Member && !product.allowMembers && !product.allowNonMembers) {
    throw new HttpsError('failed-precondition', 'Registration is not open to general members.');
  }
  if (role === AttendeeRole.Instructor && !product.allowInstructors && !product.allowMembers && !product.allowNonMembers) {
    throw new HttpsError('failed-precondition', 'Registration is not open to instructors.');
  }

  // 6. Validate Attendance Mode
  const attendance = data.attendance || existingReg.attendance || AttendanceType.InPerson;
  if ((attendance === AttendanceType.InPerson || attendance === AttendanceType.InPersonAndOnline) && !product.allowInPerson) {
    throw new HttpsError('failed-precondition', 'In-person attendance is not available.');
  }
  if ((attendance === AttendanceType.Online || attendance === AttendanceType.InPersonAndOnline) && !product.allowOnline) {
    throw new HttpsError('failed-precondition', 'Online attendance is not available.');
  }
  if (attendance === AttendanceType.VideoOnly && !product.allowVideoOnly) {
    throw new HttpsError('failed-precondition', 'Video-only access is not available.');
  }

  const isUnpaidInPerson = Boolean(
    (existingReg.paymentMethod === RegistrationPaymentMethod.InPerson ||
      existingReg.status === EventRegistrationStatus.PendingInPerson) &&
    existingReg.status !== EventRegistrationStatus.Paid
  );

  // 7. Verify Pricing Tier - Hard server-side check that this does not require an unpaid upgrade
  const tierLookupAttendance: AttendanceType =
    attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : attendance;

  let pricingTierType = PricingTierType.Standard;
  if (product.hasEarlyBird && product.earlyBirdDeadline) {
    const today = new Date().toISOString().split('T')[0];
    if (today <= product.earlyBirdDeadline) {
      pricingTierType = PricingTierType.EarlyBird;
    }
  }

  // If user previously had video access and already paid, they keep video access.
  // If video is included for free for everyone, video access is automatically granted.
  // For unpaid in-person registrations, video access can be toggled on/off freely.
  const isFreeVideo = isVideoIncludedForFree(product, role, tierLookupAttendance, pricingTierType);
  const hasVideoAccess = isFreeVideo || (isUnpaidInPerson
    ? Boolean(data.includeVideo)
    : Boolean(existingReg.hasVideoAccess || data.includeVideo));

  let tierKey = getPricingTierKey(role, tierLookupAttendance, hasVideoAccess, pricingTierType);
  let tier = product.tiers[tierKey];

  if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
    tierKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, hasVideoAccess, pricingTierType);
    tier = product.tiers[tierKey];
  }
  if ((!tier || !tier.enabled) && pricingTierType === PricingTierType.EarlyBird) {
    pricingTierType = PricingTierType.Standard;
    tierKey = getPricingTierKey(role, tierLookupAttendance, hasVideoAccess, PricingTierType.Standard);
    tier = product.tiers[tierKey];
    if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      tierKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, hasVideoAccess, PricingTierType.Standard);
      tier = product.tiers[tierKey];
    }
  }

  // If tier with video is not configured but video is included/free, fall back to novideo tier
  if ((!tier || !tier.enabled) && hasVideoAccess) {
    let fallbackNovideoKey = getPricingTierKey(role, tierLookupAttendance, false, pricingTierType);
    tier = product.tiers[fallbackNovideoKey];
    if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      fallbackNovideoKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, false, pricingTierType);
      tier = product.tiers[fallbackNovideoKey];
    }
    if ((!tier || !tier.enabled) && pricingTierType === PricingTierType.EarlyBird) {
      fallbackNovideoKey = getPricingTierKey(role, tierLookupAttendance, false, PricingTierType.Standard);
      tier = product.tiers[fallbackNovideoKey];
      if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
        fallbackNovideoKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, false, PricingTierType.Standard);
        tier = product.tiers[fallbackNovideoKey];
      }
    }
    if (tier && tier.enabled) {
      tierKey = fallbackNovideoKey;
    }
  }

  if (!tier || !tier.enabled) {
    throw new HttpsError('failed-precondition', 'The selected registration option is currently unavailable.');
  }

  let existingTierPriceInCents = existingReg.amountPaidCents || 0;
  if (existingReg.role && existingReg.attendance && !isUnpaidInPerson) {
    const existingLookupAtt: AttendanceType =
      existingReg.attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : existingReg.attendance;
    let existingKey = getPricingTierKey(existingReg.role, existingLookupAtt, Boolean(existingReg.hasVideoAccess), pricingTierType);
    let existingTier = product.tiers[existingKey];
    if ((!existingTier || !existingTier.enabled) && (existingReg.role === AttendeeRole.Member || existingReg.role === AttendeeRole.Instructor)) {
      existingKey = getPricingTierKey(AttendeeRole.NonMember, existingLookupAtt, Boolean(existingReg.hasVideoAccess), pricingTierType);
      existingTier = product.tiers[existingKey];
    }
    if ((!existingTier || !existingTier.enabled) && pricingTierType === PricingTierType.EarlyBird) {
      existingKey = getPricingTierKey(existingReg.role, existingLookupAtt, Boolean(existingReg.hasVideoAccess), PricingTierType.Standard);
      existingTier = product.tiers[existingKey];
      if ((!existingTier || !existingTier.enabled) && (existingReg.role === AttendeeRole.Member || existingReg.role === AttendeeRole.Instructor)) {
        existingKey = getPricingTierKey(AttendeeRole.NonMember, existingLookupAtt, Boolean(existingReg.hasVideoAccess), PricingTierType.Standard);
        existingTier = product.tiers[existingKey];
      }
    }
    if (existingTier && existingTier.enabled && typeof existingTier.price === 'number') {
      existingTierPriceInCents = Math.round(existingTier.price * 100);
    }
  }

  const fullPriceInCents = Math.round((tier.price ?? 0) * 100);
  const creditAppliedCents = isUnpaidInPerson ? 0 : Math.max(existingReg.amountPaidCents || 0, existingTierPriceInCents);
  const upgradeDiffCents = fullPriceInCents - creditAppliedCents;

  if (upgradeDiffCents > 0 && !isUnpaidInPerson) {
    throw new HttpsError(
      'failed-precondition',
      'The selected option requires an additional payment. Please proceed via the payment checkout.',
    );
  }

  // Calculate updated amount due for in-person door registrations
  let calculatedAmountDueCents = fullPriceInCents;
  if (isUnpaidInPerson && attendance === AttendanceType.InPerson) {
    const doorKey = getPricingTierKey(role, AttendanceType.InPerson, hasVideoAccess, PricingTierType.InPerson);
    if (product.tiers[doorKey]?.enabled) {
      calculatedAmountDueCents = Math.round((product.tiers[doorKey].price ?? 0) * 100);
    }
  }

  // 8. Update registration record in Firestore
  const updatedRegistration: Partial<EventRegistration> = {
    name: data.attendeeDetails.name.trim(),
    email: data.attendeeDetails.email.trim().toLowerCase(),
    phone: data.attendeeDetails.phone?.trim() || '',
    notes: data.attendeeDetails.notes?.trim() || '',
    role,
    attendance,
    hasVideoAccess,
    ...(isUnpaidInPerson ? { amountDueCents: calculatedAmountDueCents } : {}),
    lastUpdated: new Date().toISOString(),
    upgradeHistory: [
      ...(existingReg.upgradeHistory || []),
      {
        timestamp: new Date().toISOString(),
        previousAttendance: existingReg.attendance,
        previousHasVideoAccess: existingReg.hasVideoAccess,
        upgradeAmountCents: 0,
        stripeSessionId: '',
      },
    ],
  };

  const batch = db.batch();
  batch.update(regRef, updatedRegistration);

  if (existingReg.memberDocId) {
    const memberRegRef = db
      .collection('members')
      .doc(existingReg.memberDocId)
      .collection('registrations')
      .doc(data.existingRegistrationDocId);
    batch.update(memberRegRef, updatedRegistration);
  }

  await batch.commit();

  if (existingReg.memberDocId) {
    try {
      const event = eventSnap.data() as IlcEvent | undefined;
      const eventTitle = event?.title || product.title || 'Event';
      const purchaseDetailsMarkdown = product.purchaseDetailsMarkdown || event?.purchaseDetailsMarkdown || '';
      const inPersonDetailsMarkdown = product.inPersonDetailsMarkdown || event?.inPersonDetailsMarkdown || '';
      const onlineJoiningLink = product.onlineJoiningLink || event?.onlineJoiningLink || '';

      let message = `Your registration for **[${eventTitle}](/events/${product.eventDocId})** has been updated!`;
      if (
        attendance === AttendanceType.Online ||
        attendance === AttendanceType.InPersonAndOnline
      ) {
        if (purchaseDetailsMarkdown) {
          message += `\n\n### Online Joining Details\n${purchaseDetailsMarkdown}\n\nYou can also find these details at any time on the [event page](/events/${product.eventDocId}).`;
        } else if (onlineJoiningLink) {
          message += `\n\nYour online joining link is: [Join Zoom Meeting](${onlineJoiningLink})\n\nYou can also find this link at any time on the [event page](/events/${product.eventDocId}).`;
        } else {
          message += `\n\nYour online joining details will appear on the [event page](/events/${product.eventDocId}) prior to the class.`;
        }
      }
      if (
        attendance === AttendanceType.InPerson ||
        attendance === AttendanceType.InPersonAndOnline
      ) {
        if (inPersonDetailsMarkdown) {
          message += `\n\n### In-Person Instructions\n${inPersonDetailsMarkdown}\n\nYou can also find these details at any time on the [event page](/events/${product.eventDocId}).`;
        } else {
          message += `\n\nWe look forward to seeing you in person! Details are available on the [event page](/events/${product.eventDocId}).`;
        }
      }

      await createMemberNotification(db, existingReg.memberDocId, {
        kind: NotificationKind.EventRegistrationConfirmed,
        markdown: message,
        createdAt: new Date().toISOString(),
        dismissed: false,
        data: {
          eventId: product.eventDocId,
          attendance,
          purchaseDetailsMarkdown,
          inPersonDetailsMarkdown,
          onlineJoiningLink,
        },
      });
    } catch (notifErr) {
      logger.warn('Failed to send updated registration notification', { notifErr });
    }
  }

  logger.info('updateProductRegistration updated registration', {
    registrationDocId: data.existingRegistrationDocId,
    eventDocId: product.eventDocId,
    attendance,
    hasVideoAccess,
    email: updatedRegistration.email,
  });

  return { success: true, registrationDocId: data.existingRegistrationDocId };
});

export const registerEventInPerson = onCall<
  RegisterEventInPersonRequest,
  Promise<RegisterEventInPersonResult>
>({ cors: allowedOrigins }, async (request) => {
  const data = request.data;
  if (!data || !data.productId) {
    throw new HttpsError('invalid-argument', 'productId is required.');
  }

  const db = admin.firestore();

  // 1. Fetch Product from Firestore
  const productSnap = await db.collection('products').doc(data.productId).get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', 'Product not found.');
  }
  const product: Product = firestoreDocToProduct(productSnap);
  if (!product.eventDocId) {
    throw new HttpsError('failed-precondition', 'Product is not linked to an event.');
  }

  if (!product.allowPayInPerson) {
    throw new HttpsError('failed-precondition', 'Paying in person is not enabled for this event.');
  }
  if (!product.allowInPerson) {
    throw new HttpsError('failed-precondition', 'In-person attendance is not available.');
  }

  const role = data.role || AttendeeRole.NonMember;
  const attendance = data.attendance || AttendanceType.InPerson;
  const isFreeVideo = isVideoIncludedForFree(product, role, attendance);
  const includeVideo = isFreeVideo || Boolean(data.includeVideo);

  if (attendance !== AttendanceType.InPerson && attendance !== AttendanceType.InPersonAndOnline) {
    throw new HttpsError('invalid-argument', 'In-person payment is only available for in-person attendance.');
  }

  // 2. Validate attendee details
  const name = data.attendeeDetails?.name?.trim();
  const email = data.attendeeDetails?.email?.trim().toLowerCase();
  if (!name || !email) {
    throw new HttpsError('invalid-argument', 'Attendee name and email are required.');
  }

  // 3. Resolve member / customer
  let memberDocId: string | undefined;
  let memberId: string | undefined;
  let member: Member | undefined;

  const emailToLookup = request.auth?.token?.email || email;
  if (emailToLookup) {
    try {
      member = await getMemberByEmail(emailToLookup, db);
      memberDocId = member.docId;
      memberId = member.memberId;
    } catch {
      // Guest attendee
    }
  }

  // 4. Verify role authorization (only checked if event restricts non-members or has special pricing for that role)
  if (!product.allowNonMembers) {
    if (!member || (!hasActiveMembership(member) && !hasActiveInstructorLicense(member))) {
      throw new HttpsError(
        'permission-denied',
        'Active membership is required to register for this event.',
      );
    }
  }

  if (role === AttendeeRole.Member) {
    if (hasSpecialRolePrice(product, AttendeeRole.Member)) {
      if (!member || !hasActiveMembership(member)) {
        throw new HttpsError(
          'permission-denied',
          'Active membership is required to register at the member rate.',
        );
      }
    }
  } else if (role === AttendeeRole.Instructor) {
    if (hasSpecialRolePrice(product, AttendeeRole.Instructor)) {
      if (!member || !hasActiveInstructorLicense(member)) {
        throw new HttpsError(
          'permission-denied',
          'Active instructor license is required to register at the instructor rate.',
        );
      }
    } else if (hasSpecialRolePrice(product, AttendeeRole.Member)) {
      // If there is no dedicated instructor price but there is a special member price,
      // instructors must have active membership or an active instructor license.
      if (!member || (!hasActiveMembership(member) && !hasActiveInstructorLicense(member))) {
        throw new HttpsError(
          'permission-denied',
          'Active membership is required to register at the member rate.',
        );
      }
    }
  }

  // 5. Check if event is past
  const eventSnap = await db.collection('events').doc(product.eventDocId).get();
  if (eventSnap.exists) {
    const eventData = eventSnap.data();
    if (isEventPast(eventData as { start?: string; end?: string })) {
      throw new HttpsError(
        'failed-precondition',
        'Live registration is closed as this event has already taken place.',
      );
    }
  }

  // 6. Capacity check
  if (product.maxInPersonAttendees && product.maxInPersonAttendees > 0) {
    const currentCount = product.inPersonRegistrationsCount || 0;
    if (currentCount >= product.maxInPersonAttendees) {
      throw new HttpsError(
        'failed-precondition',
        'In-person attendance is currently sold out for this event.',
      );
    }
  }

  // 7. Check for duplicate registration
  const regsRef = db.collection('events').doc(product.eventDocId).collection('registrations');
  let existingSnap: FirebaseFirestore.QuerySnapshot | null = null;
  if (memberDocId) {
    existingSnap = await regsRef.where('memberDocId', '==', memberDocId).limit(1).get();
  }
  if ((!existingSnap || existingSnap.empty) && email) {
    existingSnap = await regsRef.where('email', '==', email).limit(1).get();
  }
  if (existingSnap && !existingSnap.empty) {
    throw new HttpsError(
      'already-exists',
      'You already have an active registration for this event.',
    );
  }

  // 8. Resolve In-Person price tier
  const tierLookupAttendance =
    attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : attendance;
  let tierKey = getPricingTierKey(role, tierLookupAttendance, includeVideo, PricingTierType.InPerson);
  let tier = product.tiers[tierKey];

  if (!tier || !tier.enabled) {
    // Fall back to non_member in_person tier
    if (role === AttendeeRole.Member || role === AttendeeRole.Instructor) {
      tierKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, includeVideo, PricingTierType.InPerson);
      tier = product.tiers[tierKey];
    }
  }

  // If no dedicated in-person tier, fall back to standard tier
  if (!tier || !tier.enabled) {
    tierKey = getPricingTierKey(role, tierLookupAttendance, includeVideo, PricingTierType.Standard);
    tier = product.tiers[tierKey];
    if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      tierKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, includeVideo, PricingTierType.Standard);
      tier = product.tiers[tierKey];
    }
  }

  // If tier with video is not configured but video is included/free, fall back to novideo tier
  if ((!tier || !tier.enabled) && includeVideo) {
    let fallbackNovideoKey = getPricingTierKey(role, tierLookupAttendance, false, PricingTierType.InPerson);
    tier = product.tiers[fallbackNovideoKey];
    if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      fallbackNovideoKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, false, PricingTierType.InPerson);
      tier = product.tiers[fallbackNovideoKey];
    }
    if (!tier || !tier.enabled) {
      fallbackNovideoKey = getPricingTierKey(role, tierLookupAttendance, false, PricingTierType.Standard);
      tier = product.tiers[fallbackNovideoKey];
      if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
        fallbackNovideoKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, false, PricingTierType.Standard);
        tier = product.tiers[fallbackNovideoKey];
      }
    }
    if (tier && tier.enabled) {
      tierKey = fallbackNovideoKey;
    }
  }

  if (!tier || !tier.enabled) {
    throw new HttpsError(
      'failed-precondition',
      'The selected in-person registration option is currently unavailable.',
    );
  }

  const inPersonPriceCents = Math.round((tier.price ?? 0) * 100);

  // 9. Write registration doc
  const targetRegDoc = regsRef.doc();
  const registrationId = targetRegDoc.id;

  const registration: EventRegistration = {
    docId: registrationId,
    eventDocId: product.eventDocId,
    productId: product.docId,
    orderDocId: registrationId,
    stripeSessionId: '',
    registeredAt: new Date().toISOString(),
    name,
    email,
    phone: data.attendeeDetails?.phone?.trim() || '',
    notes: data.attendeeDetails?.notes?.trim() || '',
    memberDocId,
    memberId,
    studentLevel: member?.studentLevel || '',
    applicationLevel: member?.applicationLevel || '',
    role,
    attendance,
    hasVideoAccess: Boolean(includeVideo && product.allowVideo),
    amountPaidCents: 0,
    amountDueCents: inPersonPriceCents,
    currency: product.currency || 'usd',
    status: EventRegistrationStatus.PendingInPerson,
    paymentMethod: RegistrationPaymentMethod.InPerson,
    pricingTierType: PricingTierType.InPerson,
    lastUpdated: new Date().toISOString(),
  };

  const batch = db.batch();
  batch.set(targetRegDoc, registration);

  if (memberDocId) {
    const memberRegRef = db.collection('members').doc(memberDocId).collection('registrations').doc(registrationId);
    batch.set(memberRegRef, registration);
  }

  await batch.commit();

  // Send member notification
  if (memberDocId) {
    try {
      const event = eventSnap.data() as IlcEvent | undefined;
      const eventTitle = event?.title || product.title;
      const formattedAmount = (inPersonPriceCents / 100).toFixed(2);
      const curr = (product.currency || 'usd').toUpperCase();
      const inPersonDetails = (product.inPersonDetailsMarkdown as string) || event?.inPersonDetailsMarkdown || '';
      let message = `You are registered to pay in person for **[${eventTitle}](/events/${product.eventDocId})**! Total due upon arrival: **${curr} ${formattedAmount}**.`;
      if (inPersonDetails) {
        message += `\n\n### In-Person Arrival Details\n${inPersonDetails}`;
      }
      await createMemberNotification(db, memberDocId, {
        kind: NotificationKind.EventRegistrationConfirmed,
        markdown: message,
        createdAt: new Date().toISOString(),
        dismissed: false,
        data: {
          eventId: product.eventDocId,
          attendance,
          inPersonDetailsMarkdown: inPersonDetails,
        },
      });
    } catch (err) {
      logger.warn('Could not send in-person registration notification:', err);
    }
  }

  return {
    success: true,
    registrationDocId: registrationId,
  };
});

export const markEventRegistrationPaid = onCall<
  MarkEventRegistrationPaidRequest,
  Promise<MarkEventRegistrationPaidResult>
>({ cors: allowedOrigins }, async (request) => {
  const { eventId, registrationId } = request.data || {};
  if (!eventId || !registrationId) {
    throw new HttpsError('invalid-argument', 'eventId and registrationId are required.');
  }

  const db = admin.firestore();

  // Verify permission: admin or event owner/manager
  const eventSnap = await db.collection(FirestoreCollection.Events).doc(eventId).get();
  if (!eventSnap.exists) {
    throw new HttpsError('not-found', 'Event not found.');
  }
  const event = eventSnap.data() as IlcEvent;
  const callerEmail = (request.auth?.token?.email || '').toLowerCase().trim();
  const isAdmin = request.auth?.token?.admin === true;

  let isManager = false;
  if (callerEmail) {
    let callerMemberDocId: string | undefined;
    try {
      const m = await getMemberByEmail(callerEmail, db);
      callerMemberDocId = m.docId;
    } catch {
      // Not a member
    }
    const ownerDocId = event.ownerDocId;
    const managerDocIds: string[] = event.managerDocIds || [];
    const ownerEmails: string[] = (event.ownerEmails || []).map((e: string) => e.toLowerCase().trim());
    const managerEmails: string[] = (event.managerEmails || []).map((e: string) => e.toLowerCase().trim());

    if (callerMemberDocId && (callerMemberDocId === ownerDocId || managerDocIds.includes(callerMemberDocId))) {
      isManager = true;
    } else if (ownerEmails.includes(callerEmail) || managerEmails.includes(callerEmail)) {
      isManager = true;
    }
  }

  if (!isAdmin && !isManager) {
    throw new HttpsError('permission-denied', 'You are not authorized to mark registrations as paid for this event.');
  }

  const regRef = db.collection(FirestoreCollection.Events).doc(eventId).collection(FirestoreSubcollection.Registrations).doc(registrationId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    throw new HttpsError('not-found', 'Registration not found.');
  }

  const reg = regSnap.data() as EventRegistration;
  const amountToRecord = reg.amountDueCents || reg.amountPaidCents || 0;

  const updates: Partial<EventRegistration> = {
    status: EventRegistrationStatus.Paid,
    amountPaidCents: amountToRecord,
    amountDueCents: 0,
    paidAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  const batch = db.batch();
  batch.update(regRef, updates);

  if (reg.memberDocId) {
    const memberRegRef = db.collection(FirestoreCollection.Members).doc(reg.memberDocId).collection(FirestoreSubcollection.Registrations).doc(registrationId);
    batch.update(memberRegRef, updates);
  }

  await batch.commit();
  return { success: true };
});

export const unmarkEventRegistrationPaid = onCall<
  UnmarkEventRegistrationPaidRequest,
  Promise<UnmarkEventRegistrationPaidResult>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { eventId, registrationId } = request.data;
  if (!eventId || !registrationId) {
    throw new HttpsError('invalid-argument', 'eventId and registrationId are required.');
  }

  const db = admin.firestore();
  const callerEmail = (request.auth.token.email || '').toLowerCase().trim();

  // Verify caller permissions (admin, owner, or manager)
  const aclSnap = await db.collection(FirestoreCollection.Acl).doc(callerEmail).get();
  const acl = aclSnap.data() as ACL | undefined;
  const isAdmin = acl?.isAdmin === true;
  const callerMemberDocId = acl?.memberDocIds?.[0];

  let isManager = false;
  const eventSnap = await db.collection(FirestoreCollection.Events).doc(eventId).get();
  if (eventSnap.exists) {
    const event = eventSnap.data() as IlcEvent;
    const ownerDocId = event.ownerDocId || '';
    const managerDocIds: string[] = event.managerDocIds || [];
    const ownerEmails: string[] = (event.ownerEmails || []).map((e: string) => e.toLowerCase().trim());
    const managerEmails: string[] = (event.managerEmails || []).map((e: string) => e.toLowerCase().trim());

    if (callerMemberDocId && (callerMemberDocId === ownerDocId || managerDocIds.includes(callerMemberDocId))) {
      isManager = true;
    } else if (ownerEmails.includes(callerEmail) || managerEmails.includes(callerEmail)) {
      isManager = true;
    }
  }

  if (!isAdmin && !isManager) {
    throw new HttpsError('permission-denied', 'You are not authorized to manage registrations for this event.');
  }

  const regRef = db.collection(FirestoreCollection.Events).doc(eventId).collection(FirestoreSubcollection.Registrations).doc(registrationId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    throw new HttpsError('not-found', 'Registration not found.');
  }

  const reg = regSnap.data() as EventRegistration;

  // Safeguard: ONLY in-person door payments can be unmarked (never online Stripe payments)
  if (reg.paymentMethod !== RegistrationPaymentMethod.InPerson) {
    throw new HttpsError('failed-precondition', 'Only in-person door payments can be unmarked.');
  }

  const amountDueToRestore = reg.amountPaidCents || reg.amountDueCents || 0;

  const updates: Omit<Partial<EventRegistration>, 'paidAt'> & {
    paidAt?: admin.firestore.FieldValue | string;
  } = {
    status: EventRegistrationStatus.PendingInPerson,
    amountDueCents: amountDueToRestore,
    amountPaidCents: 0,
    paidAt: admin.firestore.FieldValue.delete(),
    lastUpdated: new Date().toISOString(),
  };

  const batch = db.batch();
  batch.update(regRef, updates);

  if (reg.memberDocId) {
    const memberRegRef = db.collection(FirestoreCollection.Members).doc(reg.memberDocId).collection(FirestoreSubcollection.Registrations).doc(registrationId);
    batch.update(memberRegRef, updates);
  }

  await batch.commit();
  return { success: true };
});
