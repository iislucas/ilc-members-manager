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
import { InstructorLicenseType, MembershipType } from '../../../functions/src/data-model';
import {
  CheckoutSessionSummary,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

import { InlineAuthComponent } from '../inline-auth/inline-auth.component';
import { PriceTableComponent } from '../price-table/price-table';
import { formatStripeAmount } from '../stripe-price-format';
import { StepTrackComponent } from '../step-track/step-track';
import { StepFlow } from '../step-track/step-flow';
import { StepCardComponent } from '../step-card/step-card';

@Component({
  selector: 'app-instructor-license-purchase',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    SpinnerComponent,
    InlineAuthComponent,
    StepTrackComponent,
    StepCardComponent,
    PriceTableComponent,
  ],
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
  // Stripe catalogue, read from the cached copy so the licence fee is on
  // screen before the visitor signs in.
  productsLoading = this.dataService.stripeProductsLoading;
  productsError = this.dataService.stripeProductsError;
  licenseProducts = computed(() =>
    this.dataService.stripeProducts().filter((p) => {
      const titleLower = p.name.toLowerCase();
      return (
        p.active &&
        (titleLower.includes('instructor') ||
          titleLower.includes('group leader') ||
          (titleLower.includes('license') && !titleLower.includes('school'))) &&
        p.prices.some((pr) => pr.active && pr.unitAmount !== null)
      );
    }),
  );

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

  // ── Guided flow. See step-flow.ts. Step 2 shows the licence status the user
  //    should read, and the fee and payment button for it. ──
  readonly StepAccount = 1;
  readonly StepEligibility = 2;

  flow = new StepFlow(
    computed(() => {
      if (!this.isLoggedIn()) return this.StepAccount;
      return this.StepEligibility;
    }),
    ['Account', 'Eligibility'],
  );

  accountSummary = computed(() => {
    const u = this.user();
    return u?.member?.emails?.[0] || u?.firebaseUser?.email || '';
  });

  eligibilitySummary = computed(() => {
    if (!this.isActiveMember()) return 'Active membership required';
    if (!this.isEligibleForLicense()) return 'Not currently eligible';
    const expires = this.licenseExpires();
    if (!expires) return 'Eligible — no licence on record yet';
    return this.isLicenseActive()
      ? `Licence active until ${expires}`
      : `Licence expired ${expires}`;
  });

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

  studentLevelNum = computed<number>(() => {
    const lvl = this.user()?.member.studentLevel?.trim() || '';
    if (!lvl || lvl.toLowerCase() === 'entry') return 0;
    const match = lvl.match(/\d+/);
    if (match) return parseInt(match[0], 10);
    const num = parseInt(lvl, 10);
    return isNaN(num) ? 0 : num;
  });

  applicationLevelNum = computed<number>(() => {
    const lvl = this.user()?.member.applicationLevel?.trim() || '';
    if (!lvl) return 0;
    const match = lvl.match(/\d+/);
    if (match) return parseInt(match[0], 10);
    const num = parseInt(lvl, 10);
    return isNaN(num) ? 0 : num;
  });

  hasAppLevel1 = computed(() => {
    return this.applicationLevelNum() >= 1;
  });

  hasStudentLevel2 = computed(() => {
    return this.studentLevelNum() >= 2;
  });

  hasInstructorId = computed(() => {
    return !!this.user()?.member.instructorId?.trim();
  });

  instructorId = computed(() => {
    return this.user()?.member.instructorId?.trim() || '';
  });

  isLifeInstructor = computed(() => {
    const m = this.user()?.member;
    return (
      m?.instructorLicenseType === InstructorLicenseType.Life ||
      m?.instructorLicenseExpires === '9999-12-31'
    );
  });

  isInstructorTier = computed(() => {
    return (
      this.hasAppLevel1() ||
      this.hasInstructorId() ||
      this.isLifeInstructor()
    );
  });

  isGroupLeaderTier = computed(() => {
    return !this.isInstructorTier() && this.hasStudentLevel2();
  });

  isEligibleForLicense = computed(() => {
    return this.isInstructorTier() || this.isGroupLeaderTier();
  });

  isBelowLevelPrerequisites = computed(() => {
    return !this.isEligibleForLicense();
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

  productOptionTitle = computed<string>(() => {
    if (this.isGroupLeaderTier()) {
      return '1-Year Group Leader License';
    }
    if (this.isInstructorTier()) {
      return '1-Year Certified Instructor License';
    }
    return '1-Year Certified Instructor & Group Leader License';
  });

  productOptionDescription = computed<string>(() => {
    if (this.isGroupLeaderTier()) {
      return 'Provides an official Group Leader License for 1 full year. Automatically transitions to an Instructor License once you grade Application Level 1.';
    }
    if (this.isInstructorTier()) {
      return 'Extends your instructor license for 1 full year from your current expiration date (or starting today if new/expired).';
    }
    return 'Extends your license for 1 full year from your current expiration date (or starting today if new/expired).';
  });

  checkoutButtonText = computed<string>(() => {
    const active = this.isLicenseActive();
    if (this.isGroupLeaderTier()) {
      return active ? 'Renew Group Leader License' : 'Get Group Leader License';
    }
    if (this.isInstructorTier()) {
      return active ? 'Renew Instructor License' : 'Get Instructor License';
    }
    return active ? 'Renew License' : 'Get License';
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
            li.description.toLowerCase().includes('license') ||
            li.description.toLowerCase().includes('group leader'),
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
      const successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
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
            orderType: 'license',
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
