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
  UpdateProductRegistrationRequest,
  UpdateProductRegistrationResult,
} from './stripe-types';
import {
  Product,
  firestoreDocToProduct,
  getPricingTierKey,
  isEventPast,
  EventRegistration,
  AttendeeRole,
  AttendanceType,
} from './data-model/events';
import { Member } from './data-model/members';
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

  // 3. Verify role authorization
  if (role === AttendeeRole.Member) {
    if (!member || !hasActiveMembership(member)) {
      throw new HttpsError(
        'permission-denied',
        'Active membership is required to register at the member rate.',
      );
    }
  } else if (role === AttendeeRole.Instructor) {
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

      if (!addsVideo && !addsInPerson && !addsOnline && !upgradesFromVideoOnly) {
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

  // 6. Resolve the pricing tier
  const tierLookupAttendance: AttendanceType =
    attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : attendance;
  let tierKey = getPricingTierKey(role, tierLookupAttendance, includeVideo);
  let tier = product.tiers[tierKey];

  if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
    // If no special tier for member/instructor, fall back to standard non_member tier
    tierKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, includeVideo);
    tier = product.tiers[tierKey];
  }

  if (!tier || !tier.enabled) {
    throw new HttpsError(
      'failed-precondition',
      'The selected registration option is currently unavailable.',
    );
  }

  const fullPriceInCents = Math.round((tier.price ?? 0) * 100);
  let priceToChargeInCents = fullPriceInCents;

  if (isUpgradeActive) {
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

  // If user previously had video access, they keep video access
  const hasVideoAccess = Boolean(existingReg.hasVideoAccess || data.includeVideo);

  // 7. Verify Pricing Tier - Hard server-side check that this does not require an unpaid upgrade
  const tierLookupAttendance: AttendanceType =
    attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : attendance;
  let tierKey = getPricingTierKey(role, tierLookupAttendance, hasVideoAccess);
  let tier = product.tiers[tierKey];

  if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
    tierKey = getPricingTierKey(AttendeeRole.NonMember, tierLookupAttendance, hasVideoAccess);
    tier = product.tiers[tierKey];
  }

  if (!tier || !tier.enabled) {
    throw new HttpsError('failed-precondition', 'The selected registration option is currently unavailable.');
  }

  const fullPriceInCents = Math.round((tier.price ?? 0) * 100);
  const creditAppliedCents = existingReg.amountPaidCents || 0;
  const upgradeDiffCents = fullPriceInCents - creditAppliedCents;

  if (upgradeDiffCents > 0) {
    throw new HttpsError(
      'failed-precondition',
      'The selected option requires an additional payment. Please proceed via the payment checkout.',
    );
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
      const eventTitle = (eventSnap.data()?.['title'] as string) || product.title || 'Event';
      const purchaseDetailsMarkdown = product.purchaseDetailsMarkdown || (eventSnap.data()?.['purchaseDetailsMarkdown'] as string) || '';
      const inPersonDetailsMarkdown = product.inPersonDetailsMarkdown || (eventSnap.data()?.['inPersonDetailsMarkdown'] as string) || '';
      const onlineJoiningLink = product.onlineJoiningLink || (eventSnap.data()?.['onlineJoiningLink'] as string) || '';

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

