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
  StripeProduct,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

export type SchoolLicenseAction = 'renew' | 'new';

@Component({
  selector: 'app-school-license-purchase',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
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

  // Stripe products loading
  productsLoading = signal(true);
  productsError = signal<string | null>(null);
  schoolProducts = signal<StripeProduct[]>([]);
  selectedPriceId = signal<string | null>(null);

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
      if (mDocId && (s as unknown as { memberDocId?: string }).memberDocId === mDocId) return true;
      return false;
    });
  });

  selectedSchool = computed<School | null>(() => {
    const docId = this.selectedSchoolDocId();
    if (!docId) return null;
    return this.mySchools().find((s) => s.docId === docId) || null;
  });

  // Recent school license orders from member's orders
  recentSchoolOrders = computed(() => {
    const orders = this.dataService.myOrders.entries();
    return orders.filter((o) =>
      o.lineItems?.some((li) => li.description.toLowerCase().includes('school')),
    );
  });

  constructor() {
    void this.loadProducts();

    // Auto-select first school if available
    const firstSchool = this.mySchools()[0];
    if (firstSchool) {
      this.selectedSchoolDocId.set(firstSchool.docId);
    } else {
      this.licenseAction.set('new');
    }

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
      const schProds = products.filter((p) => {
        const titleLower = p.name.toLowerCase();
        return (
          p.active &&
          titleLower.includes('school') &&
          p.prices.some((pr) => pr.active && pr.unitAmount !== null)
        );
      });
      this.schoolProducts.set(schProds);

      // Select default price (e.g. yearly or first active)
      for (const p of schProds) {
        const pr = p.prices.find((pr) => pr.active && pr.unitAmount !== null);
        if (pr) {
          this.selectedPriceId.set(pr.id);
          break;
        }
      }
    } catch (err) {
      this.productsError.set(
        err instanceof Error ? err.message : 'Failed to load school license products.',
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

  formatPrice(price: StripeProductPrice): string {
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
      return `${amount} / ${interval}`;
    }
    return `${amount} one-time`;
  }

  formatAmount(unitAmount?: number | null, currency?: string | null): string {
    if (unitAmount === null || unitAmount === undefined) return '';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(unitAmount / 100);
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

    if (this.licenseAction() === 'renew' && !this.selectedSchoolDocId()) {
      this.checkoutError.set('Please select the school you want to renew.');
      return;
    }

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    try {
      const origin = window.location.origin;
      const successUrl = `${origin}/school-license?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/school-license`;

      const targetSchool = this.selectedSchool();
      const metadata: Record<string, string> = {
        memberDocId: user.member.docId,
        memberId: user.member.memberId || '',
      };
      if (targetSchool) {
        metadata['schoolDocId'] = targetSchool.docId;
        metadata['schoolId'] = targetSchool.schoolId;
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
