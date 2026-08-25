/* become-a-member.ts
 *
 * Guided page walking a new or returning user through becoming an ILC member.
 * It is a wizard: only the step the user has to do now is expanded, earlier
 * steps collapse to a summary they can reopen, and later steps stay closed so
 * nobody tries to type into a field that is not ready for them yet.
 *
 *  1. Account   — sign in, or create an account, to link the new membership.
 *  2. Details   — name, date of birth, country, phone, address.
 *  3. Membership— Annual vs Lifetime (with Senior & Under 21 rates) from Stripe,
 *                 then straight on to Stripe Checkout, returning to the Home
 *                 page with a welcome notification on success.
 *
 * Members who already have a membership see their status banner instead, along
 * with cancel/resume auto-renewal.
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
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { StripeProductsService } from '../stripe-products.service';
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
import { PriceTableComponent } from '../price-table/price-table';
import {
  formatStripePrice,
  tidyStripeLabel,
} from '../stripe-price-format';
import { StepTrackComponent } from '../step-track/step-track';
import { StepFlow } from '../step-track/step-flow';
import { StepCardComponent } from '../step-card/step-card';

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
    StepTrackComponent,
    StepCardComponent,
    PriceTableComponent,
  ],
  templateUrl: './become-a-member.html',
  styleUrl: './become-a-member.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BecomeAMemberComponent {
  protected firebaseService = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected stripeProductsService = inject(StripeProductsService);
  protected stripeService = inject(StripeService);
  protected routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  environment = environment;
  Views = Views;
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

  // Spouse form fields (for life_spouse option)
  spouseName = signal('');
  spouseEmail = signal('');
  spouseDateOfBirth = signal('');

  isSpouseOptionSelected = computed(() => this.selectedOption() === 'life_spouse');

  // Stripe catalogue. Injecting StripeProductsService is what loads it, so the
  // rates are on screen before the visitor signs in, and sessions that never
  // reach this page never pay for it.
  productsLoading = this.stripeProductsService.loading;
  productsError = this.stripeProductsService.error;
  membershipProducts = computed(() =>
    this.stripeProductsService.products().filter((p) => {
      const titleLower = p.name.toLowerCase();
      return (
        p.active &&
        (titleLower.includes('membership') ||
          p.metadata?.['squarespace_categories']?.toLowerCase().includes('membership')) &&
        p.prices.some((price) => price.active && price.unitAmount !== null)
      );
    }),
  );
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

  // Helper to calculate age from a date string YYYY-MM-DD
  private calculateAgeFromDob(dobString: string): number | null {
    const dob = dobString.trim();
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
  }

  // Calculate age from dateOfBirth
  age = computed<number | null>(() => this.calculateAgeFromDob(this.dateOfBirth()));

  // Calculate spouse's age from spouseDateOfBirth
  spouseAge = computed<number | null>(() =>
    this.calculateAgeFromDob(this.spouseDateOfBirth()),
  );

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

  // ──────────────────────────────────────────────────────────────────────────
  //  Wizard state
  //
  //  The page shows one step at a time. `firstIncompleteStep` is derived purely
  //  from the data, so a step re-opens by itself the moment its answer stops
  //  being valid; `revisitedStep` only layers an explicit "Edit" jump on top.
  // ──────────────────────────────────────────────────────────────────────────

  readonly StepAccount = 1;
  readonly StepDetails = 2;
  readonly StepMembership = 3;

  membershipSelectionComplete = computed(() => {
    if (!this.selectedPriceId()) return false;
    if (!this.isSpouseOptionSelected()) return true;
    return !!(
      this.spouseName().trim() &&
      this.spouseEmail().trim() &&
      this.spouseDateOfBirth().trim()
    );
  });

  flow = new StepFlow(
    computed(() => {
      if (!this.isLoggedIn()) return this.StepAccount;
      if (!this.hasCompletedBasicInfo()) return this.StepDetails;
      return this.StepMembership;
    }),
    ['Account', 'Details', 'Membership'],
  );

  /** One-line recap of the signed-in account, shown when step 1 is collapsed. */
  accountSummary = computed(() => {
    const u = this.user();
    return u?.member?.emails?.[0] || u?.firebaseUser?.email || '';
  });

  /** One-line recap of the member details, shown when step 2 is collapsed. */
  detailsSummary = computed(() =>
    [this.name(), this.dateOfBirth(), this.countryWithCode()?.name]
      .filter((part) => !!part)
      .join(' • '),
  );

  hasActiveSubscription = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    return !!(
      m.membershipSubscriptionId &&
      m.membershipNextAutoRenewDate &&
      m.membershipNextAutoRenewDate >= this.today()
    );
  });

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
    badge: string;
    note: string;
    price: StripeProductPrice | null;
    product: StripeProduct | null;
  }>(() => {
    const lifeProds = this.lifetimeProducts().filter(
      (p) => !p.name.toLowerCase().includes('spouse'),
    );
    if (!lifeProds.length) {
      return {
        label: 'Lifetime Membership (Individual)',
        badge: '',
        note: 'One-time payment for lifetime individual membership access. Never expires.',
        price: null,
        product: null,
      };
    }

    const activePrices: { price: StripeProductPrice; product: StripeProduct }[] = [];
    for (const prod of lifeProds) {
      for (const pr of prod.prices) {
        if (!pr.active || pr.unitAmount === null) continue;
        const n = (pr.nickname || prod.name).toLowerCase();
        if (!n.includes('spouse')) {
          activePrices.push({ price: pr, product: prod });
        }
      }
    }

    if (!activePrices.length) {
      return {
        label: 'Lifetime Membership (Individual)',
        badge: '',
        note: 'One-time payment for lifetime individual membership access. Never expires.',
        price: null,
        product: null,
      };
    }

    const age = this.age();
    let matched: { price: StripeProductPrice; product: StripeProduct } | null = null;
    let label = 'Lifetime Membership (Individual)';
    let badge = '';
    let note = 'One-time payment for lifetime individual membership access. Never expires.';

    if (age !== null && age >= 65) {
      matched =
        activePrices.find(({ price }) => {
          const n = (price.nickname || '').toLowerCase();
          return n.includes('65') || n.includes('senior');
        }) || null;
      if (matched) {
        label = `Lifetime: 65+ Senior (${matched.price.nickname || 'Senior Rate'})`;
        badge = 'Senior Rate (65+)';
        note = `Special senior rate applied based on your date of birth (Age: ${age}). One-time payment for lifetime access. Never expires.`;
      }
    }

    if (!matched) {
      matched =
        activePrices.find(({ price }) => {
          const n = (price.nickname || '').toLowerCase();
          return (
            n.includes('regular') ||
            (!n.includes('65') && !n.includes('senior'))
          );
        }) ||
        activePrices[0] ||
        null;
      if (matched) {
        label = matched.price.nickname || 'Lifetime Membership (Individual)';
        if (age !== null) {
          badge = 'Standard Rate';
          note = `Standard lifetime rate for adults (Age: ${age}). One-time payment for lifetime access. Never expires.`;
        } else {
          note =
            'Standard lifetime rate. (Enter date of birth above to check senior eligibility). Never expires.';
        }
      }
    }

    return {
      label,
      badge,
      note,
      price: matched?.price || null,
      product: matched?.product || null,
    };
  });

  lifeSpouseOption = computed<{
    label: string;
    badge: string;
    note: string;
    price: StripeProductPrice | null;
    product: StripeProduct | null;
  }>(() => {
    const activePrices: { price: StripeProductPrice; product: StripeProduct }[] = [];
    for (const prod of this.membershipProducts()) {
      for (const pr of prod.prices) {
        if (!pr.active || pr.unitAmount === null) continue;
        const n = (pr.nickname || prod.name).toLowerCase();
        if (n.includes('spouse')) {
          activePrices.push({ price: pr, product: prod });
        }
      }
    }

    if (!activePrices.length) {
      return {
        label: 'Lifetime Membership (with Spouse)',
        badge: '',
        note: 'One-time payment for lifetime membership covering both you and your spouse. Never expires.',
        price: null,
        product: null,
      };
    }

    const primaryAge = this.age();
    const spouseAge = this.spouseAge();
    const isPrimarySenior = primaryAge !== null && primaryAge >= 65;
    const isSpouseSenior = spouseAge !== null && spouseAge >= 65;
    const isEitherSenior = isPrimarySenior || isSpouseSenior;

    let matched: { price: StripeProductPrice; product: StripeProduct } | null = null;
    let label = 'Lifetime Membership (with Spouse)';
    let badge = '';
    let note = 'One-time payment for lifetime membership covering both you and your spouse. Never expires.';

    if (isEitherSenior) {
      matched =
        activePrices.find(({ price }) => {
          const n = (price.nickname || '').toLowerCase();
          return n.includes('65') || n.includes('senior');
        }) || null;
      if (matched) {
        label = `Lifetime + Spouse: 65+ Senior (${matched.price.nickname || 'Senior Rate'})`;
        badge = 'Senior Rate (65+)';
        if (isPrimarySenior && isSpouseSenior) {
          note = `Special senior rate applied based on your date of birth (Age: ${primaryAge}) and spouse’s date of birth (Age: ${spouseAge}). One-time payment covering both you and your spouse. Never expires.`;
        } else if (isPrimarySenior) {
          note = `Special senior rate applied based on your date of birth (Age: ${primaryAge}). One-time payment covering both you and your spouse. Never expires.`;
        } else {
          note = `Special senior rate applied based on your spouse’s date of birth (Age: ${spouseAge}). One-time payment covering both you and your spouse. Never expires.`;
        }
      }
    }

    if (!matched) {
      matched =
        activePrices.find(({ price }) => {
          const n = (price.nickname || '').toLowerCase();
          return (
            n.includes('regular') ||
            (!n.includes('65') && !n.includes('senior'))
          );
        }) ||
        activePrices[0] ||
        null;
      if (matched) {
        label = matched.price.nickname || 'Lifetime Membership (with Spouse)';
        if (primaryAge !== null && spouseAge !== null) {
          badge = 'Standard Rate';
          note = `Standard lifetime rate for adults (Ages: ${primaryAge} & ${spouseAge}). One-time payment covering both you and your spouse. Never expires.`;
        } else if (primaryAge !== null) {
          badge = 'Standard Rate';
          note = `Standard lifetime rate for adults (Age: ${primaryAge}). One-time payment covering both you and your spouse. Never expires.`;
        } else {
          note =
            'Standard lifetime rate. (Enter dates of birth above to check senior eligibility). Never expires.';
        }
      }
    }

    return {
      label,
      badge,
      note,
      price: matched?.price || null,
      product: matched?.product || null,
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  //  Every rate, not just the applicable one
  //
  //  `applicableAnnualTier` and friends collapse a product down to the single
  //  price this member qualifies for. The overview list instead has to name all
  //  of them ("Regular $85.00/year; 65+ Senior $55.00/year"), which used to be
  //  written out by hand in the template and could drift from the catalogue.
  // ──────────────────────────────────────────────────────────────────────────

  /** "Regular $85.00/year; 65+ Senior $55.00/year" for one product. */
  private tierSummaryOf(product: StripeProduct | null): string {
    if (!product) return '';
    return product.prices
      .filter((p) => p.active && p.unitAmount !== null)
      .map((p) => {
        const label = tidyStripeLabel(p.nickname);
        const amount = formatStripePrice(p);
        return label ? `${label} ${amount}` : amount;
      })
      .join('; ');
  }

  annualTierSummary = computed(() => this.tierSummaryOf(this.annualProduct()));

  lifeIndividualTierSummary = computed(() =>
    this.tierSummaryOf(this.lifeIndividualOption().product),
  );

  lifeSpouseTierSummary = computed(() =>
    this.tierSummaryOf(this.lifeSpouseOption().product),
  );

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
        badge: lifeInd.badge,
        price: lifeInd.price,
        note: lifeInd.note,
      });
    }

    if (lifeSp.price) {
      options.push({
        type: 'life_spouse',
        title: lifeSp.label,
        pillLabel: 'Lifetime with Spouse',
        badge: lifeSp.badge,
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
    return formatStripePrice(price);
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

    if (this.isSpouseOptionSelected()) {
      const spName = this.spouseName().trim();
      const spEmail = this.spouseEmail().trim();
      const spDob = this.spouseDateOfBirth().trim();

      if (!spName || !spEmail || !spDob) {
        this.checkoutError.set(
          'Please enter your spouse’s full name, email address, and date of birth before proceeding.',
        );
        return;
      }
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

      const metadata: Record<string, string> = {
        memberDocId: user.member.docId,
        memberId: user.member.memberId || '',
        orderType: 'membership',
      };

      if (this.isSpouseOptionSelected()) {
        metadata['spouseName'] = this.spouseName().trim();
        metadata['spouseEmail'] = this.spouseEmail().trim().toLowerCase();
        metadata['spouseDob'] = this.spouseDateOfBirth().trim();
        metadata['spouseCountry'] = resolvedCountry.name;
      }

      const { checkoutUrl } = await this.stripeService.createCheckoutSession(
        priceId,
        origin,
        1,
        {
          successUrl,
          cancelUrl,
          metadata,
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
