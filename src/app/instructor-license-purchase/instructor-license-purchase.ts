/* instructor-license-purchase.ts
 *
 * Dedicated purchase & renewal page for ILC Instructor Licenses:
 *  1. Checks eligibility: logged in, active member, application level >= 1.
 *  2. Shows past instructor license details (or HQ record status).
 *  3. Displays active recurring subscription status and order details, with Cancel/Resume Auto-Renewal.
 *  4. Presents 1-year instructor license pricing and Stripe Checkout redirect.
 *  5. On return landing with session_id, displays spinner and order status.
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
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MembershipType } from '../../../functions/src/data-model';
import {
  CheckoutSessionSummary,
  StripeProduct,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

@Component({
  selector: 'app-instructor-license-purchase',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent],
  templateUrl: './instructor-license-purchase.html',
  styleUrl: './instructor-license-purchase.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstructorLicensePurchaseComponent {
  protected firebaseService = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected stripeService = inject(StripeService);
  protected routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  Views = Views;
  user = this.firebaseService.user;

  // Stripe products loading
  productsLoading = signal(true);
  productsError = signal<string | null>(null);
  licenseProducts = signal<StripeProduct[]>([]);

  // Checkout redirecting
  isRedirecting = signal(false);
  checkoutError = signal<string | null>(null);

  // Return landing state
  sessionId = computed(() => {
    return this.routingService.signals[Views.InstructorLicensePurchase].urlParams.session_id();
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

  async onLogout(): Promise<void> {
    await this.firebaseService.logout();
  }

  isActiveMember = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    if (m.membershipType === MembershipType.Life) return true;
    const expires = m.currentMembershipExpires;
    return !!expires && expires >= this.today();
  });

  hasAppLevel1 = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    const appLvl = m.applicationLevel?.trim();
    if (!appLvl) return false;
    const num = parseInt(appLvl, 10);
    return !isNaN(num) && num >= 1;
  });

  hasInstructorId = computed(() => {
    return !!this.user()?.member.instructorId?.trim();
  });

  instructorId = computed(() => {
    return this.user()?.member.instructorId?.trim() || '';
  });

  hasLicenseDates = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    return !!(m.instructorLicenseExpires || m.instructorLicenseRenewalDate);
  });

  licenseExpires = computed(() => {
    return this.user()?.member.instructorLicenseExpires || '';
  });

  licenseRenewalDate = computed(() => {
    return this.user()?.member.instructorLicenseRenewalDate || '';
  });

  isLicenseActive = computed(() => {
    const exp = this.licenseExpires();
    return !!exp && exp >= this.today();
  });

  hasActiveSubscription = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    return !!(
      m.instructorLicenseSubscriptionId &&
      m.instructorLicenseNextAutoRenewDate &&
      m.instructorLicenseNextAutoRenewDate >= this.today()
    );
  });

  selectedPrice = computed<StripeProductPrice | null>(() => {
    for (const prod of this.licenseProducts()) {
      const p = prod.prices.find((pr) => pr.active && pr.unitAmount !== null);
      if (p) return p;
    }
    return null;
  });

  // Recent instructor license orders from member's orders
  recentLicenseOrder = computed(() => {
    const orders = this.dataService.myOrders.entries();
    return (
      orders.find((o) =>
        o.lineItems?.some(
          (li) =>
            li.description.toLowerCase().includes('instructor') ||
            li.description.toLowerCase().includes('license'),
        ),
      ) || null
    );
  });

  constructor() {
    void this.loadProducts();
    const sId = this.sessionId();
    if (sId) {
      void this.loadReturnSession(sId);
    }
  }

  async loadProducts(): Promise<void> {
    this.productsLoading.set(true);
    this.productsError.set(null);
    try {
      const { products } = await this.stripeService.listProducts();
      const licProds = products.filter((p) => {
        const titleLower = p.name.toLowerCase();
        return (
          p.active &&
          (titleLower.includes('instructor') ||
            (titleLower.includes('license') && !titleLower.includes('school'))) &&
          p.prices.some((pr) => pr.active && pr.unitAmount !== null)
        );
      });
      this.licenseProducts.set(licProds);
    } catch (err) {
      this.productsError.set(
        err instanceof Error ? err.message : 'Failed to load license products.',
      );
    } finally {
      this.productsLoading.set(false);
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
    if (unitAmount === null || unitAmount === undefined) return '';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(unitAmount / 100);
  }

  async onPurchaseInstructorLicense(): Promise<void> {
    const price = this.selectedPrice();
    if (!price) {
      this.checkoutError.set('Instructor license pricing is currently unavailable.');
      return;
    }

    const user = this.user();
    if (!user) {
      this.checkoutError.set('You must be signed in to purchase a license.');
      return;
    }

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    try {
      const origin = window.location.origin;
      const successUrl = `${origin}/instructor-license?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/instructor-license`;

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
            instructorId: user.member.instructorId || '',
          },
        },
      );

      this.redirectTo(checkoutUrl);
    } catch (err) {
      this.isRedirecting.set(false);
      this.checkoutError.set(
        err instanceof Error
          ? err.message
          : 'Failed to initiate instructor license checkout.',
      );
    }
  }

  redirectTo(url: string): void {
    window.location.assign(url);
  }

  async onCancelAutoRenew(): Promise<void> {
    const subId = this.user()?.member.instructorLicenseSubscriptionId;
    if (!subId) return;

    const confirmed = confirm(
      'Are you sure you want to cancel auto-renewal for your instructor license? You will retain access until your current expiry date.',
    );
    if (!confirmed) return;

    this.cancelInProgress.set(true);
    this.cancelSuccessMessage.set(null);
    this.cancelErrorMessage.set(null);

    try {
      const result = await this.stripeService.cancelSubscriptionRenewal(subId);
      this.cancelSuccessMessage.set(
        `Auto-renewal has been cancelled. Your instructor license remains valid until ${result.periodEnd}.`,
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
    const subId = this.user()?.member.instructorLicenseSubscriptionId;
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
