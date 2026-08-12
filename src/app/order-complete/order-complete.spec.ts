/* order-complete.spec.ts
 *
 * Unit tests for OrderCompleteComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderCompleteComponent } from './order-complete';
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import {
  CheckoutSessionSummary,
  StripeCheckoutPaymentStatus,
  StripeCheckoutStatus,
} from '../../../functions/src/stripe-types';

describe('OrderCompleteComponent', () => {
  let fixture: ComponentFixture<OrderCompleteComponent>;
  let component: OrderCompleteComponent;
  let mockStripeService: {
    getCheckoutSession: ReturnType<typeof vi.fn>;
  };
  let sessionIdSignal: ReturnType<typeof signal<string>>;

  const sampleMembershipSummary: CheckoutSessionSummary = {
    id: 'cs_test_mem_123',
    status: StripeCheckoutStatus.Complete,
    paymentStatus: StripeCheckoutPaymentStatus.Paid,
    customerEmail: 'member@example.com',
    amountTotal: 8500,
    currency: 'usd',
    lineItems: [
      {
        description: 'Annual Membership (Regular)',
        quantity: 1,
        amountTotal: 8500,
        currency: 'usd',
      },
    ],
    metadata: {
      orderType: 'membership',
    },
  };

  const sampleGradingSummary: CheckoutSessionSummary = {
    id: 'cs_test_grad_123',
    status: StripeCheckoutStatus.Complete,
    paymentStatus: StripeCheckoutPaymentStatus.Paid,
    customerEmail: 'student@example.com',
    amountTotal: 5000,
    currency: 'usd',
    lineItems: [
      {
        description: 'Grading Fee: Student Level 1',
        quantity: 1,
        amountTotal: 5000,
        currency: 'usd',
      },
    ],
    metadata: {
      gradingLevel: 'Level 1',
    },
  };

  beforeEach(async () => {
    sessionIdSignal = signal('cs_test_mem_123');

    mockStripeService = {
      getCheckoutSession: vi.fn().mockResolvedValue(sampleMembershipSummary),
    };

    const mockRoutingService = {
      signals: {
        [Views.OrderComplete]: {
          urlParams: {
            session_id: sessionIdSignal,
          },
        },
      },
      hrefForView: vi.fn((view: string) => `/${view}`),
      hrefWithParams: vi.fn((path: string) => path),
    };

    await TestBed.configureTestingModule({
      imports: [OrderCompleteComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StripeService, useValue: mockStripeService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();
  });

  async function createComponent(): Promise<void> {
    fixture = TestBed.createComponent(OrderCompleteComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should load order summary and detect membership order', async () => {
    await createComponent();
    expect(component).toBeTruthy();
    expect(mockStripeService.getCheckoutSession).toHaveBeenCalledWith('cs_test_mem_123');

    const s = component['state']();
    expect(s.kind).toBe('loaded');
    expect(component.orderKind()).toBe('membership');
  });

  it('should detect grading order type', async () => {
    mockStripeService.getCheckoutSession.mockResolvedValueOnce(sampleGradingSummary);
    sessionIdSignal.set('cs_test_grad_123');
    await createComponent();

    expect(component.orderKind()).toBe('grading');
  });

  it('should handle missing session_id gracefully', async () => {
    sessionIdSignal.set('');
    await createComponent();

    const s = component['state']();
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.message).toContain('No checkout session');
    }
  });

  it('should format money accurately', async () => {
    await createComponent();
    expect(component.formatMoney(8500, 'usd')).toBe('$85.00');
    expect(component.formatMoney(null, 'usd')).toBe('');
  });
});
