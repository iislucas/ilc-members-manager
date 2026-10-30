/**
 * Stripe Checkout & Registration callables for Class, Workshop, and Event products.
 *
 * Evaluates compositional EventPricingRules via evaluateEventPricingQuote on the server,
 * enforces per-option eligibility (Anyone / Members / Instructors) from verified auth + ACL,
 * enforces named EventCapacity limits (pre-checked on checkout and transactionally enforced
 * on registerEventInPerson / updateProductRegistration), and supports Full, Deposit + Door,
 * and Pay-at-Door settlement modes.
 */

import Stripe from 'stripe';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  allowedOrigins,
  getAttendeeRoleForStatus,
  getMemberByEmail,
  MemberStatusContext,
  PUBLIC_MEMBER_STATUS_CONTEXT,
  toMemberStatusContext,
  verifiedAuthEmail,
} from './common';
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
  AttendeeRole,
  AttendanceType,
  computeEffectiveCapacityUsage,
  encodeQuestionResponsesToMetadata,
  evaluateEventPricingQuote,
  EventAddOnKind,
  EventCapacity,
  EventPricingQuote,
  EventPricingRules,
  EventRegistration,
  EventRegistrationStatus,
  firestoreDocToEventRegistration,
  firestoreDocToIlcEvent,
  firestoreDocToProduct,
  IlcEvent,
  initEventRegistration,
  isEventPast,
  mergeImmutableQuestionResponses,
  normalizeCapacityMap,
  PaymentChoice,
  PricingTierType,
  PricingValidationErrorCode,
  Product,
  RegistrationPaymentMethod,
  validateAndBuildQuestionResponses,
} from './data-model/events';
import { FirestoreCollection, FirestoreSubcollection } from './data-model/collections';
import { firestoreDocToMember, Member } from './data-model/members';
import { ACL } from './data-model/system';
import { normalizeEmail, normalizeEmails } from './data-model/email';
import { NotificationKind } from './data-model/notifications';
import { VideoGrant, VideoGrantKind } from './data-model/vod';
import { createMemberNotification } from './notifications';
import { resolveEventVideoGrantTargets } from './proposed-events';

function requireAllowedOrigin(origin: unknown): string {
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
    throw new HttpsError('invalid-argument', 'A recognised app origin is required.');
  }
  return origin;
}

export function isRegistrationPendingInPerson(reg: EventRegistration): boolean {
  return (
    reg.status === EventRegistrationStatus.PendingInPerson ||
    (reg.paymentMethod === RegistrationPaymentMethod.InPerson &&
      reg.status !== EventRegistrationStatus.Paid &&
      reg.status !== EventRegistrationStatus.DepositPaid)
  );
}

export function resolveEffectiveRulesAndCapacities(
  product: Product,
  event: IlcEvent | null,
): {
  rules: EventPricingRules;
  capacityCounts: Record<string, number>;
} {
  const rules: EventPricingRules =
    product.pricingRules.capacities.length === 0 && event && event.capacities.length > 0
      ? {
          ...product.pricingRules,
          capacities: event.capacities,
        }
      : product.pricingRules;

  let capacityCounts: Record<string, number> = {};
  if (event && Object.keys(event.capacityCounts).length > 0) {
    capacityCounts = normalizeCapacityMap(event.capacityCounts);
  } else if (Object.keys(product.capacityCounts).length > 0) {
    capacityCounts = normalizeCapacityMap(product.capacityCounts);
  } else if (rules.capacities.length === 1) {
    const fallbackCount =
      (event?.inPersonRegistrationsCount ?? 0) || product.inPersonRegistrationsCount || 0;
    if (fallbackCount > 0) {
      capacityCounts = { [rules.capacities[0].id]: fallbackCount };
    }
  }

  return { rules, capacityCounts };
}

export function resolveRequestRuleSelection(
  rules: EventPricingRules,
  data: {
    optionId?: string;
    selectedSuboptions?: string[];
    selectedAddOnIds?: string[];
    attendance?: AttendanceType;
    includeVideo?: boolean;
  },
  existingReg: EventRegistration | null,
): {
  selectedOptionId: string;
  selectedSuboptions: string[];
  selectedAddOnIds: string[];
} {
  let selectedOptionId = (data.optionId || '').trim();
  if (!selectedOptionId && data.attendance) {
    const byAtt = rules.registrationOptions.find((o) => o.attendanceType === data.attendance);
    if (byAtt) {
      selectedOptionId = byAtt.id;
    }
  }
  if (!selectedOptionId && existingReg) {
    if (
      existingReg.optionId &&
      rules.registrationOptions.some((o) => o.id === existingReg.optionId)
    ) {
      selectedOptionId = existingReg.optionId;
    } else {
      const byRegAtt = rules.registrationOptions.find(
        (o) => o.attendanceType === existingReg.attendance,
      );
      if (byRegAtt) {
        selectedOptionId = byRegAtt.id;
      }
    }
  }
  if (!selectedOptionId) {
    selectedOptionId = rules.registrationOptions[0]?.id || '';
  }

  const addOnSet = new Set<string>(
    (data.selectedAddOnIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  // Legacy callers passing includeVideo: true without selectedAddOnIds
  if (data.selectedAddOnIds === undefined && data.includeVideo) {
    for (const addOn of rules.addOns) {
      if (addOn.spec.kind === EventAddOnKind.EventRecording) {
        addOnSet.add(addOn.id);
      }
    }
  }
  // Paid / deposit-paid upgrades retain previously purchased add-ons
  if (existingReg && !isRegistrationPendingInPerson(existingReg)) {
    for (const id of existingReg.selectedAddOnIds) {
      if (id) addOnSet.add(id);
    }
    if (existingReg.hasVideoAccess) {
      for (const addOn of rules.addOns) {
        if (addOn.spec.kind === EventAddOnKind.EventRecording) {
          addOnSet.add(addOn.id);
        }
      }
    }
  }

  const selectedSuboptions = Array.isArray(data.selectedSuboptions)
    ? data.selectedSuboptions
    : existingReg && existingReg.optionId === selectedOptionId
      ? existingReg.selectedSuboptions
      : [];

  return {
    selectedOptionId,
    selectedSuboptions,
    selectedAddOnIds: Array.from(addOnSet),
  };
}

export function computePriorPaidCreditCents(
  existingReg: EventRegistration | null,
  rules: EventPricingRules,
  memberContext: MemberStatusContext,
  isAdmin: boolean,
  eventStartDate: string,
): number {
  if (!existingReg || isRegistrationPendingInPerson(existingReg)) {
    return 0;
  }
  const paidCents = Math.max(0, existingReg.amountPaidCents);
  if (existingReg.status !== EventRegistrationStatus.Paid) {
    return paidCents;
  }

  const priorOptId =
    existingReg.optionId && rules.registrationOptions.some((o) => o.id === existingReg.optionId)
      ? existingReg.optionId
      : rules.registrationOptions.find((o) => o.attendanceType === existingReg.attendance)?.id;
  if (!priorOptId) {
    return paidCents;
  }

  const priorAddOnIds = new Set<string>(existingReg.selectedAddOnIds);
  if (existingReg.hasVideoAccess) {
    for (const a of rules.addOns) {
      if (a.spec.kind === EventAddOnKind.EventRecording) {
        priorAddOnIds.add(a.id);
      }
    }
  }

  const priorQuote = evaluateEventPricingQuote({
    rules,
    memberContext,
    isAdmin,
    eventStartDate,
    selectedOptionId: priorOptId,
    selectedAddOnIds: Array.from(priorAddOnIds),
  });

  return Math.max(paidCents, priorQuote.agreedTotalCents);
}

export function assertValidQuoteOrThrow(quote: EventPricingQuote): void {
  if (quote.isValid && quote.selectedOption) {
    return;
  }
  const permissionError = quote.validationErrors.find(
    (e) =>
      e.code === PricingValidationErrorCode.MembershipRequired ||
      e.code === PricingValidationErrorCode.InstructorRequired,
  );
  if (permissionError) {
    throw new HttpsError('permission-denied', permissionError.message);
  }
  const firstMsg =
    quote.validationErrors[0]?.message ||
    'The selected registration option is currently unavailable.';
  throw new HttpsError('failed-precondition', firstMsg);
}

export function computeCapacityUpdateOrThrow(
  capacities: EventCapacity[],
  currentCounts: Record<string, number>,
  previousHeldUsage: Record<string, number>,
  nextUsage: Record<string, number>,
): Record<string, number> {
  const updatedCounts: Record<string, number> = { ...normalizeCapacityMap(currentCounts) };
  const prevNorm = normalizeCapacityMap(previousHeldUsage);
  const nextNorm = normalizeCapacityMap(nextUsage);

  for (const cap of capacities) {
    const used = updatedCounts[cap.id] || 0;
    const prevHeld = prevNorm[cap.id] || 0;
    const nextHeld = nextNorm[cap.id] || 0;
    const baseWithoutSelf = Math.max(0, used - prevHeld);
    const projected = baseWithoutSelf + nextHeld;

    if (nextHeld > prevHeld && projected > cap.limit) {
      throw new HttpsError(
        'failed-precondition',
        `"${cap.label}" has reached capacity (${used}/${cap.limit}).`,
      );
    }
    if (projected > 0) {
      updatedCounts[cap.id] = projected;
    } else {
      delete updatedCounts[cap.id];
    }
  }

  return updatedCounts;
}

export function buildUnmarkedRegistrationUpdates(
  reg: EventRegistration,
  nowIso: string = new Date().toISOString(),
): Partial<EventRegistration> {
  if (reg.depositPaidCents > 0 && reg.agreedTotalCents > reg.depositPaidCents) {
    return {
      status: EventRegistrationStatus.DepositPaid,
      amountPaidCents: reg.depositPaidCents,
      amountDueCents: reg.agreedTotalCents - reg.depositPaidCents,
      paidAt: '',
      lastUpdated: nowIso,
    };
  }
  if (reg.paymentMethod !== RegistrationPaymentMethod.InPerson) {
    throw new HttpsError(
      'failed-precondition',
      'Only in-person door payments or deposit door balances can be unmarked.',
    );
  }
  const amountDueToRestore =
    reg.agreedTotalCents || reg.amountPaidCents || reg.amountDueCents || 0;
  return {
    status: EventRegistrationStatus.PendingInPerson,
    amountDueCents: amountDueToRestore,
    amountPaidCents: 0,
    paidAt: '',
    lastUpdated: nowIso,
  };
}

interface ResolvedCallerIdentity {
  authEmail: string;
  isAdmin: boolean;
  member: Member | undefined;
  memberContext: MemberStatusContext;
  verifiedRole: AttendeeRole;
}

async function resolveVerifiedCallerIdentity(
  request: CallableRequest<unknown>,
  db: admin.firestore.Firestore,
): Promise<ResolvedCallerIdentity> {
  const authEmail = verifiedAuthEmail(request);
  if (!authEmail) {
    return {
      authEmail: '',
      isAdmin: false,
      member: undefined,
      memberContext: PUBLIC_MEMBER_STATUS_CONTEXT,
      verifiedRole: AttendeeRole.NonMember,
    };
  }

  let isAdmin = false;
  try {
    const aclSnap = await db.collection(FirestoreCollection.Acl).doc(authEmail).get();
    const acl = aclSnap.data() as ACL | undefined;
    isAdmin = acl?.isAdmin === true;
  } catch {
    // Non-ACL user
  }

  let member: Member | undefined;
  try {
    member = await getMemberByEmail(authEmail, db);
  } catch {
    // Authenticated account without linked member profile
  }

  const memberContext = toMemberStatusContext({
    member: member ?? null,
    isAdmin,
  });

  return {
    authEmail,
    isAdmin,
    member,
    memberContext,
    verifiedRole: getAttendeeRoleForStatus(memberContext),
  };
}

function isCallerEventOrganizer(
  event: IlcEvent | null,
  callerEmail: string,
  callerMemberDocId: string,
): boolean {
  if (!event || !callerEmail) return false;
  if (
    callerMemberDocId &&
    (event.ownerDocId === callerMemberDocId ||
      event.managerDocIds.includes(callerMemberDocId))
  ) {
    return true;
  }
  const ownerEmails = normalizeEmails(event.ownerEmails);
  const managerEmails = normalizeEmails(event.managerEmails);
  return ownerEmails.includes(callerEmail) || managerEmails.includes(callerEmail);
}

async function provisionAddOnCatalogGrants(
  db: admin.firestore.Firestore,
  rules: EventPricingRules,
  selectedAddOnIds: string[],
  memberDocId: string,
  email: string,
  orderOrRegDocId: string,
): Promise<void> {
  if (!memberDocId && !email) return;
  const targetCatalogIds: string[] = [];
  for (const addOnId of selectedAddOnIds) {
    const addOn = rules.addOns.find((a) => a.id === addOnId);
    if (!addOn) continue;
    if (addOn.spec.kind === EventAddOnKind.CatalogVideo && addOn.spec.videoId) {
      targetCatalogIds.push(addOn.spec.videoId);
    } else if (addOn.spec.kind === EventAddOnKind.CatalogSeries && addOn.spec.seriesId) {
      targetCatalogIds.push(addOn.spec.seriesId);
    }
  }

  for (const catalogId of targetCatalogIds) {
    const { targetDocIds } = await resolveEventVideoGrantTargets(db, catalogId);
    for (const targetId of targetDocIds) {
      const grant: VideoGrant = {
        docId: targetId,
        videoId: targetId,
        memberDocId: memberDocId || '',
        memberEmail: email,
        grantKind: VideoGrantKind.StripePurchase,
        orderDocId: orderOrRegDocId,
        stripeSessionId: '',
        amountPaidCents: 0,
        grantedAt: new Date().toISOString(),
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
  }
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

  // 1. Load Product & Linked Event
  const productSnap = await db.collection(FirestoreCollection.Products).doc(data.productId).get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', 'Product not found.');
  }
  const product: Product = firestoreDocToProduct(productSnap);

  let linkedEvent: IlcEvent | null = null;
  if (product.eventDocId) {
    const eventSnap = await db.collection(FirestoreCollection.Events).doc(product.eventDocId).get();
    if (eventSnap.exists) {
      linkedEvent = firestoreDocToIlcEvent(eventSnap);
    }
  }

  // 2. Resolve Verified Caller Identity
  const caller = await resolveVerifiedCallerIdentity(request, db);
  const emailToLookup =
    caller.authEmail || normalizeEmail(data.attendeeDetails?.email) || '';

  // 3. Upgrade Verification or Duplicate Registration Prevention
  let isUpgradeActive = false;
  let isPayingUnpaidInPerson = false;
  let existingReg: EventRegistration | null = null;
  let targetMember = caller.member;
  let targetMemberContext = caller.memberContext;

  if (product.eventDocId) {
    if (data.isUpgrade && data.existingRegistrationDocId) {
      if (!caller.authEmail) {
        throw new HttpsError(
          'unauthenticated',
          'You must be authenticated with a verified email to upgrade an existing registration.',
        );
      }
      const regSnap = await db
        .collection(FirestoreCollection.Events)
        .doc(product.eventDocId)
        .collection(FirestoreSubcollection.Registrations)
        .doc(data.existingRegistrationDocId)
        .get();
      if (!regSnap.exists) {
        throw new HttpsError('not-found', 'Existing registration not found for upgrade.');
      }

      existingReg = firestoreDocToEventRegistration(regSnap);
      const regEmail = normalizeEmail(existingReg.email);
      const callerMemberDocId = caller.member?.docId || '';
      const isEventManager = isCallerEventOrganizer(
        linkedEvent,
        caller.authEmail,
        callerMemberDocId,
      );

      const isAuthorized =
        caller.authEmail === regEmail ||
        Boolean(
          callerMemberDocId &&
            existingReg.memberDocId &&
            callerMemberDocId === existingReg.memberDocId,
        ) ||
        caller.isAdmin ||
        isEventManager;

      if (!isAuthorized) {
        throw new HttpsError(
          'permission-denied',
          'You are not authorized to upgrade this registration.',
        );
      }

      // If an admin/manager is upgrading another attendee's registration, evaluate pricing for that attendee
      if (existingReg.memberDocId && existingReg.memberDocId !== callerMemberDocId) {
        const attendeeSnap = await db
          .collection(FirestoreCollection.Members)
          .doc(existingReg.memberDocId)
          .get();
        if (attendeeSnap.exists) {
          targetMember = firestoreDocToMember(attendeeSnap);
          targetMemberContext = toMemberStatusContext({
            member: targetMember,
            isAdmin: false,
          });
        }
      }

      isPayingUnpaidInPerson = isRegistrationPendingInPerson(existingReg);
      isUpgradeActive = true;
    } else {
      const regsRef = db
        .collection(FirestoreCollection.Events)
        .doc(product.eventDocId)
        .collection(FirestoreSubcollection.Registrations);
      let existingSnap: FirebaseFirestore.QuerySnapshot | null = null;
      if (caller.member?.docId) {
        existingSnap = await regsRef.where('memberDocId', '==', caller.member.docId).limit(1).get();
      }
      if ((!existingSnap || existingSnap.empty) && emailToLookup) {
        existingSnap = await regsRef.where('email', '==', emailToLookup).limit(1).get();
      }
      if (existingSnap && !existingSnap.empty) {
        const activeDup = existingSnap.docs.some((d) => {
          const r = firestoreDocToEventRegistration(d);
          return (
            r.status !== EventRegistrationStatus.Cancelled &&
            r.status !== EventRegistrationStatus.Refunded
          );
        });
        if (activeDup) {
          throw new HttpsError(
            'already-exists',
            'You already have an active registration for this event. Please select an upgrade option instead.',
          );
        }
      }
    }
  }

  // 4. Evaluate Compositional Pricing Rules & Live Capacities
  const { rules, capacityCounts } = resolveEffectiveRulesAndCapacities(product, linkedEvent);
  const existingCapacityUsage = existingReg
    ? computeEffectiveCapacityUsage(existingReg, rules.capacities)
    : {};
  const selection = resolveRequestRuleSelection(rules, data, existingReg);
  const requestedPaymentChoice =
    data.paymentChoice === PaymentChoice.Deposit ? PaymentChoice.Deposit : PaymentChoice.Full;
  const eventPast = linkedEvent ? isEventPast(linkedEvent) : false;

  const quote = evaluateEventPricingQuote({
    rules,
    memberContext: targetMemberContext,
    isAdmin: caller.isAdmin,
    isEventPast: eventPast,
    capacityCounts,
    existingCapacityUsage,
    eventStartDate: linkedEvent?.start || '',
    selectedOptionId: selection.selectedOptionId,
    selectedSuboptions: selection.selectedSuboptions,
    selectedAddOnIds: selection.selectedAddOnIds,
    paymentChoice: requestedPaymentChoice,
  });

  assertValidQuoteOrThrow(quote);
  const questionValidation = validateAndBuildQuestionResponses({
    applicableQuestions: quote.applicableQuestions,
    submittedAnswers: data.questionAnswers ?? [],
    existingResponses: existingReg?.questionResponses ?? [],
  });
  if (questionValidation.errors.length > 0) {
    throw new HttpsError('invalid-argument', questionValidation.errors[0].message);
  }
  const selectedOpt = quote.selectedOption!;
  const effectiveChoice = quote.effectivePaymentChoice;
  if (!effectiveChoice || effectiveChoice === PaymentChoice.PayAtDoor) {
    throw new HttpsError(
      'failed-precondition',
      'Online payment is not enabled for this selection. Use in-person registration instead.',
    );
  }

  const creditAppliedCents = computePriorPaidCreditCents(
    existingReg,
    rules,
    targetMemberContext,
    caller.isAdmin,
    linkedEvent?.start || '',
  );

  const priceToChargeInCents =
    effectiveChoice === PaymentChoice.Deposit
      ? Math.max(0, quote.chargeNowCents - creditAppliedCents)
      : Math.max(0, quote.agreedTotalCents - creditAppliedCents);

  const remainingDoorBalanceCents =
    effectiveChoice === PaymentChoice.Deposit
      ? Math.max(
          0,
          quote.cashDueAtDoorCents - Math.max(0, creditAppliedCents - quote.chargeNowCents),
        )
      : 0;

  if (priceToChargeInCents <= 0) {
    throw new HttpsError(
      'failed-precondition',
      'No additional online payment is required for this selection. Use updateProductRegistration instead.',
    );
  }

  if (priceToChargeInCents < 50) {
    throw new HttpsError(
      'invalid-argument',
      'Amount is below minimum chargeable threshold ($0.50).',
    );
  }

  const stripe = getStripeClient();

  // 5. Ensure Stripe customer is created / linked
  let customerId: string | undefined;
  const memberDocId = targetMember?.docId || existingReg?.memberDocId || '';
  const memberId = targetMember?.memberId || existingReg?.memberId || '';

  if (targetMember && caller.authEmail && targetMember.docId === caller.member?.docId) {
    try {
      if (targetMember.stripeCustomerId) {
        customerId = targetMember.stripeCustomerId;
      } else {
        const existing = await stripe.customers.list({
          email: caller.authEmail,
          limit: 1,
        });
        if (existing.data.length > 0) {
          customerId = existing.data[0].id;
        } else {
          const created = await stripe.customers.create({
            email: caller.authEmail,
            name: data.attendeeDetails?.name || targetMember.name || undefined,
            metadata: {
              memberDocId: targetMember.docId,
              memberId: targetMember.memberId,
            },
          });
          customerId = created.id;
        }
        await db.collection(FirestoreCollection.Members).doc(targetMember.docId).update({
          stripeCustomerId: customerId,
          lastUpdated: FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      logger.warn('Could not sync Stripe customer for member', {
        authEmail: caller.authEmail,
        error: e,
      });
    }
  }

  // 6. Build Dynamic Line Item Description & Metadata
  const role: AttendeeRole = existingReg?.role || getAttendeeRoleForStatus(targetMemberContext);
  const attendance = selectedOpt.option.attendanceType;
  const selectedAddOnIds = quote.selectedAddOns.map((a) => a.addOn.id);
  const selectedAddOnLabels = quote.selectedAddOns.map((a) => a.addOn.label);
  const includeVideo =
    attendance === AttendanceType.VideoOnly ||
    Boolean(existingReg?.hasVideoAccess) ||
    quote.selectedAddOns.some((a) => a.addOn.spec.kind === EventAddOnKind.EventRecording);

  const subDesc =
    quote.normalizedSuboptions.length > 0
      ? ` [${quote.normalizedSuboptions.join(', ')}]`
      : '';
  const addOnsDesc =
    selectedAddOnLabels.length > 0 ? ` + ${selectedAddOnLabels.join(', ')}` : '';
  const settlementPrefix =
    effectiveChoice === PaymentChoice.Deposit ? 'Deposit: ' : '';

  let lineItemDescription = `${settlementPrefix}${product.title} — ${selectedOpt.option.label}${subDesc}${addOnsDesc}`;
  if (isUpgradeActive && creditAppliedCents > 0) {
    const creditStr = (creditAppliedCents / 100).toFixed(2);
    const currStr = (product.currency || 'usd').toUpperCase();
    lineItemDescription = `Upgrade: ${lineItemDescription} (Credit of ${creditStr} ${currStr} applied)`;
  }

  const pricingTierType = quote.isEarlyBird ? PricingTierType.EarlyBird : PricingTierType.Standard;

  const successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = product.eventDocId
    ? `${origin}/events/${product.eventDocId}/register`
    : `${origin}/events/${product.docId}/register`;

  const totalOnlinePaidAfterCheckout = (existingReg?.amountPaidCents || 0) + priceToChargeInCents;

  const metadata: Record<string, string> = {
    orderType: 'event_registration',
    productId: product.docId,
    eventDocId: product.eventDocId || '',
    role,
    attendance,
    includeVideo: includeVideo ? 'true' : 'false',
    paymentMethod: RegistrationPaymentMethod.Stripe,
    pricingTierType,
    optionId: selectedOpt.option.id,
    optionLabel: selectedOpt.option.label,
    selectedSuboptions: JSON.stringify(quote.normalizedSuboptions),
    selectedAddOnIds: JSON.stringify(selectedAddOnIds),
    selectedAddOnLabels: JSON.stringify(selectedAddOnLabels),
    capacityUsage: JSON.stringify(selectedOpt.option.capacityUsage),
    paymentChoice: effectiveChoice,
    agreedTotalCents: String(quote.agreedTotalCents),
    depositCents: String(effectiveChoice === PaymentChoice.Deposit ? quote.depositCents : 0),
    cashDueAtDoorCents: String(remainingDoorBalanceCents),
    attendeeName: data.attendeeDetails?.name || '',
    attendeeEmail: normalizeEmail(data.attendeeDetails?.email),
    attendeePhone: data.attendeeDetails?.phone || '',
    attendeeNotes: data.attendeeDetails?.notes || '',
    memberDocId,
    memberId,
    ...encodeQuestionResponsesToMetadata(questionValidation.responses),
  };

  if (isUpgradeActive && data.existingRegistrationDocId) {
    metadata['isUpgrade'] = 'true';
    metadata['existingRegistrationDocId'] = data.existingRegistrationDocId;
    metadata['upgradeAmountCents'] = String(priceToChargeInCents);
    metadata['previouslyPaidCents'] = String(creditAppliedCents);
    metadata['totalAmountPaidCents'] = String(totalOnlinePaidAfterCheckout);
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

  const stripeProductId =
    product.stripeProductId || environment.stripe?.hqRegistrationForEventStripeProductId;
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
    optionId: selectedOpt.option.id,
    paymentChoice: effectiveChoice,
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
    throw new HttpsError('invalid-argument', 'Attendee name and email are required.');
  }

  const db = admin.firestore();

  // 1. Load Product & Event
  const prodRef = db.collection(FirestoreCollection.Products).doc(data.productId);
  const productSnap = await prodRef.get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', 'Product not found.');
  }
  const product: Product = firestoreDocToProduct(productSnap);
  if (!product.eventDocId) {
    throw new HttpsError('failed-precondition', 'Product is not linked to an event.');
  }

  const eventRef = db.collection(FirestoreCollection.Events).doc(product.eventDocId);
  const eventSnap = await eventRef.get();
  const linkedEvent: IlcEvent | null = eventSnap.exists ? firestoreDocToIlcEvent(eventSnap) : null;

  // 2. Load Existing Registration
  const regRef = eventRef
    .collection(FirestoreSubcollection.Registrations)
    .doc(data.existingRegistrationDocId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    throw new HttpsError('not-found', 'Existing registration not found.');
  }
  const existingReg = firestoreDocToEventRegistration(regSnap);

  // 3. Verify Caller Authorization
  const caller = await resolveVerifiedCallerIdentity(request, db);
  if (!caller.authEmail) {
    throw new HttpsError(
      'unauthenticated',
      'You must be authenticated with a verified email to update a registration.',
    );
  }

  const regEmail = normalizeEmail(existingReg.email);
  const callerMemberDocId = caller.member?.docId || '';
  const isEventManager = isCallerEventOrganizer(linkedEvent, caller.authEmail, callerMemberDocId);
  const isAuthorized =
    caller.authEmail === regEmail ||
    Boolean(
      callerMemberDocId &&
        existingReg.memberDocId &&
        callerMemberDocId === existingReg.memberDocId,
    ) ||
    caller.isAdmin ||
    isEventManager;

  if (!isAuthorized) {
    throw new HttpsError(
      'permission-denied',
      'You are not authorized to update this registration.',
    );
  }

  // Evaluate member context for the attendee on the registration
  let targetMemberContext = caller.memberContext;
  if (existingReg.memberDocId && existingReg.memberDocId !== callerMemberDocId) {
    const attendeeSnap = await db
      .collection(FirestoreCollection.Members)
      .doc(existingReg.memberDocId)
      .get();
    if (attendeeSnap.exists) {
      targetMemberContext = toMemberStatusContext({
        member: firestoreDocToMember(attendeeSnap),
        isAdmin: false,
      });
    }
  }

  const { rules, capacityCounts } = resolveEffectiveRulesAndCapacities(product, linkedEvent);
  const existingCapacityUsage = computeEffectiveCapacityUsage(existingReg, rules.capacities);
  const selection = resolveRequestRuleSelection(rules, data, existingReg);
  const isUnpaidInPerson = isRegistrationPendingInPerson(existingReg);
  const eventPast = linkedEvent ? isEventPast(linkedEvent) : false;

  const requestedChoice = isUnpaidInPerson
    ? PaymentChoice.PayAtDoor
    : existingReg.status === EventRegistrationStatus.DepositPaid
      ? PaymentChoice.Deposit
      : PaymentChoice.Full;

  const quote = evaluateEventPricingQuote({
    rules,
    memberContext: targetMemberContext,
    isAdmin: caller.isAdmin || isEventManager,
    isEventPast: eventPast,
    capacityCounts,
    existingCapacityUsage,
    eventStartDate: linkedEvent?.start || '',
    selectedOptionId: selection.selectedOptionId,
    selectedSuboptions: selection.selectedSuboptions,
    selectedAddOnIds: selection.selectedAddOnIds,
    paymentChoice: requestedChoice,
  });

  assertValidQuoteOrThrow(quote);
  const questionValidation = validateAndBuildQuestionResponses({
    applicableQuestions: quote.applicableQuestions,
    submittedAnswers: data.questionAnswers ?? [],
    existingResponses: existingReg?.questionResponses ?? [],
  });
  if (questionValidation.errors.length > 0) {
    throw new HttpsError('invalid-argument', questionValidation.errors[0].message);
  }
  const selectedOpt = quote.selectedOption!;

  const creditAppliedCents = computePriorPaidCreditCents(
    existingReg,
    rules,
    targetMemberContext,
    caller.isAdmin || isEventManager,
    linkedEvent?.start || '',
  );

  const onlineDueNowCents = isUnpaidInPerson
    ? 0
    : quote.effectivePaymentChoice === PaymentChoice.Deposit
      ? Math.max(0, quote.chargeNowCents - creditAppliedCents)
      : Math.max(0, quote.agreedTotalCents - creditAppliedCents);

  if (onlineDueNowCents > 0 && !isUnpaidInPerson) {
    throw new HttpsError(
      'failed-precondition',
      'The selected option requires an additional payment. Please proceed via the payment checkout.',
    );
  }

  const newDoorDueCents = isUnpaidInPerson
    ? quote.agreedTotalCents
    : quote.effectivePaymentChoice === PaymentChoice.Deposit
      ? Math.max(
          0,
          quote.cashDueAtDoorCents - Math.max(0, creditAppliedCents - quote.chargeNowCents),
        )
      : 0;

  const attendance = selectedOpt.option.attendanceType;
  const selectedAddOnIds = quote.selectedAddOns.map((a) => a.addOn.id);
  const selectedAddOnLabels = quote.selectedAddOns.map((a) => a.addOn.label);
  const hasVideoAccess =
    attendance === AttendanceType.VideoOnly ||
    (!isUnpaidInPerson && existingReg.hasVideoAccess) ||
    quote.selectedAddOns.some((a) => a.addOn.spec.kind === EventAddOnKind.EventRecording);

  const nowIso = new Date().toISOString();
  const nextStatus =
    !isUnpaidInPerson && newDoorDueCents === 0 && existingReg.status === EventRegistrationStatus.DepositPaid
      ? EventRegistrationStatus.Paid
      : existingReg.status;

  // 4. Transactional Capacity Check + Registration & Event Update
  await db.runTransaction(async (tx) => {
    const [txEventSnap, txRegSnap] = await Promise.all([tx.get(eventRef), tx.get(regRef)]);
    if (!txRegSnap.exists) {
      throw new HttpsError('not-found', 'Existing registration not found.');
    }
    const freshExisting = firestoreDocToEventRegistration(txRegSnap);
    const freshEvent = txEventSnap.exists ? firestoreDocToIlcEvent(txEventSnap) : null;
    const { rules: txRules, capacityCounts: txCounts } = resolveEffectiveRulesAndCapacities(
      product,
      freshEvent,
    );
    const prevHeld = computeEffectiveCapacityUsage(freshExisting, txRules.capacities);
    const nextUsage = selectedOpt.option.capacityUsage;
    const updatedCapacityCounts = computeCapacityUpdateOrThrow(
      txRules.capacities,
      txCounts,
      prevHeld,
      nextUsage,
    );

    const wasInPerson =
      freshExisting.attendance === AttendanceType.InPerson ||
      freshExisting.attendance === AttendanceType.InPersonAndOnline;
    const willBeInPerson =
      attendance === AttendanceType.InPerson ||
      attendance === AttendanceType.InPersonAndOnline;
    const inPersonDelta = (willBeInPerson ? 1 : 0) - (wasInPerson ? 1 : 0);

    const updatedRegistration: EventRegistration = {
      ...freshExisting,
      name: data.attendeeDetails.name.trim(),
      email: normalizeEmail(data.attendeeDetails.email),
      phone: data.attendeeDetails.phone?.trim() || '',
      notes: data.attendeeDetails.notes?.trim() || '',
      attendance,
      hasVideoAccess,
      optionId: selectedOpt.option.id,
      optionLabel: selectedOpt.option.label,
      selectedSuboptions: quote.normalizedSuboptions,
      selectedAddOnIds,
      selectedAddOnLabels,
      capacityUsage: normalizeCapacityMap(nextUsage),
      paymentChoice: quote.effectivePaymentChoice ?? PaymentChoice.Full,
      agreedTotalCents: quote.agreedTotalCents,
      amountDueCents: newDoorDueCents,
      status: nextStatus,
      questionResponses: mergeImmutableQuestionResponses(
        freshExisting.questionResponses,
        questionValidation.responses,
      ),
      lastUpdated: nowIso,
      upgradeHistory: [
        ...freshExisting.upgradeHistory,
        {
          timestamp: nowIso,
          previousAttendance: freshExisting.attendance,
          previousHasVideoAccess: freshExisting.hasVideoAccess,
          upgradeAmountCents: 0,
          stripeSessionId: '',
        },
      ],
    };

    tx.set(regRef, updatedRegistration);
    if (freshExisting.memberDocId) {
      const memberRegRef = db
        .collection(FirestoreCollection.Members)
        .doc(freshExisting.memberDocId)
        .collection(FirestoreSubcollection.Registrations)
        .doc(data.existingRegistrationDocId);
      tx.set(memberRegRef, updatedRegistration);
    }

    if (txEventSnap.exists && freshEvent) {
      tx.update(eventRef, {
        capacityCounts: updatedCapacityCounts,
        inPersonRegistrationsCount: Math.max(
          0,
          (freshEvent.inPersonRegistrationsCount ?? 0) + inPersonDelta,
        ),
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }
    tx.update(prodRef, {
      capacityCounts: updatedCapacityCounts,
      inPersonRegistrationsCount: Math.max(
        0,
        product.inPersonRegistrationsCount + inPersonDelta,
      ),
      lastUpdated: FieldValue.serverTimestamp(),
    });
  });

  // 5. Provision any newly included VOD add-on grants (for paid registrations)
  if (!isUnpaidInPerson) {
    try {
      await provisionAddOnCatalogGrants(
        db,
        rules,
        selectedAddOnIds,
        existingReg.memberDocId,
        normalizeEmail(data.attendeeDetails.email),
        data.existingRegistrationDocId,
      );
    } catch (grantErr) {
      logger.warn('Failed to provision catalog VOD grants on updateProductRegistration', {
        grantErr,
      });
    }
  }

  // 6. Send updated confirmation notification
  if (existingReg.memberDocId) {
    try {
      const eventTitle = linkedEvent?.title || product.title || 'Event';
      const purchaseDetailsMarkdown =
        product.purchaseDetailsMarkdown || linkedEvent?.purchaseDetailsMarkdown || '';
      const inPersonDetailsMarkdown =
        product.inPersonDetailsMarkdown || linkedEvent?.inPersonDetailsMarkdown || '';
      const onlineJoiningLink =
        product.onlineJoiningLink || linkedEvent?.onlineJoiningLink || '';

      let message = `Your registration for **[${eventTitle}](/events/${product.eventDocId})** has been updated (${selectedOpt.option.label})!`;
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
        createdAt: nowIso,
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
    optionId: selectedOpt.option.id,
    attendance,
    hasVideoAccess,
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

  const name = data.attendeeDetails?.name?.trim() || '';
  const email = normalizeEmail(data.attendeeDetails?.email);
  if (!name || !email) {
    throw new HttpsError('invalid-argument', 'Attendee name and email are required.');
  }

  const db = admin.firestore();

  // 1. Load Product & Event
  const prodRef = db.collection(FirestoreCollection.Products).doc(data.productId);
  const productSnap = await prodRef.get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', 'Product not found.');
  }
  const product: Product = firestoreDocToProduct(productSnap);
  if (!product.eventDocId) {
    throw new HttpsError('failed-precondition', 'Product is not linked to an event.');
  }

  const eventRef = db.collection(FirestoreCollection.Events).doc(product.eventDocId);
  const eventSnap = await eventRef.get();
  const linkedEvent: IlcEvent | null = eventSnap.exists ? firestoreDocToIlcEvent(eventSnap) : null;
  if (linkedEvent && isEventPast(linkedEvent)) {
    throw new HttpsError(
      'failed-precondition',
      'Live registration is closed as this event has already taken place.',
    );
  }

  // 2. Resolve Verified Caller Identity
  const caller = await resolveVerifiedCallerIdentity(request, db);
  const memberDocId = caller.member?.docId || '';
  const memberId = caller.member?.memberId || '';

  // 3. Check for Duplicate Registration
  const regsRef = eventRef.collection(FirestoreSubcollection.Registrations);
  let existingSnap: FirebaseFirestore.QuerySnapshot | null = null;
  if (memberDocId) {
    existingSnap = await regsRef.where('memberDocId', '==', memberDocId).limit(1).get();
  }
  if ((!existingSnap || existingSnap.empty) && email) {
    existingSnap = await regsRef.where('email', '==', email).limit(1).get();
  }
  if (existingSnap && !existingSnap.empty) {
    const activeDup = existingSnap.docs.some((d) => {
      const r = firestoreDocToEventRegistration(d);
      return (
        r.status !== EventRegistrationStatus.Cancelled &&
        r.status !== EventRegistrationStatus.Refunded
      );
    });
    if (activeDup) {
      throw new HttpsError(
        'already-exists',
        'You already have an active registration for this event.',
      );
    }
  }

  // 4. Evaluate Compositional Pricing Rules for PayAtDoor
  const { rules, capacityCounts } = resolveEffectiveRulesAndCapacities(product, linkedEvent);
  const selection = resolveRequestRuleSelection(rules, data, null);

  if (!rules.payment.allowZeroDepositInPerson) {
    throw new HttpsError(
      'failed-precondition',
      'Paying in person without an online deposit is not enabled for this event.',
    );
  }

  const quote = evaluateEventPricingQuote({
    rules,
    memberContext: caller.memberContext,
    isAdmin: caller.isAdmin,
    isEventPast: false,
    capacityCounts,
    eventStartDate: linkedEvent?.start || '',
    selectedOptionId: selection.selectedOptionId,
    selectedSuboptions: selection.selectedSuboptions,
    selectedAddOnIds: selection.selectedAddOnIds,
    paymentChoice: PaymentChoice.PayAtDoor,
  });

  assertValidQuoteOrThrow(quote);
  const questionValidation = validateAndBuildQuestionResponses({
    applicableQuestions: quote.applicableQuestions,
    submittedAnswers: data.questionAnswers ?? [],
    existingResponses: [],
  });
  if (questionValidation.errors.length > 0) {
    throw new HttpsError('invalid-argument', questionValidation.errors[0].message);
  }
  const selectedOpt = quote.selectedOption!;
  if (quote.effectivePaymentChoice !== PaymentChoice.PayAtDoor) {
    throw new HttpsError(
      'failed-precondition',
      'Paying in person at the door is not available for the selected option.',
    );
  }

  const attendance = selectedOpt.option.attendanceType;
  const selectedAddOnIds = quote.selectedAddOns.map((a) => a.addOn.id);
  const selectedAddOnLabels = quote.selectedAddOns.map((a) => a.addOn.label);
  const hasVideoAccess =
    attendance === AttendanceType.VideoOnly ||
    quote.selectedAddOns.some((a) => a.addOn.spec.kind === EventAddOnKind.EventRecording);
  const inPersonPriceCents = quote.agreedTotalCents;

  const targetRegDoc = regsRef.doc();
  const registrationId = targetRegDoc.id;
  const nowIso = new Date().toISOString();

  // 5. Transactional Capacity Enforcement + Registration Creation
  await db.runTransaction(async (tx) => {
    const txEventSnap = await tx.get(eventRef);
    const freshEvent = txEventSnap.exists ? firestoreDocToIlcEvent(txEventSnap) : null;
    const { rules: txRules, capacityCounts: txCounts } = resolveEffectiveRulesAndCapacities(
      product,
      freshEvent,
    );
    const nextUsage = selectedOpt.option.capacityUsage;
    const updatedCapacityCounts = computeCapacityUpdateOrThrow(
      txRules.capacities,
      txCounts,
      {},
      nextUsage,
    );

    const isInPerson =
      attendance === AttendanceType.InPerson ||
      attendance === AttendanceType.InPersonAndOnline;
    const inPersonDelta = isInPerson ? 1 : 0;

    const registration: EventRegistration = {
      ...initEventRegistration(),
      docId: registrationId,
      eventDocId: product.eventDocId,
      productId: product.docId,
      orderDocId: registrationId,
      stripeSessionId: '',
      registeredAt: nowIso,
      name,
      email,
      phone: data.attendeeDetails?.phone?.trim() || '',
      notes: data.attendeeDetails?.notes?.trim() || '',
      memberDocId,
      memberId,
      studentLevel: caller.member?.studentLevel || '',
      applicationLevel: caller.member?.applicationLevel || '',
      role: caller.verifiedRole,
      attendance,
      hasVideoAccess,
      optionId: selectedOpt.option.id,
      optionLabel: selectedOpt.option.label,
      selectedSuboptions: quote.normalizedSuboptions,
      selectedAddOnIds,
      selectedAddOnLabels,
      capacityUsage: normalizeCapacityMap(nextUsage),
      paymentChoice: PaymentChoice.PayAtDoor,
      agreedTotalCents: inPersonPriceCents,
      depositPaidCents: 0,
      questionResponses: questionValidation.responses,
      amountPaidCents: 0,
      amountDueCents: inPersonPriceCents,
      currency: product.currency || 'usd',
      status: EventRegistrationStatus.PendingInPerson,
      paymentMethod: RegistrationPaymentMethod.InPerson,
      pricingTierType: PricingTierType.InPerson,
      paidAt: '',
      lastUpdated: nowIso,
      upgradeHistory: [],
    };

    tx.set(targetRegDoc, registration);
    if (memberDocId) {
      const memberRegRef = db
        .collection(FirestoreCollection.Members)
        .doc(memberDocId)
        .collection(FirestoreSubcollection.Registrations)
        .doc(registrationId);
      tx.set(memberRegRef, registration);
    }

    if (txEventSnap.exists && freshEvent) {
      tx.update(eventRef, {
        capacityCounts: updatedCapacityCounts,
        inPersonRegistrationsCount: Math.max(
          0,
          (freshEvent.inPersonRegistrationsCount ?? 0) + inPersonDelta,
        ),
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }
    tx.update(prodRef, {
      capacityCounts: updatedCapacityCounts,
      inPersonRegistrationsCount: product.inPersonRegistrationsCount + inPersonDelta,
      lastUpdated: FieldValue.serverTimestamp(),
    });
  });

  // 6. Send Member Notification
  if (memberDocId) {
    try {
      const eventTitle = linkedEvent?.title || product.title;
      const formattedAmount = (inPersonPriceCents / 100).toFixed(2);
      const curr = (product.currency || 'usd').toUpperCase();
      const inPersonDetails =
        product.inPersonDetailsMarkdown || linkedEvent?.inPersonDetailsMarkdown || '';
      let message = `You are registered to pay in person for **[${eventTitle}](/events/${product.eventDocId})** (${selectedOpt.option.label})! Total due upon arrival: **${curr} ${formattedAmount}**.`;
      if (inPersonDetails) {
        message += `\n\n### In-Person Arrival Details\n${inPersonDetails}`;
      }
      await createMemberNotification(db, memberDocId, {
        kind: NotificationKind.EventRegistrationConfirmed,
        markdown: message,
        createdAt: nowIso,
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

  const eventSnap = await db.collection(FirestoreCollection.Events).doc(eventId).get();
  if (!eventSnap.exists) {
    throw new HttpsError('not-found', 'Event not found.');
  }
  const event = firestoreDocToIlcEvent(eventSnap);
  const caller = await resolveVerifiedCallerIdentity(request, db);
  const isManager = isCallerEventOrganizer(event, caller.authEmail, caller.member?.docId || '');

  if (!caller.isAdmin && !isManager) {
    throw new HttpsError(
      'permission-denied',
      'You are not authorized to mark registrations as paid for this event.',
    );
  }

  const regRef = db
    .collection(FirestoreCollection.Events)
    .doc(eventId)
    .collection(FirestoreSubcollection.Registrations)
    .doc(registrationId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    throw new HttpsError('not-found', 'Registration not found.');
  }

  const reg = firestoreDocToEventRegistration(regSnap);
  const nowIso = new Date().toISOString();
  const totalPaid =
    reg.amountDueCents > 0 ? reg.amountPaidCents + reg.amountDueCents : reg.amountPaidCents;

  const updates: Partial<EventRegistration> = {
    status: EventRegistrationStatus.Paid,
    amountPaidCents: totalPaid,
    amountDueCents: 0,
    paidAt: nowIso,
    lastUpdated: nowIso,
  };

  const batch = db.batch();
  batch.update(regRef, updates);

  if (reg.memberDocId) {
    const memberRegRef = db
      .collection(FirestoreCollection.Members)
      .doc(reg.memberDocId)
      .collection(FirestoreSubcollection.Registrations)
      .doc(registrationId);
    batch.update(memberRegRef, updates);
  }

  await batch.commit();
  return { success: true };
});

export const unmarkEventRegistrationPaid = onCall<
  UnmarkEventRegistrationPaidRequest,
  Promise<UnmarkEventRegistrationPaidResult>
>({ cors: allowedOrigins }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { eventId, registrationId } = request.data || {};
  if (!eventId || !registrationId) {
    throw new HttpsError('invalid-argument', 'eventId and registrationId are required.');
  }

  const db = admin.firestore();
  const callerEmail = verifiedAuthEmail(request);
  if (!callerEmail) {
    throw new HttpsError('unauthenticated', 'User must be authenticated with a verified email.');
  }

  const aclSnap = await db.collection(FirestoreCollection.Acl).doc(callerEmail).get();
  const acl = aclSnap.data() as ACL | undefined;
  const isAdmin = acl?.isAdmin === true;
  const callerMemberDocId = acl?.memberDocIds?.[0] || '';

  let isManager = false;
  const eventSnap = await db.collection(FirestoreCollection.Events).doc(eventId).get();
  if (eventSnap.exists) {
    const event = firestoreDocToIlcEvent(eventSnap);
    isManager = isCallerEventOrganizer(event, callerEmail, callerMemberDocId);
  }

  if (!isAdmin && !isManager) {
    throw new HttpsError(
      'permission-denied',
      'You are not authorized to manage registrations for this event.',
    );
  }

  const regRef = db
    .collection(FirestoreCollection.Events)
    .doc(eventId)
    .collection(FirestoreSubcollection.Registrations)
    .doc(registrationId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    throw new HttpsError('not-found', 'Registration not found.');
  }

  const reg = firestoreDocToEventRegistration(regSnap);
  const updates = buildUnmarkedRegistrationUpdates(reg);

  const batch = db.batch();
  batch.update(regRef, updates);

  if (reg.memberDocId) {
    const memberRegRef = db
      .collection(FirestoreCollection.Members)
      .doc(reg.memberDocId)
      .collection(FirestoreSubcollection.Registrations)
      .doc(registrationId);
    batch.update(memberRegRef, updates);
  }

  await batch.commit();
  return { success: true };
});
