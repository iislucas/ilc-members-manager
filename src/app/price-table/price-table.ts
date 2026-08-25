/* price-table.ts
 *
 * The price structure of whatever the page is selling, shown above the guided
 * purchase flow so a visitor can see what things cost before signing in or
 * filling in any forms.
 *
 * Give it the Stripe products the page sells; it renders one group per product
 * and one row per active price, so a product with Regular / Senior / Youth
 * rates shows all three. Every figure comes from the catalogue — there are no
 * rates written into the template, which is what used to let the quoted prices
 * drift away from what Stripe actually charged.
 *
 * Usage:
 *   <app-price-table
 *     [products]="membershipProducts()"
 *     [loading]="dataService.stripeProductsLoading()"
 *     [error]="dataService.stripeProductsError()"
 *     title="Membership Rates"
 *   ></app-price-table>
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SpinnerComponent } from '../spinner/spinner.component';
import { IconComponent } from '../icons/icon.component';
import { StripeProduct } from '../../../functions/src/stripe-types';
import { formatStripePrice, tidyStripeLabel } from '../stripe-price-format';

export interface PriceRow {
  /** The rate's own name, e.g. "65+ Senior". */
  label: string;
  /** Formatted amount with billing period, e.g. "$85.00/year". */
  amount: string;
}

export interface PriceGroup {
  /** The product's name, e.g. "Annual". */
  title: string;
  rows: PriceRow[];
}

/**
 * Orders rates the way a reader expects rather than the order Stripe happens
 * to have created them in. Numeric-aware, so "Student Level 10" sorts after
 * "Student Level 2" instead of before it.
 */
const rateOrder = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

@Component({
  selector: 'app-price-table',
  standalone: true,
  imports: [NgTemplateOutlet, SpinnerComponent, IconComponent],
  templateUrl: './price-table.html',
  styleUrl: './price-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceTableComponent {
  products = input.required<StripeProduct[]>();
  loading = input(false);
  error = input<string | null>(null);

  /** Heading above the table. */
  title = input('Pricing');

  /**
   * Shown under the heading — for anything the amounts alone do not convey,
   * such as a local instructor fee charged separately. Deliberately supplied
   * by the page rather than taken from the product's Stripe description, which
   * holds long-form marketing copy, not a caption for a table of figures.
   */
  note = input<string | null>(null);

  groups = computed<PriceGroup[]>(() =>
    this.products()
      .filter((product) => product.active)
      .map((product) => ({
        title: tidyStripeLabel(product.name),
        rows: product.prices
          // A price with no amount cannot be shown as a figure, and an
          // archived one is not on sale — neither belongs in the breakdown.
          .filter((price) => price.active && price.unitAmount !== null)
          .map((price) => ({
            label: tidyStripeLabel(price.nickname) || tidyStripeLabel(product.name),
            amount: formatStripePrice(price, {
              omitOneTimeSuffix: this.omitOneTimeSuffix(),
            }),
          }))
          // Stripe returns prices in creation order, which for the grading
          // fees came out as levels 4, 3, 2, 1, 6, 5.
          .sort((a, b) => rateOrder.compare(a.label, b.label)),
      }))
      // A product whose prices were all filtered out would render as an empty
      // heading, which reads as something failing to load.
      .filter((group) => group.rows.length > 0),
  );

  /**
   * Start folded, with the heading as the control that opens it. For a long
   * rate card — the gradings run to 19 rows — the full list pushes the page's
   * actual purpose off the screen, so it is offered rather than imposed.
   */
  collapsible = input(false);

  /**
   * Drop the "one-time" wording from the amounts. For a card where every rate
   * is a single charge — the grading fees — it repeats down every line without
   * distinguishing anything.
   */
  omitOneTimeSuffix = input(false);

  private readonly userOpened = signal(false);

  /** A non-collapsible table is simply always open. */
  isOpen = computed(() => !this.collapsible() || this.userOpened());

  toggle(): void {
    this.userOpened.update((open) => !open);
  }

  /** How many rates the fold is hiding, so the closed state says what it holds. */
  rateCount = computed(() =>
    this.groups().reduce((total, group) => total + group.rows.length, 0),
  );

  /** True once loading finished and there is genuinely nothing to show. */
  isEmpty = computed(
    () => !this.loading() && !this.error() && this.groups().length === 0,
  );
}
