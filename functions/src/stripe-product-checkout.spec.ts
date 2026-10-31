import { describe, it, expect } from 'vitest';
import {
  assertValidQuoteOrThrow,
  buildUnmarkedRegistrationUpdates,
  computeCapacityUpdateOrThrow,
  computePriorPaidCreditCents,
  resolveEffectiveRulesAndCapacities,
  resolveRequestRuleSelection,
} from './stripe-product-checkout';
import {
  AttendeeRole,
  AttendanceType,
  EarlyBirdPolicyKind,
  evaluateEventPricingQuote,
  EventAddOnKind,
  EventRegistration,
  EventRegistrationStatus,
  firestoreDocToProduct,
  initEvent,
  initEventAddOn,
  initEventCapacity,
  initEventDiscount,
  initEventPricingRules,
  initEventRegistration,
  initEventRegistrationOption,
  initEventRuleConditions,
  initProduct,
  PersonStatusKind,
  Product,
  RegistrationConditionKind,
  RegistrationPaymentMethod,
  SubSelectionKind,
  TimingConditionKind,
  TimingWindow,
  WhoConditionKind,
} from './data-model/events';
import {
  MembershipType,
  PUBLIC_MEMBER_STATUS_CONTEXT,
  toMemberStatusContext,
} from './data-model/member-status';
import { InstructorLicenseType } from './data-model/curriculum';

function buildSampleRulesProduct(): Product {
  const rules = initEventPricingRules();
  rules.capacities = [
    initEventCapacity({ id: 'hall', label: 'Main Hall', limit: 10 }),
    initEventCapacity({ id: 'friday', label: 'Friday Spots', limit: 5 }),
  ];
  rules.earlyBird = {
    kind: EarlyBirdPolicyKind.Enabled,
    deadlineDate: '2099-09-01',
  };
  rules.registrationOptions = [
    initEventRegistrationOption({
      id: 'full_in_person',
      label: 'Full Event (In-Person)',
      attendanceType: AttendanceType.InPerson,
      conditions: initEventRuleConditions(),
      capacityUsage: { hall: 1, friday: 1 },
      priceCents: 10000,
    }),
    initEventRegistrationOption({
      id: 'two_day',
      label: '2-Day Pass',
      attendanceType: AttendanceType.InPerson,
      conditions: initEventRuleConditions(),
      capacityUsage: { hall: 1 },
      priceCents: 7000,
      subSelection: {
        kind: SubSelectionKind.PickSuboptions,
        pickCount: 2,
        availableSuboptions: ['Fri', 'Sat', 'Sun'],
      },
    }),
    initEventRegistrationOption({
      id: 'online_live',
      label: 'Online (Zoom)',
      attendanceType: AttendanceType.Online,
      conditions: initEventRuleConditions(),
      capacityUsage: {},
      priceCents: 6000,
    }),
    initEventRegistrationOption({
      id: 'inst_clinic',
      label: 'Instructor Clinic',
      attendanceType: AttendanceType.InPerson,
      conditions: initEventRuleConditions({
        who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
      }),
      capacityUsage: { hall: 1 },
      priceCents: 5000,
    }),
  ];
  rules.discounts = [
    initEventDiscount({
      id: 'eb_disc',
      label: 'Early Bird Discount',
      discountCents: 1500,
      conditions: initEventRuleConditions({
        timing: {
          kind: TimingConditionKind.Window,
          window: TimingWindow.BeforeEarlyBird,
        },
        registration: {
          kind: RegistrationConditionKind.SpecificOptions,
          optionIds: ['full_in_person'],
        },
      }),
    }),
    initEventDiscount({
      id: 'mem_disc',
      label: 'Member Discount',
      discountCents: 2000,
      conditions: initEventRuleConditions({
        who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
        registration: { kind: RegistrationConditionKind.AllOptions },
      }),
    }),
    initEventDiscount({
      id: 'inst_disc',
      label: 'Extra Instructor Discount',
      discountCents: 1000,
      conditions: initEventRuleConditions({
        who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
        registration: { kind: RegistrationConditionKind.AllOptions },
      }),
    }),
  ];
  rules.addOns = [
    initEventAddOn({
      id: 'event_recording',
      label: 'Event Video Recording',
      description: 'Edited class video',
      spec: { kind: EventAddOnKind.EventRecording },
      conditions: initEventRuleConditions({
        registration: { kind: RegistrationConditionKind.AllOptions },
      }),
      priceCents: 2000,
    }),
  ];

  return {
    ...initProduct(),
    docId: 'prod_rules_1',
    eventDocId: 'event_1',
    title: 'Autumn Seminar',
    pricingRules: rules,
  };
}

describe('stripe-product-checkout rule resolution & capacity transactions', () => {
  it('resolves legacy attendance + includeVideo inputs and locks paid add-ons on upgrade', () => {
    const product = buildSampleRulesProduct();

    // Legacy caller specifying attendance + includeVideo without optionId / selectedAddOnIds
    const resolvedLegacy = resolveRequestRuleSelection(
      product.pricingRules,
      {
        attendance: AttendanceType.Online,
        includeVideo: true,
      },
      null,
    );
    expect(resolvedLegacy.selectedOptionId).toBe('online_live');
    expect(resolvedLegacy.selectedAddOnIds).toEqual(['event_recording']);

    // Paid upgrade retains previously purchased recording add-on even if client omits it
    const existingPaidReg: EventRegistration = {
      ...initEventRegistration(),
      docId: 'reg_1',
      optionId: 'online_live',
      attendance: AttendanceType.Online,
      hasVideoAccess: true,
      selectedAddOnIds: ['event_recording'],
      status: EventRegistrationStatus.Paid,
      paymentMethod: RegistrationPaymentMethod.Stripe,
      amountPaidCents: 6000,
    };
    const resolvedUpgrade = resolveRequestRuleSelection(
      product.pricingRules,
      {
        optionId: 'full_in_person',
        selectedAddOnIds: [],
      },
      existingPaidReg,
    );
    expect(resolvedUpgrade.selectedOptionId).toBe('full_in_person');
    expect(resolvedUpgrade.selectedAddOnIds).toEqual(['event_recording']);
  });

  it('enforces named EventCapacity limits transactionally and frees capacity when switching to online', () => {
    const product = buildSampleRulesProduct();
    const capacities = product.pricingRules.capacities;

    // 1. Exceeding Friday limit (5/5 used, requesting +1) throws failed-precondition
    expect(() =>
      computeCapacityUpdateOrThrow(
        capacities,
        { hall: 5, friday: 5 },
        {},
        { hall: 1, friday: 1 },
      ),
    ).toThrow(/Friday Spots.*reached capacity/);

    // 2. Existing attendee already holding { hall: 1, friday: 1 } updating their registration at 5/5 succeeds!
    const keptCounts = computeCapacityUpdateOrThrow(
      capacities,
      { hall: 5, friday: 5 },
      { hall: 1, friday: 1 },
      { hall: 1, friday: 1 },
    );
    expect(keptCounts).toEqual({ hall: 5, friday: 5 });

    // 3. Existing attendee switching from Full In-Person ({ hall: 1, friday: 1 }) to Online ({}) releases units
    const releasedCounts = computeCapacityUpdateOrThrow(
      capacities,
      { hall: 5, friday: 1 },
      { hall: 1, friday: 1 },
      {},
    );
    expect(releasedCounts).toEqual({ hall: 4 });
  });

  it('resolves live capacities from linked event and falls back to legacy inPersonRegistrationsCount for single capacity', () => {
    const product = buildSampleRulesProduct();
    product.pricingRules.capacities = [
      initEventCapacity({ id: 'venue_capacity', label: 'In-Person Spots', limit: 15 }),
    ];

    const legacyEvent = {
      ...initEvent(),
      docId: 'event_1',
      inPersonRegistrationsCount: 7,
      capacityCounts: {},
    };

    const resolved = resolveEffectiveRulesAndCapacities(product, legacyEvent);
    expect(resolved.capacityCounts).toEqual({ venue_capacity: 7 });
  });

  it('maps eligibility errors to permission-denied and capacity/suboption errors to failed-precondition', () => {
    const product = buildSampleRulesProduct();

    // Non-member attempting Instructor-only option -> permission-denied
    const instQuote = evaluateEventPricingQuote({
      rules: product.pricingRules,
      memberContext: PUBLIC_MEMBER_STATUS_CONTEXT,
      selectedOptionId: 'inst_clinic',
      evaluationDateAoE: '2099-08-01',
    });
    expect(() => assertValidQuoteOrThrow(instQuote)).toThrowError(
      expect.objectContaining({ code: 'permission-denied' }),
    );

    // Selecting 2-Day Pass with only 1 suboption -> failed-precondition
    const suboptQuote = evaluateEventPricingQuote({
      rules: product.pricingRules,
      memberContext: PUBLIC_MEMBER_STATUS_CONTEXT,
      selectedOptionId: 'two_day',
      selectedSuboptions: ['Fri'],
      evaluationDateAoE: '2099-08-01',
    });
    expect(() => assertValidQuoteOrThrow(suboptQuote)).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('values prior paid registration at max(amountPaidCents, current option + add-on value) for upgrades', () => {
    const product = buildSampleRulesProduct();
    // Make full_in_person and online_live equal standard price ($100)
    product.pricingRules.earlyBird = { kind: EarlyBirdPolicyKind.Disabled };
    product.pricingRules.registrationOptions = [
      initEventRegistrationOption({
        id: 'in_person',
        label: 'In-Person',
        attendanceType: AttendanceType.InPerson,
        priceCents: 10000,
      }),
      initEventRegistrationOption({
        id: 'online',
        label: 'Online',
        attendanceType: AttendanceType.Online,
        priceCents: 10000,
      }),
    ];

    const instContext = toMemberStatusContext({
      member: {
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2999-01-01',
        instructorId: '10',
        instructorLicenseType: InstructorLicenseType.Annual,
        instructorLicenseExpires: '2999-01-01',
      },
      isAdmin: false,
    });

    // Attendee paid $60 originally (before price rose to $70 instructor rate + $20 video = $90)
    const existingPaid: EventRegistration = {
      ...initEventRegistration(),
      docId: 'reg_inst',
      optionId: 'in_person',
      attendance: AttendanceType.InPerson,
      hasVideoAccess: true,
      selectedAddOnIds: ['event_recording'],
      amountPaidCents: 6000,
      status: EventRegistrationStatus.Paid,
      paymentMethod: RegistrationPaymentMethod.Stripe,
    };

    const credit = computePriorPaidCreditCents(
      existingPaid,
      product.pricingRules,
      instContext,
      false,
      '2099-10-01',
    );
    expect(credit).toBe(9000);

    // Pending in-person registration receives 0 credit when paying online
    const pendingDoor: EventRegistration = {
      ...existingPaid,
      amountPaidCents: 0,
      amountDueCents: 9000,
      status: EventRegistrationStatus.PendingInPerson,
      paymentMethod: RegistrationPaymentMethod.InPerson,
    };
    expect(
      computePriorPaidCreditCents(
        pendingDoor,
        product.pricingRules,
        instContext,
        false,
        '2099-10-01',
      ),
    ).toBe(0);
  });

  it('unmarks in-person and deposit-paid door balances cleanly with strictly defined fields', () => {
    // 1. In-person door payment -> PendingInPerson with paidAt: ''
    const paidDoor: EventRegistration = {
      ...initEventRegistration(),
      docId: 'reg_door',
      status: EventRegistrationStatus.Paid,
      paymentMethod: RegistrationPaymentMethod.InPerson,
      totalPriceCents: 6500,
      amountPaidCents: 6500,
      amountDueCents: 0,
      paidAt: '2026-09-08T10:00:00Z',
    };
    const revertedDoor = buildUnmarkedRegistrationUpdates(paidDoor, '2026-09-09T00:00:00Z');
    expect(revertedDoor).toEqual({
      status: EventRegistrationStatus.PendingInPerson,
      amountDueCents: 6500,
      amountPaidCents: 0,
      paidAt: '',
      lastUpdated: '2026-09-09T00:00:00Z',
    });

    // 2. Deposit-paid registration whose remaining door balance was marked paid -> reverts to DepositPaid
    const paidDeposit: EventRegistration = {
      ...initEventRegistration(),
      docId: 'reg_dep',
      status: EventRegistrationStatus.Paid,
      paymentMethod: RegistrationPaymentMethod.Stripe,
      totalPriceCents: 8000,
      depositPaidCents: 2500,
      amountPaidCents: 8000,
      amountDueCents: 0,
      paidAt: '2026-09-08T10:00:00Z',
    };
    const revertedDeposit = buildUnmarkedRegistrationUpdates(paidDeposit, '2026-09-09T00:00:00Z');
    expect(revertedDeposit).toEqual({
      status: EventRegistrationStatus.DepositPaid,
      amountPaidCents: 2500,
      amountDueCents: 5500,
      paidAt: '',
      lastUpdated: '2026-09-09T00:00:00Z',
    });

    // 3. Full Stripe online payment cannot be unmarked
    const fullStripe: EventRegistration = {
      ...initEventRegistration(),
      docId: 'reg_stripe',
      status: EventRegistrationStatus.Paid,
      paymentMethod: RegistrationPaymentMethod.Stripe,
      totalPriceCents: 8000,
      depositPaidCents: 0,
      amountPaidCents: 8000,
      amountDueCents: 0,
    };
    expect(() => buildUnmarkedRegistrationUpdates(fullStripe)).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('converts legacy Matrix Firestore product docs into equivalent EventPricingRules on load', () => {
    const legacyProduct = firestoreDocToProduct({
      id: 'legacy_prod',
      data: () => ({
        eventDocId: 'event_legacy',
        title: 'Legacy Workshop',
        allowNonMembers: false,
        allowMembers: true,
        allowInstructors: true,
        allowInPerson: true,
        allowOnline: true,
        allowVideo: true,
        hasMemberPrice: true,
        hasInstructorPrice: true,
        maxInPersonAttendees: 25,
        tiers: {
          member_in_person_novideo: { enabled: true, price: 80 },
          member_in_person_video: { enabled: true, price: 100 },
          instructor_in_person_novideo: { enabled: true, price: 60 },
          instructor_in_person_video: { enabled: true, price: 80 },
          member_online_novideo: { enabled: true, price: 50 },
          member_online_video: { enabled: true, price: 70 },
          instructor_online_novideo: { enabled: true, price: 40 },
          instructor_online_video: { enabled: true, price: 60 },
        },
      }),
    });

    // Public non-member is rejected (options require Members)
    const publicQuote = evaluateEventPricingQuote({
      rules: legacyProduct.pricingRules,
      memberContext: PUBLIC_MEMBER_STATUS_CONTEXT,
      evaluationDateAoE: '2099-05-01',
    });
    expect(publicQuote.isEligibleToRegister).toBe(false);

    // Active member gets $80 in-person + $20 recording = $100, and capacity limit 25 is tracked
    const memberQuote = evaluateEventPricingQuote({
      rules: legacyProduct.pricingRules,
      memberContext: toMemberStatusContext({
        member: {
          membershipType: MembershipType.Annual,
          currentMembershipExpires: '2999-01-01',
          instructorId: '',
          instructorLicenseType: InstructorLicenseType.None,
          instructorLicenseExpires: '',
        },
        isAdmin: false,
      }),
      selectedAddOnIds: ['event_recording'],
      capacityCounts: { in_person_venue: 10 },
      evaluationDateAoE: '2099-05-01',
    });
    expect(memberQuote.isValid).toBe(true);
    expect(memberQuote.totalPriceCents).toBe(10000);
    expect(memberQuote.evaluatedCapacities[0].remaining).toBe(15);
  });
});
