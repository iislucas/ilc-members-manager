/* order-complete.ts
 *
 * The "thanks for your order" page. Stripe redirects the buyer here after a
 * successful checkout, with the Checkout Session id in the `session_id` query
 * param. We read the session back (via the getStripeCheckoutSession cloud
 * function) to confirm what was purchased.
 *
 * Reached at /order-complete?session_id=... — a public, standalone page not
 * linked from navigation.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { SpinnerComponent } from '../spinner/spinner.component';
import { IconComponent } from '../icons/icon.component';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { StripeService } from '../stripe.service';
import { CheckoutSessionSummary } from '../../../functions/src/stripe-types';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; summary: CheckoutSessionSummary }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-order-complete',
  standalone: true,
  imports: [SpinnerComponent, IconComponent],
  templateUrl: './order-complete.html',
  styleUrl: './order-complete.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderCompleteComponent {
  private stripeService = inject(StripeService);
  private routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  private sessionId = computed(() =>
    this.routingService.signals[Views.OrderComplete].urlParams.session_id(),
  );

  protected state = signal<LoadState>({ kind: 'idle' });

  constructor() {
    // Load (or reload) whenever the session_id in the URL changes.
    effect(() => {
      const sessionId = this.sessionId();
      if (!sessionId) {
        this.state.set({
          kind: 'error',
          message: 'No checkout session was provided.',
        });
        return;
      }
      void this.load(sessionId);
    });
  }

  private async load(sessionId: string): Promise<void> {
    this.state.set({ kind: 'loading' });
    try {
      const summary = await this.stripeService.getCheckoutSession(sessionId);
      this.state.set({ kind: 'loaded', summary });
    } catch (error) {
      this.state.set({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not load your order details.',
      });
    }
  }

  /** True once payment has completed (vs. still processing/unpaid). */
  isPaid(summary: CheckoutSessionSummary): boolean {
    return summary.paymentStatus === 'paid' || summary.status === 'complete';
  }

  formatMoney(amount: number | null, currency: string | null): string {
    if (amount === null || !currency) {
      return '';
    }
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  }
}
