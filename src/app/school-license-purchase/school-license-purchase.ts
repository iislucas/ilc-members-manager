/* school-license-purchase.ts
 *
 * Dedicated purchase & renewal page for ILC School Licenses:
 *  1. Lists existing schools managed/owned by the member with license & subscription status.
 *  2. Allows selecting an existing school to renew or purchasing for a new school.
 *  3. Offers Yearly ($600/yr) and Monthly ($60/mo) Stripe billing options.
 *  4. Provides Cancel/Resume Auto-Renewal for school subscriptions.
 *  5. On return with session_id, displays renewal spinner and order status.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  linkedSignal,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  MembershipType,
  School,
} from '../../../functions/src/data-model';
import {
  CheckoutSessionSummary,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

import { InlineAuthComponent } from '../inline-auth/inline-auth.component';
import { PriceTableComponent } from '../price-table/price-table';
import {
  formatStripeAmount,
  formatStripePrice,
} from '../stripe-price-format';
import { StepTrackComponent } from '../step-track/step-track';
import { StepFlow } from '../step-track/step-flow';
import { StepCardComponent } from '../step-card/step-card';
import { AutocompleteComponent } from '../autocomplete/autocomplete';

export type SchoolLicenseAction = 'renew' | 'new';

@Component({
  selector: 'app-school-license-purchase',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    InlineAuthComponent,
    AutocompleteComponent,
    StepTrackComponent,
    StepCardComponent,
    PriceTableComponent,
  ],
  templateUrl: './school-license-purchase.html',
  styleUrl: './school-license-purchase.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolLicensePurchaseComponent {
  protected firebaseService = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected stripeService = inject(StripeService);
  protected routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  Views = Views;
  user = this.firebaseService.user;

  // Stripe catalogue, read from the cached copy so the licence fee is on
  // screen before the visitor signs in.
  productsLoading = this.dataService.stripeProductsLoading;
  productsError = this.dataService.stripeProductsError;
  schoolProducts = computed(() =>
    this.dataService.stripeProducts().filter((p) => {
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

  // Mode: renew existing vs new school
  licenseAction = signal<SchoolLicenseAction>('renew');
  selectedSchoolDocId = signal<string | null>(null);

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
  cancelInProgress = signal(false);
  cancelSuccessMessage = signal<string | null>(null);
  cancelErrorMessage = signal<string | null>(null);

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
      return !!this.selectedSchoolDocId() || this.mySchools().length === 0;
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
    const docId = this.selectedSchoolDocId();
    const school = this.mySchools().find((s) => s.docId === docId);
    return school?.schoolName || '';
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

  // Schools owned/managed by this member
  mySchools = computed<School[]>(() => {
    const u = this.user();
    if (!u) return [];
    const all = this.dataService.schools.entries();
    const managedIds = new Set(u.schoolsManaged || []);
    const insId = u.member.instructorId?.trim();
    const mDocId = u.member.docId;

    return all.filter((s) => {
      if (s.schoolId && managedIds.has(s.schoolId)) return true;
      if (insId && s.ownerInstructorId === insId) return true;
      if (insId && s.managerInstructorIds?.includes(insId)) return true;
      if (mDocId && s.ownerMemberDocId === mDocId) return true;
      return false;
    });
  });

  selectedSchool = computed<School | null>(() => {
    const docId = this.selectedSchoolDocId();
    if (!docId) return null;
    return this.mySchools().find((s) => s.docId === docId) || null;
  });

  constructor() {
    // Auto-select first school if available
    const firstSchool = this.mySchools()[0];
    if (firstSchool) {
      this.selectedSchoolDocId.set(firstSchool.docId);
    } else {
      this.licenseAction.set('new');
    }

    const userCountry = this.user()?.member?.country;
    if (userCountry) {
      this.newSchoolCountry.set(userCountry);
    }

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

  formatPrice(price: StripeProductPrice): string {
    return formatStripePrice(price);
  }

  formatAmount(unitAmount?: number | null, currency?: string | null): string {
    return formatStripeAmount(unitAmount, currency);
  }

  isSchoolActive(school: School): boolean {
    const exp = school.schoolLicenseExpires;
    return !!exp && exp >= this.today();
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
      if (!this.selectedSchoolDocId()) {
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
