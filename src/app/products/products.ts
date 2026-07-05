/* products.ts
 *
 * Standalone, publicly accessible page listing Stripe products and letting a
 * visitor start a purchase. Selecting an item creates a Stripe Checkout Session
 * (via the createStripeCheckoutSession cloud function) and redirects the
 * browser to Stripe's hosted checkout. On success Stripe returns the buyer to
 * the /order-complete page.
 *
 * This page is intentionally not linked from the home page or navigation — it
 * is reached directly via its /products URL.
 */

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { SpinnerComponent } from '../spinner/spinner.component';
import { IconComponent } from '../icons/icon.component';
import { StripeService } from '../stripe.service';
import {
  StripeProduct,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; products: StripeProduct[] }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [SpinnerComponent, IconComponent],
  templateUrl: './products.html',
  styleUrl: './products.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductsComponent {
  private stripeService = inject(StripeService);

  protected state = signal<LoadState>({ kind: 'loading' });
  // Price id currently being turned into a checkout session (drives the
  // per-button busy state and disables the rest while we redirect).
  protected checkoutPriceId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.state.set({ kind: 'loading' });
    try {
      const { products } = await this.stripeService.listProducts();
      // Only show purchasable products (active, with at least one price).
      const purchasable = products.filter(
        (p) => p.active && this.buyablePrice(p) !== null,
      );
      this.state.set({ kind: 'loaded', products: purchasable });
    } catch (error) {
      this.state.set({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to load products.',
      });
    }
  }

  retry(): void {
    void this.load();
  }

  /** The price we'll charge for a product: its default price, else the first. */
  buyablePrice(product: StripeProduct): StripeProductPrice | null {
    if (product.defaultPrice && product.defaultPrice.active) {
      return product.defaultPrice;
    }
    return product.prices.find((price) => price.active) ?? null;
  }

  /** Human-readable price, e.g. "$85.00 / year" or "$20.00". */
  formatPrice(price: StripeProductPrice): string {
    const amount =
      price.unitAmount === null
        ? ''
        : new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: price.currency.toUpperCase(),
          }).format(price.unitAmount / 100);

    if (price.type === 'recurring' && price.recurringInterval) {
      const count = price.recurringIntervalCount ?? 1;
      const interval =
        count > 1
          ? `${count} ${price.recurringInterval}s`
          : price.recurringInterval;
      return `${amount} / ${interval}`;
    }
    return amount || 'See details';
  }

  async buy(product: StripeProduct): Promise<void> {
    const price = this.buyablePrice(product);
    if (!price || this.checkoutPriceId()) {
      return;
    }
    this.checkoutPriceId.set(price.id);
    try {
      const { checkoutUrl } = await this.stripeService.createCheckoutSession(
        price.id,
        window.location.origin,
      );
      // Hand off to Stripe's hosted checkout page.
      window.location.assign(checkoutUrl);
    } catch (error) {
      this.checkoutPriceId.set(null);
      this.state.set({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not start checkout. Please try again.',
      });
    }
  }
}
