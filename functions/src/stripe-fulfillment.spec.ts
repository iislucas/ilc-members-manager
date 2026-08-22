import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import {
  initMember,
  initMemberOrder,
  MembershipType,
  OrderKind,
  MemberOrderKind,
  MemberOrderPaymentStatus,
  StripeOrder,
  StripeOrderType,
  StripeCheckoutMode,
  StripePaymentStatus,
  StudentLevel,
  ApplicationLevel,
  GradingStatus,
  PaymentStatus,
  OrderStatus,
  NotificationKind,
  orderDisplayNumber,
} from './data-model';
import {
  fulfillStripeOrder,
  fulfillSpouseLifeMembership,
  mirrorOrderToMemberSubcollection,
  resolveMemberForStripeOrder,
  extendDateByYears,
  extendDateByMonths,
  syncSubscriptionStatusToMember,
} from './stripe-fulfillment';

import { environment } from './environment/environment';

describe('stripe-fulfillment', () => {
  // The contact address members are pointed at when a purchase needs a human.
  const supportEmail = environment.email?.from || 'web-helper-team@iliqchuan.com';
  let mockDb: any;
  let mockMemberRef: any;
  let mockOrdersCollection: any;
  let mockGradingsCollection: any;
  let mockOrderDocSet: any;
  let mockNotificationSet: any;

  const sampleMember = {
    ...initMember(),
    docId: 'mem_123',
    memberId: 'US123',
    emails: ['sam@example.com'],
    currentMembershipExpires: '2028-05-15',
    membershipSubscriptionId: '',
    membershipNextAutoRenewDate: '',
    instructorLicenseExpires: '2028-05-15',
    instructorLicenseSubscriptionId: '',
    instructorLicenseNextAutoRenewDate: '',
    classVideoLibraryExpirationDate: '',
    classVideoLibrarySubscriptionId: '',
    classVideoLibraryNextAutoRenewDate: '',
  };

  beforeEach(() => {
    mockNotificationSet = vi.fn().mockResolvedValue({});
    mockMemberRef = {
      update: vi.fn().mockResolvedValue({}),
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          id: 'mock_doc_id',
          set: mockNotificationSet,
        }),
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        }),
      }),
    };

    mockOrderDocSet = vi.fn().mockResolvedValue({});
    mockOrdersCollection = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      add: vi.fn().mockResolvedValue({ id: 'new_order_id' }),
      doc: vi.fn().mockReturnValue({ set: mockOrderDocSet }),
    };

    mockGradingsCollection = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      add: vi.fn().mockResolvedValue({ id: 'new_grading_doc_id' }),
    };

    const mockCountersGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        memberIdCounters: { US: 100, FR: 200 },
        instructorIdCounter: 100,
        schoolIdCounter: 100,
      }),
    });

    const mockCountersSet = vi.fn().mockResolvedValue({});

    mockDb = {
      runTransaction: vi.fn().mockImplementation(async (fn) => {
        return fn({
          get: vi.fn().mockImplementation(async () => mockCountersGet()),
          set: mockCountersSet,
        });
      }),
      doc: vi.fn().mockImplementation((path: string) => {
        if (path === 'system/counters') {
          return {
            get: mockCountersGet,
            set: mockCountersSet,
          };
        }
        return {
          id: path,
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn().mockResolvedValue({}),
        };
      }),
      collection: vi.fn((colName: string) => {
        if (colName === 'members') {
          return {
            doc: vi.fn().mockReturnValue(mockMemberRef),
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [{ id: 'mem_123', data: () => ({ ...sampleMember }) }],
                }),
              }),
            }),
          };
        }
        if (colName === 'gradings') return mockGradingsCollection;
        if (colName === 'orders') return mockOrdersCollection;
        if (colName === 'acl') {
          return {
            doc: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ memberDocIds: ['mem_123'] }),
              }),
            }),
          };
        }
        return {};
      }),
    };
  });

  it('resolves member from order metadata or customer email', async () => {
    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_123',
      created: '2026-05-15T00:00:00Z',
      amountTotal: 8500,
      currency: 'usd',
      metadata: { memberDocId: 'mem_123' },
      lineItems: [],
    };

    mockMemberRef.get = vi.fn().mockResolvedValue({
      exists: true,
      id: 'mem_123',
      data: () => ({ ...sampleMember }),
    });

    const member = await resolveMemberForStripeOrder(mockDb, order);
    expect(member).toBeDefined();
    expect(member?.docId).toBe('mem_123');
  });

  it('mirrors order into /members/{memberDocId}/orders/{orderDocId} subcollection', async () => {
    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_123',
      created: '2026-05-15T00:00:00Z',
      amountTotal: 8500,
      currency: 'usd',
      paymentStatus: StripePaymentStatus.Paid,
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
    };

    const memberSubDocSet = vi.fn().mockResolvedValue({});
    mockMemberRef.collection = vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({ set: memberSubDocSet }),
    });

    await mirrorOrderToMemberSubcollection(
      mockDb,
      sampleMember,
      order,
      'order_doc_123',
    );

    expect(mockMemberRef.collection).toHaveBeenCalledWith('orders');
    expect(memberSubDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'order_doc_123',
        orderDocId: 'order_doc_123',
        memberDocId: 'mem_123',
        amountTotal: 8500,
        currency: 'usd',
        paymentStatus: MemberOrderPaymentStatus.Paid,
      }),
      { merge: true },
    );
  });

  it('fulfills membership subscription and sets auto-renew date on member doc', async () => {
    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_123',
      subscriptionId: 'sub_mem_999',
      mode: StripeCheckoutMode.Subscription,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 8500,
      currency: 'usd',
      lineItems: [
        {
          productId: 'prod_mem',
          priceId: 'price_mem',
          description: 'Annual Membership',
          quantity: 1,
          amountTotal: 8500,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, sampleMember, order, 'order_doc_123');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipType: MembershipType.Annual,
        membershipSubscriptionId: 'sub_mem_999',
        membershipNextAutoRenewDate: '2029-05-15',
        currentMembershipExpires: '2029-05-15',
      }),
    );
  });

  // A member at Student 1: their next owed level is Student 2.
  const gradingMember = {
    ...sampleMember,
    studentLevel: StudentLevel.Level1,
    applicationLevel: ApplicationLevel.None,
  };

  it('auto-provisions a grading document when a member purchases a grading', async () => {
    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_123',
      created: '2026-05-15T00:00:00Z',
      amountTotal: 5000,
      currency: 'usd',
      lineItems: [
        {
          productId: 'prod_grading',
          priceId: 'price_grading',
          description: 'Grading - Student Level 2',
          quantity: 1,
          amountTotal: 5000,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, gradingMember, order, 'order_doc_123');

    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        studentMemberDocId: 'mem_123',
        studentMemberId: 'US123',
        orderId: 'order_doc_123',
        level: 'Student 2',
      }),
    );
    // Receipt and progression agree, so nobody is alerted.
    expect(mockOrderDocSet).not.toHaveBeenCalled();
    expect(mockNotificationSet).not.toHaveBeenCalled();
  });

  // Builds a gradings collection mock: the orderId de-duplication query finds
  // nothing, and the per-member query returns `docs`.
  function mockMemberGradings(
    docs: Array<{ id: string; update: any; data: Record<string, unknown> }>,
  ): void {
    mockGradingsCollection.where = vi.fn((field: string) => {
      if (field === 'studentMemberDocId') {
        return {
          get: vi.fn().mockResolvedValue({
            empty: docs.length === 0,
            docs: docs.map((d) => ({
              id: d.id,
              ref: { update: d.update },
              data: () => d.data,
            })),
          }),
        };
      }
      return {
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        }),
      };
    });
  }

  function gradingOrder(description: string, stripeObjectId: string): StripeOrder {
    return {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 5000,
      currency: 'usd',
      lineItems: [
        {
          productId: 'prod_grading',
          priceId: 'price_grading',
          description,
          quantity: 1,
          amountTotal: 8000,
          currency: 'usd',
        },
      ],
    };
  }

  it('settles an existing unpaid grading instead of creating a duplicate', async () => {
    const unpaidUpdate = vi.fn().mockResolvedValue({});
    mockMemberGradings([
      {
        id: 'existing_unpaid_grading',
        update: unpaidUpdate,
        data: {
          level: 'Student 2',
          status: GradingStatus.AwaitingRequest,
          paymentStatus: PaymentStatus.NotYetPaid,
        },
      },
    ]);

    await fulfillStripeOrder(
      mockDb,
      gradingMember,
      gradingOrder('GRADING : Student Level 2', 'cs_124'),
      'order_doc_124',
    );

    expect(mockGradingsCollection.add).not.toHaveBeenCalled();
    expect(unpaidUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order_doc_124',
        paymentStatus: PaymentStatus.PaidByStripe,
      }),
    );
    // Receipt and progression agree, so nobody is alerted.
    expect(mockOrderDocSet).not.toHaveBeenCalled();
    expect(mockNotificationSet).not.toHaveBeenCalled();
  });

  it('does not step over an out-of-order unpaid grading at a later level', async () => {
    // Application 1 comes after Student 2, and Student 2 is what is owed next.
    const laterUpdate = vi.fn().mockResolvedValue({});
    mockMemberGradings([
      {
        id: 'unpaid_later_level',
        update: laterUpdate,
        data: {
          level: 'Application 1',
          status: GradingStatus.AwaitingRequest,
          paymentStatus: PaymentStatus.NotYetPaid,
        },
      },
    ]);

    await fulfillStripeOrder(
      mockDb,
      gradingMember,
      gradingOrder('GRADING : Student Level 2', 'cs_125'),
      'order_doc_125',
    );

    expect(laterUpdate).not.toHaveBeenCalled();
    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'Student 2', orderId: 'order_doc_125' }),
    );
    expect(mockNotificationSet).not.toHaveBeenCalled();
  });

  it('creates the grading when a student buys a level above their current one', async () => {
    // Member is at Student 1 and buys Student 4. Booking ahead is allowed and
    // raises nothing.
    mockMemberGradings([]);

    await fulfillStripeOrder(
      mockDb,
      gradingMember,
      gradingOrder('GRADING : Student Level 4', 'cs_126'),
      'order_doc_126',
    );

    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'Student 4',
        status: GradingStatus.AwaitingRequest,
        paymentStatus: PaymentStatus.PaidByStripe,
      }),
    );
    expect(mockOrderDocSet).not.toHaveBeenCalled();
    expect(mockNotificationSet).not.toHaveBeenCalled();
  });

  it('flags a payment for a level the student has already achieved', async () => {
    mockMemberGradings([]);

    // Member is at Student 3, so Student 2 is behind them.
    await fulfillStripeOrder(
      mockDb,
      {
        ...sampleMember,
        studentLevel: StudentLevel.Level3,
        applicationLevel: ApplicationLevel.None,
      },
      gradingOrder('GRADING : Student Level 2', 'cs_127'),
      'order_doc_127',
    );

    // The payment is never lost: the grading is created, held for review.
    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'Student 2',
        status: GradingStatus.RequiresReview,
        paymentStatus: PaymentStatus.PaidByStripe,
        // The reason is stored on the grading for the admin who picks it up.
        reviewIssue: expect.stringContaining('at or below their current level'),
      }),
    );

    // Admins: flagging the order is what surfaces it in their feed.
    expect(mockOrderDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        ilcAppOrderStatus: OrderStatus.NeedsManualProcessing,
      }),
      { merge: true },
    );
    expect(JSON.stringify(mockOrderDocSet.mock.calls[0][0].ilcAppOrderIssues)).toContain(
      'at or below their current level',
    );

    // The member: what they paid, why it needs checking, and where to write.
    const notification = mockNotificationSet.mock.calls[0][0];
    expect(notification.kind).toBe(NotificationKind.OrderNeedsAttention);
    expect(notification.markdown).toContain('Student 2');
    expect(notification.markdown).toContain('USD 80.00');
    expect(notification.markdown).toContain('already shows');
    expect(notification.markdown).toContain(supportEmail);
    expect(notification.markdown).toContain('order_doc_127');
  });

  it('flags a payment for a level the student has already paid for', async () => {
    mockMemberGradings([
      {
        id: 'already_paid_grading',
        update: vi.fn().mockResolvedValue({}),
        data: {
          level: 'Student 2',
          status: GradingStatus.AwaitingRequest,
          paymentStatus: PaymentStatus.PaidByStripe,
        },
      },
    ]);

    await fulfillStripeOrder(
      mockDb,
      gradingMember,
      gradingOrder('GRADING : Student Level 2', 'cs_128'),
      'order_doc_128',
    );

    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'Student 2',
        status: GradingStatus.RequiresReview,
      }),
    );
    expect(JSON.stringify(mockOrderDocSet.mock.calls[0][0].ilcAppOrderIssues)).toContain(
      'Duplicate grading payment',
    );
    expect(mockNotificationSet.mock.calls[0][0].markdown).toContain(
      'already paid for',
    );
  });

  it('books a fresh grading when paying after an unpaid failed attempt', async () => {
    // A NotPassed record is a closed attempt, so it is not settled by the
    // payment — the student is buying another go at that level.
    const failedUpdate = vi.fn().mockResolvedValue({});
    mockMemberGradings([
      {
        id: 'failed_unpaid',
        update: failedUpdate,
        data: {
          level: 'Student 2',
          status: GradingStatus.NotPassed,
          paymentStatus: PaymentStatus.NotYetPaid,
        },
      },
    ]);

    await fulfillStripeOrder(
      mockDb,
      gradingMember,
      gradingOrder('GRADING : Student Level 2', 'cs_129'),
      'order_doc_129',
    );

    expect(failedUpdate).not.toHaveBeenCalled();
    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'Student 2',
        status: GradingStatus.AwaitingRequest,
      }),
    );
    expect(mockNotificationSet).not.toHaveBeenCalled();
  });

  it('flags a payment whose level cannot be recognised', async () => {
    mockMemberGradings([]);

    await fulfillStripeOrder(
      mockDb,
      gradingMember,
      gradingOrder('GRADING : Mystery Item', 'cs_130'),
      'order_doc_130',
    );

    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({ status: GradingStatus.RequiresReview }),
    );
    expect(JSON.stringify(mockOrderDocSet.mock.calls[0][0].ilcAppOrderIssues)).toContain(
      'unrecognised level',
    );
    expect(mockNotificationSet.mock.calls[0][0].markdown).toContain(supportEmail);
  });

  it('stamps a human-friendly order number onto the grading it creates', async () => {
    mockMemberGradings([]);
    const order = gradingOrder('GRADING : Student Level 2', 'cs_live_number_test');

    await fulfillStripeOrder(mockDb, gradingMember, order, 'order_doc_num');

    // Instructors can read the grading but not the order, so the number has to
    // live on the grading itself.
    const created = mockGradingsCollection.add.mock.calls[0][0];
    expect(created.orderNumber).toBe(
      orderDisplayNumber(order.created, 'cs_live_number_test'),
    );
    expect(created.orderNumber).toMatch(/^202605-\d{4}$/);
  });

  it('stamps the order number when settling an existing unpaid grading', async () => {
    const unpaidUpdate = vi.fn().mockResolvedValue({});
    mockMemberGradings([
      {
        id: 'existing_unpaid_grading',
        update: unpaidUpdate,
        data: {
          level: 'Student 2',
          status: GradingStatus.AwaitingRequest,
          paymentStatus: PaymentStatus.NotYetPaid,
        },
      },
    ]);

    await fulfillStripeOrder(
      mockDb,
      gradingMember,
      gradingOrder('GRADING : Student Level 2', 'cs_live_settle_num'),
      'order_doc_settle_num',
    );

    expect(unpaidUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: expect.stringMatching(/^202605-\d{4}$/),
      }),
    );
  });

  it('trusts the level recorded in the order metadata over the line-item text', async () => {
    mockMemberGradings([]);
    const order = gradingOrder('GRADING : Some Renamed Product', 'cs_128');
    order.metadata = { orderType: 'grading', gradingLevel: 'Student 2' };

    await fulfillStripeOrder(mockDb, gradingMember, order, 'order_doc_128');

    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'Student 2' }),
    );
    // Metadata level matches what is owed, so the odd description raises nothing.
    expect(mockNotificationSet).not.toHaveBeenCalled();
  });

  it('fulfills monthly Class Video Library subscription on member doc', async () => {
    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_vid_monthly',
      subscriptionId: 'sub_vid_monthly_123',
      mode: StripeCheckoutMode.Subscription,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 2500,
      currency: 'usd',
      lineItems: [
        {
          productId: 'prod_vid',
          priceId: 'price_vid_monthly',
          description: 'Monthly Class Video Library Subscription',
          quantity: 1,
          amountTotal: 2500,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, sampleMember, order, 'order_vid_123');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        classVideoLibrarySubscription: true,
        classVideoLibrarySubscriptionId: 'sub_vid_monthly_123',
        classVideoLibraryLastRenewalDate: expect.any(String),
        classVideoLibraryExpirationDate: expect.any(String),
        classVideoLibraryNextAutoRenewDate: expect.any(String),
      }),
    );
  });

  it('fulfills annual Class Video Library subscription on member doc', async () => {
    const memberWithExistingSub = {
      ...sampleMember,
      classVideoLibrarySubscription: true,
      classVideoLibraryExpirationDate: '2028-06-01',
    };

    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_vid_annual',
      subscriptionId: 'sub_vid_annual_456',
      mode: StripeCheckoutMode.Subscription,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 25000,
      currency: 'usd',
      lineItems: [
        {
          productId: 'prod_vid',
          priceId: 'price_vid_annual',
          description: '1-Year Class Video Library Subscription (Annual)',
          quantity: 1,
          amountTotal: 25000,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, memberWithExistingSub, order, 'order_vid_456');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        classVideoLibrarySubscription: true,
        classVideoLibrarySubscriptionId: 'sub_vid_annual_456',
        classVideoLibraryExpirationDate: '2029-06-01',
        classVideoLibraryNextAutoRenewDate: '2029-06-01',
      }),
    );
  });

  it('auto-assigns a new memberId when a new member without memberId purchases annual membership', async () => {
    const memberWithoutId = {
      ...sampleMember,
      docId: 'mem_new_1',
      memberId: '',
      country: 'United States',
      firstMembershipStarted: '',
      currentMembershipExpires: '',
    };

    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_new_annual',
      mode: StripeCheckoutMode.Payment,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 8500,
      currency: 'usd',
      lineItems: [
        {
          productId: 'prod_mem',
          priceId: 'price_mem_annual',
          description: 'Annual Membership',
          quantity: 1,
          amountTotal: 8500,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, memberWithoutId, order, 'order_new_annual');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipType: MembershipType.Annual,
        memberId: 'US101',
        firstMembershipStarted: expect.any(String),
        lastRenewalDate: expect.any(String),
        currentMembershipExpires: expect.any(String),
      }),
    );
    expect(memberWithoutId.memberId).toBe('US101');
  });

  it('auto-assigns a new memberId using order billingAddress country when member country is empty', async () => {
    const memberWithoutCountry = {
      ...sampleMember,
      docId: 'mem_new_2',
      memberId: '',
      country: '',
      firstMembershipStarted: '',
      currentMembershipExpires: '',
    };

    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_new_fr',
      mode: StripeCheckoutMode.Payment,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 8500,
      currency: 'usd',
      billingAddress: {
        country: 'FR',
      },
      lineItems: [
        {
          productId: 'prod_mem',
          priceId: 'price_mem_annual',
          description: 'Annual Membership',
          quantity: 1,
          amountTotal: 8500,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, memberWithoutCountry, order, 'order_new_fr');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipType: MembershipType.Annual,
        memberId: 'FR201',
        country: 'France',
      }),
    );
    expect(memberWithoutCountry.memberId).toBe('FR201');
    expect(memberWithoutCountry.country).toBe('France');
  });

  it('auto-assigns a new memberId when a new member purchases lifetime membership', async () => {
    const memberWithoutId = {
      ...sampleMember,
      docId: 'mem_new_3',
      memberId: '',
      country: 'United States',
      firstMembershipStarted: '',
      currentMembershipExpires: '',
    };

    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_new_life',
      mode: StripeCheckoutMode.Payment,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 150000,
      currency: 'usd',
      lineItems: [
        {
          productId: 'prod_mem_life',
          priceId: 'price_mem_life',
          description: 'Lifetime Membership (Individual)',
          quantity: 1,
          amountTotal: 150000,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, memberWithoutId, order, 'order_new_life');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipType: MembershipType.Life,
        memberId: 'US101',
        currentMembershipExpires: '9999-12-31',
        firstMembershipStarted: expect.any(String),
        lastRenewalDate: expect.any(String),
      }),
    );
    expect(memberWithoutId.memberId).toBe('US101');
  });

  it('handles unresolved country gracefully without assigning memberId and logs error', async () => {
    const memberWithInvalidCountry = {
      ...sampleMember,
      docId: 'mem_invalid_country',
      memberId: '',
      country: 'UnknownLand',
      firstMembershipStarted: '',
      currentMembershipExpires: '',
    };

    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_invalid_country',
      mode: StripeCheckoutMode.Payment,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 8500,
      currency: 'usd',
      lineItems: [
        {
          productId: 'prod_mem',
          priceId: 'price_mem_annual',
          description: 'Annual Membership',
          quantity: 1,
          amountTotal: 8500,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, memberWithInvalidCountry, order, 'order_invalid_country');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipType: MembershipType.Annual,
      }),
    );
    expect(memberWithInvalidCountry.memberId).toBe('');
  });

  it('fulfills instructor license and assigns new instructor ID if member does not have one', async () => {
    const memberWithoutInstructorId = {
      ...sampleMember,
      docId: 'mem_new_instructor',
      instructorId: '',
      instructorLicenseExpires: '',
      instructorLicenseRenewalDate: '',
    };

    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_lic_new_inst',
      mode: StripeCheckoutMode.Payment,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 10000,
      currency: 'usd',
      metadata: {
        orderType: 'license',
        memberDocId: 'mem_new_instructor',
      },
      lineItems: [
        {
          productId: 'prod_lic',
          priceId: 'price_lic_annual',
          description: '1-Year Certified Instructor License',
          quantity: 1,
          amountTotal: 10000,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, memberWithoutInstructorId, order, 'order_lic_123');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        instructorId: '101',
        instructorLicenseType: 'Annual',
        instructorLicenseRenewalDate: expect.any(String),
        instructorLicenseExpires: expect.any(String),
      }),
    );
    expect(memberWithoutInstructorId.instructorId).toBe('101');
  });

  it('fulfills instructor license for existing instructor and extends expiry by 1 year', async () => {
    const existingInstructor = {
      ...sampleMember,
      docId: 'mem_existing_instructor',
      instructorId: '55',
      instructorLicenseExpires: '2028-05-15',
      instructorLicenseRenewalDate: '2027-05-15',
    };

    const order: StripeOrder = {
      docId: '',
      lastUpdated: '2026-05-15T00:00:00Z',
      ilcAppOrderKind: OrderKind.Stripe,
      stripeOrderType: StripeOrderType.Checkout,
      stripeObjectId: 'cs_lic_renew',
      subscriptionId: 'sub_lic_123',
      mode: StripeCheckoutMode.Subscription,
      created: '2026-05-15T00:00:00Z',
      amountTotal: 10000,
      currency: 'usd',
      metadata: {
        orderType: 'license',
        memberDocId: 'mem_existing_instructor',
      },
      lineItems: [
        {
          productId: 'prod_lic',
          priceId: 'price_lic_annual',
          description: 'Certified Instructor License',
          quantity: 1,
          amountTotal: 10000,
          currency: 'usd',
        },
      ],
    };

    await fulfillStripeOrder(mockDb, existingInstructor, order, 'order_lic_456');

    expect(mockMemberRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        instructorLicenseType: 'Annual',
        instructorLicenseExpires: '2029-05-15',
        instructorLicenseSubscriptionId: 'sub_lic_123',
        instructorLicenseNextAutoRenewDate: '2029-05-15',
      }),
    );
    // Preserves existing instructor ID
    expect(existingInstructor.instructorId).toBe('55');
  });

  describe('fulfillSpouseLifeMembership', () => {
    it('creates a new Life member when spouse record does not exist', async () => {
      const createdSpouseDocRef = {
        id: 'new_spouse_doc_123',
        set: vi.fn().mockResolvedValue({}),
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({
            id: 'mock_order_doc',
            set: vi.fn().mockResolvedValue({}),
          }),
        }),
      };

      const customDb = {
        ...mockDb,
        collection: vi.fn((colName: string) => {
          if (colName === 'members') {
            return {
              doc: vi.fn((docId?: string) => {
                if (!docId) return createdSpouseDocRef;
                return mockMemberRef;
              }),
              where: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
                  }),
                }),
                limit: vi.fn().mockReturnValue({
                  get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
                }),
              }),
            };
          }
          if (colName === 'acl') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: false }),
              }),
            };
          }
          return mockDb.collection(colName);
        }),
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-05-15T00:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_life_spouse_123',
        mode: StripeCheckoutMode.Payment,
        created: '2026-05-15T00:00:00Z',
        amountTotal: 250000,
        currency: 'usd',
        metadata: {
          spouseName: 'Alex Doe',
          spouseEmail: 'alex@example.com',
          spouseDob: '1992-08-20',
          spouseCountry: 'United States',
        },
        lineItems: [
          {
            productId: 'prod_life',
            priceId: 'price_life_spouse',
            description: 'Life : + Spouse',
            quantity: 1,
            amountTotal: 250000,
            currency: 'usd',
          },
        ],
      };

      const spouseDocId = await fulfillSpouseLifeMembership(
        customDb,
        order,
        'order_life_spouse_123',
        sampleMember,
      );

      expect(spouseDocId).toBe('new_spouse_doc_123');
      expect(createdSpouseDocRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Alex Doe',
          emails: ['alex@example.com'],
          dateOfBirth: '1992-08-20',
          country: 'United States',
          membershipType: MembershipType.Life,
          currentMembershipExpires: '9999-12-31',
          memberId: 'US101',
        }),
      );
    });

    it('updates existing member to Life membership when spouse already exists', async () => {
      const existingSpouseMember = {
        ...initMember(),
        docId: 'mem_existing_spouse_456',
        memberId: 'US456',
        name: 'Alex Doe',
        emails: ['alex@example.com'],
        dateOfBirth: '1992-08-20',
        country: 'United States',
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2027-01-01',
      };

      const existingSpouseRef = {
        id: 'mem_existing_spouse_456',
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem_existing_spouse_456',
          data: () => ({ ...existingSpouseMember }),
        }),
        update: vi.fn().mockResolvedValue({}),
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({
            id: 'mock_order_doc',
            set: vi.fn().mockResolvedValue({}),
          }),
        }),
      };

      const customDb = {
        ...mockDb,
        collection: vi.fn((colName: string) => {
          if (colName === 'members') {
            return {
              doc: vi.fn().mockReturnValue(existingSpouseRef),
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [
                      {
                        id: 'mem_existing_spouse_456',
                        exists: true,
                        data: () => ({ ...existingSpouseMember }),
                      },
                    ],
                  }),
                }),
              }),
            };
          }
          if (colName === 'acl') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({ memberDocIds: ['mem_existing_spouse_456'] }),
                }),
              }),
            };
          }
          return mockDb.collection(colName);
        }),
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-05-15T00:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_life_spouse_existing',
        mode: StripeCheckoutMode.Payment,
        created: '2026-05-15T00:00:00Z',
        amountTotal: 250000,
        currency: 'usd',
        metadata: {
          spouseName: 'Alex Doe',
          spouseEmail: 'alex@example.com',
          spouseDob: '1992-08-20',
          spouseCountry: 'United States',
        },
        lineItems: [
          {
            productId: 'prod_life',
            priceId: 'price_life_spouse',
            description: 'Lifetime Membership (with Spouse)',
            quantity: 1,
            amountTotal: 250000,
            currency: 'usd',
          },
        ],
      };

      const spouseDocId = await fulfillSpouseLifeMembership(
        customDb,
        order,
        'order_life_spouse_existing',
        sampleMember,
      );

      expect(spouseDocId).toBe('mem_existing_spouse_456');
      expect(existingSpouseRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipType: MembershipType.Life,
          currentMembershipExpires: '9999-12-31',
          membershipNextAutoRenewDate: '',
        }),
      );
    });

    describe('School license fulfillment', () => {
      it('should renew an existing school license', async () => {
        const mockSchoolRef = {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              schoolLicenseExpires: '2027-01-01',
            }),
          }),
          update: vi.fn().mockResolvedValue({}),
        };

        const customDb = {
          ...mockDb,
          collection: vi.fn((colName: string) => {
            if (colName === 'schools') {
              return {
                doc: vi.fn().mockReturnValue(mockSchoolRef),
              };
            }
            if (colName === 'members') {
              return {
                doc: vi.fn().mockReturnValue(mockMemberRef),
              };
            }
            return mockDb.collection(colName);
          }),
        };

        const order: StripeOrder = {
          docId: '',
          lastUpdated: '2026-05-15T00:00:00Z',
          ilcAppOrderKind: OrderKind.Stripe,
          stripeOrderType: StripeOrderType.Checkout,
          stripeObjectId: 'cs_school_renew',
          mode: StripeCheckoutMode.Payment,
          created: '2026-05-15T00:00:00Z',
          amountTotal: 60000,
          currency: 'usd',
          metadata: {
            orderType: 'school',
            schoolDocId: 'school_123',
            schoolId: 'SCH-100',
            memberDocId: sampleMember.docId,
          },
          lineItems: [
            {
              productId: 'prod_school',
              priceId: 'price_school_yearly',
              description: '1-Year School Affiliation License',
              quantity: 1,
              amountTotal: 60000,
              currency: 'usd',
            },
          ],
        };

        await fulfillStripeOrder(customDb, sampleMember, order, 'order_sch_renew');

        expect(mockSchoolRef.update).toHaveBeenCalledWith(
          expect.objectContaining({
            schoolLicenseExpires: '2028-01-01',
          }),
        );
      });

      it('should create a new school and assign memberDocId as owner when purchasing for a new school', async () => {
        const createdSchoolData: any[] = [];
        const mockNewSchoolDocRef = {
          id: 'new_school_doc_789',
          set: vi.fn().mockImplementation(async (data) => {
            createdSchoolData.push(data);
          }),
        };

        const customDb = {
          ...mockDb,
          collection: vi.fn((colName: string) => {
            if (colName === 'schools') {
              return {
                doc: vi.fn().mockReturnValue(mockNewSchoolDocRef),
              };
            }
            if (colName === 'members') {
              return {
                doc: vi.fn().mockReturnValue(mockMemberRef),
              };
            }
            return mockDb.collection(colName);
          }),
        };

        const order: StripeOrder = {
          docId: '',
          lastUpdated: '2026-05-15T00:00:00Z',
          ilcAppOrderKind: OrderKind.Stripe,
          stripeOrderType: StripeOrderType.Checkout,
          stripeObjectId: 'cs_school_new',
          mode: StripeCheckoutMode.Payment,
          created: '2026-05-15T00:00:00Z',
          amountTotal: 60000,
          currency: 'usd',
          metadata: {
            orderType: 'school',
            isNewSchool: 'true',
            schoolName: 'ILC London Academy',
            schoolCountry: 'United Kingdom',
            schoolCity: 'London',
            schoolAddress: '10 Downing St',
            memberDocId: sampleMember.docId,
          },
          lineItems: [
            {
              productId: 'prod_school',
              priceId: 'price_school_yearly',
              description: '1-Year School Affiliation License',
              quantity: 1,
              amountTotal: 60000,
              currency: 'usd',
            },
          ],
        };

        await fulfillStripeOrder(customDb, sampleMember, order, 'order_sch_new');

        expect(mockNewSchoolDocRef.set).toHaveBeenCalledTimes(1);
        expect(createdSchoolData[0]).toEqual(
          expect.objectContaining({
            schoolName: 'ILC London Academy',
            schoolCountry: 'United Kingdom',
            schoolCity: 'London',
            schoolAddress: '10 Downing St',
            ownerMemberDocId: sampleMember.docId,
            schoolId: 'SCH-101',
          }),
        );
      });
    });

    describe('Date arithmetic & firstMembershipStarted preservation', () => {
      it('extendDateByYears extends 1 year from reference date when expired or empty', () => {
        expect(extendDateByYears('', 1, '2026-08-15')).toBe('2027-08-15');
        expect(extendDateByYears(null, 1, '2026-08-15')).toBe('2027-08-15');
        expect(extendDateByYears('2025-01-01', 1, '2026-08-15')).toBe('2027-08-15');
      });

      it('extendDateByYears extends from current expiry when renewing early while active', () => {
        expect(extendDateByYears('2026-12-31', 1, '2026-08-15')).toBe('2027-12-31');
        expect(extendDateByYears('2027-05-15', 2, '2026-08-15')).toBe('2029-05-15');
      });

      it('extendDateByYears preserves life membership (9999-12-31)', () => {
        expect(extendDateByYears('9999-12-31', 1, '2026-08-15')).toBe('9999-12-31');
      });

      it('extendDateByMonths extends 1 month from reference date when expired or empty', () => {
        expect(extendDateByMonths('', 1, '2026-08-15')).toBe('2026-09-15');
        expect(extendDateByMonths(null, 1, '2026-08-15')).toBe('2026-09-15');
        expect(extendDateByMonths('2026-01-01', 1, '2026-08-15')).toBe('2026-09-15');
      });

      it('extendDateByMonths extends from current expiry when renewing early while active', () => {
        expect(extendDateByMonths('2026-09-15', 1, '2026-08-20')).toBe('2026-10-15');
      });

      it('never overwrites existing firstMembershipStarted on annual membership renewal', async () => {
        const existingMember = {
          ...sampleMember,
          firstMembershipStarted: '2020-03-01',
          lastRenewalDate: '2025-05-15',
          currentMembershipExpires: '2026-05-15',
        };

        const order: StripeOrder = {
          docId: '',
          lastUpdated: '2026-08-15T00:00:00Z',
          ilcAppOrderKind: OrderKind.Stripe,
          stripeOrderType: StripeOrderType.Checkout,
          stripeObjectId: 'cs_renew_mem',
          mode: StripeCheckoutMode.Payment,
          created: '2026-08-15T00:00:00Z',
          amountTotal: 8500,
          currency: 'usd',
          metadata: { memberDocId: existingMember.docId },
          lineItems: [
            {
              productId: 'prod_mem',
              priceId: 'price_mem_annual',
              description: 'Annual Membership Renewal',
              quantity: 1,
              amountTotal: 8500,
              currency: 'usd',
            },
          ],
        };

        await fulfillStripeOrder(mockDb, existingMember, order, 'order_renew_mem');

        expect(mockMemberRef.update).toHaveBeenCalledWith(
          expect.objectContaining({
            lastRenewalDate: '2026-08-15',
            currentMembershipExpires: '2027-08-15',
          }),
        );
        // firstMembershipStarted must NOT be in the update payload
        const updateArgs = mockMemberRef.update.mock.calls[0][0];
        expect(updateArgs.firstMembershipStarted).toBeUndefined();
        expect(existingMember.firstMembershipStarted).toBe('2020-03-01');
      });

      it('sets firstMembershipStarted on first-time membership purchase when previously empty', async () => {
        const newMember = {
          ...sampleMember,
          firstMembershipStarted: '',
          lastRenewalDate: '',
          currentMembershipExpires: '',
        };

        const order: StripeOrder = {
          docId: '',
          lastUpdated: '2026-08-15T00:00:00Z',
          ilcAppOrderKind: OrderKind.Stripe,
          stripeOrderType: StripeOrderType.Checkout,
          stripeObjectId: 'cs_new_mem',
          mode: StripeCheckoutMode.Payment,
          created: '2026-08-15T00:00:00Z',
          amountTotal: 8500,
          currency: 'usd',
          metadata: { memberDocId: newMember.docId },
          lineItems: [
            {
              productId: 'prod_mem',
              priceId: 'price_mem_annual',
              description: 'Annual Membership',
              quantity: 1,
              amountTotal: 8500,
              currency: 'usd',
            },
          ],
        };

        await fulfillStripeOrder(mockDb, newMember, order, 'order_new_mem');

        expect(mockMemberRef.update).toHaveBeenCalledWith(
          expect.objectContaining({
            firstMembershipStarted: '2026-08-15',
            lastRenewalDate: '2026-08-15',
            currentMembershipExpires: '2027-08-15',
          }),
        );
      });

      it('correctly sets 1 month expiry for monthly video subscription and 1 year for annual video subscription', async () => {
        // Test Monthly
        const monthlyMember = {
          ...sampleMember,
          classVideoLibraryExpirationDate: '',
        };

        const monthlyOrder: StripeOrder = {
          docId: '',
          lastUpdated: '2026-08-15T00:00:00Z',
          ilcAppOrderKind: OrderKind.Stripe,
          stripeOrderType: StripeOrderType.Checkout,
          stripeObjectId: 'cs_video_monthly',
          mode: StripeCheckoutMode.Subscription,
          subscriptionId: 'sub_vid_month_123',
          created: '2026-08-15T00:00:00Z',
          amountTotal: 2500,
          currency: 'usd',
          metadata: { memberDocId: monthlyMember.docId },
          lineItems: [
            {
              productId: 'prod_video',
              priceId: 'price_video_monthly',
              description: 'Class Video Library Subscription (Monthly)',
              quantity: 1,
              amountTotal: 2500,
              currency: 'usd',
            },
          ],
        };

        await fulfillStripeOrder(mockDb, monthlyMember, monthlyOrder, 'order_vid_m');

        expect(mockMemberRef.update).toHaveBeenCalledWith(
          expect.objectContaining({
            classVideoLibrarySubscription: true,
            classVideoLibraryLastRenewalDate: '2026-08-15',
            classVideoLibraryExpirationDate: '2026-09-15',
            classVideoLibraryNextAutoRenewDate: '2026-09-15',
            'stripeSubscriptions.sub_vid_month_123': expect.objectContaining({
              interval: 'month',
              currentPeriodStart: '2026-08-15',
              currentPeriodEnd: '2026-09-15',
            }),
          }),
        );

        // Test Annual
        mockMemberRef.update.mockClear();
        const yearlyMember = {
          ...sampleMember,
          classVideoLibraryExpirationDate: '',
        };

        const yearlyOrder: StripeOrder = {
          docId: '',
          lastUpdated: '2026-08-15T00:00:00Z',
          ilcAppOrderKind: OrderKind.Stripe,
          stripeOrderType: StripeOrderType.Checkout,
          stripeObjectId: 'cs_video_yearly',
          mode: StripeCheckoutMode.Subscription,
          subscriptionId: 'sub_vid_year_456',
          created: '2026-08-15T00:00:00Z',
          amountTotal: 25000,
          currency: 'usd',
          metadata: { memberDocId: yearlyMember.docId },
          lineItems: [
            {
              productId: 'prod_video',
              priceId: 'price_video_yearly',
              description: 'Class Video Library Subscription (Annual)',
              quantity: 1,
              amountTotal: 25000,
              currency: 'usd',
            },
          ],
        };

        await fulfillStripeOrder(mockDb, yearlyMember, yearlyOrder, 'order_vid_y');

        expect(mockMemberRef.update).toHaveBeenCalledWith(
          expect.objectContaining({
            classVideoLibrarySubscription: true,
            classVideoLibraryLastRenewalDate: '2026-08-15',
            classVideoLibraryExpirationDate: '2027-08-15',
            classVideoLibraryNextAutoRenewDate: '2027-08-15',
            'stripeSubscriptions.sub_vid_year_456': expect.objectContaining({
              interval: 'year',
              currentPeriodStart: '2026-08-15',
              currentPeriodEnd: '2027-08-15',
            }),
          }),
        );
      });

      it('syncSubscriptionStatusToMember updates currentMembershipExpires and video expiration when active subscription renews', async () => {
        const memberWithSub = {
          ...sampleMember,
          membershipSubscriptionId: 'sub_mem_789',
          currentMembershipExpires: '2026-08-15',
          stripeSubscriptions: {
            sub_mem_789: {
              subscriptionId: 'sub_mem_789',
              status: 'active',
              currentPeriodEnd: '2026-08-15',
            },
          },
        };

        mockMemberRef.get = vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem_123',
          data: () => memberWithSub,
        });

        const fakeSubscription: any = {
          id: 'sub_mem_789',
          status: 'active',
          cancel_at_period_end: false,
          current_period_end: Math.floor(new Date('2027-08-15T00:00:00Z').getTime() / 1000),
          metadata: { memberDocId: 'mem_123' },
        };

        await syncSubscriptionStatusToMember(mockDb, fakeSubscription);

        expect(mockMemberRef.update).toHaveBeenCalledWith(
          expect.objectContaining({
            membershipNextAutoRenewDate: '2027-08-15',
            currentMembershipExpires: '2027-08-15',
            'stripeSubscriptions.sub_mem_789.status': 'active',
            'stripeSubscriptions.sub_mem_789.currentPeriodEnd': '2027-08-15',
          }),
        );
      });
    });
  });
});
