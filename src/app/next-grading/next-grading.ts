/* next-grading.ts
 *
 * Dedicated purchase page for a member's next grading:
 *  1. Verifies login & active membership.
 *  2. Displays current level & next grading level.
 *  3. Finds matching Stripe product & price for the next grading level.
 *  4. Initiates Stripe Checkout redirect.
 *  5. On return with session_id, displays a setup spinner and order summary.
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
import {
  GradingStatus,
  MembershipType,
  nextGradingLevel,
} from '../../../functions/src/data-model';
import {
  CheckoutSessionSummary,
  StripeProduct,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

@Component({
  selector: 'app-next-grading',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent],
  templateUrl: './next-grading.html',
  styleUrl: './next-grading.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NextGradingComponent {
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
  allProducts = signal<StripeProduct[]>([]);

  // Checkout redirecting
  isRedirecting = signal(false);
  checkoutError = signal<string | null>(null);

  // Return landing state
  sessionId = computed(() => {
    return this.routingService.signals[Views.NextGrading].urlParams.session_id();
  });

  returnSessionLoading = signal(false);
  returnSessionSummary = signal<CheckoutSessionSummary | null>(null);
  returnSessionError = signal<string | null>(null);

  today = computed(() => new Date().toISOString().split('T')[0]);

  isLoggedIn = computed(() => !!this.user());

  isActiveMember = computed(() => {
    const m = this.user()?.member;
    if (!m) return false;
    if (m.membershipType === MembershipType.Life) return true;
    const expires = m.currentMembershipExpires;
    return !!expires && expires >= this.today();
  });

  currentStudentLevel = computed(() => {
    return this.user()?.member.studentLevel || 'None';
  });

  currentApplicationLevel = computed(() => {
    return this.user()?.member.applicationLevel || 'None';
  });

  nextLevel = computed(() => {
    const m = this.user()?.member;
    if (!m) return null;
    return nextGradingLevel(m.studentLevel, m.applicationLevel);
  });

  // Find matching Stripe product & price for the next grading level
  matchingGradingPrice = computed<{
    product: StripeProduct;
    price: StripeProductPrice;
  } | null>(() => {
    const next = this.nextLevel();
    if (!next) return null;

    const nextLower = next.toLowerCase();
    const products = this.allProducts();

    for (const prod of products) {
      const prodNameLower = prod.name.toLowerCase();
      if (!prod.active || !prodNameLower.includes('grading')) continue;

      for (const price of prod.prices) {
        if (!price.active || price.unitAmount === null) continue;
        const nickLower = (price.nickname || '').toLowerCase();

        // Exact or fuzzy match for level name
        // e.g. "student 1" matches "student level 1", "entry" matches "entry level", "application 1" matches "application level 1"
        if (
          nickLower === nextLower ||
          nickLower.includes(nextLower) ||
          (nextLower === 'student entry' && nickLower.includes('entry')) ||
          (nextLower.startsWith('student ') &&
            nickLower === `student level ${nextLower.replace('student ', '')}`) ||
          (nextLower.startsWith('application ') &&
            nickLower === `application level ${nextLower.replace('application ', '')}`)
        ) {
          return { product: prod, price };
        }
      }
    }

    // Fallback: look in student or application products
    if (nextLower.includes('student') || nextLower.includes('entry')) {
      const studentProd = products.find(
        (p) => p.active && p.name.toLowerCase().includes('student'),
      );
      if (studentProd) {
        const pMatch = studentProd.prices.find((pr) => {
          const n = (pr.nickname || '').toLowerCase();
          return (
            pr.active &&
            (n.includes(nextLower) ||
              (nextLower === 'student entry' && n.includes('entry')))
          );
        });
        if (pMatch) return { product: studentProd, price: pMatch };
      }
    } else if (nextLower.includes('application')) {
      const appProd = products.find(
        (p) => p.active && p.name.toLowerCase().includes('application'),
      );
      if (appProd) {
        const pMatch = appProd.prices.find((pr) => {
          const n = (pr.nickname || '').toLowerCase();
          return pr.active && n.includes(nextLower);
        });
        if (pMatch) return { product: appProd, price: pMatch };
      }
    }

    return null;
  });

  // Check if member already has a pending or open grading for this level
  alreadyHasGrading = computed(() => {
    const next = this.nextLevel();
    if (!next) return null;
    const gradings = this.dataService.myGradings.entries();
    return (
      gradings.find(
        (g) =>
          g.level?.toLowerCase() === next.toLowerCase() &&
          g.status !== GradingStatus.NotPassed,
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
      this.allProducts.set(products);
    } catch (err) {
      this.productsError.set(
        err instanceof Error ? err.message : 'Failed to load grading products.',
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

  async onPurchaseNextGrading(): Promise<void> {
    const match = this.matchingGradingPrice();
    if (!match) {
      this.checkoutError.set('Grading pricing is currently unavailable.');
      return;
    }

    const user = this.user();
    if (!user) {
      this.checkoutError.set('You must be signed in to purchase a grading.');
      return;
    }

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    try {
      const origin = window.location.origin;
      const successUrl = `${origin}/next-grading?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/next-grading`;

      const { checkoutUrl } = await this.stripeService.createCheckoutSession(
        match.price.id,
        origin,
        1,
        {
          successUrl,
          cancelUrl,
          metadata: {
            memberDocId: user.member.docId,
            memberId: user.member.memberId || '',
            gradingLevel: this.nextLevel() || '',
          },
        },
      );

      this.redirectTo(checkoutUrl);
    } catch (err) {
      this.isRedirecting.set(false);
      this.checkoutError.set(
        err instanceof Error
          ? err.message
          : 'Failed to initiate grading checkout.',
      );
    }
  }

  redirectTo(url: string): void {
    window.location.assign(url);
  }
}
