/* order-complete.ts
 *
 * The "thanks for your order" / order confirmation page.
 * Stripe redirects the buyer here after checkout (or buyers view their receipt).
 * We read the session back via getStripeCheckoutSession and render tailored
 * welcome, benefits, and next-steps based on what was purchased (membership,
 * grading, license, video library, etc.).
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

export type OrderKind = 'membership' | 'grading' | 'license' | 'video' | 'general';

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
  public readonly Views = Views;
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  private sessionId = computed(() =>
    this.routingService.signals[Views.OrderComplete].urlParams.session_id(),
  );

  protected state = signal<LoadState>({ kind: 'idle' });

  orderKind = computed<OrderKind>(() => {
    const s = this.state();
    if (s.kind !== 'loaded') return 'general';
    const meta = s.summary.metadata || {};
    if (meta['orderType'] === 'membership' || meta['membershipOption']) {
      return 'membership';
    }
    if (meta['gradingLevel'] || meta['orderType'] === 'grading') {
      return 'grading';
    }
    if (meta['orderType'] === 'license') {
      return 'license';
    }
    if (meta['orderType'] === 'video') {
      return 'video';
    }

    const text = s.summary.lineItems
      .map((i) => i.description.toLowerCase())
      .join(' ');

    if (
      text.includes('membership') ||
      text.includes('annual') ||
      text.includes('lifetime') ||
      text.includes('life member')
    ) {
      return 'membership';
    }
    if (text.includes('grading')) {
      return 'grading';
    }
    if (
      text.includes('license') ||
      text.includes('instructor') ||
      text.includes('school')
    ) {
      return 'license';
    }
    if (text.includes('video') || text.includes('library')) {
      return 'video';
    }
    return 'general';
  });

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
