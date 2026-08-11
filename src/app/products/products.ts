/* products.ts
 *
 * Standalone, publicly accessible page listing Stripe products grouped in rows
 * with headings and their respective price options, letting a visitor start a
 * purchase. Selecting an option creates a Stripe Checkout Session (via the
 * createStripeCheckoutSession cloud function) and redirects the browser to
 * Stripe's hosted checkout. On success Stripe returns the buyer to the
 * /order-complete page.
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
      // Only show purchasable products (active, with at least one active price).
      const purchasable = products.filter(
        (p) => p.active && this.activePrices(p).length > 0,
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

  /** Return all active, payable prices for a product. */
  activePrices(product: StripeProduct): StripeProductPrice[] {
    return product.prices.filter((p) => p.active && p.unitAmount !== null);
  }

  /** Human-readable title or nickname for a specific price option. */
  priceOptionTitle(product: StripeProduct, price: StripeProductPrice): string {
    if (price.nickname && price.nickname.trim()) {
      return price.nickname.trim();
    }
    // If the product has multiple prices but no nickname, show a generic option label.
    if (product.prices.length > 1) {
      return 'Option';
    }
    return '';
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

  /** Redirect the browser to Stripe Checkout URL. */
  redirectTo(url: string): void {
    window.location.assign(url);
  }

  async buy(price: StripeProductPrice): Promise<void> {
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
      this.redirectTo(checkoutUrl);
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
