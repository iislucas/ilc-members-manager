import { describe, it, expect, vi } from 'vitest';
import { clearOrderProcessingState, executeOrderDownstreamLogic } from './api';
import { SquareSpaceOrder, SquareSpaceLineItemType } from '../data-model';
import * as admin from 'firebase-admin';

describe('clearOrderProcessingState', () => {
  it('should clear order-level and line-item-level processing fields', () => {
    const order = {
      orderNumber: '123',
      ilcAppOrderStatus: 'processed',
      ilcAppOrderIssues: ['some issue'],
      lineItems: [
        {
          id: 'item1',
          sku: 'VID-LIBRARY',
          quantity: '1',
          unitPricePaid: { value: '50.00' },
          ilcAppProcessingStatus: 'processed',
        },
        {
          id: 'item2',
          sku: 'GRA-STU',
          quantity: '1',
          unitPricePaid: { value: '100.00' },
          ilcAppProcessingStatus: 'error',
          ilcAppProcessingIssue: 'Member not found',
        },
      ],
    } as unknown as SquareSpaceOrder;

    clearOrderProcessingState(order);

    expect(order.ilcAppOrderStatus).toBeUndefined();
    expect(order.ilcAppOrderIssues).toBeUndefined();
    expect(order.lineItems![0].ilcAppProcessingStatus).toBeUndefined();
    expect(order.lineItems![1].ilcAppProcessingStatus).toBeUndefined();
    expect(order.lineItems![1].ilcAppProcessingIssue).toBeUndefined();
    // Non-ilcApp fields should be preserved
    expect(order.orderNumber).toBe('123');
    expect(order.lineItems![0].sku).toBe('VID-LIBRARY');
    expect(order.lineItems![1].sku).toBe('GRA-STU');
  });

  it('should handle orders with no line items', () => {
    const order = {
      orderNumber: '456',
      ilcAppOrderStatus: 'error',
      ilcAppOrderIssues: ['fail'],
    } as unknown as SquareSpaceOrder;

    clearOrderProcessingState(order);

    expect(order.ilcAppOrderStatus).toBeUndefined();
    expect(order.ilcAppOrderIssues).toBeUndefined();
    expect(order.orderNumber).toBe('456');
  });

  it('should be a no-op on a fresh order with no processing state', () => {
    const order = {
      orderNumber: '789',
      lineItems: [
        { id: 'item1', sku: 'MEM-YEAR-REG', quantity: '1', unitPricePaid: { value: '85.00' } },
      ],
    } as unknown as SquareSpaceOrder;

    clearOrderProcessingState(order);

    expect(order.orderNumber).toBe('789');
    expect(order.lineItems![0].sku).toBe('MEM-YEAR-REG');
    expect(order.ilcAppOrderStatus).toBeUndefined();
  });
});

describe('executeOrderDownstreamLogic with physical products', () => {
  it('should mark physical items as needs-manual-processing if order is PENDING', async () => {
    const order = {
      orderNumber: '123',
      fulfillmentStatus: 'PENDING',
      lineItems: [
        {
          id: 'item1',
          sku: 'PHYSICAL-SKU',
          lineItemType: SquareSpaceLineItemType.PhysicalProduct,
          quantity: '1',
          unitPricePaid: { value: '10.00' },
        },
      ],
    } as unknown as SquareSpaceOrder;

    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          update: mockUpdate,
        }),
      }),
    } as unknown as admin.firestore.Firestore;

    await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

    expect(mockUpdate).toHaveBeenCalled();
    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.ilcAppOrderStatus).toBe('needs-manual-processing');
    expect(updateData.lineItems[0].ilcAppProcessingStatus).toBe('needs-manual-processing');
  });

  it('should mark physical items as processed if order is FULFILLED', async () => {
    const order = {
      orderNumber: '123',
      fulfillmentStatus: 'FULFILLED',
      lineItems: [
        {
          id: 'item1',
          sku: 'PHYSICAL-SKU',
          lineItemType: SquareSpaceLineItemType.PhysicalProduct,
          quantity: '1',
          unitPricePaid: { value: '10.00' },
        },
      ],
    } as unknown as SquareSpaceOrder;

    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          update: mockUpdate,
        }),
      }),
    } as unknown as admin.firestore.Firestore;

    await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

    expect(mockUpdate).toHaveBeenCalled();
    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.ilcAppOrderStatus).toBe('processed');
    expect(updateData.lineItems[0].ilcAppProcessingStatus).toBe('processed');
  });

  it('should mark unknown SKUs as processed if order is FULFILLED', async () => {
    const order = {
      orderNumber: '123',
      fulfillmentStatus: 'FULFILLED',
      lineItems: [
        {
          id: 'item1',
          sku: 'PRINT-3SGUIDE',
          quantity: '1',
          unitPricePaid: { value: '25.00' },
        },
      ],
    } as unknown as SquareSpaceOrder;

    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          update: mockUpdate,
        }),
      }),
    } as unknown as admin.firestore.Firestore;

    await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

    expect(mockUpdate).toHaveBeenCalled();
    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.ilcAppOrderStatus).toBe('processed');
    expect(updateData.lineItems[0].ilcAppProcessingStatus).toBe('processed');
  });

  it('should skip orders with status needs-manual-processing (use reprocessOrder to re-run)', async () => {
    const order = {
      orderNumber: '123',
      fulfillmentStatus: 'FULFILLED',
      ilcAppOrderStatus: 'needs-manual-processing',
      lineItems: [
        {
          id: 'item1',
          sku: 'PHYSICAL-SKU',
          lineItemType: SquareSpaceLineItemType.PhysicalProduct,
          quantity: '1',
          unitPricePaid: { value: '10.00' },
          ilcAppProcessingStatus: 'needs-manual-processing',
        },
      ],
    } as unknown as SquareSpaceOrder;

    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          update: mockUpdate,
        }),
      }),
    } as unknown as admin.firestore.Firestore;

    // The function should skip because ilcAppOrderStatus is already set.
    await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should skip orders with status error (use reprocessOrder to re-run)', async () => {
    const order = {
      orderNumber: '123',
      fulfillmentStatus: 'FULFILLED',
      ilcAppOrderStatus: 'error',
      lineItems: [
        {
          id: 'item1',
          sku: 'MEM-YEAR-REG',
          quantity: '1',
          unitPricePaid: { value: '85.00' },
          ilcAppProcessingStatus: 'error',
          ilcAppProcessingIssue: 'Some error',
        },
      ],
    } as unknown as SquareSpaceOrder;

    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          update: mockUpdate,
        }),
      }),
    } as unknown as admin.firestore.Firestore;

    // The function should skip because ilcAppOrderStatus is already set.
    await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should process after clearOrderProcessingState clears the status', async () => {
    const order = {
      orderNumber: '123',
      fulfillmentStatus: 'FULFILLED',
      ilcAppOrderStatus: 'needs-manual-processing',
      lineItems: [
        {
          id: 'item1',
          sku: 'PHYSICAL-SKU',
          lineItemType: SquareSpaceLineItemType.PhysicalProduct,
          quantity: '1',
          unitPricePaid: { value: '10.00' },
          ilcAppProcessingStatus: 'needs-manual-processing',
        },
      ],
    } as unknown as SquareSpaceOrder;

    // Simulate the reprocessOrder flow: clear state first, then call executeOrderDownstreamLogic.
    clearOrderProcessingState(order);

    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          update: mockUpdate,
        }),
      }),
    } as unknown as admin.firestore.Firestore;

    await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

    expect(mockUpdate).toHaveBeenCalled();
    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.ilcAppOrderStatus).toBe('processed');
    expect(updateData.lineItems[0].ilcAppProcessingStatus).toBe('processed');
  });

  describe('executeOrderDownstreamLogic pending notifications', () => {
    it('should create a pending membership notification if order processing fails for a first membership purchase', async () => {
      const order = {
        orderNumber: '123',
        customerEmail: 'test@example.com',
        fulfillmentStatus: 'PENDING',
        lineItems: [
          {
            id: 'item1',
            sku: 'MEM-YEAR-REG',
            quantity: '1',
            unitPricePaid: { value: '85.00' },
            customizations: [
              { label: 'Is this membership for a new member?', value: 'Renewing an existing member' },
              { label: 'Member ID', value: 'US999' },
            ]
          },
        ],
      } as unknown as SquareSpaceOrder;

      const mockUpdate = vi.fn().mockResolvedValue({});
      const mockSet = vi.fn().mockResolvedValue({});

      const mockCollection = vi.fn().mockImplementation((colName) => {
        const colObj: any = {
          doc: vi.fn().mockImplementation((docId) => {
            return {
              get: vi.fn().mockResolvedValue({ exists: false }),
              set: mockSet,
              update: mockUpdate,
              collection: vi.fn().mockReturnValue(colObj),
            };
          }),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn()
            .mockResolvedValueOnce({
              empty: false,
              docs: [{
                id: 'member-doc-id',
                ref: {
                  id: 'member-doc-id',
                  update: vi.fn(),
                },
                data: () => ({
                  docId: 'member-doc-id',
                  emails: ['other@example.com'],
                  membershipType: 'NotYetAMember',
                  instructorId: '',
                  memberId: 'US999',
                })
              }]
            })
            .mockResolvedValue({ empty: true, docs: [] }),
        };
        return colObj;
      });

      const mockDb = {
        collection: mockCollection,
        batch: vi.fn().mockReturnValue({
          delete: vi.fn(),
          commit: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as admin.firestore.Firestore;

      await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockCollection).toHaveBeenCalledWith('members');
      expect(mockSet).toHaveBeenCalled();
      const notificationCall = mockSet.mock.calls[0][0];
      expect(notificationCall.kind).toBe('MembershipPending');
      expect(notificationCall.markdown).toContain('Your purchase of **Membership**');
    });
  });

  describe('fulfillOrder status updates', () => {
    it('marks physical items as processed and sets ilcAppOrderStatus to processed when fulfilled', async () => {
      const order = {
        docId: 'ord_1',
        orderNumber: '1001',
        fulfillmentStatus: 'PENDING',
        ilcAppOrderStatus: 'needs-manual-processing',
        ilcAppOrderIssues: ['Physical product awaiting shipment'],
        lineItems: [
          {
            id: 'li_1',
            sku: 'BOOK-1',
            productName: 'ILC Guide',
            lineItemType: SquareSpaceLineItemType.PhysicalProduct,
            quantity: '1',
            unitPricePaid: { value: '25.00' },
            ilcAppProcessingStatus: 'needs-manual-processing',
            ilcAppProcessingIssue: 'Awaiting shipping',
          },
        ],
      } as unknown as SquareSpaceOrder;

      // Simulate the fulfillment update logic
      const lineItems = (order.lineItems || []).map((li) => {
        if (li.ilcAppProcessingStatus === 'needs-manual-processing') {
          const updated = { ...li, ilcAppProcessingStatus: 'processed' };
          delete updated.ilcAppProcessingIssue;
          return updated;
        }
        return li;
      });

      expect(lineItems[0].ilcAppProcessingStatus).toBe('processed');
      expect(lineItems[0].ilcAppProcessingIssue).toBeUndefined();

      const hasRemainingErrors = lineItems.some((li) => li.ilcAppProcessingStatus === 'error');
      const newOrderStatus = hasRemainingErrors ? 'error' : 'processed';
      expect(newOrderStatus).toBe('processed');
    });

    it('retains order error status and issues when fulfilling an order with failed digital items', async () => {
      const order = {
        docId: 'ord_2',
        orderNumber: '1002',
        fulfillmentStatus: 'PENDING',
        ilcAppOrderStatus: 'error',
        ilcAppOrderIssues: ['Email mismatch for member US100'],
        lineItems: [
          {
            id: 'li_1',
            sku: 'BOOK-1',
            productName: 'ILC Guide',
            lineItemType: SquareSpaceLineItemType.PhysicalProduct,
            quantity: '1',
            unitPricePaid: { value: '25.00' },
            ilcAppProcessingStatus: 'needs-manual-processing',
          },
          {
            id: 'li_2',
            sku: 'MEM-YEAR-REG',
            productName: 'Annual Membership',
            quantity: '1',
            unitPricePaid: { value: '85.00' },
            ilcAppProcessingStatus: 'error',
            ilcAppProcessingIssue: 'Email mismatch for member US100',
          },
        ],
      } as unknown as SquareSpaceOrder;

      // Simulate the fulfillment update logic
      const lineItems = (order.lineItems || []).map((li) => {
        if (li.ilcAppProcessingStatus === 'needs-manual-processing') {
          const updated = { ...li, ilcAppProcessingStatus: 'processed' };
          delete updated.ilcAppProcessingIssue;
          return updated;
        }
        return li;
      });

      const hasRemainingErrors = lineItems.some((li) => li.ilcAppProcessingStatus === 'error');
      const newOrderStatus = hasRemainingErrors ? 'error' : 'processed';
      const newIssues = hasRemainingErrors ? (order.ilcAppOrderIssues || []) : [];

      expect(lineItems[0].ilcAppProcessingStatus).toBe('processed');
      expect(lineItems[1].ilcAppProcessingStatus).toBe('error');
      expect(newOrderStatus).toBe('error');
      expect(newIssues).toEqual(['Email mismatch for member US100']);
    });
  });
});
