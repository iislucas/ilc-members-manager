/* member-orders.spec.ts
 *
 * Unit tests for MemberOrdersComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemberOrdersComponent } from './member-orders';
import { StripeService } from '../stripe.service';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService, UserDetails } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { Grading, GradingStatus, initGrading, gradingDisplayId, orderDisplayNumber } from '../../../functions/src/data-model/gradings';
import { initMember, Member, MembershipType, SubscriptionInterval, SubscriptionItemType, SubscriptionStatus } from '../../../functions/src/data-model/members';
import { initMemberOrder, MemberOrder, MemberOrderKind, MemberOrderType, MemberOrderPaymentStatus, MemberOrderFulfillmentStatus } from '../../../functions/src/data-model/orders';
import { initSchool, School } from '../../../functions/src/data-model/schools';
import { ManagedSchoolBillingInfo } from '../../../functions/src/stripe-types';

describe('MemberOrdersComponent', () => {
  let fixture: ComponentFixture<MemberOrdersComponent>;
  let component: MemberOrdersComponent;

  let mockFirebaseStateService: {
    user: ReturnType<typeof signal<UserDetails | null>>;
  };

  let mockDataManagerService: {
    myOrders: {
      entries: ReturnType<typeof signal<MemberOrder[]>>;
    };
    myGradings: {
      entries: ReturnType<typeof signal<Grading[]>>;
    };
    schools: {
      entries: ReturnType<typeof signal<School[]>>;
    };
  };

  let mockStripeService: {
    cancelSubscriptionRenewal: ReturnType<typeof vi.fn>;
    resumeSubscriptionRenewal: ReturnType<typeof vi.fn>;
    updateSubscriptionRenewalDate: ReturnType<typeof vi.fn>;
    createSubscriptionPaymentMethodSession: ReturnType<typeof vi.fn>;
    createCustomerPortalSession: ReturnType<typeof vi.fn>;
    getManagedSchoolsBilling: ReturnType<typeof vi.fn>;
  };

  let mockRoutingService: {
    hrefForView: ReturnType<typeof vi.fn>;
    view: ReturnType<typeof vi.fn>;
  };

  const sampleMember: Member = {
    ...initMember(),
    docId: 'mem-123',
    memberId: 'US123',
    name: 'Bruce Lee',
    emails: ['bruce@example.com'],
    currentMembershipExpires: '2027-05-15',
    membershipSubscriptionId: 'sub_mem_123',
    membershipNextAutoRenewDate: '2027-05-15',
    instructorId: 'INS-01',
    instructorLicenseExpires: '2027-05-15',
    instructorLicenseSubscriptionId: 'sub_ins_123',
    instructorLicenseNextAutoRenewDate: '',
    classVideoLibrarySubscription: true,
    classVideoLibraryExpirationDate: '2027-06-01',
    classVideoLibrarySubscriptionId: 'sub_vid_123',
    classVideoLibraryNextAutoRenewDate: '2027-06-01',
    stripeSubscriptions: {
      sub_mem_123: {
        subscriptionId: 'sub_mem_123',
        type: SubscriptionItemType.Membership,
        status: SubscriptionStatus.Active,
        planName: 'Annual Membership',
        amount: 8500,
        currency: 'usd',
        interval: SubscriptionInterval.Year,
        currentPeriodStart: '2026-05-15',
        currentPeriodEnd: '2027-05-15',
        nextAutoRenewDate: '2027-05-15',
        cancelAtPeriodEnd: false,
        paymentMethodBrand: 'visa',
        paymentMethodLast4: '4242',
      },
      sub_ins_123: {
        subscriptionId: 'sub_ins_123',
        type: SubscriptionItemType.InstructorLicense,
        status: SubscriptionStatus.Active,
        planName: 'Instructor License',
        amount: 15000,
        currency: 'usd',
        interval: SubscriptionInterval.Year,
        currentPeriodStart: '2026-05-15',
        currentPeriodEnd: '2027-05-15',
        nextAutoRenewDate: '',
        cancelAtPeriodEnd: true,
        paymentMethodBrand: 'visa',
        paymentMethodLast4: '4242',
      },
      sub_vid_123: {
        subscriptionId: 'sub_vid_123',
        type: SubscriptionItemType.VideoLibrary,
        status: SubscriptionStatus.Active,
        planName: 'Class Video Library',
        amount: 1500,
        currency: 'usd',
        interval: SubscriptionInterval.Month,
        currentPeriodStart: '2027-05-01',
        currentPeriodEnd: '2027-06-01',
        nextAutoRenewDate: '2027-06-01',
        cancelAtPeriodEnd: false,
        paymentMethodBrand: 'visa',
        paymentMethodLast4: '4242',
      },
    },
  };

  const sampleOrders: MemberOrder[] = [
    {
      ...initMemberOrder(),
      docId: 'order-1',
      orderDocId: 'order-1',
      memberDocId: 'mem-123',
      memberId: 'US123',
      orderKind: MemberOrderKind.Stripe,
      orderType: MemberOrderType.Checkout,
      orderNumber: 'in_1001',
      date: '2026-05-15',
      amountTotal: 8500,
      currency: 'usd',
      paymentStatus: MemberOrderPaymentStatus.Paid,
      fulfillmentStatus: MemberOrderFulfillmentStatus.Fulfilled,
      description: 'Annual Membership',
      lineItems: [
        {
          productId: 'prod_1',
          priceId: 'price_1',
          description: 'Annual Membership',
          quantity: 1,
          amountTotal: 8500,
          currency: 'usd',
        },
      ],
    },
    {
      ...initMemberOrder(),
      docId: 'order-2',
      orderDocId: 'order-2',
      memberDocId: 'mem-123',
      memberId: 'US123',
      orderKind: MemberOrderKind.Stripe,
      orderType: MemberOrderType.Renewal,
      orderNumber: 'in_1002',
      date: '2026-06-01',
      amountTotal: 1500,
      currency: 'usd',
      paymentStatus: MemberOrderPaymentStatus.Paid,
      fulfillmentStatus: MemberOrderFulfillmentStatus.Fulfilled,
      description: 'Class Video Library',
      lineItems: [],
    },
  ];

  const sampleGrading: Grading = {
    ...initGrading(),
    docId: 'grading-doc-Ab12',
    orderId: 'order-2',
    level: 'Student 3',
    status: GradingStatus.AwaitingRequest,
    gradingEventDate: '2026-06-01',
  };

  beforeEach(() => {
    mockFirebaseStateService = {
      user: signal<UserDetails | null>({
        member: { ...sampleMember },
        memberProfiles: [{ ...sampleMember }],
        isAdmin: false,
        schoolsManaged: [],
        firebaseUser: { uid: 'mem-123' } as never,
      }),
    };

    mockDataManagerService = {
      myOrders: {
        entries: signal<MemberOrder[]>(sampleOrders),
      },
      // The second order paid for a grading; fulfillment sets the grading's
      // orderId to the order's document id.
      myGradings: {
        entries: signal<Grading[]>([sampleGrading]),
      },
      schools: {
        entries: signal<School[]>([]),
      },
    };

    mockStripeService = {
      cancelSubscriptionRenewal: vi.fn().mockResolvedValue({ success: true, periodEnd: '2027-05-15' }),
      resumeSubscriptionRenewal: vi.fn().mockResolvedValue({ success: true, nextAutoRenewDate: '2027-05-15' }),
      updateSubscriptionRenewalDate: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_mem_123',
        status: 'trialing',
        cancelAtPeriodEnd: false,
        nextAutoRenewDate: '2027-05-08',
      }),
      createSubscriptionPaymentMethodSession: vi.fn().mockResolvedValue({
        url: 'https://checkout.stripe.com/c/pay/cs_setup_test',
      }),
      createCustomerPortalSession: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test' }),
      getManagedSchoolsBilling: vi.fn().mockResolvedValue({ schools: {} }),
    };

    mockRoutingService = {
      hrefForView: vi.fn().mockReturnValue('/mock-path'),
      view: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [MemberOrdersComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: StripeService, useValue: mockStripeService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    });

    fixture = TestBed.createComponent(MemberOrdersComponent);
    component = fixture.componentInstance;
  });

  it('creates component and derives subscription cards correctly', () => {
    expect(component).toBeTruthy();
    const subs = component.subscriptions();
    expect(subs.length).toBe(3);

    // Membership
    const mem = subs.find((s) => s.category === 'membership');
    expect(mem).toBeDefined();
    expect(mem?.isAutoRenewing).toBe(true);
    expect(mem?.nextAutoRenewDate).toBe('2027-05-15');
    expect(mem?.canCancel).toBe(true);

    // Instructor License
    const ins = subs.find((s) => s.category === 'instructor_license');
    expect(ins).toBeDefined();
    expect(ins?.isAutoRenewing).toBe(false);
    expect(ins?.canResume).toBe(true);

    // Video Library
    const vid = subs.find((s) => s.category === 'video_library');
    expect(vid).toBeDefined();
    expect(vid?.isAutoRenewing).toBe(true);
  });

  it('filters orders by search query correctly', () => {
    expect(component.orders().length).toBe(2);

    component.searchQuery.set('Annual');
    expect(component.orders().length).toBe(1);
    expect(component.orders()[0].description).toBe('Annual Membership');

    component.searchQuery.set('Video');
    expect(component.orders().length).toBe(1);
    expect(component.orders()[0].description).toBe('Class Video Library');

    component.searchQuery.set('non-existent');
    expect(component.orders().length).toBe(0);
  });

  it('cancels auto-renewal via inline confirmation on subscription card without window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const memCard = element.querySelector('.sub-card.membership')!;
    const cancelBtn = memCard.querySelector<HTMLButtonElement>('.sub-card-actions .cancel-btn')!;
    cancelBtn.click();
    fixture.detectChanges();

    expect(confirmSpy).not.toHaveBeenCalled();
    const confirmDangerBtn = memCard.querySelector<HTMLButtonElement>('.confirm-danger-btn')!;
    expect(confirmDangerBtn).toBeTruthy();

    confirmDangerBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockStripeService.cancelSubscriptionRenewal).toHaveBeenCalledWith('sub_mem_123');
    expect(memCard.textContent).toContain(
      'Auto-renewal cancelled. Your access remains active until 2027-05-15.',
    );
  });

  it('resumes auto-renewal on subscription card and sets feedback banner', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const insCard = element.querySelector('.sub-card.instructor_license')!;
    const resumeBtn = insCard.querySelector<HTMLButtonElement>('.resume-btn')!;
    resumeBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockStripeService.resumeSubscriptionRenewal).toHaveBeenCalledWith('sub_ins_123');
    expect(insCard.textContent).toContain('Auto-renewal resumed');
  });

  it('opens customer portal session', async () => {
    await component.onOpenCustomerPortal();
    expect(mockStripeService.createCustomerPortalSession).toHaveBeenCalled();
  });

  it('renders section headers for Purchase, Membership, Licenses, and Subscriptions, and Order History', async () => {
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const headings = Array.from(element.querySelectorAll('h2')).map((h) => h.textContent?.trim());
    expect(headings).toContain('Learn about or purchase');
    expect(headings).toContain('My Membership, Licenses, and Subscriptions');
    expect(headings).toContain('Order History');
  });

  it('renders clean quick link cards and displays lifetime access status on subscription cards', async () => {
    mockFirebaseStateService.user.set({
      member: {
        ...sampleMember,
        membershipType: MembershipType.Life,
        instructorLicenseType: 'Life' as any,
        instructorLicenseExpires: '9999-12-31',
      },
      memberProfiles: [{ ...sampleMember }],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: { uid: 'mem-123' } as never,
    });

    await fixture.whenStable();
    expect(component.isLifeMember()).toBe(true);
    expect(component.isLifeInstructor()).toBe(true);

    const element = fixture.nativeElement as HTMLElement;
    const allCards = element.querySelectorAll('a.service-link-card');
    expect(allCards.length).toBe(5);

    // Quick links have no active-badge lifetime chips
    expect(element.querySelector('.service-link-card .active-badge')).toBeNull();

    // Subscription cards derive lifetime access and omit Next auto-renewal payment row
    fixture.detectChanges();
    const subs = component.subscriptions();
    const memSub = subs.find((s) => s.category === 'membership');
    expect(memSub?.status).toBe('lifetime');
    expect(memSub?.statusLabel).toBe('Lifetime Access');

    const memCardEl = element.querySelector('.sub-card.membership');
    expect(memCardEl?.textContent).toContain('Lifetime Access');
    expect(memCardEl?.textContent).not.toContain('Next auto-renewal payment:');
  });

  it('sets group leader title and subtitle when member is Student Level 2 or 3 without Application Level 1', async () => {
    mockFirebaseStateService.user.set({
      member: {
        ...sampleMember,
        instructorId: '',
        studentLevel: 'Student Level 2' as any,
        applicationLevel: '' as any,
        instructorLicenseSubscriptionId: 'sub_gl_123',
        instructorLicenseExpires: '2027-05-15',
      },
      memberProfiles: [{ ...sampleMember }],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: { uid: 'mem-123' } as never,
    });

    await fixture.whenStable();
    expect(component.isGroupLeaderTier()).toBe(true);
    expect(component.isInstructorTier()).toBe(false);
    expect(component.licenseCardSubtitle()).toContain('group leader license');

    const subs = component.subscriptions();
    const licSub = subs.find((s) => s.category === 'instructor_license');
    expect(licSub?.title).toBe('Group Leader License');
  });

  it('sets instructor title and subtitle when member has Application Level 1 or Instructor ID', async () => {
    mockFirebaseStateService.user.set({
      member: {
        ...sampleMember,
        instructorId: 'INS-01',
        studentLevel: 'Student Level 6' as any,
        applicationLevel: 'Application Level 1' as any,
      },
      memberProfiles: [{ ...sampleMember }],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: { uid: 'mem-123' } as never,
    });

    await fixture.whenStable();
    expect(component.isInstructorTier()).toBe(true);
    expect(component.isGroupLeaderTier()).toBe(false);
    expect(component.licenseCardSubtitle()).toContain('certified instructor teaching license');

    const subs = component.subscriptions();
    const licSub = subs.find((s) => s.category === 'instructor_license');
    expect(licSub?.title).toBe('Instructor License');
  });

  it('calculates order quantity correctly', () => {
    expect(component.getOrderQuantity(sampleOrders[0])).toBe(1);
    expect(component.getOrderQuantity(sampleOrders[1])).toBe(1);

    const multiItemOrder: MemberOrder = {
      ...sampleOrders[0],
      lineItems: [
        { productId: 'p1', priceId: 'pr1', description: 'Item 1', quantity: 2, amountTotal: 2000, currency: 'usd' },
        { productId: 'p2', priceId: 'pr2', description: 'Item 2', quantity: 3, amountTotal: 3000, currency: 'usd' },
      ],
    };
    expect(component.getOrderQuantity(multiItemOrder)).toBe(5);
  });

  it('renders simplified order cards without sub-table or checkout chip', async () => {
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    // Verify no sub-table exists
    expect(element.querySelector('.order-details-pane')).toBeNull();
    expect(element.querySelector('.line-items-table')).toBeNull();

    // Verify order cards are rendered
    const orderCards = element.querySelectorAll('.order-card');
    expect(orderCards.length).toBe(2);

    // Card 1: Checkout order -> has Qty: 1, Paid badge, but NO checkout badge
    const card1Text = orderCards[0].textContent || '';
    expect(card1Text).toContain('Annual Membership');
    expect(card1Text).toContain('Qty: 1');
    expect(card1Text).toContain('paid');
    expect(card1Text).not.toContain('checkout');

    // Card 2: Renewal order -> has Qty: 1, Paid badge, and Renewal badge
    const card2Text = orderCards[1].textContent || '';
    expect(card2Text).toContain('Class Video Library');
    expect(card2Text).toContain('Qty: 1');
    expect(card2Text).toContain('renewal');
    expect(card2Text).toContain('paid');
  });

  it('derives display order ID and preserves full ID in DOM for selection', async () => {
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const orderIdElements = element.querySelectorAll('.order-id-text');
    expect(orderIdElements.length).toBe(2);
    // Verifies full raw IDs are in DOM nodes (enabling click-to-select-all)
    expect(orderIdElements[0].textContent).toBe(sampleOrders[0].orderNumber);
    expect(orderIdElements[1].textContent).toBe(sampleOrders[1].orderNumber);

    // Tests getOrderDisplayId logic
    expect(component.getOrderDisplayId(sampleOrders[0])).toBe(sampleOrders[0].orderNumber);
    const invoiceOrder: MemberOrder = {
      ...sampleOrders[0],
      orderNumber: 'cs_live_123',
      stripeInvoiceId: 'in_9999',
    };
    expect(component.getOrderDisplayId(invoiceOrder)).toBe('in_9999');
  });

  it('shows an order reference alongside the full reference', async () => {
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const shown = element.querySelectorAll('.order-number');
    // Every order has one, whatever it bought.
    expect(shown.length).toBe(2);
    expect(shown[0].textContent?.trim()).toBe(
      'Order Ref #' + component.getOrderNumber(sampleOrders[0]),
    );
    // Date of the order, then four digits.
    expect(component.getOrderNumber(sampleOrders[0])).toMatch(/^\d{8}-\d{4}$/);

    // The full Stripe reference is still in the DOM for click-to-select.
    expect(element.querySelectorAll('.order-id-text').length).toBe(2);
  });

  it('matches the order number the server stamps onto a grading', async () => {
    const order = sampleOrders[0];
    expect(component.getOrderNumber(order)).toBe(
      orderDisplayNumber(order.created || order.date, order.orderNumber || ''),
    );
  });

  it('finds an order by its short order number', async () => {
    const number = component.getOrderNumber(sampleOrders[0]);
    component.searchQuery.set(number);
    await fixture.whenStable();
    expect(component.orders().length).toBe(1);
    expect(component.orders()[0].docId).toBe(sampleOrders[0].docId);
  });

  it('shows both references on the order that paid for a grading', async () => {
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const refs = element.querySelectorAll('.grading-id');
    // Only the grading order carries a grading reference...
    expect(refs.length).toBe(1);
    expect(refs[0].textContent?.trim()).toBe('Grading Ref #202606-Ab12');

    // ...and it carries an order reference as well.
    const gradingCard = refs[0].closest('.col-date');
    expect(gradingCard?.querySelector('.order-number')?.textContent).toContain(
      'Order Ref #',
    );

    expect(component.getGradingId(sampleOrders[1])).toBe('202606-Ab12');
    expect(component.getGradingId(sampleOrders[0])).toBe('');
  });

  it('shows the same reference the grading page derives', async () => {
    expect(component.getGradingId(sampleOrders[1])).toBe(
      gradingDisplayId(sampleGrading),
    );
  });

  it('asks for the grading event date when the grading has no reference yet', async () => {
    mockDataManagerService.myGradings.entries.set([
      { ...sampleGrading, gradingEventDate: '' },
    ]);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const ref = element.querySelector('.grading-id');
    expect(ref?.textContent).toContain('Please set the grading event date');
    expect(ref?.classList.contains('needs-date')).toBe(true);
  });

  it('finds an order by the grading reference it paid for', async () => {
    component.searchQuery.set('202606-Ab12');
    await fixture.whenStable();
    expect(component.orders().length).toBe(1);
    expect(component.orders()[0].docId).toBe('order-2');
  });

  it('copies order ID to clipboard and sets copiedOrderId state', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    await component.copyOrderId('cs_live_123');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('cs_live_123');
    expect(component.copiedOrderId()).toBe('cs_live_123');
  });

  it('should use standard primary-button for portal action and replace button with spinner when loading', async () => {
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const portalBtn = element.querySelector('.portal-btn');
    expect(portalBtn).toBeTruthy();
    expect(portalBtn?.classList.contains('primary-button')).toBe(true);

    // Verify when portalLoading is true, spinner replaces button and no button contains app-spinner
    component.portalLoading.set(true);
    await fixture.whenStable();

    const spinnerInButton = element.querySelector('button app-spinner');
    expect(spinnerInButton).toBeNull();

    const standaloneSpinner = element.querySelector('.portal-action app-spinner');
    expect(standaloneSpinner).toBeTruthy();
    expect(standaloneSpinner?.textContent).toContain('Redirecting to Stripe...');
  });

  it('should use standard primary-button for renew links', async () => {
    mockFirebaseStateService.user.set({
      member: {
        ...sampleMember,
        currentMembershipExpires: '2020-01-01',
        membershipSubscriptionId: '',
      },
      memberProfiles: [{ ...sampleMember }],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: { uid: 'mem-123' } as never,
    });
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const renewLink = element.querySelector('a.primary-button');
    expect(renewLink).toBeTruthy();
    expect(renewLink?.textContent).toContain('Renew Now');
  });

  it('displays Next auto-renewal payment with YYYY-MM-DD ($XX.XX USD) and keeps advance expiration separate', async () => {
    mockFirebaseStateService.user.set({
      member: {
        ...sampleMember,
        classVideoLibrarySubscription: true,
        classVideoLibraryExpirationDate: '2028-03-23',
        classVideoLibrarySubscriptionId: 'sub_vid_123',
        classVideoLibraryNextAutoRenewDate: '2026-11-23',
        stripeSubscriptions: {
          sub_vid_123: {
            subscriptionId: 'sub_vid_123',
            type: SubscriptionItemType.VideoLibrary,
            status: SubscriptionStatus.Active,
            planName: 'Class Video Library',
            amount: 2500,
            currency: 'usd',
            interval: SubscriptionInterval.Month,
            currentPeriodStart: '2026-10-23',
            currentPeriodEnd: '2026-11-23',
            nextAutoRenewDate: '2026-11-23',
            cancelAtPeriodEnd: false,
          },
        },
      },
      memberProfiles: [{ ...sampleMember }],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: { uid: 'mem-123' } as never,
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const vid = component.subscriptions().find((s) => s.category === 'video_library');
    expect(vid?.expirationDate).toBe('2028-03-23');
    expect(vid?.nextAutoRenewDate).toBe('2026-11-23');
    expect(vid?.autoRenewalPaymentText).toBe('2026-11-23 ($25.00 USD)');
    expect(vid?.projectedExpirationDate).toBe('2028-04-23');

    const element = fixture.nativeElement as HTMLElement;
    const vidCard = element.querySelector('.sub-card.video_library');
    expect(vidCard?.textContent).toContain('Valid through 2028-03-23');
    expect(vidCard?.textContent).toContain('Next auto-renewal payment:');
    expect(vidCard?.textContent).toContain('2026-11-23 ($25.00 USD)');
    expect(vidCard?.textContent).toContain(
      'You will pay $25.00 USD and the expiration date will be extended to 2028-04-23.',
    );
  });

  it('separates payer school licenses into main grid and non-payer managed schools into subsection below', async () => {
    const ownPaidSchool: School = {
      ...initSchool(),
      docId: 'school-own-doc',
      schoolId: 'SCH-OWN-1',
      schoolName: 'Seattle ILC Academy',
      ownerMemberDocId: 'mem-123',
      ownerInstructorId: 'INS-01',
      schoolLicenseExpires: '2027-08-01',
    };
    const otherPaidSchool: School = {
      ...initSchool(),
      docId: 'school-other-doc',
      schoolId: 'SCH-OTHER-2',
      schoolName: 'Portland ILC Branch',
      ownerInstructorId: 'INS-99',
      managerInstructorIds: ['INS-01'],
      schoolLicenseExpires: '2027-09-15',
    };

    const billingResponse: Record<string, ManagedSchoolBillingInfo> = {
      'school-own-doc': {
        schoolDocId: 'school-own-doc',
        schoolId: 'SCH-OWN-1',
        payerMemberDocId: 'mem-123',
        payerMemberId: 'US123',
        payerName: 'Bruce Lee',
        isAutoRenewing: true,
        nextAutoRenewDate: '2027-08-01',
        amount: 60000,
        currency: 'usd',
        lastPaymentDate: '2026-08-01',
      },
      'school-other-doc': {
        schoolDocId: 'school-other-doc',
        schoolId: 'SCH-OTHER-2',
        payerMemberDocId: 'mem-999',
        payerMemberId: 'US999',
        payerName: 'Sifu Alice',
        isAutoRenewing: true,
        nextAutoRenewDate: '2027-09-15',
        amount: 60000,
        currency: 'usd',
        lastPaymentDate: '2026-09-15',
      },
    };
    mockStripeService.getManagedSchoolsBilling.mockResolvedValue({
      schools: billingResponse,
    });
    mockDataManagerService.schools.entries.set([ownPaidSchool, otherPaidSchool]);

    mockFirebaseStateService.user.set({
      member: {
        ...sampleMember,
        stripeSubscriptions: {
          sub_sch_own: {
            subscriptionId: 'sub_sch_own',
            type: SubscriptionItemType.SchoolLicense,
            status: SubscriptionStatus.Active,
            planName: 'School License Yearly',
            amount: 60000,
            currency: 'usd',
            interval: SubscriptionInterval.Year,
            currentPeriodStart: '2026-08-01',
            currentPeriodEnd: '2027-08-01',
            nextAutoRenewDate: '2027-08-01',
            cancelAtPeriodEnd: false,
            schoolDocId: 'school-own-doc',
            schoolId: 'SCH-OWN-1',
            schoolName: 'Seattle ILC Academy',
          },
        },
      },
      memberProfiles: [{ ...sampleMember }],
      isAdmin: false,
      schoolsManaged: ['school-own-doc', 'school-other-doc'],
      firebaseUser: { uid: 'mem-123' } as never,
    });

    await fixture.whenStable();
    await component.loadManagedSchoolsBilling();
    fixture.detectChanges();

    const mainSchools = component
      .subscriptions()
      .filter((s) => s.category === 'school_license');
    expect(mainSchools.length).toBe(1);
    expect(mainSchools[0].title).toBe('School License: Seattle ILC Academy');
    expect(mainSchools[0].payerLabel).toBe('You (Bruce Lee)');
    expect(mainSchools[0].autoRenewalPaymentText).toBe('2027-08-01 ($600.00 USD)');
    expect(mainSchools[0].projectedExpirationDate).toBe('2028-08-01');
    expect(mainSchools[0].canCancel).toBe(true);

    const otherSchools = component.otherPayerSchoolSubscriptions();
    expect(otherSchools.length).toBe(1);
    expect(otherSchools[0].title).toBe('School License: Portland ILC Branch');
    expect(otherSchools[0].payerLabel).toBe('Sifu Alice (US999)');
    expect(otherSchools[0].autoRenewalPaymentText).toBe('2027-09-15 ($600.00 USD)');
    expect(otherSchools[0].projectedExpirationDate).toBe('2028-09-15');
    expect(otherSchools[0].canCancel).toBe(false);
    expect(otherSchools[0].canResume).toBe(false);

    const element = fixture.nativeElement as HTMLElement;
    const subSection = element.querySelector('.managed-schools-subsection');
    expect(subSection).toBeTruthy();
    expect(subSection?.textContent).toContain('Other Schools You Own or Manage');
    expect(subSection?.textContent).toContain('Sifu Alice (US999)');
    expect(subSection?.textContent).toContain('2027-09-15 ($600.00 USD)');
    expect(subSection?.textContent).toContain(
      'You will pay $600.00 USD and the expiration date will be extended to 2028-09-15.',
    );
  });

  it('omits the projected expiration extension note when auto-renewal is off', async () => {
    mockFirebaseStateService.user.set({
      member: {
        ...sampleMember,
        currentMembershipExpires: '2027-05-01',
        membershipSubscriptionId: 'sub-mem-1',
        membershipNextAutoRenewDate: '',
      },
      memberProfiles: [{ ...sampleMember }],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: { uid: 'mem-123' } as never,
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const memCard = element.querySelector('.sub-card.membership');
    expect(memCard?.querySelector('.renewal-extension-note')).toBeNull();
  });
});

