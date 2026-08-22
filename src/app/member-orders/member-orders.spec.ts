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
import { initMember, initMemberOrder, Member, MemberOrder, MemberOrderKind, MemberOrderType, MemberOrderPaymentStatus, MemberOrderFulfillmentStatus, MembershipType, Grading, GradingStatus, initGrading, gradingDisplayId, orderDisplayNumber } from '../../../functions/src/data-model';

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
  };

  let mockStripeService: {
    cancelSubscriptionRenewal: ReturnType<typeof vi.fn>;
    resumeSubscriptionRenewal: ReturnType<typeof vi.fn>;
    createCustomerPortalSession: ReturnType<typeof vi.fn>;
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
    };

    mockStripeService = {
      cancelSubscriptionRenewal: vi.fn().mockResolvedValue({ success: true, periodEnd: '2027-05-15' }),
      resumeSubscriptionRenewal: vi.fn().mockResolvedValue({ success: true, nextAutoRenewDate: '2027-05-15' }),
      createCustomerPortalSession: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test' }),
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

  it('cancels auto-renewal on user confirmation and sets banner message', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await component.onCancelAutoRenew('sub_mem_123');

    expect(mockStripeService.cancelSubscriptionRenewal).toHaveBeenCalledWith('sub_mem_123');
    expect(component.actionMessage()).toContain('Auto-renewal has been cancelled');
  });

  it('resumes auto-renewal and sets banner message', async () => {
    await component.onResumeAutoRenew('sub_ins_123');

    expect(mockStripeService.resumeSubscriptionRenewal).toHaveBeenCalledWith('sub_ins_123');
    expect(component.actionMessage()).toContain('Auto-renewal has been resumed');
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

    // Subscription cards derive lifetime access
    const subs = component.subscriptions();
    const memSub = subs.find((s) => s.category === 'membership');
    expect(memSub?.status).toBe('lifetime');
    expect(memSub?.statusLabel).toBe('Lifetime Access');
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

  it('shows a short order number alongside the full reference', async () => {
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const shown = element.querySelectorAll('.order-number');
    expect(shown.length).toBe(2);
    expect(shown[0].textContent?.trim()).toBe(
      '#' + component.getOrderNumber(sampleOrders[0]),
    );
    // Year and month of the order, then four digits.
    expect(component.getOrderNumber(sampleOrders[0])).toMatch(/^\d{6}-\d{4}$/);

    // The full reference is still in the DOM for click-to-select.
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

  it('shows the grading reference on the order that paid for a grading', async () => {
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const refs = element.querySelectorAll('.grading-id');
    // Only the grading order carries one.
    expect(refs.length).toBe(1);
    expect(refs[0].textContent?.trim()).toBe('Ref #202606-Ab12');

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
});
