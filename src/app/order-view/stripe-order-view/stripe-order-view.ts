import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StripeOrder } from '../../../../functions/src/data-model';
import { IconComponent } from '../../icons/icon.component';

@Component({
  selector: 'app-stripe-order-view',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './stripe-order-view.html',
  styleUrl: './stripe-order-view.scss',
})
export class StripeOrderView {
  order = input.required<StripeOrder>();

  // Human-readable label for the kind of Stripe event behind this order.
  typeLabel = computed(() => {
    switch (this.order().stripeOrderType) {
      case 'checkout':
        return 'Checkout';
      case 'renewal':
        return 'Subscription renewal';
      case 'cancellation':
        return 'Subscription cancelled';
      default:
        return this.order().stripeOrderType;
    }
  });

  // Amounts arrive in the currency's minor unit (e.g. cents); render as a major
  // unit value with the currency code.
  formattedTotal = computed(() => {
    const o = this.order();
    if (o.amountTotal == null || !o.currency) {
      return '—';
    }
    const amount = (o.amountTotal / 100).toFixed(2);
    return `${amount} ${o.currency.toUpperCase()}`;
  });

  formatLineAmount(amount: number, currency: string): string {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
