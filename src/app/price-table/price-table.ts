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

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SpinnerComponent } from '../spinner/spinner.component';
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
  description: string | null;
  rows: PriceRow[];
}

@Component({
  selector: 'app-price-table',
  standalone: true,
  imports: [SpinnerComponent],
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
   * such as a local instructor fee charged separately.
   */
  note = input<string | null>(null);

  groups = computed<PriceGroup[]>(() =>
    this.products()
      .filter((product) => product.active)
      .map((product) => ({
        title: tidyStripeLabel(product.name),
        description: product.description,
        rows: product.prices
          // A price with no amount cannot be shown as a figure, and an
          // archived one is not on sale — neither belongs in the breakdown.
          .filter((price) => price.active && price.unitAmount !== null)
          .map((price) => ({
            label: tidyStripeLabel(price.nickname) || tidyStripeLabel(product.name),
            amount: formatStripePrice(price),
          })),
      }))
      // A product whose prices were all filtered out would render as an empty
      // heading, which reads as something failing to load.
      .filter((group) => group.rows.length > 0),
  );

  /** True once loading finished and there is genuinely nothing to show. */
  isEmpty = computed(
    () => !this.loading() && !this.error() && this.groups().length === 0,
  );
}
