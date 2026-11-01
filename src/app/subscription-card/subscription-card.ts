import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { StripeService } from '../stripe.service';
import { NetworkStateService } from '../network-state.service';
import { computeProjectedRenewalExpirationDate } from '../stripe-price-format';
import {
  DisplaySubscriptionCard,
  SubscriptionCardStatus,
} from './subscription-card.model';
import { environment } from '../../environments/environment';

type CardActionInFlight =
  | 'cancel'
  | 'resume'
  | 'edit-date'
  | 'payment-method'
  | 'remove-payment-method'
  | null;

@Component({
  selector: 'app-subscription-card',
  standalone: true,
  imports: [IconComponent, SpinnerComponent],
  templateUrl: './subscription-card.html',
  styleUrl: './subscription-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubscriptionCardComponent {
  protected stripeService = inject(StripeService);
  protected networkState = inject(NetworkStateService);

  card = input.required<DisplaySubscriptionCard>();
  showRenewLink = input<boolean>(true);
  subscriptionUpdated = output<void>();

  SubscriptionCardStatus = SubscriptionCardStatus;
  adminEmail = environment.adminEmail;
  isOffline = this.networkState.isOffline;

  detailsExpanded = signal(false);
  editingRenewalDate = signal(false);
  confirmingCancel = signal(false);
  confirmingRemovePaymentMethod = signal(false);
  actionInFlight = signal<CardActionInFlight>(null);
  feedbackMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  draftRenewalDate = linkedSignal<DisplaySubscriptionCard, string>({
    source: () => this.card(),
    computation: (c) => c.defaultRenewalEditDate || c.nextAutoRenewDate || '',
  });

  detailsPanelId = computed(
    () => `renewal-details-${this.card().id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
  );

  draftProjectedExpiration = computed(() => {
    const c = this.card();
    const draft = this.draftRenewalDate().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft)) return '';
    return computeProjectedRenewalExpirationDate({
      currentExpirationDate: c.expirationDate,
      nextAutoRenewDate: draft,
      interval: c.interval,
    });
  });

  isDraftDateValid = computed(() => {
    const c = this.card();
    const draft = this.draftRenewalDate().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft)) return false;
    if (c.minRenewalEditDate && draft < c.minRenewalEditDate) return false;
    if (c.maxRenewalEditDate && draft > c.maxRenewalEditDate) return false;
    return true;
  });

  spinnerMessage = computed(() => {
    switch (this.actionInFlight()) {
      case 'cancel':
        return 'Cancelling auto-renewal...';
      case 'resume':
        return 'Resuming auto-renewal...';
      case 'edit-date':
        return 'Updating renewal date...';
      case 'payment-method':
        return 'Opening payment method setup...';
      case 'remove-payment-method':
        return 'Removing payment method...';
      default:
        return '';
    }
  });

  toggleDetails(): void {
    this.detailsExpanded.update((open) => !open);
    if (!this.detailsExpanded()) {
      this.editingRenewalDate.set(false);
    }
  }

  openRenewalDateEditor(): void {
    const c = this.card();
    this.draftRenewalDate.set(
      c.defaultRenewalEditDate || c.nextAutoRenewDate || '',
    );
    this.detailsExpanded.set(true);
    this.editingRenewalDate.set(true);
    this.confirmingCancel.set(false);
    this.confirmingRemovePaymentMethod.set(false);
    this.errorMessage.set(null);
  }

  cancelRenewalDateEditor(): void {
    this.editingRenewalDate.set(false);
  }

  onDraftDateChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.draftRenewalDate.set(target?.value || '');
  }

  requestCancelAutoRenew(): void {
    this.confirmingCancel.set(true);
    this.confirmingRemovePaymentMethod.set(false);
    this.editingRenewalDate.set(false);
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);
  }

  dismissCancelAutoRenew(): void {
    this.confirmingCancel.set(false);
  }

  requestRemovePaymentMethod(): void {
    this.confirmingRemovePaymentMethod.set(true);
    this.confirmingCancel.set(false);
    this.editingRenewalDate.set(false);
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);
  }

  dismissRemovePaymentMethod(): void {
    this.confirmingRemovePaymentMethod.set(false);
  }

  async confirmRemovePaymentMethod(): Promise<void> {
    const subId = this.card().subscriptionId;
    if (!subId) return;

    this.actionInFlight.set('remove-payment-method');
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);

    try {
      await this.stripeService.removeSubscriptionPaymentMethod(subId);
      this.confirmingRemovePaymentMethod.set(false);
      this.detailsExpanded.set(false);
      this.feedbackMessage.set(
        `Payment method removed. Your access remains active until ${this.card().expirationDate}.`,
      );
      this.subscriptionUpdated.emit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Failed to remove payment method: ${msg}`);
    } finally {
      this.actionInFlight.set(null);
    }
  }

  async confirmCancelAutoRenew(): Promise<void> {
    const subId = this.card().subscriptionId;
    if (!subId) return;

    this.actionInFlight.set('cancel');
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);

    try {
      const result = await this.stripeService.cancelSubscriptionRenewal(subId);
      this.confirmingCancel.set(false);
      this.detailsExpanded.set(false);
      this.feedbackMessage.set(
        `Auto-renewal cancelled. Your access remains active until ${this.card().expirationDate || result.periodEnd}.`,
      );
      this.subscriptionUpdated.emit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Failed to cancel auto-renewal: ${msg}`);
    } finally {
      this.actionInFlight.set(null);
    }
  }

  async onResumeAutoRenew(): Promise<void> {
    const subId = this.card().subscriptionId;
    if (!subId) return;

    this.actionInFlight.set('resume');
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);

    try {
      const result = await this.stripeService.resumeSubscriptionRenewal(subId);
      this.feedbackMessage.set(
        `Auto-renewal resumed. Next payment scheduled for ${result.nextAutoRenewDate}.`,
      );
      this.subscriptionUpdated.emit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Failed to resume auto-renewal: ${msg}`);
    } finally {
      this.actionInFlight.set(null);
    }
  }

  async onSaveRenewalDate(): Promise<void> {
    const c = this.card();
    const subId = c.subscriptionId;
    const newDate = this.draftRenewalDate().trim();
    if (!subId || !this.isDraftDateValid()) return;

    this.actionInFlight.set('edit-date');
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);

    try {
      const result = await this.stripeService.updateSubscriptionRenewalDate(
        subId,
        newDate,
      );
      this.editingRenewalDate.set(false);
      this.feedbackMessage.set(
        `Next auto-renewal payment updated to ${result.nextAutoRenewDate}.`,
      );
      this.subscriptionUpdated.emit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Failed to update renewal date: ${msg}`);
    } finally {
      this.actionInFlight.set(null);
    }
  }

  async onUpdatePaymentMethod(): Promise<void> {
    const subId = this.card().subscriptionId;
    if (!subId) return;

    this.actionInFlight.set('payment-method');
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);

    try {
      const { url } =
        await this.stripeService.createSubscriptionPaymentMethodSession(
          subId,
          this.currentReturnUrl(),
        );
      this.redirectToUrl(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errorMessage.set(`Could not open payment method setup: ${msg}`);
      this.actionInFlight.set(null);
    }
  }

  protected currentReturnUrl(): string {
    return window.location.href;
  }

  protected redirectToUrl(url: string): void {
    window.location.href = url;
  }
}
