/* products.spec.ts
 *
 * Unit tests for ProductsComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductsComponent } from './products';
import { StripeService } from '../stripe.service';
import {
  StripeProduct,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

describe('ProductsComponent', () => {
  let fixture: ComponentFixture<ProductsComponent>;
  let component: ProductsComponent;
  let mockStripeService: {
    listProducts: ReturnType<typeof vi.fn>;
    createCheckoutSession: ReturnType<typeof vi.fn>;
    getCheckoutSession: ReturnType<typeof vi.fn>;
  };

  const sampleProducts: StripeProduct[] = [
    {
      id: 'prod_membership',
      name: 'MEMBERSHIP : Annual',
      description: 'Annual membership for I Liq Chuan members.',
      active: true,
      images: ['https://example.com/membership.png'],
      metadata: {},
      created: 1000,
      updated: 1000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_mem_reg',
          active: true,
          currency: 'usd',
          unitAmount: 8500,
          type: 'recurring',
          recurringInterval: 'year',
          recurringIntervalCount: 1,
          nickname: 'Annual : Regular',
          created: 1001,
        },
        {
          id: 'price_mem_sen',
          active: true,
          currency: 'usd',
          unitAmount: 5500,
          type: 'recurring',
          recurringInterval: 'year',
          recurringIntervalCount: 1,
          nickname: 'Annual : 65+ Senior',
          created: 1002,
        },
        {
          id: 'price_mem_inactive',
          active: false,
          currency: 'usd',
          unitAmount: 4000,
          type: 'recurring',
          recurringInterval: 'year',
          recurringIntervalCount: 1,
          nickname: 'Annual : Inactive Option',
          created: 1003,
        },
      ],
    },
    {
      id: 'prod_grading_student',
      name: 'GRADING : Student Levels',
      description: 'Student grading fee.',
      active: true,
      images: [],
      metadata: {},
      created: 2000,
      updated: 2000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_entry',
          active: true,
          currency: 'usd',
          unitAmount: 6000,
          type: 'one_time',
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Entry Level',
          created: 2001,
        },
        {
          id: 'price_stu1',
          active: true,
          currency: 'usd',
          unitAmount: 8000,
          type: 'one_time',
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Student Level 1',
          created: 2002,
        },
      ],
    },
    {
      id: 'prod_inactive',
      name: 'Archived Product',
      description: null,
      active: false,
      images: [],
      metadata: {},
      created: 3000,
      updated: 3000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_archived',
          active: true,
          currency: 'usd',
          unitAmount: 1000,
          type: 'one_time',
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Archived',
          created: 3001,
        },
      ],
    },
  ];

  beforeEach(async () => {
    mockStripeService = {
      listProducts: vi.fn().mockResolvedValue({ products: sampleProducts }),
      createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        sessionId: 'cs_test_123',
      }),
      getCheckoutSession: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProductsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StripeService, useValue: mockStripeService },
      ],
    }).compileComponents();
  });

  async function createComponent(): Promise<void> {
    fixture = TestBed.createComponent(ProductsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should create and load active purchasable products', async () => {
    await createComponent();
    expect(component).toBeTruthy();

    const state = (component as any).state();
    expect(state.kind).toBe('loaded');
    expect(state.products.length).toBe(2);
    expect(state.products.map((p: StripeProduct) => p.id)).toEqual([
      'prod_membership',
      'prod_grading_student',
    ]);
  });

  it('should filter active prices for a product', async () => {
    await createComponent();
    const active = component.activePrices(sampleProducts[0]);
    expect(active.length).toBe(2);
    expect(active.map((p: StripeProductPrice) => p.id)).toEqual([
      'price_mem_reg',
      'price_mem_sen',
    ]);
  });

  it('should format recurring and one-time prices correctly', async () => {
    await createComponent();
    const recurringPrice: StripeProductPrice = {
      id: 'p1',
      active: true,
      currency: 'usd',
      unitAmount: 8500,
      type: 'recurring',
      recurringInterval: 'year',
      recurringIntervalCount: 1,
      nickname: 'Regular',
    };
    const oneTimePrice: StripeProductPrice = {
      id: 'p2',
      active: true,
      currency: 'usd',
      unitAmount: 6000,
      type: 'one_time',
      recurringInterval: null,
      recurringIntervalCount: null,
      nickname: 'Entry',
    };

    expect(component.formatPrice(recurringPrice)).toBe('$85.00 / year');
    expect(component.formatPrice(oneTimePrice)).toBe('$60.00');
  });

  it('should render product headings and price option cards in DOM', async () => {
    await createComponent();
    const compiled = fixture.nativeElement as HTMLElement;

    const groups = compiled.querySelectorAll('.product-group');
    expect(groups.length).toBe(2);

    const firstHeader = groups[0].querySelector('.product-name');
    expect(firstHeader?.textContent).toContain('MEMBERSHIP : Annual');

    const firstOptions = groups[0].querySelectorAll('.price-option-card');
    expect(firstOptions.length).toBe(2);
    expect(firstOptions[0].textContent).toContain('Annual : Regular');
    expect(firstOptions[0].textContent).toContain('$85.00 / year');
    expect(firstOptions[1].textContent).toContain('Annual : 65+ Senior');
    expect(firstOptions[1].textContent).toContain('$55.00 / year');

    const secondHeader = groups[1].querySelector('.product-name');
    expect(secondHeader?.textContent).toContain('GRADING : Student Levels');
    const secondOptions = groups[1].querySelectorAll('.price-option-card');
    expect(secondOptions.length).toBe(2);
    expect(secondOptions[0].textContent).toContain('Entry Level');
    expect(secondOptions[0].textContent).toContain('$60.00');
  });

  it('should trigger buy and redirect for the clicked price option', async () => {
    await createComponent();
    const redirectSpy = vi
      .spyOn(component, 'redirectTo')
      .mockImplementation(() => {});

    const targetPrice = sampleProducts[0].prices[0];
    await component.buy(targetPrice);

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_mem_reg',
      window.location.origin,
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_123',
    );
  });

  it('should handle load errors and allow retry', async () => {
    mockStripeService.listProducts.mockRejectedValueOnce(
      new Error('Network error'),
    );
    await createComponent();

    const state = (component as any).state();
    expect(state.kind).toBe('error');
    expect(state.message).toBe('Network error');

    // Retry
    mockStripeService.listProducts.mockResolvedValueOnce({
      products: sampleProducts,
    });
    component.retry();
    await fixture.whenStable();

    const retriedState = (component as any).state();
    expect(retriedState.kind).toBe('loaded');
    expect(retriedState.products.length).toBe(2);
  });
});
