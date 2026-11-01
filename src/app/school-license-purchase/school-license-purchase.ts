/* school-license-purchase.ts
 *
 * Dedicated purchase & renewal page for ILC School Licenses:
 *  1. Lists existing schools managed/owned by the member with license & subscription status.
 *  2. Allows selecting an existing school to renew or purchasing for a new school.
 *     `/school-license?schoolId=SCH-123` pre-selects that school for renewal
 *     (linked from the school's page).
 *  3. Offers Yearly ($600/yr) and Monthly ($60/mo) Stripe billing options.
 *  4. Provides Cancel/Resume Auto-Renewal for school subscriptions.
 *  5. On return with session_id, displays renewal spinner and order status.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  linkedSignal,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { StripeProductsService } from '../stripe-products.service';
import { StripeService } from '../stripe.service';
import { NetworkStateService } from '../network-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { hasActiveMembership } from '../../../functions/src/data-model/members';
import { School } from '../../../functions/src/data-model/schools';
import {
  CheckoutSessionSummary,
  ManagedSchoolBillingInfo,
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
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { SubscriptionCardComponent } from '../subscription-card/subscription-card';
import {
  DisplaySubscriptionCard,
  SubscriptionCardStatus,
  buildSchoolSubscriptionCards,
  getManagedSchoolsForUser,
} from '../subscription-card/subscription-card.model';

export type SchoolLicenseAction = 'renew' | 'new';

import { environment } from '../../environments/environment';

@Component({
  selector: 'app-school-license-purchase',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SpinnerComponent,
    InlineAuthComponent,
    AutocompleteComponent,
    StepTrackComponent,
    StepCardComponent,
    SubscriptionCardComponent,
  ],
  templateUrl: './school-license-purchase.html',
  styleUrl: './school-license-purchase.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolLicensePurchaseComponent {
  protected firebaseService = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected stripeProductsService = inject(StripeProductsService);
  protected stripeService = inject(StripeService);
  protected networkState = inject(NetworkStateService);
  protected routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  isOffline = this.networkState.isOffline;

  Views = Views;
  SubscriptionCardStatus = SubscriptionCardStatus;
  environment = environment;
  adminEmail = environment.adminEmail;
  user = this.firebaseService.user;

  // Stripe catalogue. Injecting StripeProductsService is what loads it, so the
  // licence fee is on screen before the visitor signs in.
  productsLoading = this.stripeProductsService.loading;
  productsError = this.stripeProductsService.error;
  schoolProducts = computed(() =>
    this.stripeProductsService.products().filter((p) => {
      const titleLower = p.name.toLowerCase();
      return (
        p.active &&
        titleLower.includes('school') &&
        p.prices.some((pr) => pr.active && pr.unitAmount !== null)
      );
    }),
  );

  // Defaults to the first active licence price, and re-derives if the
  // catalogue changes underneath it.
  selectedPriceId = linkedSignal<string | null>(() => {
    for (const prod of this.schoolProducts()) {
      const pr = prod.prices.find((p) => p.active && p.unitAmount !== null);
      if (pr) return pr.id;
    }
    return null;
  });

  selectedPrice = computed<StripeProductPrice | null>(() => {
    const id = this.selectedPriceId();
    for (const prod of this.schoolProducts()) {
      const p = prod.prices.find((pr) => pr.id === id);
      if (p) return p;
    }
    return null;
  });

  // Human-readable schoolId from the `?schoolId=` URL param (e.g. from the
  // "Renew License" link on a school's page); '' when absent.
  urlSchoolId = computed(
    () =>
      this.routingService.signals[Views.SchoolLicensePurchase].urlParams.schoolId() ||
      '',
  );

  // Optional `?tab=renew|new` URL param for deep-linking to either tab.
  urlTab = computed(
    () =>
      this.routingService.signals[Views.SchoolLicensePurchase].urlParams.tab() ||
      '',
  );

  // Mode: renew existing vs new school. Defaults to 'renew' when the member
  // manages any renewable school (unless `?tab=new` is in the URL); re-derives
  // only if that changes (e.g. once the schools list loads), so a manual choice
  // is kept.
  licenseAction = linkedSignal<
    { hasRenewableSchools: boolean; urlTab: string },
    SchoolLicenseAction
  >({
    source: () => ({
      hasRenewableSchools: this.renewableSchools().length > 0,
      urlTab: this.urlTab(),
    }),
    computation: ({ hasRenewableSchools, urlTab }) => {
      if (!hasRenewableSchools) return 'new';
      if (urlTab === 'new' || urlTab === 'renew') return urlTab;
      return 'renew';
    },
  });

  setLicenseAction(action: SchoolLicenseAction): void {
    const resolved: SchoolLicenseAction =
      action === 'renew' && this.renewableSchools().length === 0
        ? 'new'
        : action;
    this.licenseAction.set(resolved);
    this.routingService.signals[Views.SchoolLicensePurchase].urlParams.tab.set(
      resolved,
    );
  }

  onLicenseTabKeydown(event: KeyboardEvent): void {
    let next: SchoolLicenseAction | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      next = this.licenseAction() === 'renew' ? 'new' : 'renew';
    } else if (event.key === 'Home') {
      next = 'renew';
    } else if (event.key === 'End') {
      next = 'new';
    }
    if (!next) return;

    event.preventDefault();
    this.setLicenseAction(next);
    const tablist = (event.currentTarget as HTMLElement | null)?.closest(
      '[role="tablist"]',
    );
    const targetTab = tablist?.querySelector<HTMLButtonElement>(
      `#school-license-tab-${this.licenseAction()}`,
    );
    targetTab?.focus();
  }

  // The school being renewed. Keeps the current choice while it is still one
  // of the member's renewable schools; otherwise defaults to the school named
  // in the URL, falling back to the first renewable managed school.
  selectedSchoolDocId = linkedSignal<
    { schools: School[]; wantedSchoolId: string },
    string | null
  >({
    source: () => ({
      schools: this.renewableSchools(),
      wantedSchoolId: this.urlSchoolId(),
    }),
    computation: ({ schools, wantedSchoolId }, previous) => {
      if (
        previous?.value &&
        previous.source.wantedSchoolId === wantedSchoolId &&
        schools.some((s) => s.docId === previous.value)
      ) {
        return previous.value;
      }
      const wanted = wantedSchoolId
        ? schools.find((s) => s.schoolId === wantedSchoolId)
        : undefined;
      return (wanted ?? schools[0])?.docId ?? null;
    },
  });

  // New school form fields
  newSchoolName = signal('');
  newSchoolCountry = signal('');
  newSchoolCity = signal('');
  newSchoolCountyOrState = signal('');
  newSchoolAddress = signal('');
  newSchoolZipCode = signal('');
  newSchoolWebsite = signal('');

  countryDisplayFns = {
    toChipId: (c: { id: string; name: string }) => c.id,
    toName: (c: { id: string; name: string }) => c.name,
  };

  countryWithCode = computed(() => {
    const cName = this.newSchoolCountry().trim();
    if (!cName) return null;
    return (
      this.dataService.countries.entries().find(
        (c) =>
          c.name.toLowerCase() === cName.toLowerCase() ||
          c.id.toLowerCase() === cName.toLowerCase(),
      ) || null
    );
  });

  // Checkout redirecting
  isRedirecting = signal(false);
  checkoutError = signal<string | null>(null);

  // Return landing state
  sessionId = computed(() => {
    return this.routingService.signals[Views.SchoolLicensePurchase].urlParams.session_id();
  });

  returnSessionLoading = signal(false);
  returnSessionSummary = signal<CheckoutSessionSummary | null>(null);
  returnSessionError = signal<string | null>(null);

  // Subscription management
  managedSchoolsBilling = signal<Record<string, ManagedSchoolBillingInfo>>({});
  private lastLoadedBillingKey = '';

  today = computed(() => new Date().toISOString().split('T')[0]);

  isLoggedIn = computed(() => !!this.user());

  // ── Guided flow. See step-flow.ts. ──
  readonly StepAccount = 1;
  readonly StepSchool = 2;

  /**
   * Step 2 is complete once there is a school to charge for: either one picked
   * to renew, or enough detail to register a new one. This is the single source
   * of truth for both the step gate and the checkout button.
   */
  schoolDetailsComplete = computed(() => {
    if (this.licenseAction() === 'renew') {
      return !!this.selectedSchool();
    }
    return !!(
      this.newSchoolName().trim() &&
      this.newSchoolCountry().trim() &&
      this.newSchoolCity().trim()
    );
  });

  flow = new StepFlow(
    computed(() => {
      if (!this.isLoggedIn()) return this.StepAccount;
      return this.StepSchool;
    }),
    ['Account', 'School'],
  );

  accountSummary = computed(() => {
    const u = this.user();
    return u?.member?.emails?.[0] || u?.firebaseUser?.email || '';
  });

  schoolSummary = computed(() => {
    if (this.licenseAction() !== 'renew') {
      const parts = [this.newSchoolName(), this.newSchoolCity(), this.newSchoolCountry()];
      return parts.filter((part) => !!part.trim()).join(' • ');
    }
    return this.selectedSchool()?.schoolName || '';
  });

  async onLogout(): Promise<void> {
    await this.firebaseService.logout();
  }

  isActiveMember = computed(() => {
    const m = this.user()?.member;
    return m ? hasActiveMembership(m, this.today()) : false;
  });

  // Schools owned/managed by this member
  mySchools = computed<School[]>(() =>
    getManagedSchoolsForUser(this.dataService.schools.entries(), this.user()),
  );

  // Managed schools eligible for renewal (excludes lifetime licenses)
  renewableSchools = computed<School[]>(() =>
    this.mySchools().filter((s) => !this.isSchoolLifetimeLicense(s)),
  );

  selectedSchool = computed<School | null>(() => {
    const docId = this.selectedSchoolDocId();
    if (!docId) return null;
    return this.renewableSchools().find((s) => s.docId === docId) || null;
  });

  managedSchoolCards = computed<DisplaySubscriptionCard[]>(() => {
    const u = this.user();
    if (!u) return [];
    const schools = this.mySchools();
    if (schools.length === 0) return [];
    const wantedSchoolId = this.urlSchoolId();
    const orderedSchools = wantedSchoolId
      ? [
          ...schools.filter((s) => s.schoolId === wantedSchoolId),
          ...schools.filter((s) => s.schoolId !== wantedSchoolId),
        ]
      : schools;

    return buildSchoolSubscriptionCards({
      member: u.member,
      schools: orderedSchools,
      billingMap: this.managedSchoolsBilling(),
      orders: this.dataService.myOrders.entries(),
      todayStr: this.today(),
      baseSchoolLicenseUrl:
        this.routingService.hrefForView(Views.SchoolLicensePurchase) ||
        '/school-license',
    }).allSchoolCards;
  });

  schoolCardByDocId = computed<Record<string, DisplaySubscriptionCard>>(() => {
    const map: Record<string, DisplaySubscriptionCard> = {};
    for (const card of this.managedSchoolCards()) {
      if (card.schoolDocId) {
        map[card.schoolDocId] = card;
      }
    }
    return map;
  });

  selectSchoolForRenewal(schoolDocId: string): void {
    if (!this.renewableSchools().some((s) => s.docId === schoolDocId)) {
      return;
    }
    this.setLicenseAction('renew');
    this.selectedSchoolDocId.set(schoolDocId);
    this.flow.goTo(this.StepSchool);
  }

  constructor() {
    const userCountry = this.user()?.member?.country;
    if (userCountry) {
      this.newSchoolCountry.set(userCountry);
    }

    const sId = this.sessionId();
    if (sId) {
      void this.loadReturnSession(sId);
    }

    effect(() => {
      const u = this.user();
      const schools = this.mySchools();
      if (!u || schools.length === 0) {
        this.lastLoadedBillingKey = '';
        untracked(() => this.managedSchoolsBilling.set({}));
        return;
      }
      const key = `${u.member.docId}:${schools.map((s) => s.docId).sort().join(',')}`;
      if (key === this.lastLoadedBillingKey) return;
      this.lastLoadedBillingKey = key;
      void this.loadManagedSchoolsBilling();
    });
  }

  async loadManagedSchoolsBilling(): Promise<void> {
    if (typeof this.stripeService.getManagedSchoolsBilling !== 'function') {
      return;
    }
    try {
      const res = await this.stripeService.getManagedSchoolsBilling();
      this.managedSchoolsBilling.set(res?.schools || {});
    } catch {
      // Fail closed silently if billing lookup fails
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

  formatPrice(price: StripeProductPrice): string {
    return formatStripePrice(price);
  }

  /**
   * The licence fee, for the page subtitle. There is only one rate, so it
   * belongs in the sentence describing what you get rather than in a table of
   * its own.
   */
  headlinePrice = computed(() => formatStripePrice(this.selectedPrice()));

  formatAmount(unitAmount?: number | null, currency?: string | null): string {
    return formatStripeAmount(unitAmount, currency);
  }

  // An empty schoolLicenseExpires (or 'life' / '9999-12-31' sentinel) means a
  // lifetime license (as in the ACL builder in on-member-update.ts), which
  // counts as active and never needs renewing.
  isSchoolLifetimeLicense(school: School): boolean {
    const exp = school.schoolLicenseExpires.trim().toLowerCase();
    return !exp || exp === 'life' || exp === '9999-12-31';
  }

  isSchoolActive(school: School): boolean {
    if (this.isSchoolLifetimeLicense(school)) return true;
    return school.schoolLicenseExpires >= this.today();
  }

  async onPurchaseSchoolLicense(): Promise<void> {
    const priceId = this.selectedPriceId();
    if (!priceId) {
      this.checkoutError.set('Please select a school license billing option.');
      return;
    }

    const user = this.user();
    if (!user) {
      this.checkoutError.set('You must be signed in to purchase a school license.');
      return;
    }

    if (this.licenseAction() === 'renew') {
      if (!this.selectedSchool()) {
        this.checkoutError.set('Please select the school you want to renew.');
        return;
      }
    } else {
      if (!this.newSchoolName().trim()) {
        this.checkoutError.set('Please enter a name for your new school.');
        return;
      }
      if (!this.newSchoolCountry().trim()) {
        this.checkoutError.set('Please select or enter the country for your new school.');
        return;
      }
      if (!this.newSchoolCity().trim()) {
        this.checkoutError.set('Please enter the city for your new school.');
        return;
      }
    }

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    try {
      const origin = window.location.origin;
      const successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/school-license`;

      const metadata: Record<string, string> = {
        memberDocId: user.member.docId,
        memberId: user.member.memberId || '',
        orderType: 'school',
      };

      if (this.licenseAction() === 'renew') {
        const targetSchool = this.selectedSchool();
        if (targetSchool) {
          metadata['schoolDocId'] = targetSchool.docId;
          metadata['schoolId'] = targetSchool.schoolId;
        }
      } else {
        metadata['isNewSchool'] = 'true';
        metadata['schoolName'] = this.newSchoolName().trim();
        metadata['schoolCountry'] = this.newSchoolCountry().trim();
        metadata['schoolCity'] = this.newSchoolCity().trim();
        metadata['schoolCountyOrState'] = this.newSchoolCountyOrState().trim();
        metadata['schoolAddress'] = this.newSchoolAddress().trim();
        metadata['schoolZipCode'] = this.newSchoolZipCode().trim();
        metadata['schoolWebsite'] = this.newSchoolWebsite().trim();
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
          : 'Failed to initiate school license checkout.',
      );
    }
  }

  redirectTo(url: string): void {
    window.location.assign(url);
  }
}
