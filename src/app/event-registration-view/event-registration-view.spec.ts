/* event-registration-view.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  EventRegistrationViewComponent,
  QuickPayConfirmAction,
} from './event-registration-view';
import { ProductService } from '../product.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { StripeService } from '../stripe.service';
import { SearchableSet } from '../searchable-set';
import {
  AttendanceType,
  AttendeeRole,
  EventAddOnKind,
  EventRegistration,
  EventRegistrationStatus,
  initEvent,
  initEventAddOn,
  initEventCapacity,
  initEventPricingRules,
  initEventRegistration,
  initEventRegistrationOption,
  initEventRegistrationQuestion,
  initProduct,
  PaymentChoice,
  PricingTierType,
  RegistrationPaymentMethod,
  RegistrationQuestionKind,
  SubSelectionKind,
} from '../../../functions/src/data-model/events';
import { initMember, MembershipType } from '../../../functions/src/data-model/members';

describe('EventRegistrationViewComponent', () => {
  let component: EventRegistrationViewComponent;
  let fixture: ComponentFixture<EventRegistrationViewComponent>;

  const mockEvent = {
    ...initEvent(),
    docId: 'event-1',
    title: 'Autumn Push Hands Intensive',
    productId: 'prod-1',
    ownerDocId: 'host-member-doc',
    ownerEmails: ['host@ilc.com'],
    capacities: [initEventCapacity({ id: 'hall', label: 'Main Hall', limit: 30 })],
    capacityCounts: { hall: 12 },
  };

  const mockProduct = {
    ...initProduct(),
    docId: 'prod-1',
    eventDocId: 'event-1',
    currency: 'usd',
    pricingRules: {
      ...initEventPricingRules(),
      capacities: [initEventCapacity({ id: 'hall', label: 'Main Hall', limit: 30 })],
      registrationOptions: [
        initEventRegistrationOption({
          id: 'opt_in_person',
          label: 'Full Weekend (In-Person)',
          attendanceType: AttendanceType.InPerson,
          priceCents: 20000,
          capacityUsage: { hall: 1 },
          subSelection: {
            kind: SubSelectionKind.PickSuboptions,
            availableSuboptions: ['Saturday', 'Sunday'],
            pickCount: 1,
          },
        }),
        initEventRegistrationOption({
          id: 'opt_online',
          label: 'Live Online Stream',
          attendanceType: AttendanceType.Online,
          priceCents: 12000,
          capacityUsage: {},
        }),
      ],
      addOns: [
        initEventAddOn({
          id: 'addon_rec',
          label: 'Event Recording',
          priceCents: 4000,
          spec: { kind: EventAddOnKind.EventRecording },
        }),
      ],
      questions: [
        initEventRegistrationQuestion({
          id: 'q_diet',
          label: 'Dietary Restrictions',
          spec: { kind: RegistrationQuestionKind.ShortText, placeholder: 'None' },
        }),
      ],
    },
  };

  const mockRegistration: EventRegistration = {
    ...initEventRegistration(),
    docId: 'reg-42',
    eventDocId: 'event-1',
    productId: 'prod-1',
    orderDocId: 'ord-stripe-42',
    stripeSessionId: 'cs_test_42',
    registeredAt: '2026-09-10T14:00:00.000Z',
    paidAt: '2026-09-10T14:02:00.000Z',
    lastUpdated: '2026-09-10T14:02:00.000Z',
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1-555-0101',
    notes: 'Arriving early',
    memberDocId: 'mem-doc-jane',
    memberId: 'US402',
    studentLevel: '4',
    applicationLevel: '2',
    role: AttendeeRole.Member,
    attendance: AttendanceType.InPerson,
    optionId: 'opt_in_person',
    optionLabel: 'Full Weekend (In-Person)',
    selectedSuboptions: ['Saturday'],
    selectedAddOnIds: [],
    selectedAddOnLabels: [],
    hasVideoAccess: false,
    capacityUsage: { hall: 1 },
    status: EventRegistrationStatus.DepositPaid,
    paymentMethod: RegistrationPaymentMethod.Stripe,
    paymentChoice: PaymentChoice.Deposit,
    pricingTierType: PricingTierType.Standard,
    totalPriceCents: 20000,
    depositPaidCents: 5000,
    amountPaidCents: 5000,
    amountDueCents: 15000,
    currency: 'usd',
    questionResponses: [
      {
        questionId: 'q_diet',
        questionLabel: 'Dietary Restrictions',
        kind: RegistrationQuestionKind.ShortText,
        answerText: 'Gluten-free',
        selectedOptions: [],
      },
    ],
  };

  const linkedJaneMember = {
    ...initMember(),
    docId: 'mem-doc-jane',
    memberId: 'US402',
    name: 'Jane Smith',
    emails: ['jane@example.com'],
    membershipType: MembershipType.Annual,
    currentMembershipExpires: '2099-12-31',
    studentLevel: '5' as typeof mockRegistration.studentLevel,
    applicationLevel: '2' as typeof mockRegistration.applicationLevel,
  };

  const mockProductService = {
    getEventRegistration: vi
      .fn()
      .mockImplementation(async () => JSON.parse(JSON.stringify(mockRegistration))),
    getProduct: vi
      .fn()
      .mockImplementation(async () => JSON.parse(JSON.stringify(mockProduct))),
    getProductByEventId: vi
      .fn()
      .mockImplementation(async () => JSON.parse(JSON.stringify(mockProduct))),
  };

  const mockDataManagerService = {
    members: new SearchableSet(['name', 'memberId', 'emails'], 'docId', [linkedJaneMember]),
    getEventById: vi
      .fn()
      .mockImplementation(async () => JSON.parse(JSON.stringify(mockEvent))),
    getMemberByDocId: vi.fn().mockImplementation((id: string) =>
      id === linkedJaneMember.docId ? linkedJaneMember : undefined,
    ),
    getMemberByMemberId: vi.fn().mockImplementation((id: string) =>
      id === linkedJaneMember.memberId ? linkedJaneMember : undefined,
    ),
    getMember: vi.fn().mockImplementation((id: string) =>
      id === linkedJaneMember.docId || id === linkedJaneMember.memberId
        ? linkedJaneMember
        : undefined,
    ),
  };

  const mockRoutingService = {
    signals: {
      eventRegistrationView: {
        pathVars: {
          eventId: signal('event-1'),
          registrationId: signal('reg-42'),
        },
      },
    },
    hrefForView: vi.fn().mockImplementation((view: string, vars?: Record<string, string>) => {
      if (view === 'orderView') return `/order-view/${vars?.['orderId']}`;
      if (view === 'manageMemberView') return `/members/${vars?.['memberId']}`;
      if (view === 'eventRegistrations') return `/events/${vars?.['eventId']}/registrations`;
      return `/events/${vars?.['eventId']}`;
    }),
    navigateTo: vi.fn(),
  };

  const mockFirebaseState = {
    user: signal<{
      isAdmin: boolean;
      firebaseUser?: { email?: string };
      member?: { docId: string; emails?: string[] };
    } | null>({
      isAdmin: true,
      firebaseUser: { email: 'admin@ilc.com' },
      member: { docId: 'admin-doc', emails: ['admin@ilc.com'] },
    }),
  };

  const mockStripeService = {
    adminUpdateEventRegistration: vi.fn(),
    markEventRegistrationPaid: vi.fn().mockResolvedValue({ success: true }),
    unmarkEventRegistrationPaid: vi.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(async () => {
    mockFirebaseState.user.set({
      isAdmin: true,
      firebaseUser: { email: 'admin@ilc.com' },
      member: { docId: 'admin-doc', emails: ['admin@ilc.com'] },
    });
    mockProductService.getEventRegistration.mockImplementation(async () =>
      JSON.parse(JSON.stringify(mockRegistration)),
    );
    mockStripeService.adminUpdateEventRegistration.mockReset();
    mockStripeService.markEventRegistrationPaid.mockClear();

    await TestBed.configureTestingModule({
      imports: [EventRegistrationViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: StripeService, useValue: mockStripeService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventRegistrationViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads registration details, emits dynamic titles, and allows HQ Admin to edit, recalculate, and save', async () => {
    const loadedTitles: string[] = [];
    const loadedEventTitles: string[] = [];
    component.titleLoaded.subscribe((t) => loadedTitles.push(t));
    component.eventTitleLoaded.subscribe((t) => loadedEventTitles.push(t));

    await component.loadData('event-1', 'reg-42');
    fixture.detectChanges();

    expect(loadedEventTitles).toContain('Autumn Push Hands Intensive');
    expect(loadedTitles).toContain('Registration: Jane Smith');
    expect(component.canEdit()).toBe(true);
    expect(component.isDirty()).toBe(false);

    // Changing option & toggling recording add-on preserves manual prices until Recalculate is clicked
    component.onConfiguredOptionChange('opt_online');
    component.toggleConfiguredAddOn(mockProduct.pricingRules.addOns[0], true);
    expect(component.formAttendance()).toBe(AttendanceType.Online);
    expect(component.formHasVideoAccess()).toBe(true);
    expect(component.formCapacityUsage()).toEqual({});
    // Manual price stays 200.00 before clicking Recalculate
    expect(component.formTotalPriceMajor()).toBe('200.00');

    // Clicking "Recalculate from rules" computes $120 Online + $40 Recording = $160 ($110 due after $50 paid)
    component.recalculatePriceFromRules();
    expect(component.formTotalPriceMajor()).toBe('160.00');
    expect(component.formAmountDueMajor()).toBe('110.00');

    // Sync levels from linked member updates studentLevel '4' -> '5'
    component.syncRoleAndLevelsFromMember();
    expect(component.formStudentLevel()).toBe('5');

    // Edit question response & notes
    component.updateQuestionText(component.mergedQuestions()[0], 'Vegan');
    component.formNotes.set('Switched to online + recording');
    expect(component.isDirty()).toBe(true);

    const savedReg: EventRegistration = {
      ...mockRegistration,
      ...component.buildFieldsPayload(),
      lastUpdated: '2026-09-12T10:00:00.000Z',
    };
    mockStripeService.adminUpdateEventRegistration.mockResolvedValueOnce({
      success: true,
      registration: savedReg,
    });

    await component.onSubmit(new Event('submit'));
    fixture.detectChanges();

    expect(mockStripeService.adminUpdateEventRegistration).toHaveBeenCalledTimes(1);
    const callArg = mockStripeService.adminUpdateEventRegistration.mock.calls[0][0];
    expect(callArg.eventId).toBe('event-1');
    expect(callArg.registrationId).toBe('reg-42');
    expect(callArg.updates.optionId).toBe('opt_online');
    expect(callArg.updates.selectedAddOnIds).toEqual(['addon_rec']);
    expect(callArg.updates.totalPriceCents).toBe(16000);
    expect(callArg.updates.amountDueCents).toBe(11000);
    expect(callArg.updates.studentLevel).toBe('5');
    expect(callArg.updates.questionResponses[0].answerText).toBe('Vegan');
    expect(component.isDirty()).toBe(false);
    expect(component.saveSuccessMessage()).toContain('saved');
  });

  it('renders read-only details for event organizers while allowing quick Mark Paid in Full', async () => {
    mockFirebaseState.user.set({
      isAdmin: false,
      firebaseUser: { email: 'host@ilc.com' },
      member: { docId: 'host-member-doc', emails: ['host@ilc.com'] },
    });

    await component.loadData('event-1', 'reg-42');
    fixture.detectChanges();

    expect(component.canView()).toBe(true);
    expect(component.canEdit()).toBe(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('form.registration-edit-form')).toBeNull();
    expect(el.querySelector('dl.readonly-dl')).not.toBeNull();
    expect(el.textContent).toContain('Organizer Read-Only View');
    expect(el.textContent).toContain('Gluten-free');

    // Organizer can still confirm Mark Paid in Full
    component.quickPayConfirm.set(QuickPayConfirmAction.MarkPaid);
    await component.confirmQuickPayToggle();
    expect(mockStripeService.markEventRegistrationPaid).toHaveBeenCalledWith({
      eventId: 'event-1',
      registrationId: 'reg-42',
    });
  });

  it('blocks unauthorized users who are neither admin nor event organizer', async () => {
    mockFirebaseState.user.set({
      isAdmin: false,
      firebaseUser: { email: 'stranger@example.com' },
      member: { docId: 'stranger-doc', emails: ['stranger@example.com'] },
    });

    await component.loadData('event-1', 'reg-42');
    fixture.detectChanges();

    expect(component.canView()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Access Restricted');
  });
});
