/* class-video-library-purchase.ts
 *
 * Dedicated purchase & subscription management page for the Class Video Library:
 *  1. Shows current video library subscription status, expiry date, auto-renewal status, and last order.
 *  2. Provides Cancel/Resume Auto-Renewal for active subscribers.
 *  3. Offers monthly subscription pricing and Stripe Checkout redirect for new/renewing subscribers.
 *  4. On return with session_id, displays activation spinner and order confirmation.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { StripeProductsService } from '../stripe-products.service';
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  CheckoutSessionSummary,
  StripePriceType,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

import { InlineAuthComponent } from '../inline-auth/inline-auth.component';
import {
  formatStripeAmount,
  formatStripePrice,
} from '../stripe-price-format';
import { StepTrackComponent } from '../step-track/step-track';
import { StepFlow } from '../step-track/step-flow';
import { StepCardComponent } from '../step-card/step-card';

@Component({
  selector: 'app-class-video-library-purchase',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    SpinnerComponent,
    InlineAuthComponent,
    StepTrackComponent,
    StepCardComponent,
  ],
  templateUrl: './class-video-library-purchase.html',
  styleUrl: './class-video-library-purchase.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassVideoLibraryPurchaseComponent {
  protected firebaseService = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected stripeProductsService = inject(StripeProductsService);
  protected stripeService = inject(StripeService);
  protected routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  Views = Views;
  user = this.firebaseService.user;

  // Stripe products loading
  // Stripe catalogue. Injecting StripeProductsService is what loads it, so the
  // subscription rate is on screen before the visitor signs in.
  productsLoading = this.stripeProductsService.loading;
  productsError = this.stripeProductsService.error;
  // Matching on 'video' alone also caught the one-off "I Liq Chuan 21 Form
  // Instructional Video", whose $5.99 one-time price sat one Stripe creation
  // date away from becoming what the Subscribe button charged. This page sells
  // one thing: a recurring subscription to the library.
  videoProducts = computed(() =>
    this.stripeProductsService.products().filter((p) => {
      const titleLower = p.name.toLowerCase();
      return (
        p.active &&
        titleLower.includes('library') &&
        p.prices.some(
          (pr) =>
            pr.active &&
            pr.unitAmount !== null &&
            pr.type === StripePriceType.Recurring,
        )
      );
    }),
  );

  // Checkout redirecting
  isRedirecting = signal(false);
  checkoutError = signal<string | null>(null);

  // Return landing state
  sessionId = computed(() => {
    return this.routingService.signals[Views.ClassVideoLibraryPurchase].urlParams.session_id();
  });

  returnSessionLoading = signal(false);
  returnSessionSummary = signal<CheckoutSessionSummary | null>(null);
  returnSessionError = signal<string | null>(null);

  // Subscription management
  cancelInProgress = signal(false);
  cancelSuccessMessage = signal<string | null>(null);
  cancelErrorMessage = signal<string | null>(null);

  today = computed(() => new Date().toISOString().split('T')[0]);

  isLoggedIn = computed(() => !!this.user());

  // ── Guided flow: sign in, then choose the plan. See step-flow.ts. ──
  readonly StepAccount = 1;
  readonly StepPlan = 2;

  flow = new StepFlow(
    computed(() => (this.isLoggedIn() ? this.StepPlan : this.StepAccount)),
    ['Account', 'Subscription'],
  );

  accountSummary = computed(() => {
    const u = this.user();
    return u?.member?.emails?.[0] || u?.firebaseUser?.email || '';
  });

  async onLogout(): Promise<void> {
    await this.firebaseService.logout();
  }

  hasVideoAccess = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    const hasSubscription = !!m.classVideoLibrarySubscription;
    const exp = m.classVideoLibraryExpirationDate;
    return hasSubscription && (!exp || exp >= this.today());
  });

  expirationDate = computed(() => {
    return this.user()?.member.classVideoLibraryExpirationDate || '';
  });

  hasActiveAutoRenew = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    return !!(
      m.classVideoLibrarySubscriptionId &&
      m.classVideoLibraryNextAutoRenewDate &&
      m.classVideoLibraryNextAutoRenewDate >= this.today()
    );
  });

  hasActiveStripeSubscription = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    return !!m.classVideoLibrarySubscriptionId && this.hasVideoAccess();
  });

  isSubscribeFoldOpen = signal(false);

  toggleSubscribeFold(): void {
    this.isSubscribeFoldOpen.update((open) => !open);
  }

  nextAutoRenewDate = computed(() => {
    return this.user()?.member.classVideoLibraryNextAutoRenewDate || '';
  });

  selectedPrice = computed<StripeProductPrice | null>(() => {
    for (const prod of this.videoProducts()) {
      // Recurring only: a one-time price here would silently turn the
      // subscription into a single charge.
      const p = prod.prices.find(
        (pr) =>
          pr.active &&
          pr.unitAmount !== null &&
          pr.type === StripePriceType.Recurring,
      );
      if (p) return p;
    }
    return null;
  });

  /**
   * The subscription rate, for the page subtitle. There is only one, so it
   * belongs in the sentence describing what you get rather than in a table of
   * its own.
   */
  headlinePrice = computed(() => formatStripePrice(this.selectedPrice()));

  // Recent video library order
  recentVideoOrder = computed(() => {
    const orders = this.dataService.myOrders.entries();
    return (
      orders.find((o) =>
        o.lineItems?.some(
          (li) =>
            li.description.toLowerCase().includes('video') ||
            li.description.toLowerCase().includes('library'),
        ),
      ) || null
    );
  });

  constructor() {
    const sId = this.sessionId();
    if (sId) {
      void this.loadReturnSession(sId);
    }
  }


  async loadReturnSession(sessionId: string): Promise<void> {
    this.returnSessionLoading.set(true);
    this.returnSessionError.set(null);
    try {
      const summary = await this.stripeService.getCheckoutSession(sessionId);
      this.returnSessionSummary.set(summary);
    } catch (err) {
      this.returnSessionError.set(
        err instanceof Error
          ? err.message
          : 'Could not load order confirmation.',
      );
    } finally {
      this.returnSessionLoading.set(false);
    }
  }

  formatPrice(unitAmount?: number | null, currency?: string | null): string {
    return formatStripeAmount(unitAmount, currency);
  }

  async onSubscribeVideoLibrary(): Promise<void> {
    const price = this.selectedPrice();
    if (!price) {
      this.checkoutError.set('Video library subscription pricing is currently unavailable.');
      return;
    }

    const user = this.user();
    if (!user) {
      this.checkoutError.set('You must be signed in to subscribe.');
      return;
    }

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    try {
      const origin = window.location.origin;
      const successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/class-video-library-subscription`;

      const { checkoutUrl } = await this.stripeService.createCheckoutSession(
        price.id,
        origin,
        1,
        {
          successUrl,
          cancelUrl,
          metadata: {
            memberDocId: user.member.docId,
            memberId: user.member.memberId || '',
            orderType: 'video',
          },
        },
      );

      this.redirectTo(checkoutUrl);
    } catch (err) {
      this.isRedirecting.set(false);
      this.checkoutError.set(
        err instanceof Error
          ? err.message
          : 'Failed to initiate video library checkout.',
      );
    }
  }

  redirectTo(url: string): void {
    window.location.assign(url);
  }

  async onCancelAutoRenew(): Promise<void> {
    const subId = this.user()?.member.classVideoLibrarySubscriptionId;
    if (!subId) return;

    const confirmed = confirm(
      'Are you sure you want to cancel auto-renewal for your Class Video Library subscription? You will retain access until your current expiration date.',
    );
    if (!confirmed) return;

    this.cancelInProgress.set(true);
    this.cancelSuccessMessage.set(null);
    this.cancelErrorMessage.set(null);

    try {
      const result = await this.stripeService.cancelSubscriptionRenewal(subId);
      this.cancelSuccessMessage.set(
        `Auto-renewal has been cancelled. Your access remains active until ${result.periodEnd}.`,
      );
    } catch (err) {
      this.cancelErrorMessage.set(
        err instanceof Error ? err.message : 'Failed to cancel auto-renewal.',
      );
    } finally {
      this.cancelInProgress.set(false);
    }
  }

  async onResumeAutoRenew(): Promise<void> {
    const subId = this.user()?.member.classVideoLibrarySubscriptionId;
    if (!subId) return;

    this.cancelInProgress.set(true);
    this.cancelSuccessMessage.set(null);
    this.cancelErrorMessage.set(null);

    try {
      const result = await this.stripeService.resumeSubscriptionRenewal(subId);
      this.cancelSuccessMessage.set(
        `Auto-renewal resumed. Next renewal date: ${result.nextAutoRenewDate}.`,
      );
    } catch (err) {
      this.cancelErrorMessage.set(
        err instanceof Error ? err.message : 'Failed to resume auto-renewal.',
      );
    } finally {
      this.cancelInProgress.set(false);
    }
  }
}
