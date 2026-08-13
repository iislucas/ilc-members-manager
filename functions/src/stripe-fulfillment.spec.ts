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
} from './data-model';
import {
  fulfillStripeOrder,
  fulfillSpouseLifeMembership,
  mirrorOrderToMemberSubcollection,
  resolveMemberForStripeOrder,
} from './stripe-fulfillment';

describe('stripe-fulfillment', () => {
  let mockDb: any;
  let mockMemberRef: any;
  let mockOrdersCollection: any;
  let mockGradingsCollection: any;

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
    mockMemberRef = {
      update: vi.fn().mockResolvedValue({}),
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          id: 'mock_doc_id',
          set: vi.fn().mockResolvedValue({}),
        }),
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        }),
      }),
    };

    mockOrdersCollection = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      add: vi.fn().mockResolvedValue({ id: 'new_order_id' }),
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

    await fulfillStripeOrder(mockDb, sampleMember, order, 'order_doc_123');

    expect(mockGradingsCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        studentMemberDocId: 'mem_123',
        studentMemberId: 'US123',
        orderId: 'order_doc_123',
        level: 'Student 2',
      }),
    );
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
  });
});
