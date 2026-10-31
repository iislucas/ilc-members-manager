/* product-view.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ProductViewComponent } from './product-view';
import { ProductService } from '../product.service';
import { StripeService } from '../stripe.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import {
  AttendeeRole,
  AttendanceType,
  DepositPolicyKind,
  DepositRefundPolicyKind,
  EarlyBirdPolicyKind,
  EventAddOnKind,
  EventRegistration,
  EventRegistrationStatus,
  firestoreDocToProduct,
  IlcEvent,
  initEvent,
  initEventAddOn,
  initEventCapacity,
  initEventDiscount,
  initEventPricingRules,
  initEventRegistration,
  initEventRegistrationOption,
  initEventRegistrationQuestion,
  initEventRuleConditions,
  initProduct,
  PaymentChoice,
  PaymentConditionKind,
  PersonStatusKind,
  Product,
  RegistrationConditionKind,
  RegistrationPaymentMethod,
  RegistrationQuestionKind,
  SubSelectionKind,
  TimingConditionKind,
  TimingWindow,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';
import { MembershipType } from '../../../functions/src/data-model/members';

describe('ProductViewComponent', () => {
  let component: ProductViewComponent;
  let fixture: ComponentFixture<ProductViewComponent>;
  let capturedEventWatcher: ((event: IlcEvent) => void) | null = null;

  function buildWorkshopProduct(): Product {
    const rules = initEventPricingRules();
    rules.capacities = [
      initEventCapacity({
        id: 'hall_spots',
        label: 'Training Hall Spots',
        limit: 20,
        description: 'Maximum in-person spots on the floor',
      }),
    ];
    rules.earlyBird = {
      kind: EarlyBirdPolicyKind.Enabled,
      deadlineDate: '2099-09-15',
    };
    rules.registrationOptions = [
      initEventRegistrationOption({
        id: 'full_in_person',
        label: 'Full Workshop (In-Person)',
        description: 'All 4 days on the training floor',
        attendanceType: AttendanceType.InPerson,
        conditions: initEventRuleConditions(),
        capacityUsage: { hall_spots: 1 },
        priceCents: 10000,
        subSelection: { kind: SubSelectionKind.None },
      }),
      initEventRegistrationOption({
        id: 'two_day_pass',
        label: '2-Day Pass',
        description: 'Pick any 2 days in person',
        attendanceType: AttendanceType.InPerson,
        conditions: initEventRuleConditions(),
        capacityUsage: { hall_spots: 1 },
        priceCents: 7000,
        subSelection: {
          kind: SubSelectionKind.PickSuboptions,
          pickCount: 2,
          availableSuboptions: ['Friday', 'Saturday', 'Sunday', 'Monday'],
        },
      }),
      initEventRegistrationOption({
        id: 'online_zoom',
        label: 'Online Live (Zoom)',
        description: 'Join remotely via Zoom',
        attendanceType: AttendanceType.Online,
        conditions: initEventRuleConditions(),
        capacityUsage: {},
        priceCents: 5000,
        subSelection: { kind: SubSelectionKind.None },
      }),
      initEventRegistrationOption({
        id: 'instructor_clinic',
        label: 'Instructor Clinic',
        description: 'Certified instructors session',
        attendanceType: AttendanceType.InPerson,
        conditions: initEventRuleConditions({
          who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
        }),
        capacityUsage: { hall_spots: 1 },
        priceCents: 6000,
        subSelection: { kind: SubSelectionKind.None },
      }),
      initEventRegistrationOption({
        id: 'recording_only',
        label: 'Recording Only',
        description: 'Post-event recording access',
        attendanceType: AttendanceType.VideoOnly,
        conditions: initEventRuleConditions(),
        capacityUsage: {},
        priceCents: 4000,
        subSelection: { kind: SubSelectionKind.None },
      }),
    ];
    rules.discounts = [
      initEventDiscount({
        id: 'early_full_disc',
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
        id: 'member_disc',
        label: 'Active Member Discount',
        discountCents: 2000,
        conditions: initEventRuleConditions({
          who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
          registration: {
            kind: RegistrationConditionKind.SpecificOptions,
            optionIds: ['full_in_person', 'two_day_pass', 'online_zoom'],
          },
        }),
      }),
      initEventDiscount({
        id: 'inst_disc',
        label: 'Extra Instructor Discount',
        discountCents: 1000,
        conditions: initEventRuleConditions({
          who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
          registration: {
            kind: RegistrationConditionKind.SpecificOptions,
            optionIds: ['full_in_person', 'two_day_pass', 'online_zoom'],
          },
        }),
      }),
    ];
    rules.addOns = [
      initEventAddOn({
        id: 'event_recording',
        label: 'Event Video Recording',
        description: 'Stream the edited recording',
        spec: { kind: EventAddOnKind.EventRecording },
        priceCents: 2000,
        conditions: initEventRuleConditions({
          registration: {
            kind: RegistrationConditionKind.SpecificOptions,
            optionIds: ['full_in_person', 'two_day_pass', 'online_zoom'],
          },
        }),
      }),
    ];
    rules.payment = {
      allowFullPayment: true,
      allowZeroDepositInPerson: true,
      depositPolicy: {
        kind: DepositPolicyKind.Enabled,
        depositCents: 3000,
        offlineInstructions: 'Bring remaining balance in cash on Friday morning.',
        refundPolicy: {
          kind: DepositRefundPolicyKind.RefundableBefore,
          deadlineDate: '2099-09-20',
        },
      },
    };

    return {
      ...initProduct(),
      docId: 'test-prod-1',
      eventDocId: 'event-1',
      title: 'Autumn Kung Fu Workshop',
      description: 'An intensive 4-day workshop.',
      currency: 'usd',
      pricingRules: rules,
      maxInPersonAttendees: 20,
    };
  }

  function buildMockEvent(): IlcEvent {
    return {
      ...initEvent(),
      docId: 'event-1',
      title: 'Autumn Kung Fu Workshop',
      productId: 'test-prod-1',
      start: '2099-10-01T10:00:00Z',
      end: '2099-10-04T16:00:00Z',
      capacities: [
        initEventCapacity({
          id: 'hall_spots',
          label: 'Training Hall Spots',
          limit: 20,
          description: 'Maximum in-person spots on the floor',
        }),
      ],
      capacityCounts: { hall_spots: 5 },
      inPersonRegistrationsCount: 5,
    };
  }

  let mockProductService: {
    getProduct: ReturnType<typeof vi.fn>;
    getProductByEventId: ReturnType<typeof vi.fn>;
    getUserRegistrationForEvent: ReturnType<typeof vi.fn>;
    watchEvent: ReturnType<typeof vi.fn>;
    watchProduct: ReturnType<typeof vi.fn>;
  };

  let mockDataManagerService: {
    getEventById: ReturnType<typeof vi.fn>;
  };

  let mockStripeService: {
    createProductCheckoutSession: ReturnType<typeof vi.fn>;
    updateProductRegistration: ReturnType<typeof vi.fn>;
    registerEventInPerson: ReturnType<typeof vi.fn>;
  };

  let mockRoutingService: {
    signals: {
      eventRegister: {
        pathVars: {
          eventId: ReturnType<typeof signal<string>>;
        };
      };
    };
    hrefForView: ReturnType<typeof vi.fn>;
    navigateToParts: ReturnType<typeof vi.fn>;
  };

  const mockFirebaseState = {
    loginStatus: signal('SignedIn'),
    loggedIn: signal(Promise.resolve({})),
    loginError: signal<string | null>(null),
    unverifiedUser: signal<unknown>(null),
    completedEmailLinkSignIn: signal<string | null>(null),
    offerPasswordSetup: signal<boolean>(false),
    pendingEmailLink: signal<string | null>(null),
    checkEmailStatus: vi.fn().mockResolvedValue({
      hasMemberRecord: true,
      hasAuthAccount: true,
      isGoogleManaged: false,
    }),
    clearLoginError: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    signInWithGoogle: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
    user: signal<unknown>({
      email: 'member@example.com',
      firebaseUser: { email: 'member@example.com' },
      isAdmin: false,
      isFullMember: true,
      isInstructor: false,
      member: {
        docId: 'mem-1',
        memberId: 'US100',
        name: 'Test Member',
        emails: ['member@example.com'],
        phone: '555-0100',
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2999-01-01',
      },
    }),
  };

  beforeEach(async () => {
    capturedEventWatcher = null;
    const prod = buildWorkshopProduct();
    const ev = buildMockEvent();

    mockFirebaseState.user.set({
      email: 'member@example.com',
      firebaseUser: { email: 'member@example.com' },
      isAdmin: false,
      isFullMember: true,
      isInstructor: false,
      member: {
        docId: 'mem-1',
        memberId: 'US100',
        name: 'Test Member',
        emails: ['member@example.com'],
        phone: '555-0100',
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2999-01-01',
      },
    });

    mockProductService = {
      getProduct: vi.fn().mockResolvedValue(prod),
      getProductByEventId: vi.fn().mockResolvedValue(prod),
      getUserRegistrationForEvent: vi.fn().mockResolvedValue(undefined),
      watchEvent: vi.fn().mockImplementation((_id: string, cb: (e: IlcEvent) => void) => {
        capturedEventWatcher = cb;
        return () => {};
      }),
      watchProduct: vi.fn().mockReturnValue(() => {}),
    };

    mockDataManagerService = {
      getEventById: vi.fn().mockResolvedValue(ev),
    };

    mockStripeService = {
      createProductCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
        sessionId: 'cs_test_123',
      }),
      updateProductRegistration: vi.fn().mockResolvedValue({
        success: true,
        registrationDocId: 'reg-123',
      }),
      registerEventInPerson: vi.fn().mockResolvedValue({
        success: true,
        registrationDocId: 'reg-door-123',
      }),
    };

    mockRoutingService = {
      signals: {
        eventRegister: {
          pathVars: {
            eventId: signal('event-1'),
          },
        },
      },
      hrefForView: vi.fn().mockReturnValue('/mock-link'),
      navigateToParts: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProductViewComponent],
      providers: [
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: StripeService, useValue: mockStripeService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductViewComponent);
    component = fixture.componentInstance;
    vi.spyOn(
      component as unknown as { redirectToCheckout: (url: string) => void },
      'redirectToCheckout',
    ).mockImplementation(() => {});
    fixture.detectChanges();
  });

  it('loads product, starts live event/product watchers, and evaluates member early-bird quote', async () => {
    await component.loadProduct();
    fixture.detectChanges();

    expect(component.product()?.title).toBe('Autumn Kung Fu Workshop');
    expect(mockProductService.watchEvent).toHaveBeenCalledWith('event-1', expect.any(Function));
    expect(mockProductService.watchProduct).toHaveBeenCalledWith(
      'test-prod-1',
      expect.any(Function),
    );

    // Base $100 - $15 early bird - $20 member discount = $65 (6500 cents)
    const q = component.quote()!;
    expect(q.isEarlyBird).toBe(true);
    expect(q.selectedOption?.option.id).toBe('full_in_person');
    expect(q.totalPriceCents).toBe(6500);
    expect(component.onlineDueNowCents()).toBe(6500);
    expect(component.canSubmit()).toBe(true);
  });

  it('updates live capacities via watchEvent and blocks submission when selected option becomes sold out', async () => {
    await component.loadProduct();
    fixture.detectChanges();

    expect(component.quote()?.evaluatedCapacities[0].remaining).toBe(15); // 20 - 5

    // Simulate live Firestore snapshot filling all 20 hall_spots
    expect(capturedEventWatcher).toBeTruthy();
    capturedEventWatcher!({
      ...buildMockEvent(),
      capacityCounts: { hall_spots: 20 },
      inPersonRegistrationsCount: 20,
    });
    fixture.detectChanges();

    // Force selecting the in-person option explicitly to verify sold-out validation
    component.selectedOptionId.set('full_in_person');
    fixture.detectChanges();

    const fullOptEval = component
      .quote()!
      .allEvaluatedOptions.find((o) => o.option.id === 'full_in_person')!;
    expect(fullOptEval.isSoldOut).toBe(true);
    expect(component.quote()!.isValid).toBe(false);
    expect(component.canSubmit()).toBe(false);

    // Switching to Online Live (0 hall_spots usage) remains available and valid
    const onlineEval = component
      .quote()!
      .allEvaluatedOptions.find((o) => o.option.id === 'online_zoom')!;
    component.selectOption(onlineEval);
    fixture.detectChanges();

    expect(onlineEval.isSoldOut).toBe(false);
    expect(component.quote()!.isValid).toBe(true);
    expect(component.canSubmit()).toBe(true);
  });

  it('enforces PickSuboptions count and greys out unselected pills once pickCount is reached', async () => {
    await component.loadProduct();
    fixture.detectChanges();

    const twoDayEval = component
      .quote()!
      .allEvaluatedOptions.find((o) => o.option.id === 'two_day_pass')!;
    component.selectOption(twoDayEval);
    fixture.detectChanges();

    // 0 of 2 selected -> invalid
    expect(component.selectedSuboptions()).toEqual([]);
    expect(component.canSubmit()).toBe(false);

    component.toggleSuboption('Friday', 2, true);
    expect(component.canSubmit()).toBe(false);

    component.toggleSuboption('Sunday', 2, true);
    fixture.detectChanges();

    expect(component.selectedSuboptions()).toEqual(['Friday', 'Sunday']);
    expect(component.isSuboptionDisabled('Saturday', 2)).toBe(true);
    expect(component.isSuboptionDisabled('Friday', 2)).toBe(false);
    expect(component.canSubmit()).toBe(true);

    // Trying to add a 3rd sub-option is ignored
    component.toggleSuboption('Saturday', 2, true);
    expect(component.selectedSuboptions()).toEqual(['Friday', 'Sunday']);
  });

  it('applies cumulative Member + Instructor + Early Bird discounts on scoped options and restricts Instructor-only options for non-instructors', async () => {
    await component.loadProduct();
    fixture.detectChanges();

    // Regular member cannot select Instructor Clinic
    const instClinicAsMember = component
      .quote()!
      .allEvaluatedOptions.find((o) => o.option.id === 'instructor_clinic')!;
    expect(instClinicAsMember.isEligibleForPerson).toBe(false);

    // Switch logged-in user to Certified Instructor
    mockFirebaseState.user.set({
      email: 'instructor@example.com',
      firebaseUser: { email: 'instructor@example.com' },
      isAdmin: false,
      isFullMember: true,
      isInstructor: true,
      member: {
        docId: 'inst-1',
        memberId: 'US001',
        name: 'Test Instructor',
        emails: ['instructor@example.com'],
        phone: '555-0200',
        membershipType: MembershipType.Life,
        currentMembershipExpires: '',
        instructorId: 'INST-1',
        instructorLicenseType: 'Annual',
        instructorLicenseExpires: '2999-01-01',
      },
    });
    fixture.detectChanges();

    // Full Workshop ($100) - $15 Early Bird - $20 Member - $10 Extra Instructor = $55 (5500 cents)
    expect(component.quote()!.totalPriceCents).toBe(5500);

    // Instructor Clinic is now eligible ($60, no discounts scoped to instructor_clinic)
    const instClinicAsInst = component
      .quote()!
      .allEvaluatedOptions.find((o) => o.option.id === 'instructor_clinic')!;
    expect(instClinicAsInst.isEligibleForPerson).toBe(true);
    component.selectOption(instClinicAsInst);
    fixture.detectChanges();
    expect(component.quote()!.totalPriceCents).toBe(6000);
  });

  it('calculates optional add-on price and deposit vs pay-at-door settlement', async () => {
    await component.loadProduct();
    fixture.detectChanges();

    const addOnEval = component.quote()!.availableAddOns[0];
    expect(addOnEval.priceCents).toBe(2000); // $20 recording add-on

    component.toggleAddOn(addOnEval, true);
    fixture.detectChanges();

    // Full online: $65 attendance + $20 recording = $85
    expect(component.quote()!.totalPriceCents).toBe(8500);
    expect(component.onlineDueNowCents()).toBe(8500);
    expect(component.doorBalanceDueCents()).toBe(0);

    // Deposit choice: $30 deposit + $20 add-on = $50 online today, $35 due at door
    component.selectedPaymentChoice.set(PaymentChoice.Deposit);
    fixture.detectChanges();

    expect(component.onlineDueNowCents()).toBe(5000);
    expect(component.doorBalanceDueCents()).toBe(3500);
    const summaryBox = fixture.nativeElement.querySelector('.price-summary-box') as HTMLElement;
    expect(summaryBox.textContent).toContain('Event Deposit (Paid Online Today)');
    expect(summaryBox.textContent).toContain('$30');
    expect(summaryBox.textContent).toContain('Add-On: Event Video Recording (Paid Online Today)');
    expect(summaryBox.textContent).toContain('$20');
    expect(summaryBox.textContent).toContain('Charged Online Today');
    expect(summaryBox.textContent).toContain('$50');
    expect(summaryBox.textContent).toContain('Event Balance Due at Door');
    expect(summaryBox.textContent).toContain('$35');
    expect(fixture.nativeElement.textContent).toContain('Bring remaining balance in cash');

    // Pay at Door choice: $0 online today, $85 due at door -> calls registerEventInPerson
    component.selectedPaymentChoice.set(PaymentChoice.PayAtDoor);
    fixture.detectChanges();

    expect(component.onlineDueNowCents()).toBe(0);
    expect(component.doorBalanceDueCents()).toBe(8500);

    await component.submitRegistration();
    expect(mockStripeService.registerEventInPerson).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'test-prod-1',
        optionId: 'full_in_person',
        selectedAddOnIds: ['event_recording'],
        paymentChoice: PaymentChoice.PayAtDoor,
      }),
    );
  });

  it('handles upgrades: locks owned add-ons, credits prior payment, and differentiates free updates from paid upgrades', async () => {
    await component.loadProduct();

    const existingReg: EventRegistration = {
      ...initEventRegistration(),
      docId: 'reg-123',
      eventDocId: 'event-1',
      productId: 'test-prod-1',
      registeredAt: '2099-08-01T10:00:00Z',
      name: 'Test Member',
      email: 'member@example.com',
      role: AttendeeRole.Member,
      attendance: AttendanceType.Online,
      optionId: 'online_zoom',
      optionLabel: 'Online Live (Zoom)',
      hasVideoAccess: false,
      amountPaidCents: 3000, // Online ($50) - Member ($20) = $30
      totalPriceCents: 3000,
      paymentMethod: RegistrationPaymentMethod.Stripe,
      status: EventRegistrationStatus.Paid,
    };
    component.existingRegistration.set(existingReg);
    fixture.detectChanges();

    expect(component.isUpgrade()).toBe(true);
    expect(component.effectiveCreditCents()).toBe(3000);
    expect(component.onlineDueNowCents()).toBe(0);
    expect(component.isFreeOrInPlaceUpdate()).toBe(true);

    // Saving in-place update calls updateProductRegistration
    await component.submitRegistration();
    expect(mockStripeService.updateProductRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'test-prod-1',
        existingRegistrationDocId: 'reg-123',
        optionId: 'online_zoom',
      }),
    );

      // Upgrading to Full Workshop ($65) -> $65 - $30 credit = $35 due online
    const fullEval = component
      .quote()!
      .allEvaluatedOptions.find((o) => o.option.id === 'full_in_person')!;
    component.selectOption(fullEval);
    fixture.detectChanges();

    expect(component.onlineDueNowCents()).toBe(3500);
    expect(component.isFreeOrInPlaceUpdate()).toBe(false);

    await component.proceedToCheckout();
    expect(mockStripeService.createProductCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'test-prod-1',
        optionId: 'full_in_person',
        isUpgrade: true,
        existingRegistrationDocId: 'reg-123',
      }),
    );

    // Conversely, if a registrant already paid $65 for Full Workshop, switching down to Online ($30) is disabled as a Lower Tier downgrade
    component.existingRegistration.set({
      ...existingReg,
      attendance: AttendanceType.InPerson,
      optionId: 'full_in_person',
      optionLabel: 'Full Workshop',
      amountPaidCents: 6500,
      totalPriceCents: 6500,
    });
    fixture.detectChanges();

    const onlineEvalAfterPaidFull = component
      .quote()!
      .allEvaluatedOptions.find((o) => o.option.id === 'online_zoom')!;
    expect(component.isOptionDowngrade(onlineEvalAfterPaidFull)).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Lower Tier');
    component.selectOption(onlineEvalAfterPaidFull);
    expect(component.selectedOptionId()).toBe('full_in_person');
  });

  it('allows pending in-person registrant to pay online via Stripe', async () => {
    await component.loadProduct();

    component.existingRegistration.set({
      ...initEventRegistration(),
      docId: 'reg-door',
      eventDocId: 'event-1',
      productId: 'test-prod-1',
      registeredAt: '2099-08-01T10:00:00Z',
      name: 'Test Member',
      email: 'member@example.com',
      role: AttendeeRole.Member,
      attendance: AttendanceType.InPerson,
      optionId: 'full_in_person',
      capacityUsage: { hall_spots: 1 },
      amountPaidCents: 0,
      amountDueCents: 6500,
      totalPriceCents: 6500,
      paymentMethod: RegistrationPaymentMethod.InPerson,
      status: EventRegistrationStatus.PendingInPerson,
    });
    fixture.detectChanges();

    expect(component.isPendingInPerson()).toBe(true);
    expect(component.effectiveCreditCents()).toBe(0);
    expect(component.onlineDueNowCents()).toBe(6500);
    expect(component.isFreeOrInPlaceUpdate()).toBe(false);
    expect(component.canSubmit()).toBe(true);
  });

  it('converts legacy Matrix Firestore product docs seamlessly into Rule-Based Pricing', async () => {
    const rawLegacyData = {
      eventDocId: 'event-1',
      title: 'Legacy Matrix Seminar',
      currency: 'usd',
      allowNonMembers: true,
      allowMembers: true,
      allowInstructors: true,
      allowInPerson: true,
      allowOnline: true,
      allowVideo: true,
      hasMemberPrice: true,
      hasInstructorPrice: false,
      maxInPersonAttendees: 15,
      tiers: {
        non_member_in_person_novideo: { enabled: true, price: 100 },
        non_member_in_person_video: { enabled: true, price: 120 },
        member_in_person_novideo: { enabled: true, price: 80 },
        member_in_person_video: { enabled: true, price: 100 },
        non_member_online_novideo: { enabled: true, price: 60 },
        non_member_online_video: { enabled: true, price: 80 },
        member_online_novideo: { enabled: true, price: 40 },
        member_online_video: { enabled: true, price: 60 },
      },
    };
    const legacyProduct = firestoreDocToProduct({
      id: 'legacy-prod-1',
      data: () => rawLegacyData,
    });

    component.product.set(legacyProduct);
    component.linkedEvent.set({
      ...buildMockEvent(),
      capacities: [],
      capacityCounts: {},
      inPersonRegistrationsCount: 3,
    });
    fixture.detectChanges();

    // Member In-Person should evaluate to $80 (8000 cents), with 12 of 15 spots left
    const q = component.quote()!;
    expect(q.totalPriceCents).toBe(8000);
    expect(q.evaluatedCapacities[0].remaining).toBe(12);
  });

  describe('role resolution & restricted option inline login', () => {
    it('resolves active vs expired instructor and Life member roles accurately', () => {
      // Instructor with expired license but active membership -> Member
      mockFirebaseState.user.set({
        email: 'inst@example.com',
        isAdmin: false,
        member: {
          docId: 'mem-2',
          memberId: 'US200',
          instructorId: '5',
          instructorLicenseExpires: '2020-01-01',
          membershipType: MembershipType.Annual,
          currentMembershipExpires: '2999-01-01',
          name: 'Expired Inst',
          emails: ['inst@example.com'],
        },
      });
      expect(component.userRole()).toBe(AttendeeRole.Member);

      // Life member with past expiry date -> still active Member
      mockFirebaseState.user.set({
        email: 'life@example.com',
        isAdmin: false,
        member: {
          docId: 'mem-life',
          memberId: 'US999',
          membershipType: MembershipType.Life,
          currentMembershipExpires: '2020-01-01',
          name: 'Life Member',
          emails: ['life@example.com'],
        },
      });
      expect(component.userRole()).toBe(AttendeeRole.Member);
      expect(component.isLifeMember()).toBe(true);
    });

    it('shows inline Sign In panel when unauthenticated user views a members-only event', async () => {
      await component.loadProduct();

      mockFirebaseState.user.set(null);
      const prod = buildWorkshopProduct();
      prod.pricingRules.registrationOptions = prod.pricingRules.registrationOptions.map((o) => ({
        ...o,
        conditions: initEventRuleConditions({
          who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
        }),
      }));
      component.product.set(prod);
      fixture.detectChanges();

      expect(component.quote()!.isEligibleToRegister).toBe(false);
      const notice = fixture.nativeElement.querySelector('.role-ineligible-notice');
      expect(notice).toBeTruthy();

      const signInBtn = notice.querySelector('button.primary-button') as HTMLButtonElement;
      expect(signInBtn).toBeTruthy();
      expect(fixture.nativeElement.querySelector('app-inline-auth')).toBeFalsy();

      signInBtn.click();
      fixture.detectChanges();

      expect(component.showInlineLogin()).toBe(true);
      expect(fixture.nativeElement.querySelector('app-inline-auth')).toBeTruthy();
    });
  });

  describe('registration form questions & read-only upgrade locking', () => {
    it('renders accessible form questions, enforces required answers before submit, and sends questionAnswers to Stripe checkout', async () => {
      const prod = buildWorkshopProduct();
      prod.pricingRules.questions = [
        initEventRegistrationQuestion({
          id: 'q_shirt',
          label: 'T-Shirt Size',
          description: 'Included for in-person attendees',
          required: true,
          spec: { kind: RegistrationQuestionKind.Select, options: ['Small', 'Medium', 'Large'] },
          conditions: initEventRuleConditions({
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_in_person', 'two_day_pass'],
            },
          }),
        }),
        initEventRegistrationQuestion({
          id: 'q_focus',
          label: 'Focus Topics',
          description: 'Pick one or more areas',
          required: true,
          spec: {
            kind: RegistrationQuestionKind.Checkboxes,
            options: ['Spinning Hands', 'Chin Na'],
          },
          conditions: initEventRuleConditions(),
        }),
        initEventRegistrationQuestion({
          id: 'q_diet',
          label: 'Dietary Notes',
          required: false,
          spec: { kind: RegistrationQuestionKind.ShortText, placeholder: 'Optional' },
          conditions: initEventRuleConditions(),
        }),
      ];
      mockProductService.getProduct.mockResolvedValue(prod);
      mockRoutingService.signals.eventRegister.pathVars.eventId.set('event-1');

      const redirectSpy = vi
        .spyOn(component as unknown as { redirectToCheckout: (url: string) => void }, 'redirectToCheckout')
        .mockImplementation(() => {});

      await component.loadProduct();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('select#reg-q-q_shirt')).toBeTruthy();
      expect(el.querySelector('fieldset.question-fieldset legend')?.textContent).toContain(
        'Focus Topics',
      );
      expect(
        el.querySelector('select#reg-q-q_shirt')?.getAttribute('aria-describedby'),
      ).toBe('reg-q-desc-q_shirt');

      // Required questions unanswered -> canSubmit is false
      expect(component.canSubmit()).toBe(false);

      // Switching to Online Zoom hides In-Person-only T-Shirt Size question
      component.selectedOptionId.set('online_zoom');
      fixture.detectChanges();
      expect(el.querySelector('select#reg-q-q_shirt')).toBeNull();
      expect(component.canSubmit()).toBe(false); // Focus Topics still required

      // Switch back to Full In-Person and answer required questions
      component.selectedOptionId.set('full_in_person');
      component.updateQuestionSelect('q_shirt', 'Large');
      component.toggleQuestionCheckbox('q_focus', 'Spinning Hands', true);
      component.updateQuestionText('q_diet', 'Vegetarian');
      fixture.detectChanges();

      expect(component.canSubmit()).toBe(true);
      await component.proceedToCheckout();

      expect(mockStripeService.createProductCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          questionAnswers: expect.arrayContaining([
            { questionId: 'q_shirt', answerText: 'Large', selectedOptions: [] },
            { questionId: 'q_focus', answerText: '', selectedOptions: ['Spinning Hands'] },
            { questionId: 'q_diet', answerText: 'Vegetarian', selectedOptions: [] },
          ]),
        }),
      );
      redirectSpy.mockRestore();
    });

    it('displays previously submitted responses in Your Current Registration and locks them read-only while allowing newly unlocked upgrade questions', async () => {
      const prod = buildWorkshopProduct();
      prod.pricingRules.questions = [
        initEventRegistrationQuestion({
          id: 'q_focus',
          label: 'Focus Topics',
          required: true,
          spec: {
            kind: RegistrationQuestionKind.Checkboxes,
            options: ['Spinning Hands', 'Chin Na'],
          },
          conditions: initEventRuleConditions(),
        }),
        initEventRegistrationQuestion({
          id: 'q_shirt',
          label: 'T-Shirt Size',
          required: true,
          spec: { kind: RegistrationQuestionKind.Select, options: ['Small', 'Medium', 'Large'] },
          conditions: initEventRuleConditions({
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_in_person'],
            },
          }),
        }),
      ];

      const existingOnlineReg: EventRegistration = {
        ...initEventRegistration(),
        docId: 'reg-existing-1',
        eventDocId: 'event-1',
        productId: 'test-prod-1',
        name: 'Test Member',
        email: 'member@example.com',
        role: AttendeeRole.Member,
        optionId: 'online_zoom',
        optionLabel: 'Online Live (Zoom)',
        attendance: AttendanceType.Online,
        amountPaidCents: 3000,
        totalPriceCents: 3000,
        status: EventRegistrationStatus.Paid,
        paymentMethod: RegistrationPaymentMethod.Stripe,
        questionResponses: [
          {
            questionId: 'q_focus',
            questionLabel: 'Focus Topics',
            kind: RegistrationQuestionKind.Checkboxes,
            answerText: '',
            selectedOptions: ['Chin Na'],
          },
        ],
      };

      mockProductService.getProduct.mockResolvedValue(prod);
      mockProductService.getUserRegistrationForEvent.mockResolvedValue(existingOnlineReg);
      mockRoutingService.signals.eventRegister.pathVars.eventId.set('event-1');

      await component.loadProduct();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.current-reg-responses')?.textContent).toContain('Focus Topics');
      expect(el.querySelector('.current-reg-responses')?.textContent).toContain('Chin Na');

      // Existing question q_focus is locked read-only
      expect(component.isQuestionLocked('q_focus')).toBe(true);
      component.toggleQuestionCheckbox('q_focus', 'Spinning Hands', true);
      expect(component.getQuestionSelectedOptions('q_focus')).toEqual(['Chin Na']);

      // Upgrading to Full Workshop unlocks T-Shirt Size (which has no recorded response yet)
      component.selectedOptionId.set('full_in_person');
      fixture.detectChanges();
      expect(component.isQuestionLocked('q_shirt')).toBe(false);
      expect(component.canSubmit()).toBe(false);

      component.updateQuestionSelect('q_shirt', 'Medium');
      fixture.detectChanges();
      expect(component.canSubmit()).toBe(true);
    });

    it('renders Paid-in-Full add-ons as locked when Deposit or Pay-at-Door is selected, unlocks them on Full Payment, and treats organizer-marked Paid registrations as Paid in Full', async () => {
      const prod = buildWorkshopProduct();
      prod.pricingRules.addOns.push(
        initEventAddOn({
          id: 'vip_bonus',
          label: 'Bonus Study Guide',
          description: 'Included when paid in full',
          spec: { kind: EventAddOnKind.Other },
          priceCents: 0,
          conditions: initEventRuleConditions({
            payment: { kind: PaymentConditionKind.PaidInFull },
          }),
        }),
      );

      mockProductService.getProduct.mockResolvedValue(prod);
      mockProductService.getUserRegistrationForEvent.mockResolvedValue(null);
      mockRoutingService.signals.eventRegister.pathVars.eventId.set('event-1');

      await component.loadProduct();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;

      // Default payment choice is Full -> vip_bonus is unlocked and selectable
      expect(component.effectivePaymentChoice()).toBe(PaymentChoice.Full);
      expect(component.quote()?.availableAddOns.map((a) => a.addOn.id)).toContain('vip_bonus');
      expect(component.paidInFullLockedAddOns()).toEqual([]);

      // Select vip_bonus, then switch to Deposit -> vip_bonus becomes locked ("Paid in Full Only") and excluded from quote
      const vipEval = component.quote()!.availableAddOns.find((a) => a.addOn.id === 'vip_bonus')!;
      component.toggleAddOn(vipEval, true);
      component.selectedPaymentChoice.set(PaymentChoice.Deposit);
      fixture.detectChanges();

      expect(component.quote()?.availableAddOns.map((a) => a.addOn.id)).not.toContain('vip_bonus');
      expect(component.paidInFullLockedAddOns().map((a) => a.id)).toEqual(['vip_bonus']);
      expect(el.textContent).toContain('Paid in Full Only');
      expect(el.textContent).toContain('Select "Pay Full Amount Online" below');

      // Now load an existing registration marked Paid in Full offline by the organizer
      const offlinePaidReg: EventRegistration = {
        ...initEventRegistration(),
        docId: 'reg-offline-paid',
        eventDocId: 'event-1',
        productId: 'test-prod-1',
        name: 'Offline Paid Member',
        email: 'member@example.com',
        role: AttendeeRole.Member,
        optionId: 'full_in_person',
        optionLabel: 'Full Workshop (In-Person)',
        attendance: AttendanceType.InPerson,
        amountPaidCents: 6500,
        totalPriceCents: 6500,
        status: EventRegistrationStatus.Paid,
        paidInFullOffline: true,
        paymentMethod: RegistrationPaymentMethod.InPerson,
      };
      mockProductService.getUserRegistrationForEvent.mockResolvedValue(offlinePaidReg);

      await component.loadProduct();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el.textContent).toContain('Paid (Recorded by Organizer)');
      expect(component.isExistingPaidInFull()).toBe(true);
      expect(component.quote()?.availableAddOns.map((a) => a.addOn.id)).toContain('vip_bonus');
      expect(component.paidInFullLockedAddOns()).toEqual([]);
    });
  });
});
