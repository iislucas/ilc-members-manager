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
  Grading,
  GradingStatus,
  MembershipType,
  nextGradingLevel,
  gradingProgression,
  normalizeGradingLevel,
  achievedGradingLevels,
  isGradingPaid,
  unpaidGradingsInProgressionOrder,
  nextGradingPayment,
  StudentLevel,
  ApplicationLevel,
} from '../../../functions/src/data-model';
import {
  CheckoutSessionSummary,
  StripeProduct,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

import { InlineAuthComponent } from '../inline-auth/inline-auth.component';

@Component({
  selector: 'app-next-grading',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent, InlineAuthComponent],
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

  // Free retake creation state
  isCreatingRetake = signal(false);
  retakeError = signal<string | null>(null);

  // Whether user explicitly chose to buy advance subsequent level while retake is available
  buyingAdvanceLevel = signal(false);

  // Return landing state
  sessionId = computed(() => {
    return this.routingService.signals[Views.NextGrading].urlParams.session_id();
  });

  returnSessionLoading = signal(false);
  returnSessionSummary = signal<CheckoutSessionSummary | null>(null);
  returnSessionError = signal<string | null>(null);

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

  currentStudentLevel = computed(() => {
    const lvl = this.user()?.member.studentLevel;
    if (!lvl) return 'None';
    return `${lvl}`;
  });

  currentApplicationLevel = computed(() => {
    const lvl = this.user()?.member.applicationLevel;
    if (!lvl) return null;
    return `${lvl}`;
  });

  // Achieved levels from member record
  achievedLevels = computed(() => {
    const m = this.user()?.member;
    if (!m) return new Set<string>();
    return achievedGradingLevels(m.studentLevel, m.applicationLevel);
  });

  // The immediate next unpassed grading level based on student's current recorded member levels
  immediateNextLevel = computed(() => {
    const m = this.user()?.member;
    if (!m) return null;
    return nextGradingLevel(m.studentLevel, m.applicationLevel);
  });

  // All pending/open (unfinalized) gradings for the current member, sorted in canonical progression order
  pendingGradings = computed<Grading[]>(() => {
    const user = this.user();
    if (!user) return [];
    const gradings = this.dataService.myGradings.entries();
    const open = gradings.filter(
      (g) =>
        g.status !== GradingStatus.Passed &&
        g.status !== GradingStatus.NotPassed &&
        !!g.level,
    );
    return [...open].sort((a, b) => {
      const idxA = gradingProgression.indexOf(normalizeGradingLevel(a.level));
      const idxB = gradingProgression.indexOf(normalizeGradingLevel(b.level));
      const orderA = idxA === -1 ? 999 : idxA;
      const orderB = idxB === -1 ? 999 : idxB;
      return orderA - orderB;
    });
  });

  pendingLevelSet = computed(() => {
    return new Set(
      this.pendingGradings().map((g) => normalizeGradingLevel(g.level)),
    );
  });

  // Gradings the member still owes the HQ fee for, earliest in the progression
  // first. These are exactly what they still need to buy, so they must never be
  // skipped over when working out the next level to purchase. This deliberately
  // covers gradings that were already conducted but never paid for, not just
  // open ones — a payment settles them too.
  unpaidGradings = computed<Grading[]>(() => {
    const user = this.user();
    if (!user) return [];
    return unpaidGradingsInProgressionOrder(this.dataService.myGradings.entries());
  });

  // The earliest level (in progression order) with an unpaid grading record.
  // This is the grading a payment will be applied to.
  unpaidPendingLevel = computed(() => {
    const g = this.unpaidGradings()[0];
    return g ? normalizeGradingLevel(g.level) : '';
  });

  // Formatted list of all pending grading levels in progression order (e.g. "Student 2, Student 3")
  pendingLevelsList = computed(() => {
    return this.pendingGradings()
      .map((g) => g.level)
      .join(', ');
  });

  // The earliest pending grading in progression order that the student must complete first
  activeNextPendingGrading = computed<Grading | null>(() => {
    const pending = this.pendingGradings();
    return pending.length > 0 ? pending[0] : null;
  });

  // Check if member is eligible for a free retake at any level (has a NotPassed grading and no open/passed grading)
  retakeEligibleLevel = computed(() => {
    const user = this.user();
    if (!user) return '';
    const achieved = this.achievedLevels();
    const pending = this.pendingLevelSet();
    const gradings = this.dataService.myGradings.entries();

    for (const lvl of gradingProgression) {
      if (achieved.has(lvl)) continue;
      if (pending.has(lvl)) continue;

      // Only a paid failed attempt earns a free retake. An unpaid one still
      // owes its fee; paying it creates the follow-up grading automatically
      // (see onGradingUpdated), so it is offered as a purchase instead.
      const hasPaidNotPassed = gradings.some(
        (g) =>
          normalizeGradingLevel(g.level) === lvl &&
          g.status === GradingStatus.NotPassed &&
          isGradingPaid(g),
      );
      if (hasPaidNotPassed) {
        return lvl;
      }
    }
    return '';
  });

  retakeEligible = computed(() => !!this.retakeEligibleLevel());

  // Next level available for Stripe purchase: the first level along the
  // progression that is NOT achieved, NOT already paid for, and NOT a free
  // retake. A level with an unpaid grading record is still purchasable — that
  // outstanding fee is what the member came here to pay.
  // What the member's next grading payment applies to. This is the same
  // `nextGradingPayment` rule Stripe fulfillment uses to decide which grading a
  // payment settles, so the level offered here is always the level that gets
  // paid. A free retake is handled separately, so it is skipped.
  nextPayment = computed(() => {
    const m = this.user()?.member;
    if (!m) return { level: '', grading: null };
    return nextGradingPayment(
      m.studentLevel,
      m.applicationLevel,
      this.dataService.myGradings.entries(),
      this.retakeEligibleLevel(),
    );
  });

  nextPurchasableLevel = computed(() => this.nextPayment().level);

  // True when the level being purchased settles an existing unpaid grading
  // record rather than starting a brand-new one.
  isPayingForExistingGrading = computed(() => {
    const target = this.targetLevel();
    return !!target && target === this.nextPayment().level && !!this.nextPayment().grading;
  });

  // Selectable grading levels to purchase via Stripe
  selectableLevels = computed<Array<{ level: string; description: string }>>(() => {
    const purchasable = this.nextPurchasableLevel();
    if (!purchasable) return [];

    const retake = this.retakeEligibleLevel();
    const paidPending = this.pendingGradings().filter((g) => isGradingPaid(g));


    let desc = 'Next target grading level in the curriculum';
    if (purchasable === this.unpaidPendingLevel()) {
      desc = `Outstanding fee for your existing ${purchasable} grading`;
    } else if (retake) {
      desc = `Subsequent progression level (in advance, after your ${retake} retake)`;
    } else if (paidPending.length > 0) {
      desc = `Subsequent progression level (after your pending ${paidPending[0].level} grading)`;
    }

    return [{ level: purchasable, description: desc }];
  });

  // Target level for UI display & actions
  targetLevel = computed(() => {
    if (this.retakeEligible() && !this.buyingAdvanceLevel()) {
      return this.retakeEligibleLevel();
    }
    return this.nextPurchasableLevel() || this.immediateNextLevel() || null;
  });

  // Backwards compatibility alias
  nextLevel = computed(() => this.targetLevel());

  async onStartRetake(): Promise<void> {
    const user = this.user();
    const level = this.retakeEligibleLevel();
    if (!user || !level) return;
    this.isCreatingRetake.set(true);
    this.retakeError.set(null);
    try {
      const docId = await this.dataService.requestGradingRetake(
        user.member.docId,
        level,
      );
      this.routingService.navigateToParts(['gradings', docId]);
    } catch (err) {
      this.retakeError.set(
        err instanceof Error ? err.message : 'Failed to create retake grading.',
      );
    } finally {
      this.isCreatingRetake.set(false);
    }
  }

  // Find matching Stripe product & price for the target purchasable grading level
  matchingGradingPrice = computed<{
    product: StripeProduct;
    price: StripeProductPrice;
  } | null>(() => {
    // If user is doing the free retake and hasn't chosen to purchase advance level, no Stripe price is needed
    if (this.retakeEligible() && !this.buyingAdvanceLevel()) {
      return null;
    }

    const target = this.targetLevel();
    if (!target) return null;

    const nextLower = target.toLowerCase();
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

  // Check if member already has a pending or open grading for this target level
  alreadyHasGrading = computed(() => {
    return this.pendingGradings()[0] || null;
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
      const successUrl = `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;
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
            orderType: 'grading',
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
