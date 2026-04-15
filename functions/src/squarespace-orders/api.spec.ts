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

  it('should reprocess orders with status needs-manual-processing when fulfilled', async () => {
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

    await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

    expect(mockUpdate).toHaveBeenCalled();
    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.ilcAppOrderStatus).toBe('processed');
    expect(updateData.lineItems[0].ilcAppProcessingStatus).toBe('processed');
  });

  it('should NOT reprocess line items with status error when order is fulfilled', async () => {
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

    await executeOrderDownstreamLogic(order, 'doc1', mockDb, { skipFulfillment: true });

    expect(mockUpdate).toHaveBeenCalled();
    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.ilcAppOrderStatus).toBe('error');
    expect(updateData.lineItems[0].ilcAppProcessingStatus).toBe('error');
  });
});
