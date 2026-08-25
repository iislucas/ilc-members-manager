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
    opts: {
      loading?: boolean;
      error?: string | null;
      collapsible?: boolean;
    } = {},
  ) {
    fixture.componentRef.setInput('products', products);
    fixture.componentRef.setInput('loading', opts.loading ?? false);
    fixture.componentRef.setInput('error', opts.error ?? null);
    fixture.componentRef.setInput('collapsible', opts.collapsible ?? false);
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

    const rows = [...el.querySelectorAll('.price-row')].map((r) => ({
      label: r.querySelector('.price-row-label')?.textContent?.trim(),
      amount: r.querySelector('.price-row-amount')?.textContent?.trim(),
    }));
    expect(rows.length).toBe(2);
    expect(rows).toContainEqual({ label: 'Regular', amount: '$85.00/year' });
    expect(rows).toContainEqual({ label: '65+ Senior', amount: '$55.00/year' });
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

  it('should order levels numerically, not in Stripe creation order', () => {
    // The live catalogue returned these in creation order — 4, 3, 2, 1 — which
    // is not how anyone reads a fee schedule. 10 must also follow 2, which a
    // plain string sort gets wrong.
    const el = render([
      product({
        name: 'GRADING : Student Levels',
        prices: [
          price({ id: 'p4', nickname: 'Student Level 4', unitAmount: 35000 }),
          price({ id: 'p10', nickname: 'Student Level 10', unitAmount: 90000 }),
          price({ id: 'p2', nickname: 'Student Level 2', unitAmount: 15000 }),
          price({ id: 'p1', nickname: 'Student Level 1', unitAmount: 15000 }),
        ],
      }),
    ]);

    const labels = [...el.querySelectorAll('.price-row-label')].map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Student Level 1',
      'Student Level 2',
      'Student Level 4',
      'Student Level 10',
    ]);
  });

  it('should not print the product description, which holds marketing copy', () => {
    // Live descriptions run to over a thousand characters; they are not a
    // caption for a table of figures.
    const blurb = 'Cultivate inner peace and unleash your inner warrior. '.repeat(20);
    const el = render([
      product({ description: blurb, prices: [price({ nickname: 'Regular' })] }),
    ]);

    expect(el.textContent).not.toContain('Cultivate inner peace');
  });

  it('should start folded when collapsible, and open on click', () => {
    const el = render(
      [product({ prices: [price({ nickname: 'Regular' })] })],
      { collapsible: true },
    );

    // Folded: the heading and a count of what is hidden, but no rates.
    expect(el.querySelector('.price-row')).toBeNull();
    const toggle = el.querySelector<HTMLButtonElement>('.price-table-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.price-table-count')?.textContent).toContain('1');

    toggle!.click();
    fixture.detectChanges();

    expect(el.querySelectorAll('.price-row').length).toBe(1);
    expect(
      el.querySelector('.price-table-toggle')?.getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('should stay open with no toggle when not collapsible', () => {
    const el = render([product({ prices: [price({ nickname: 'Regular' })] })]);
    expect(el.querySelector('.price-table-toggle')).toBeNull();
    expect(el.querySelectorAll('.price-row').length).toBe(1);
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
