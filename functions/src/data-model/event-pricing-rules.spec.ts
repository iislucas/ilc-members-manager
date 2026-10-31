/* event-pricing-rules.spec.ts
 *
 * Unit tests for unified compositional rule-based event pricing, named capacities,
 * shared EventRuleConditions (Who, Early Bird Before/After, Before Event Starts, Option Scope),
 * cumulative EventDiscount summing, Firestore normalizers, legacy Matrix & legacy Rules
 * interpretation, Anywhere-on-Earth (UTC-12) cutoff boundaries, suboption validation,
 * and deposit/cash payment splits.
 */

import { describe, expect, it } from 'vitest';
import {
  AttendanceType,
  AttendeeRole,
  computeEffectiveCapacityUsage,
  EventRegistrationStatus,
  firestoreDocToEventRegistration,
  firestoreDocToIlcEvent,
  firestoreDocToProduct,
  formatProductPriceRange,
  hasSpecialRolePrice,
  initEventRegistration,
  initProduct,
  syncProductSummaryFlagsFromRules,
} from './events';
import {
  applyDiscount,
  decodeQuestionResponsesFromMetadata,
  DepositPolicyKind,
  DepositRefundPolicyKind,
  EarlyBirdPolicyKind,
  encodeQuestionResponsesToMetadata,
  EventAddOnKind,
  EventPricingRules,
  evaluateEventPricingQuote,
  formatQuestionResponseValue,
  getAnywhereOnEarthDate,
  initEventAddOn,
  initEventDiscount,
  initEventRegistrationOption,
  initEventRegistrationQuestion,
  initEventRuleConditions,
  normalizeEventPricingRules,
  PaymentChoice,
  PersonStatusKind,
  PricingValidationErrorCode,
  RegistrationConditionKind,
  RegistrationQuestionKind,
  SubSelectionKind,
  TimingConditionKind,
  TimingWindow,
  validateAndBuildQuestionResponses,
  validateRuleConditions,
  WhoConditionKind,
} from './event-pricing-rules';
import { InstructorLicenseType } from './curriculum';
import {
  MemberStatusFields,
  MembershipType,
  PUBLIC_MEMBER_STATUS_CONTEXT,
  toMemberStatusContext,
} from './member-status';

const activeMemberFields: MemberStatusFields = {
  membershipType: MembershipType.Annual,
  currentMembershipExpires: '2027-12-31',
  instructorId: '',
  instructorLicenseType: InstructorLicenseType.None,
  instructorLicenseExpires: '',
};

const activeInstructorFields: MemberStatusFields = {
  membershipType: MembershipType.Life,
  currentMembershipExpires: '',
  instructorId: 'INST-100',
  instructorLicenseType: InstructorLicenseType.Annual,
  instructorLicenseExpires: '2027-12-31',
};

const activeMemberCtx = toMemberStatusContext({ member: activeMemberFields });
const activeInstructorCtx = toMemberStatusContext({ member: activeInstructorFields });
const adminNonMemberCtx = toMemberStatusContext({ isAdmin: true, member: null });

// Full Flushing NY Intensive fixture using shared EventRuleConditions and EventDiscount.
function buildFlushingIntensiveRules(): EventPricingRules {
  const membersOnlyConditions = initEventRuleConditions({
    who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
  });
  return {
    capacities: [
      { id: 'fri_spots', label: 'Friday Participants', description: 'Max floor spots Friday', limit: 25 },
      { id: 'sat_spots', label: 'Saturday Participants', description: 'Max floor spots Saturday', limit: 25 },
      { id: 'sun_spots', label: 'Sunday Participants', description: 'Max floor spots Sunday', limit: 25 },
    ],
    earlyBird: {
      kind: EarlyBirdPolicyKind.Enabled,
      deadlineDate: '2026-12-31',
    },
    registrationOptions: [
      initEventRegistrationOption({
        id: 'full_workshop',
        label: 'Full Workshop, Fri - Mon',
        description: '',
        attendanceType: AttendanceType.InPerson,
        conditions: membersOnlyConditions,
        capacityUsage: { fri_spots: 1, sat_spots: 1, sun_spots: 1 },
        subSelection: { kind: SubSelectionKind.None },
        priceCents: 49000, // $490
      }),
      initEventRegistrationOption({
        id: 'two_days',
        label: 'Two Days (any two of Fri, Sat, Sun)',
        description: '',
        attendanceType: AttendanceType.InPerson,
        conditions: membersOnlyConditions,
        capacityUsage: {},
        subSelection: {
          kind: SubSelectionKind.PickSuboptions,
          availableSuboptions: ['Friday', 'Saturday', 'Sunday'],
          pickCount: 2,
        },
        priceCents: 33000, // $330
      }),
      initEventRegistrationOption({
        id: 'single_day',
        label: 'Single Day (Fri, Sat or Sun)',
        description: '',
        attendanceType: AttendanceType.InPerson,
        conditions: membersOnlyConditions,
        capacityUsage: {},
        subSelection: {
          kind: SubSelectionKind.PickSuboptions,
          availableSuboptions: ['Friday', 'Saturday', 'Sunday'],
          pickCount: 1,
        },
        priceCents: 18000, // $180
      }),
      initEventRegistrationOption({
        id: 'mon_half_day',
        label: 'Monday Half Day',
        description: '',
        attendanceType: AttendanceType.InPerson,
        conditions: membersOnlyConditions,
        capacityUsage: {},
        subSelection: { kind: SubSelectionKind.None },
        priceCents: 5000, // $50
      }),
      initEventRegistrationOption({
        id: 'recording_only',
        label: 'Intensive Videos Pre-Order (Recording Only)',
        description: 'Pre-order event videos without attending in person',
        attendanceType: AttendanceType.VideoOnly,
        conditions: initEventRuleConditions(), // Anyone
        capacityUsage: {},
        subSelection: { kind: SubSelectionKind.None },
        priceCents: 9000, // $90
      }),
    ],
    discounts: [],
    addOns: [
      initEventAddOn({
        id: 'eb_free_videos',
        label: 'Intensive Videos (Early Bird Bonus)',
        description: 'All intensive videos FREE with Early Registration for the Full Workshop',
        spec: { kind: EventAddOnKind.EventRecording },
        conditions: initEventRuleConditions({
          timing: {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEarlyBird,
          },
          registration: { kind: RegistrationConditionKind.SpecificOptions, optionIds: ['full_workshop'] },
        }),
        priceCents: 0,
      }),
      initEventAddOn({
        id: 'eb_video_review',
        label: 'Personal Video Review',
        description: 'Early Registration add-on for Full Workshop participants',
        spec: { kind: EventAddOnKind.Other },
        conditions: initEventRuleConditions({
          timing: {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEarlyBird,
          },
          registration: { kind: RegistrationConditionKind.SpecificOptions, optionIds: ['full_workshop'] },
        }),
        priceCents: 2500, // $25
      }),
      initEventAddOn({
        id: 'videos_and_review_combo',
        label: 'Intensive Videos + 1 Personal Video Review',
        description: 'Available until the intensive starts',
        spec: { kind: EventAddOnKind.EventRecording },
        conditions: initEventRuleConditions({
          timing: {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEventStart,
          },
          registration: {
            kind: RegistrationConditionKind.SpecificOptions,
            optionIds: ['full_workshop', 'two_days', 'single_day', 'mon_half_day'],
          },
        }),
        priceCents: 7500, // $75
      }),
    ],
    questions: [],
    payment: {
      allowFullPayment: true,
      depositPolicy: {
        kind: DepositPolicyKind.Enabled,
        depositCents: 5000, // $50
        refundPolicy: { kind: DepositRefundPolicyKind.NonRefundable },
        offlineInstructions: 'the rest by cash/check at registration on Friday',
      },
      allowZeroDepositInPerson: false,
    },
  };
}

describe('event-pricing-rules', () => {
  describe('Fixed-cent discounts & Anywhere-on-Earth (UTC-12) helpers', () => {
    it('computes fixed-cent discounts accurately and clamps at zero', () => {
      expect(applyDiscount(49000, 16000)).toBe(33000);
      expect(applyDiscount(20000, 0)).toBe(20000);
      expect(applyDiscount(5000, 9900)).toBe(0);
    });

    it('evaluates Anywhere-on-Earth (UTC-12) boundaries accurately', () => {
      const lastMomentOf2026AoE = Date.parse('2027-01-01T11:59:59.999Z');
      expect(getAnywhereOnEarthDate(lastMomentOf2026AoE)).toBe('2026-12-31');

      const firstMomentOf2027AoE = Date.parse('2027-01-01T12:00:00.000Z');
      expect(getAnywhereOnEarthDate(firstMomentOf2027AoE)).toBe('2027-01-01');
    });
  });

  describe('Shared EventRuleConditions on Registration Options & named capacities', () => {
    const rules = buildFlushingIntensiveRules();
    const eventStartDate = '2027-01-15';

    it('supports mixed per-option Who conditions (public VideoOnly option alongside Members-only live options)', () => {
      // Public non-member automatically defaults to the Anyone-eligible recording_only option ($90)
      const publicDefaultQuote = evaluateEventPricingQuote({
        rules,
        memberContext: PUBLIC_MEMBER_STATUS_CONTEXT,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
      });
      expect(publicDefaultQuote.isEligibleToRegister).toBe(true);
      expect(publicDefaultQuote.isValid).toBe(true);
      expect(publicDefaultQuote.availableOptions.map((o) => o.option.id)).toEqual([
        'recording_only',
      ]);
      expect(publicDefaultQuote.selectedOption?.option.id).toBe('recording_only');
      expect(publicDefaultQuote.agreedTotalCents).toBe(9000);
      expect(publicDefaultQuote.availablePaymentChoices).toEqual([PaymentChoice.Full]);

      // Public non-member explicitly selecting Members-only full_workshop is rejected
      const publicInvalidSelection = evaluateEventPricingQuote({
        rules,
        memberContext: PUBLIC_MEMBER_STATUS_CONTEXT,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
        selectedOptionId: 'full_workshop',
      });
      expect(publicInvalidSelection.isValid).toBe(false);
      expect(publicInvalidSelection.validationErrors.map((e) => e.code)).toContain(
        PricingValidationErrorCode.MembershipRequired,
      );

      // Admin bypasses per-option eligibility restrictions
      const adminQuote = evaluateEventPricingQuote({
        rules,
        memberContext: adminNonMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
        selectedOptionId: 'full_workshop',
      });
      expect(adminQuote.isValid).toBe(true);

      // Instructors-only option blocks regular active members, allows active instructors
      const instructorsOnlyRules: EventPricingRules = {
        ...rules,
        registrationOptions: rules.registrationOptions.map((o) => ({
          ...o,
          conditions: initEventRuleConditions({
            who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
          }),
        })),
      };
      const memberOnInstructorsOnly = evaluateEventPricingQuote({
        rules: instructorsOnlyRules,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
      });
      expect(memberOnInstructorsOnly.isEligibleToRegister).toBe(false);
      expect(memberOnInstructorsOnly.validationErrors.map((e) => e.code)).toContain(
        PricingValidationErrorCode.InstructorRequired,
      );

      const instructorOnInstructorsOnly = evaluateEventPricingQuote({
        rules: instructorsOnlyRules,
        memberContext: activeInstructorCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
      });
      expect(instructorOnInstructorsOnly.isEligibleToRegister).toBe(true);
      expect(instructorOnInstructorsOnly.isValid).toBe(true);
    });

    it('enforces named EventCapacity limits and credits existingCapacityUsage during upgrades', () => {
      const soldOutFridayQuote = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
        capacityCounts: { fri_spots: 25, sat_spots: 20, sun_spots: 10 },
        selectedOptionId: 'full_workshop',
      });
      expect(soldOutFridayQuote.isValid).toBe(false);
      expect(soldOutFridayQuote.selectedOption?.isSoldOut).toBe(true);
      expect(soldOutFridayQuote.validationErrors.map((e) => e.code)).toContain(
        PricingValidationErrorCode.CapacityExceeded,
      );
      expect(soldOutFridayQuote.validationErrors[0].message).toContain('Friday Participants');

      // Recording Only (capacityUsage: {}) remains available even when Friday is sold out!
      const recordingWhenFull = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
        capacityCounts: { fri_spots: 25, sat_spots: 25, sun_spots: 25 },
        selectedOptionId: 'recording_only',
      });
      expect(recordingWhenFull.isValid).toBe(true);
      expect(recordingWhenFull.selectedOption?.isSoldOut).toBe(false);

      // Upgrading registrant who ALREADY holds 1 spot in fri_spots can upgrade to full_workshop!
      const upgradeWithCredit = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
        capacityCounts: { fri_spots: 25, sat_spots: 20, sun_spots: 10 },
        existingCapacityUsage: { fri_spots: 1 },
        selectedOptionId: 'full_workshop',
      });
      expect(upgradeWithCredit.isValid).toBe(true);
      expect(upgradeWithCredit.selectedOption?.isSoldOut).toBe(false);
      const friEval = upgradeWithCredit.evaluatedCapacities.find(
        (c) => c.capacity.id === 'fri_spots',
      );
      expect(friEval?.additionalNeeded).toBe(0);
      expect(friEval?.exceedsLimit).toBe(false);
    });

    it('prices Full Workshop in Early Registration with free videos + $25 review and Deposit split', () => {
      const quote = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        eventStartDate,
        nowMs: Date.parse('2027-01-01T11:59:59Z'), // Still 2026-12-31 AoE
        selectedOptionId: 'full_workshop',
        selectedAddOnIds: ['eb_free_videos', 'eb_video_review'],
        paymentChoice: PaymentChoice.Deposit,
      });

      expect(quote.isEarlyBird).toBe(true);
      expect(quote.isValid).toBe(true);
      expect(quote.availableAddOns.map((a) => a.addOn.id)).toEqual([
        'eb_free_videos',
        'eb_video_review',
        'videos_and_review_combo',
      ]);
      expect(quote.attendanceNetCents).toBe(49000); // $490
      expect(quote.addOnsTotalCents).toBe(2500); // $0 + $25
      expect(quote.agreedTotalCents).toBe(51500); // $515
      expect(quote.depositCents).toBe(5000); // $50 deposit
      // $50 deposit + 100% of add-ons ($25) charged online now = $75
      expect(quote.chargeNowCents).toBe(7500);
      // Remaining attendance balance ($490 - $50 = $440) due in cash at door
      expect(quote.cashDueAtDoorCents).toBe(44000);
      expect(quote.isDepositCurrentlyRefundable).toBe(false);
    });

    it('evaluates BeforeEarlyBird and BeforeEventStart timing conditions on add-ons & options accurately', () => {
      const rulesWithPreStartAddOn: EventPricingRules = {
        ...rules,
        addOns: [
          ...rules.addOns.slice(0, 2),
          initEventAddOn({
            id: 'pre_start_videos',
            label: 'Intensive Videos (Pre-Event)',
            description: 'Available before event starts',
            spec: { kind: EventAddOnKind.EventRecording },
            conditions: initEventRuleConditions({
              timing: {
                kind: TimingConditionKind.Window,
                window: TimingWindow.BeforeEventStart,
              },
              registration: { kind: RegistrationConditionKind.SpecificOptions, optionIds: ['full_workshop'] },
            }),
            priceCents: 7500,
          }),
        ],
      };

      // During Early Bird (before cutoff & before start): both BeforeEarlyBird and BeforeEventStart add-ons are shown
      const earlyQuote = evaluateEventPricingQuote({
        rules: rulesWithPreStartAddOn,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
        selectedOptionId: 'full_workshop',
      });
      expect(earlyQuote.availableAddOns.map((a) => a.addOn.id)).toEqual([
        'eb_free_videos',
        'eb_video_review',
        'pre_start_videos',
      ]);

      // After Early Bird cutoff, before event start: BeforeEarlyBird add-ons are hidden, BeforeEventStart stays shown
      const lateQuote = evaluateEventPricingQuote({
        rules: rulesWithPreStartAddOn,
        memberContext: activeMemberCtx,
        eventStartDate,
        nowMs: Date.parse('2027-01-01T12:00:00Z'), // 2027-01-01 AoE -> After Early Bird, Before Start
        selectedOptionId: 'full_workshop',
        selectedAddOnIds: ['pre_start_videos'],
        paymentChoice: PaymentChoice.Full,
      });

      expect(lateQuote.isEarlyBird).toBe(false);
      expect(lateQuote.isBeforeEventStart).toBe(true);
      expect(lateQuote.isValid).toBe(true);
      expect(lateQuote.availableAddOns.map((a) => a.addOn.id)).toEqual(['pre_start_videos']);
      expect(lateQuote.chargeNowCents).toBe(56500); // $490 + $75

      // Once event starts: BeforeEventStart add-ons are also hidden
      const startedQuote = evaluateEventPricingQuote({
        rules: rulesWithPreStartAddOn,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: eventStartDate,
        selectedOptionId: 'full_workshop',
      });
      expect(startedQuote.isBeforeEventStart).toBe(false);
      expect(startedQuote.availableAddOns).toHaveLength(0);

      const invalidAttempt = evaluateEventPricingQuote({
        rules: rulesWithPreStartAddOn,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2027-01-05',
        selectedOptionId: 'full_workshop',
        selectedAddOnIds: ['eb_free_videos'],
      });
      expect(invalidAttempt.isValid).toBe(false);
      expect(invalidAttempt.validationErrors.map((e) => e.code)).toContain(
        PricingValidationErrorCode.AddOnUnavailable,
      );
    });

    it('does not trigger BeforeEarlyBird discounts when top-level Early Bird Pricing is Disabled', () => {
      const disabledEarlyRules: EventPricingRules = {
        ...buildFlushingIntensiveRules(),
        earlyBird: { kind: EarlyBirdPolicyKind.Disabled },
        discounts: [
          initEventDiscount({
            id: 'eb_50',
            label: 'Early Bird Discount',
            discountCents: 5000,
            conditions: initEventRuleConditions({
              timing: {
                kind: TimingConditionKind.Window,
                window: TimingWindow.BeforeEarlyBird,
              },
            }),
          }),
        ],
      };

      const quote = evaluateEventPricingQuote({
        rules: disabledEarlyRules,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-15',
        selectedOptionId: 'full_workshop',
      });

      expect(quote.isEarlyBird).toBe(false);
      expect(quote.attendanceEarlyDiscountCents).toBe(0);
      expect(quote.attendanceDiscountCents).toBe(0);
      expect(quote.attendanceNetCents).toBe(49000);
    });

    it('enforces SubSelectionKind.PickSuboptions count and membership for Two Days ($330)', () => {
      const missingDays = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-20',
        selectedOptionId: 'two_days',
        selectedSuboptions: ['Friday'],
      });
      expect(missingDays.isValid).toBe(false);
      expect(missingDays.validationErrors.map((e) => e.code)).toContain(
        PricingValidationErrorCode.InvalidSuboptionCount,
      );

      const bogusDay = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-20',
        selectedOptionId: 'two_days',
        selectedSuboptions: ['Friday', 'Monday'],
      });
      expect(bogusDay.isValid).toBe(false);
      expect(bogusDay.validationErrors.map((e) => e.code)).toContain(
        PricingValidationErrorCode.InvalidSuboptionValue,
      );

      const validTwoDays = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        eventStartDate,
        evaluationDateAoE: '2026-12-20',
        selectedOptionId: 'two_days',
        selectedSuboptions: ['Friday', 'Sunday'],
        paymentChoice: PaymentChoice.Full,
      });
      expect(validTwoDays.isValid).toBe(true);
      expect(validTwoDays.attendanceNetCents).toBe(33000); // $330
      expect(validTwoDays.availableAddOns.map((a) => a.addOn.id)).toEqual([
        'videos_and_review_combo',
      ]);
    });

    it('disables BeforeEventStart add-ons on or after eventStartDate', () => {
      const onStartDay = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        eventStartDate: '2027-01-15T09:30:00',
        evaluationDateAoE: '2027-01-15',
        selectedOptionId: 'mon_half_day',
      });
      expect(onStartDay.isBeforeEventStart).toBe(false);
      expect(onStartDay.availableAddOns).toHaveLength(0);
      expect(onStartDay.attendanceNetCents).toBe(5000); // $50
    });
  });

  describe('Unified Compositional Discounts (summing matching discounts) & DepositRefundPolicy', () => {
    it('sums all matching discounts (Early Bird + Member + Instructor + Pre-Event), caps at option price, and evaluates DepositRefundPolicy', () => {
      const baseRules = buildFlushingIntensiveRules();
      const rules: EventPricingRules = {
        ...baseRules,
        capacities: [],
        earlyBird: {
          kind: EarlyBirdPolicyKind.Enabled,
          deadlineDate: '2026-12-31',
        },
        registrationOptions: [
          {
            ...baseRules.registrationOptions[0],
            capacityUsage: {},
          },
        ],
        discounts: [
          initEventDiscount({
            id: 'eb_40',
            label: 'Early Bird $40 Off',
            discountCents: 4000,
            conditions: initEventRuleConditions({
              timing: {
                kind: TimingConditionKind.Window,
                window: TimingWindow.BeforeEarlyBird,
              },
            }),
          }),
          initEventDiscount({
            id: 'mem_45',
            label: 'Member $45 Off',
            discountCents: 4500,
            conditions: initEventRuleConditions({
              who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
              registration: { kind: RegistrationConditionKind.AllOptions },
            }),
          }),
          initEventDiscount({
            id: 'inst_30_extra',
            label: 'Instructor Extra $30 Off',
            discountCents: 3000,
            conditions: initEventRuleConditions({
              who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
              registration: { kind: RegistrationConditionKind.AllOptions },
            }),
          }),
          initEventDiscount({
            id: 'pre_event_20',
            label: 'Advance Registration $20 Off',
            discountCents: 2000,
            conditions: initEventRuleConditions({
              timing: {
                kind: TimingConditionKind.Window,
                window: TimingWindow.BeforeEventStart,
              },
              registration: { kind: RegistrationConditionKind.SpecificOptions, optionIds: ['full_workshop'] },
            }),
          }),
        ],
        payment: {
          allowFullPayment: true,
          depositPolicy: {
            kind: DepositPolicyKind.Enabled,
            depositCents: 7500, // $75 deposit
            refundPolicy: {
              kind: DepositRefundPolicyKind.RefundableBefore,
              deadlineDate: '2027-01-10',
            },
            offlineInstructions: 'Remaining balance at door',
          },
          allowZeroDepositInPerson: false,
        },
      };

      // Active Instructor during Early Bird before event start gets EB ($40) + Member ($45) + Instructor ($30) + Pre-Event ($20) = $135 off ($490 -> $355)
      const instQuote = evaluateEventPricingQuote({
        rules,
        memberContext: activeInstructorCtx,
        eventStartDate: '2027-01-15',
        evaluationDateAoE: '2026-12-10',
        paymentChoice: PaymentChoice.Deposit,
      });
      expect(instQuote.isValid).toBe(true);
      expect(instQuote.selectedOption?.appliedDiscounts.map((d) => d.discount.id)).toEqual([
        'eb_40',
        'mem_45',
        'inst_30_extra',
        'pre_event_20',
      ]);
      expect(instQuote.attendanceEarlyDiscountCents).toBe(4000);
      expect(instQuote.attendanceDiscountCents).toBe(13500);
      expect(instQuote.attendanceNetCents).toBe(35500);
      expect(instQuote.depositCents).toBe(7500);
      expect(instQuote.cashDueAtDoorCents).toBe(28000);
      expect(instQuote.isDepositCurrentlyRefundable).toBe(true);

      // Post-Early-Bird (2027-01-12) before event start (2027-01-15): Member ($45) + Instructor ($30) + Pre-Event ($20) = $95 off -> $395
      const postEbBeforeEvent = evaluateEventPricingQuote({
        rules,
        memberContext: activeInstructorCtx,
        eventStartDate: '2027-01-15',
        evaluationDateAoE: '2027-01-12',
      });
      expect(postEbBeforeEvent.isValid).toBe(true);
      expect(postEbBeforeEvent.isDepositCurrentlyRefundable).toBe(false);
      expect(postEbBeforeEvent.attendanceDiscountCents).toBe(9500);
      expect(postEbBeforeEvent.attendanceNetCents).toBe(39500);

      // On event start date (2027-01-15): Pre-Event ($20) no longer applies -> Member ($45) + Instructor ($30) = $75 off -> $415
      const onEventStart = evaluateEventPricingQuote({
        rules,
        memberContext: activeInstructorCtx,
        eventStartDate: '2027-01-15',
        evaluationDateAoE: '2027-01-15',
      });
      expect(onEventStart.attendanceDiscountCents).toBe(7500);
      expect(onEventStart.attendanceNetCents).toBe(41500);
    });

    it('treats SpecificOptions with empty optionIds [] strictly as matching zero options', () => {
      const rules = buildFlushingIntensiveRules();
      rules.addOns = [
        initEventAddOn({
          id: 'unassigned_addon',
          label: 'Scoped to nothing',
          description: '',
          spec: { kind: EventAddOnKind.Other },
          conditions: initEventRuleConditions({
            registration: { kind: RegistrationConditionKind.SpecificOptions, optionIds: [] },
          }),
          priceCents: 1000,
        }),
      ];
      const quote = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        evaluationDateAoE: '2026-12-15',
      });
      expect(quote.availableAddOns).toHaveLength(0);
    });
  });

  describe('Unified Matrix & Legacy Rules migration + strict definedness', () => {
    it('interprets legacy Matrix Firestore Product documents directly into unified EventPricingRules with exact prices', () => {
      const legacyDoc = {
        id: 'prod_legacy_1',
        data: () => ({
          title: 'Legacy Workshop',
          currency: 'usd',
          allowNonMembers: true,
          allowMembers: true,
          allowInstructors: true,
          allowInPerson: true,
          allowOnline: true,
          allowVideo: true,
          allowVideoOnly: true,
          allowPayInPerson: true,
          hasEarlyBird: true,
          earlyBirdDeadline: '2026-11-30',
          maxInPersonAttendees: 30,
          inPersonRegistrationsCount: 12,
          videoDeltaPrice: 20,
          tiers: {
            non_member_in_person_novideo: { enabled: true, price: 120 },
            non_member_in_person_novideo_early_bird: { enabled: true, price: 100 },
            member_in_person_novideo: { enabled: true, price: 95 },
            instructor_in_person_novideo: { enabled: true, price: 80 },
            non_member_online_novideo: { enabled: true, price: 90 },
            non_member_video_only: { enabled: true, price: 45 },
          },
        }),
      };

      const parsed = firestoreDocToProduct(legacyDoc);
      expect(parsed.docId).toBe('prod_legacy_1');
      expect(parsed.pricingRules.capacities).toEqual([
        {
          id: 'in_person_venue',
          label: 'In-Person Venue',
          description: '',
          limit: 30,
        },
      ]);
      expect(parsed.capacityCounts).toEqual({ in_person_venue: 12 });
      expect(parsed.pricingRules.registrationOptions[0].priceCents).toBe(12000);
      expect(parsed.pricingRules.registrationOptions.map((o) => o.id)).toEqual([
        'in_person',
        'online',
        'in_person_and_online',
        'video_only',
      ]);
      // Discounts: $20 Early Bird + $25 Member + $15 extra Instructor (total $40 for Instructor)
      expect(parsed.pricingRules.discounts.map((d) => [d.id, d.discountCents])).toEqual([
        ['early_bird_discount', 2000],
        ['member_discount', 2500],
        ['instructor_discount', 1500],
      ]);
      expect(parsed.pricingRules.addOns).toHaveLength(1);
      expect(parsed.pricingRules.addOns[0].priceCents).toBe(2000);
      expect(parsed.pricingRules.payment.allowZeroDepositInPerson).toBe(true);
      expect(formatProductPriceRange(parsed)).toBe('45.00 – 120.00 USD');

      // Verify Early Bird + Member quote on converted product: $120 - $20 EB - $25 Member = $75
      const ebMemberQuote = evaluateEventPricingQuote({
        rules: parsed.pricingRules,
        memberContext: activeMemberCtx,
        evaluationDateAoE: '2026-11-15',
        capacityCounts: parsed.capacityCounts,
        selectedOptionId: 'in_person',
        selectedAddOnIds: ['event_recording'],
      });
      expect(ebMemberQuote.isValid).toBe(true);
      expect(ebMemberQuote.attendanceNetCents).toBe(7500);
      expect(ebMemberQuote.addOnsTotalCents).toBe(2000);
      expect(ebMemberQuote.agreedTotalCents).toBe(9500);

      // Verify Standard Instructor quote on converted product: $120 - $25 Member - $15 Instructor = $80
      const stdInstQuote = evaluateEventPricingQuote({
        rules: parsed.pricingRules,
        memberContext: activeInstructorCtx,
        evaluationDateAoE: '2026-12-05',
        capacityCounts: parsed.capacityCounts,
        selectedOptionId: 'in_person',
      });
      expect(stdInstQuote.attendanceNetCents).toBe(8000);
    });

    it('migrates legacy personDiscounts, per-option earlyRegistration, and addOn earlyRegistration/onlyBeforeEventStart cleanly', () => {
      const normalized = normalizeEventPricingRules({
        requireActiveMembership: 1,
        basePriceCents: 20000,
        defaultOptionId: 'non_existent',
        earlyRegistration: { kind: 'enabled', deadlineDate: '2026-10-01' },
        baseOptions: [
          {
            id: 'opt_a',
            label: 'Option A',
            deltaFromDefaultCents: -5000,
            earlyRegistration: { kind: 'discount', discountCents: 3000 },
          },
          {
            id: 'opt_b',
            label: 'Option B',
            deltaFromDefaultCents: -5000,
            earlyRegistration: { kind: 'early_registration_only' },
          },
        ],
        personDiscounts: [
          {
            id: 'mem_d',
            statusKind: 'member',
            label: 'Member',
            discountCents: 2000,
            optionScope: { kind: 'all_options' },
          },
          {
            id: 'inst_d',
            statusKind: 'instructor',
            label: 'Instructor',
            discountCents: 5000,
            optionScope: { kind: 'all_options' },
          },
        ],
        addOns: [
          {
            id: 'rec_addon',
            label: 'Event Recording',
            priceCents: 2500,
            earlyRegistration: { kind: 'discount', discountCents: 500 },
            onlyBeforeEventStart: true,
            spec: {
              kind: EventAddOnKind.EventRecording,
              standalonePreOrder: { kind: 'enabled', priceCents: 4000 },
            },
          },
        ],
      });

      expect(normalized.earlyBird).toEqual({
        kind: EarlyBirdPolicyKind.Enabled,
        deadlineDate: '2026-10-01',
      });
      expect(normalized.registrationOptions[0].conditions.who).toEqual({
        kind: WhoConditionKind.Status,
        status: PersonStatusKind.Member,
      });
      expect(normalized.registrationOptions[1].conditions.timing).toEqual({
        kind: TimingConditionKind.Window,
        window: TimingWindow.BeforeEarlyBird,
      });
      // Legacy basePriceCents + deltaFromDefaultCents convert cleanly to explicit priceCents
      expect(normalized.registrationOptions[0].priceCents).toBe(20000);
      expect(normalized.registrationOptions[1].priceCents).toBe(15000);
      // Migrated standalonePreOrder becomes an explicit VideoOnly option at $40
      expect(normalized.registrationOptions).toHaveLength(3);
      expect(normalized.registrationOptions[2].attendanceType).toBe(AttendanceType.VideoOnly);
      expect(normalized.registrationOptions[2].priceCents).toBe(4000);

      // Migrated discounts: $30 Early Bird on opt_a + $20 Member + $30 incremental Instructor
      expect(normalized.discounts.map((d) => [d.id, d.discountCents])).toEqual([
        ['early_bird_discount', 3000],
        ['mem_d', 2000],
        ['inst_d', 3000],
      ]);

      // Migrated discounted add-on splits into BeforeEarlyBird ($20) and BeforeEventStart ($25)
      expect(normalized.addOns).toHaveLength(2);
      expect(normalized.addOns[0].priceCents).toBe(2000);
      expect(normalized.addOns[0].conditions.timing).toEqual({
        kind: TimingConditionKind.Window,
        window: TimingWindow.BeforeEarlyBird,
      });
      expect(normalized.addOns[1].priceCents).toBe(2500);
      expect(normalized.addOns[1].conditions.timing).toEqual({
        kind: TimingConditionKind.Window,
        window: TimingWindow.BeforeEventStart,
      });

      // Legacy conditions with separate earlyBird / eventStart or removed spouse status migrate safely
      const legacySplitConds = normalizeEventPricingRules({
        baseOptions: [
          {
            id: 'opt_1',
            label: 'Full Event',
            priceCents: 10000,
            conditions: {
              who: { kind: 'status', status: 'spouse' },
              eventStart: { kind: 'before_event_start' },
              optionScope: { kind: 'specific_options', optionIds: ['opt_1'] },
            },
          },
        ],
        discounts: [
          {
            id: 'd_spouse',
            label: 'Legacy Spouse Discount',
            discountCents: 5000,
            conditions: {
              who: { kind: 'status', status: 'spouse' },
            },
          },
          {
            id: 'd_eb',
            label: 'Legacy EB Discount',
            discountCents: 2000,
            conditions: {
              earlyBird: { kind: 'window', window: 'on_or_before_cutoff' },
            },
          },
        ],
      });
      // Registration option drops optionScope (implicit) and maps eventStart -> timing BeforeEventStart
      expect(legacySplitConds.registrationOptions[0].conditions).toEqual({
        who: { kind: WhoConditionKind.Anyone },
        timing: {
          kind: TimingConditionKind.Window,
          window: TimingWindow.BeforeEventStart,
        },
        registration: { kind: RegistrationConditionKind.AllOptions },
      });
      // Legacy spouse discount is dropped rather than turning into an Anyone discount!
      expect(legacySplitConds.discounts.map((d) => d.id)).toEqual(['d_eb']);
      expect(legacySplitConds.discounts[0].conditions.timing).toEqual({
        kind: TimingConditionKind.Window,
        window: TimingWindow.BeforeEarlyBird,
      });

      // validateRuleConditions enforces Early Bird policy, implicit registration condition, and >= 1 selected option
      expect(
        validateRuleConditions(
          initEventRuleConditions({
            timing: {
              kind: TimingConditionKind.Window,
              window: TimingWindow.BeforeEarlyBird,
            },
          }),
          { itemLabel: 'EB Discount', allowRegistrationCondition: true, earlyBirdEnabled: false },
        ),
      ).toHaveLength(1);
      expect(
        validateRuleConditions(
          initEventRuleConditions({
            registration: { kind: RegistrationConditionKind.SpecificOptions, optionIds: [] },
          }),
          { itemLabel: 'Lunch Add-On', allowRegistrationCondition: true, earlyBirdEnabled: true },
        ),
      ).toHaveLength(1);

      // Legacy IlcEvent with maxInPersonAttendees normalizes to capacities & capacityCounts
      const ev = firestoreDocToIlcEvent({
        id: 'ev_legacy',
        data: () => ({
          title: 'Workshop',
          start: '2027-02-01',
          maxInPersonAttendees: 40,
          inPersonRegistrationsCount: 15,
        }),
      });
      expect(ev.capacities).toEqual([
        { id: 'in_person_venue', label: 'In-Person Venue', description: '', limit: 40 },
      ]);
      expect(ev.capacityCounts).toEqual({ in_person_venue: 15 });

      // Legacy registration without explicit capacityUsage falls back to { in_person_venue: 1 }
      const legacyReg = firestoreDocToEventRegistration({
        id: 'reg_1',
        data: () => ({
          attendance: AttendanceType.InPerson,
          amountPaidCents: 10000,
        }),
      });
      expect(computeEffectiveCapacityUsage(legacyReg, ev.capacities)).toEqual({
        in_person_venue: 1,
      });

      // Strictly defined EventRegistration fields: zero undefined properties!
      const initReg = initEventRegistration();
      for (const [k, v] of Object.entries(initReg)) {
        expect(v, `initEventRegistration().${k} must be defined`).not.toBeUndefined();
      }
      for (const [k, v] of Object.entries(legacyReg)) {
        expect(v, `firestoreDocToEventRegistration().${k} must be defined`).not.toBeUndefined();
      }
      expect(legacyReg.status).toBe(EventRegistrationStatus.Paid);
      expect(legacyReg.agreedTotalCents).toBe(10000);
      expect(legacyReg.amountDueCents).toBe(0);

      const syncedProd = syncProductSummaryFlagsFromRules({
        ...initProduct(),
        pricingRules: {
          ...buildFlushingIntensiveRules(),
          discounts: [
            initEventDiscount({
              id: 'inst_disc',
              label: 'Instructor',
              discountCents: 5000,
              conditions: initEventRuleConditions({
                who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
              }),
            }),
          ],
        },
      });
      expect(syncedProd.allowNonMembers).toBe(true); // recording_only is open to Anyone
      expect(syncedProd.allowMembers).toBe(true);
      expect(syncedProd.allowVideoOnly).toBe(true);
      expect(hasSpecialRolePrice(syncedProd, AttendeeRole.Instructor)).toBe(true);
    });
  });

  describe('Registration Form Questions, validation, immutability, and Stripe metadata chunking', () => {
    it('evaluates question eligibility conditions and validates ShortText, LongText, Select, and Checkboxes', () => {
      const rules = buildFlushingIntensiveRules();
      rules.questions = [
        initEventRegistrationQuestion({
          id: 'q_dietary',
          label: 'Dietary Restrictions',
          description: 'Let us know about allergies for Friday lunch.',
          required: true,
          spec: {
            kind: RegistrationQuestionKind.ShortText,
            placeholder: 'None / Vegetarian / Gluten-free',
          },
          conditions: initEventRuleConditions({
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_workshop', 'two_days'],
            },
          }),
        }),
        initEventRegistrationQuestion({
          id: 'q_shirt',
          label: 'Workshop T-Shirt Size',
          required: true,
          spec: {
            kind: RegistrationQuestionKind.Select,
            options: ['Small', 'Medium', 'Large', 'XL'],
          },
          conditions: initEventRuleConditions({
            timing: {
              kind: TimingConditionKind.Window,
              window: TimingWindow.BeforeEarlyBird,
            },
          }),
        }),
        initEventRegistrationQuestion({
          id: 'q_topics',
          label: 'Focus Areas',
          required: true,
          spec: {
            kind: RegistrationQuestionKind.Checkboxes,
            options: ['21-Form', 'Spinning Hands', 'Sticky Hands'],
          },
        }),
        initEventRegistrationQuestion({
          id: 'q_goals',
          label: 'Training Background & Goals',
          required: false,
          spec: {
            kind: RegistrationQuestionKind.LongText,
            placeholder: 'Share any injuries or personal goals...',
          },
        }),
      ];

      // Recording-only after cutoff only gets q_topics and q_goals (not in-person q_dietary or early-bird q_shirt)
      const recPostCutoff = evaluateEventPricingQuote({
        rules,
        memberContext: PUBLIC_MEMBER_STATUS_CONTEXT,
        evaluationDateAoE: '2027-01-05',
        selectedOptionId: 'recording_only',
      });
      expect(recPostCutoff.applicableQuestions.map((q) => q.id)).toEqual(['q_topics', 'q_goals']);

      // Full Workshop before cutoff for an active member gets all 4 questions
      const fullEarlyQuote = evaluateEventPricingQuote({
        rules,
        memberContext: activeMemberCtx,
        evaluationDateAoE: '2026-12-20',
        selectedOptionId: 'full_workshop',
      });
      expect(fullEarlyQuote.applicableQuestions.map((q) => q.id)).toEqual([
        'q_dietary',
        'q_shirt',
        'q_topics',
        'q_goals',
      ]);

      // Missing required answers fails validation
      const missingResult = validateAndBuildQuestionResponses({
        applicableQuestions: fullEarlyQuote.applicableQuestions,
        submittedAnswers: [],
        existingResponses: [],
      });
      expect(missingResult.errors).toHaveLength(3);
      expect(
        missingResult.errors.every(
          (e) => e.code === PricingValidationErrorCode.MissingRequiredQuestion,
        ),
      ).toBe(true);

      // Invalid select / checkbox choice fails validation
      const invalidChoiceResult = validateAndBuildQuestionResponses({
        applicableQuestions: fullEarlyQuote.applicableQuestions,
        submittedAnswers: [
          { questionId: 'q_dietary', answerText: 'Vegetarian', selectedOptions: [] },
          { questionId: 'q_shirt', answerText: 'XXL', selectedOptions: [] },
          { questionId: 'q_topics', answerText: '', selectedOptions: ['Unknown Form'] },
        ],
        existingResponses: [],
      });
      expect(invalidChoiceResult.errors.map((e) => e.code)).toContain(
        PricingValidationErrorCode.InvalidQuestionResponse,
      );

      // Valid submission builds canonical responses (including optional unanswered q_goals so it locks too)
      const longNotes = 'Practicing ILC for 4 years. '.repeat(25).trim(); // > 650 chars
      const validResult = validateAndBuildQuestionResponses({
        applicableQuestions: fullEarlyQuote.applicableQuestions,
        submittedAnswers: [
          { questionId: 'q_dietary', answerText: '  No peanuts  ', selectedOptions: [] },
          { questionId: 'q_shirt', answerText: 'Large', selectedOptions: [] },
          {
            questionId: 'q_topics',
            answerText: '',
            selectedOptions: ['Sticky Hands', '21-Form'],
          },
          { questionId: 'q_goals', answerText: longNotes, selectedOptions: [] },
        ],
        existingResponses: [],
      });
      expect(validResult.errors).toHaveLength(0);
      expect(validResult.responses).toEqual([
        {
          questionId: 'q_dietary',
          questionLabel: 'Dietary Restrictions',
          kind: RegistrationQuestionKind.ShortText,
          answerText: 'No peanuts',
          selectedOptions: [],
        },
        {
          questionId: 'q_shirt',
          questionLabel: 'Workshop T-Shirt Size',
          kind: RegistrationQuestionKind.Select,
          answerText: 'Large',
          selectedOptions: [],
        },
        {
          questionId: 'q_topics',
          questionLabel: 'Focus Areas',
          kind: RegistrationQuestionKind.Checkboxes,
          answerText: '',
          // Canonical order from spec.options!
          selectedOptions: ['21-Form', 'Sticky Hands'],
        },
        {
          questionId: 'q_goals',
          questionLabel: 'Training Background & Goals',
          kind: RegistrationQuestionKind.LongText,
          answerText: longNotes,
          selectedOptions: [],
        },
      ]);
      expect(formatQuestionResponseValue(validResult.responses[2])).toBe(
        '21-Form, Sticky Hands',
      );

      // Chunking into Stripe metadata keeps every metadata value <= 450 chars and decodes losslessly
      const encodedMeta = encodeQuestionResponsesToMetadata(validResult.responses);
      expect(Number(encodedMeta['questionResponsesChunks'])).toBeGreaterThanOrEqual(2);
      for (const val of Object.values(encodedMeta)) {
        expect(val.length).toBeLessThanOrEqual(450);
      }
      expect(decodeQuestionResponsesFromMetadata(encodedMeta)).toEqual(validResult.responses);
    });

    it('locks previously submitted questionResponses as read-only while allowing newly unlocked option questions on upgrade', () => {
      const qOnline = initEventRegistrationQuestion({
        id: 'q_zoom_name',
        label: 'Zoom Display Name',
        required: true,
        spec: { kind: RegistrationQuestionKind.ShortText, placeholder: '' },
      });
      const qInPerson = initEventRegistrationQuestion({
        id: 'q_meal',
        label: 'Lunch Preference',
        required: true,
        spec: {
          kind: RegistrationQuestionKind.Select,
          options: ['Standard', 'Vegan'],
        },
      });

      const existingResponses = [
        {
          questionId: 'q_zoom_name',
          questionLabel: 'Zoom Display Name',
          kind: RegistrationQuestionKind.ShortText,
          answerText: 'Original Name',
          selectedOptions: [],
        },
      ];

      // Upgrade where both qOnline and newly-unlocked qInPerson apply, and client tries to overwrite q_zoom_name:
      const upgradeValidation = validateAndBuildQuestionResponses({
        applicableQuestions: [qOnline, qInPerson],
        submittedAnswers: [
          { questionId: 'q_zoom_name', answerText: 'Tampered Name', selectedOptions: [] },
          { questionId: 'q_meal', answerText: 'Vegan', selectedOptions: [] },
        ],
        existingResponses,
      });

      expect(upgradeValidation.errors).toHaveLength(0);
      expect(upgradeValidation.responses).toEqual([
        {
          questionId: 'q_zoom_name',
          questionLabel: 'Zoom Display Name',
          kind: RegistrationQuestionKind.ShortText,
          answerText: 'Original Name', // Preserved read-only!
          selectedOptions: [],
        },
        {
          questionId: 'q_meal',
          questionLabel: 'Lunch Preference',
          kind: RegistrationQuestionKind.Select,
          answerText: 'Vegan',
          selectedOptions: [],
        },
      ]);
    });
  });
});
