import { describe, it, expect } from 'vitest';
import { clearOrderProcessingState } from './api';
import { SquareSpaceOrder } from '../data-model';

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
