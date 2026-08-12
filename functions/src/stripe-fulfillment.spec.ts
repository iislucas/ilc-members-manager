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
          set: vi.fn().mockResolvedValue({}),
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

    mockDb = {
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
});
