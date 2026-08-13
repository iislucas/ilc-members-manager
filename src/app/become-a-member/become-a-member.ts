/* become-a-member.ts
 *
 * Guided page walking a new or returning user through becoming an ILC member:
 *  1. Ensures the user is signed in (or prompts email/password/Google sign-in).
 *  2. Collects basic member information (name, date of birth, country, phone, address).
 *  3. Offers membership options (Annual vs Lifetime, with Senior & Under 21 rates) fetched from Stripe.
 *  4. Shows existing subscription details and cancel/resume auto-renewal if already subscribed.
 *  5. Redirects to Stripe Checkout, returning to the Home page with a welcome notification on success.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { MembershipType } from '../../../functions/src/data-model';
import {
  StripeProduct,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';
import { environment } from '../../environments/environment';

import { InlineAuthComponent } from '../inline-auth/inline-auth.component';

export type MembershipOptionType = 'annual' | 'life_individual' | 'life_spouse';

@Component({
  selector: 'app-become-a-member',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
    InlineAuthComponent,
  ],
  templateUrl: './become-a-member.html',
  styleUrl: './become-a-member.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BecomeAMemberComponent {
  protected firebaseService = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected stripeService = inject(StripeService);
  protected routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  environment = environment;
  Views = Views;
  LoginStatus = LoginStatus;
  user = this.firebaseService.user;

  // Form fields
  name = linkedSignal(() => this.user()?.member?.name || '');
  dateOfBirth = linkedSignal(() => this.user()?.member?.dateOfBirth || '');
  country = linkedSignal(() => this.user()?.member?.country || '');
  phone = linkedSignal(() => this.user()?.member?.phone || '');
  address = linkedSignal(() => this.user()?.member?.address || '');
  city = linkedSignal(() => this.user()?.member?.city || '');
  zipCode = linkedSignal(() => this.user()?.member?.zipCode || '');
  countyOrState = linkedSignal(() => this.user()?.member?.countyOrState || '');
  gender = linkedSignal(() => this.user()?.member?.gender || '');

  // Login form state (if not logged in)
  loginEmail = signal('');
  loginPassword = signal('');
  showPassword = signal(false);
  isSigningUp = signal(false);
  authError = signal<string | null>(null);
  authLoading = signal(false);

  // Stripe product state
  productsLoading = signal(true);
  productsError = signal<string | null>(null);
  membershipProducts = signal<StripeProduct[]>([]);
  selectedOption = signal<MembershipOptionType>('annual');

  // Checkout redirect state
  isRedirecting = signal(false);
  checkoutError = signal<string | null>(null);

  // Subscription management state
  cancelInProgress = signal(false);
  cancelSuccessMessage = signal<string | null>(null);
  cancelErrorMessage = signal<string | null>(null);

  countryDisplayFns = {
    toChipId: (c: { id: string; name: string }) => c.id,
    toName: (c: { id: string; name: string }) => c.name,
  };

  countryWithCode = computed(() => {
    const cName = this.country().trim();
    if (!cName) return null;
    return (
      this.dataService.countries.entries().find(
        (c) =>
          c.name.toLowerCase() === cName.toLowerCase() ||
          c.id.toLowerCase() === cName.toLowerCase(),
      ) || null
    );
  });

  isLoggedIn = computed(() => !!this.user());

  today = computed(() => new Date().toISOString().split('T')[0]);

  // Calculate age from dateOfBirth
  age = computed<number | null>(() => {
    const dob = this.dateOfBirth().trim();
    if (!dob) return null;
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let calculatedAge = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      calculatedAge--;
    }
    return calculatedAge >= 0 ? calculatedAge : null;
  });

  isLifeMember = computed(() => {
    return this.user()?.member?.membershipType === MembershipType.Life;
  });

  hasActiveAnnualMembership = computed(() => {
    const m = this.user()?.member;
    if (!m || m.membershipType !== MembershipType.Annual) return false;
    const expires = m.currentMembershipExpires;
    return !!expires && expires >= this.today();
  });

  hasExpiredMembership = computed(() => {
    const m = this.user()?.member;
    if (!m || m.membershipType === MembershipType.Life) return false;
    const expires = m.currentMembershipExpires;
    return !!expires && expires < this.today();
  });

  isExistingActiveMember = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    if (m.membershipType === MembershipType.Life) return true;
    const expires = m.currentMembershipExpires;
    return !!expires && expires >= this.today();
  });

  hasCompletedBasicInfo = computed(() => {
    return !!(
      this.name().trim() &&
      this.dateOfBirth().trim() &&
      this.countryWithCode()
    );
  });

  isBasicInfoCollapsed = linkedSignal(() => {
    return this.isExistingActiveMember() && this.hasCompletedBasicInfo();
  });

  toggleBasicInfoCollapse(): void {
    this.isBasicInfoCollapsed.set(!this.isBasicInfoCollapsed());
  }

  hasActiveSubscription = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    return !!(
      m.membershipSubscriptionId &&
      m.membershipNextAutoRenewDate &&
      m.membershipNextAutoRenewDate >= this.today()
    );
  });

  constructor() {
    void this.loadStripeProducts();
  }

  async loadStripeProducts(): Promise<void> {
    this.productsLoading.set(true);
    this.productsError.set(null);
    try {
      const { products } = await this.stripeService.listProducts();
      const memProducts = products.filter((p) => {
        const titleLower = p.name.toLowerCase();
        return (
          p.active &&
          (titleLower.includes('membership') ||
            p.metadata?.['squarespace_categories']?.toLowerCase().includes('membership')) &&
          p.prices.some((price) => price.active && price.unitAmount !== null)
        );
      });
      this.membershipProducts.set(memProducts);
    } catch (err) {
      this.productsError.set(
        err instanceof Error ? err.message : 'Failed to load membership products.',
      );
    } finally {
      this.productsLoading.set(false);
    }
  }

  annualProduct = computed(() => {
    return (
      this.membershipProducts().find(
        (p) =>
          p.name.toLowerCase().includes('annual') ||
          p.prices.some((pr) => pr.type === 'recurring'),
      ) || null
    );
  });

  lifetimeProducts = computed(() => {
    return this.membershipProducts().filter(
      (p) =>
        p.name.toLowerCase().includes('life') &&
        p.prices.some((pr) => pr.type === 'one_time'),
    );
  });

  // Automatically determine the applicable annual price and tier based on member's age
  applicableAnnualTier = computed<{
    label: string;
    badge: string;
    note: string;
    price: StripeProductPrice | null;
    product: StripeProduct | null;
  }>(() => {
    const annualProd = this.annualProduct();
    if (!annualProd) {
      return {
        label: 'Annual Membership',
        badge: '',
        note: 'Auto-renews annually. Cancel anytime from your account.',
        price: null,
        product: null,
      };
    }

    const activePrices = annualProd.prices.filter(
      (p) => p.active && p.unitAmount !== null,
    );
    const age = this.age();

    let matchedPrice: StripeProductPrice | null = null;
    let label = 'Annual Membership';
    let badge = '';
    let note = 'Auto-renews annually. Cancel anytime from your account.';

    if (age !== null && age < 21) {
      matchedPrice =
        activePrices.find((p) => {
          const n = (p.nickname || '').toLowerCase();
          return (
            n.includes('21') ||
            n.includes('under') ||
            n.includes('youth') ||
            n.includes('junior')
          );
        }) || null;
      if (matchedPrice) {
        label = `Annual: Under 21 (${matchedPrice.nickname || 'Youth Rate'})`;
        badge = 'Youth Rate (Under 21)';
        note = `Special youth rate applied based on your date of birth (Age: ${age}). Auto-renews annually.`;
      }
    } else if (age !== null && age >= 65) {
      matchedPrice =
        activePrices.find((p) => {
          const n = (p.nickname || '').toLowerCase();
          return n.includes('65') || n.includes('senior');
        }) || null;
      if (matchedPrice) {
        label = `Annual: 65+ Senior (${matchedPrice.nickname || 'Senior Rate'})`;
        badge = 'Senior Rate (65+)';
        note = `Special senior rate applied based on your date of birth (Age: ${age}). Auto-renews annually.`;
      }
    }

    if (!matchedPrice) {
      matchedPrice =
        activePrices.find((p) => {
          const n = (p.nickname || '').toLowerCase();
          return (
            n.includes('regular') ||
            (!n.includes('65') &&
              !n.includes('senior') &&
              !n.includes('21') &&
              !n.includes('under'))
          );
        }) ||
        activePrices[0] ||
        null;
      if (age !== null) {
        badge = 'Standard Rate';
        note = `Standard annual rate for adults (Age: ${age}). Auto-renews annually.`;
      } else {
        note =
          'Standard annual rate. (Enter date of birth above to check youth / senior eligibility). Auto-renews annually.';
      }
    }

    return {
      label,
      badge,
      note,
      price: matchedPrice,
      product: annualProd,
    };
  });

  lifeIndividualOption = computed<{
    label: string;
    note: string;
    price: StripeProductPrice | null;
    product: StripeProduct | null;
  }>(() => {
    for (const prod of this.lifetimeProducts()) {
      if (prod.name.toLowerCase().includes('spouse')) continue;
      for (const pr of prod.prices) {
        if (!pr.active || pr.unitAmount === null) continue;
        const n = (pr.nickname || prod.name).toLowerCase();
        if (!n.includes('spouse')) {
          return {
            label: pr.nickname || 'Lifetime Membership (Individual)',
            note: 'One-time payment for lifetime individual membership access. Never expires.',
            price: pr,
            product: prod,
          };
        }
      }
    }
    return {
      label: 'Lifetime Membership (Individual)',
      note: 'One-time payment for lifetime individual membership access. Never expires.',
      price: null,
      product: null,
    };
  });

  lifeSpouseOption = computed<{
    label: string;
    note: string;
    price: StripeProductPrice | null;
    product: StripeProduct | null;
  }>(() => {
    for (const prod of this.membershipProducts()) {
      for (const pr of prod.prices) {
        if (!pr.active || pr.unitAmount === null) continue;
        const n = (pr.nickname || prod.name).toLowerCase();
        if (n.includes('spouse')) {
          return {
            label: pr.nickname || 'Lifetime Membership (with Spouse)',
            note: 'One-time payment for lifetime membership covering both you and your spouse. Never expires.',
            price: pr,
            product: prod,
          };
        }
      }
    }
    return {
      label: 'Lifetime Membership (with Spouse)',
      note: 'One-time payment for lifetime membership covering both you and your spouse. Never expires.',
      price: null,
      product: null,
    };
  });

  membershipOptions = computed(() => {
    const annual = this.applicableAnnualTier();
    const lifeInd = this.lifeIndividualOption();
    const lifeSp = this.lifeSpouseOption();

    const options: Array<{
      type: MembershipOptionType;
      title: string;
      pillLabel: string;
      badge?: string;
      price: StripeProductPrice | null;
      note: string;
    }> = [];

    if (annual.price) {
      options.push({
        type: 'annual',
        title: annual.label,
        pillLabel: 'Annual',
        badge: annual.badge,
        price: annual.price,
        note: annual.note,
      });
    }

    if (lifeInd.price) {
      options.push({
        type: 'life_individual',
        title: lifeInd.label,
        pillLabel: 'Lifetime Individual',
        price: lifeInd.price,
        note: lifeInd.note,
      });
    }

    if (lifeSp.price) {
      options.push({
        type: 'life_spouse',
        title: lifeSp.label,
        pillLabel: 'Lifetime with Spouse',
        price: lifeSp.price,
        note: lifeSp.note,
      });
    }

    return options;
  });

  selectedPriceId = computed<string | null>(() => {
    const opt = this.selectedOption();
    if (opt === 'annual') {
      return this.applicableAnnualTier().price?.id || null;
    }
    if (opt === 'life_individual') {
      return this.lifeIndividualOption().price?.id || null;
    }
    if (opt === 'life_spouse') {
      return this.lifeSpouseOption().price?.id || null;
    }
    return null;
  });

  selectedOptionDetails = computed(() => {
    const opt = this.selectedOption();
    return (
      this.membershipOptions().find((o) => o.type === opt) ||
      this.membershipOptions()[0] ||
      null
    );
  });

  formatPrice(price: StripeProductPrice | null | undefined): string {
    if (!price) return '';
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
      return `${amount}/${interval}`;
    }
    return `${amount} one-time`;
  }

  async onLogout(): Promise<void> {
    await this.firebaseService.logout();
  }

  // Authentication actions
  async onLoginWithEmail(): Promise<void> {
    const email = this.loginEmail().trim();
    const password = this.loginPassword();
    if (!email || !password) return;

    this.authLoading.set(true);
    this.authError.set(null);
    const result = await this.firebaseService.loginWithEmail(password, email);
    this.authLoading.set(false);
    if (!result.success) {
      this.authError.set(result.errorCode || 'Sign in failed.');
    }
  }

  async onSignupWithEmail(): Promise<void> {
    const email = this.loginEmail().trim();
    const password = this.loginPassword();
    if (!email || !password) return;

    this.authLoading.set(true);
    this.authError.set(null);
    const result = await this.firebaseService.signupWithEmail(password, email);
    this.authLoading.set(false);
    if (!result.success) {
      this.authError.set(result.errorCode || 'Account creation failed.');
    }
  }

  async onLoginWithGoogle(): Promise<void> {
    this.authLoading.set(true);
    this.authError.set(null);
    const result = await this.firebaseService.loginWithGoogle();
    this.authLoading.set(false);
    if (!result.success && result.errorCode !== 'auth/cancelled-popup-request') {
      this.authError.set(result.errorCode || 'Google sign-in failed.');
    }
  }

  // Profile save & Proceed to Stripe checkout
  async onProceedToPayment(): Promise<void> {
    if (this.isLifeMember()) {
      this.checkoutError.set(
        'You already have an active Lifetime Membership. No additional purchase is needed.',
      );
      return;
    }

    const priceId = this.selectedPriceId();
    if (!priceId) {
      this.checkoutError.set('Please select a membership option.');
      return;
    }

    const user = this.user();
    if (!user) {
      this.checkoutError.set('Please sign in or create an account first.');
      return;
    }

    const memberName = this.name().trim();
    const memberDob = this.dateOfBirth().trim();
    const resolvedCountry = this.countryWithCode();

    if (!memberName || !memberDob || !resolvedCountry) {
      if (!resolvedCountry && this.country().trim()) {
        const errorMsg = `Unrecognized country "${this.country()}". Please select a valid country from the list. If your country is missing, please contact ${environment.adminEmail}.`;
        console.error(errorMsg);
        this.checkoutError.set(errorMsg);
      } else {
        this.checkoutError.set(
          'Please enter your full name, date of birth, and select a valid country before proceeding.',
        );
      }
      return;
    }

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    try {
      // Save updated profile info to Firestore member doc first
      await this.dataService.updateMember(
        user.member.docId,
        {
          ...user.member,
          name: memberName,
          dateOfBirth: memberDob,
          country: resolvedCountry.name,
          phone: this.phone().trim(),
          address: this.address().trim(),
          city: this.city().trim(),
          zipCode: this.zipCode().trim(),
          countyOrState: this.countyOrState().trim(),
          gender: this.gender().trim(),
        },
        user.member,
      );

      const origin = window.location.origin;
      const successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/become-a-member`;

      const { checkoutUrl } = await this.stripeService.createCheckoutSession(
        priceId,
        origin,
        1,
        {
          successUrl,
          cancelUrl,
          metadata: {
            memberDocId: user.member.docId,
            memberId: user.member.memberId || '',
            orderType: 'membership',
          },
        },
      );

      this.redirectTo(checkoutUrl);
    } catch (err) {
      this.isRedirecting.set(false);
      this.checkoutError.set(
        err instanceof Error
          ? err.message
          : 'Failed to initiate checkout. Please try again.',
      );
    }
  }

  redirectTo(url: string): void {
    window.location.assign(url);
  }

  // Cancel auto-renewal
  async onCancelAutoRenew(): Promise<void> {
    const subId = this.user()?.member.membershipSubscriptionId;
    if (!subId) return;

    const confirmed = confirm(
      'Are you sure you want to cancel auto-renewal for your membership? You will retain access until your current expiry date.',
    );
    if (!confirmed) return;

    this.cancelInProgress.set(true);
    this.cancelSuccessMessage.set(null);
    this.cancelErrorMessage.set(null);

    try {
      const result = await this.stripeService.cancelSubscriptionRenewal(subId);
      this.cancelSuccessMessage.set(
        `Auto-renewal has been cancelled. Your membership remains active until ${result.periodEnd}.`,
      );
    } catch (err) {
      this.cancelErrorMessage.set(
        err instanceof Error ? err.message : 'Failed to cancel auto-renewal.',
      );
    } finally {
      this.cancelInProgress.set(false);
    }
  }

  // Resume auto-renewal
  async onResumeAutoRenew(): Promise<void> {
    const subId = this.user()?.member.membershipSubscriptionId;
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
