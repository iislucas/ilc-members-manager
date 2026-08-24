import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { PriceTableComponent } from './price-table';
import {
  StripePriceType,
  StripeProduct,
  StripeProductPrice,
  StripeRecurringInterval,
} from '../../../functions/src/stripe-types';

function price(overrides: Partial<StripeProductPrice>): StripeProductPrice {
  return {
    id: 'price_1',
    active: true,
    currency: 'usd',
    unitAmount: 8500,
    type: StripePriceType.OneTime,
    recurringInterval: null,
    recurringIntervalCount: null,
    nickname: null,
    created: 1,
    ...overrides,
  };
}

function product(overrides: Partial<StripeProduct>): StripeProduct {
  return {
    id: 'prod_1',
    name: 'MEMBERSHIP : Annual',
    description: null,
    active: true,
    images: [],
    metadata: {},
    created: 1,
    updated: 1,
    defaultPrice: null,
    prices: [],
    ...overrides,
  };
}

describe('PriceTableComponent', () => {
  let fixture: ComponentFixture<PriceTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PriceTableComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PriceTableComponent);
  });

  function render(
    products: StripeProduct[],
    opts: { loading?: boolean; error?: string | null } = {},
  ) {
    fixture.componentRef.setInput('products', products);
    fixture.componentRef.setInput('loading', opts.loading ?? false);
    fixture.componentRef.setInput('error', opts.error ?? null);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('should list every active rate of a product as its own row', () => {
    const el = render([
      product({
        prices: [
          price({
            id: 'p_reg',
            nickname: 'Annual : Regular',
            unitAmount: 8500,
            type: StripePriceType.Recurring,
            recurringInterval: StripeRecurringInterval.Year,
          }),
          price({
            id: 'p_sen',
            nickname: 'Annual : 65+ Senior',
            unitAmount: 5500,
            type: StripePriceType.Recurring,
            recurringInterval: StripeRecurringInterval.Year,
          }),
        ],
      }),
    ]);

    const rows = el.querySelectorAll('.price-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.price-row-amount')?.textContent).toContain(
      '$85.00/year',
    );
    expect(rows[1].querySelector('.price-row-amount')?.textContent).toContain(
      '$55.00/year',
    );
  });

  it('should strip the catalogue namespace from product and rate names', () => {
    const el = render([
      product({
        name: 'MEMBERSHIP : Annual',
        prices: [price({ nickname: 'Annual : 65+ Senior' })],
      }),
    ]);

    expect(el.querySelector('.price-group-header h3')?.textContent?.trim()).toBe(
      'Annual',
    );
    expect(el.querySelector('.price-row-label')?.textContent?.trim()).toBe(
      '65+ Senior',
    );
  });

  it('should fall back to the product name for a rate with no nickname', () => {
    const el = render([
      product({
        name: 'SCHOOL : Affiliation License',
        prices: [price({ nickname: null })],
      }),
    ]);

    expect(el.querySelector('.price-row-label')?.textContent?.trim()).toBe(
      'Affiliation License',
    );
  });

  it('should exclude archived prices and prices with no amount', () => {
    const el = render([
      product({
        prices: [
          price({ id: 'p_live', nickname: 'Regular', unitAmount: 8500 }),
          price({ id: 'p_old', nickname: 'Retired', active: false }),
          price({ id: 'p_none', nickname: 'Metered', unitAmount: null }),
        ],
      }),
    ]);

    const labels = [...el.querySelectorAll('.price-row-label')].map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).toEqual(['Regular']);
  });

  it('should exclude inactive products entirely', () => {
    const el = render([
      product({ id: 'prod_off', active: false, prices: [price({})] }),
    ]);
    expect(el.querySelectorAll('.price-group').length).toBe(0);
  });

  it('should render nothing rather than an empty shell when there are no rates', () => {
    const el = render([product({ prices: [] })]);
    expect(el.querySelector('.price-table')).toBeNull();
  });

  it('should show a spinner while the catalogue is loading', () => {
    const el = render([], { loading: true });
    expect(el.querySelector('app-spinner')).toBeTruthy();
    expect(el.querySelector('.price-row')).toBeNull();
  });

  it('should surface a load failure instead of silently showing no prices', () => {
    const el = render([], { error: 'Stripe unavailable' });
    expect(el.querySelector('.error-message')?.textContent).toContain(
      'Stripe unavailable',
    );
  });
});
