/* next-grading.ts
 *
 * Dedicated purchase page for a member's gradings:
 *  1. Verifies login & active membership.
 *  2. Displays current level & the levels still to buy.
 *  3. Lets the member pick how many levels to buy ahead (always a prefix of the
 *     remaining progression) and finds the Stripe price for each.
 *  4. Initiates one Stripe Checkout redirect for all selected levels.
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
import { StripeProductsService } from '../stripe-products.service';
import { StripeService } from '../stripe.service';
import { NetworkStateService } from '../network-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { nextGradingLevel, gradingProgression, normalizeGradingLevel, achievedGradingLevels, progressionIndex, toGradingLevel, studentLevelLabel, applicationLevelLabel } from '../../../functions/src/data-model/curriculum';
import { Grading, GradingStatus, isGradingPaid, unpaidGradingsInProgressionOrder, upcomingGradingPayments, NextGradingPayment, freeRetakeLevel } from '../../../functions/src/data-model/gradings';
import { findGradingPrice, GradingPrice } from '../../../functions/src/data-model/grading-prices';
import { MembershipType, hasActiveMembership } from '../../../functions/src/data-model/members';
import {
  CheckoutSessionSummary,
  StripeProduct,
  StripeProductPrice,
} from '../../../functions/src/stripe-types';

import { InlineAuthComponent } from '../inline-auth/inline-auth.component';
import { PriceTableComponent } from '../price-table/price-table';
import { formatStripeAmount } from '../stripe-price-format';
import { StepTrackComponent } from '../step-track/step-track';
import { StepFlow } from '../step-track/step-flow';
import { StepCardComponent } from '../step-card/step-card';

import { environment } from '../../environments/environment';

@Component({
  selector: 'app-next-grading',
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
  templateUrl: './next-grading.html',
  styleUrl: './next-grading.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NextGradingComponent {
  protected firebaseService = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected stripeProductsService = inject(StripeProductsService);
  protected stripeService = inject(StripeService);
  protected networkState = inject(NetworkStateService);
  protected routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  isOffline = this.networkState.isOffline;

  Views = Views;
  environment = environment;
  adminEmail = environment.adminEmail;
  user = this.firebaseService.user;

  // Stripe catalogue. Injecting StripeProductsService is what loads it, so the
  // grading fees are on screen before the visitor signs in.
  allProducts = this.stripeProductsService.products;
  productsLoading = this.stripeProductsService.loading;
  productsError = this.stripeProductsService.error;

  /**
   * The rate for a grading the member can buy: on sale, and priced.
   */
  private static isSellable(price: StripeProductPrice): boolean {
    return price.active && price.unitAmount !== null;
  }

  /**
   * True when the rate is one of the syllabus levels rather than an extra. The
   * catalogue names rates 'Entry Level', 'Student Level 4', …; `toGradingLevel`
   * reads any of those spellings.
   */
  private static isSyllabusLevel(price: StripeProductPrice): boolean {
    return toGradingLevel(price.nickname) !== null;
  }

  /**
   * The grading fees, for the price breakdown above the flow.
   *
   * Grouped by what the reader is looking at rather than by how Stripe files
   * it: the student and application levels are the syllabus, and anything else
   * the catalogue carries — Meditation & Philosophy today, more later — is a
   * grading you can take but not a rung on the ladder, so it is gathered under
   * its own heading at the end. Display only; what a member actually buys is
   * resolved by `matchingGradingPrice` from the full catalogue.
   */
  gradingProducts = computed<StripeProduct[]>(() => {
    const gradingCatalogue = this.allProducts().filter(
      (p) =>
        p.active &&
        p.name.toLowerCase().includes('grading') &&
        p.prices.some(NextGradingComponent.isSellable),
    );

    const levelProducts: StripeProduct[] = [];
    const additional: StripeProductPrice[] = [];

    for (const product of gradingCatalogue) {
      const sellable = product.prices.filter(NextGradingComponent.isSellable);
      const levels = sellable.filter(NextGradingComponent.isSyllabusLevel);
      additional.push(
        ...sellable.filter((pr) => !NextGradingComponent.isSyllabusLevel(pr)),
      );
      if (levels.length) {
        levelProducts.push({ ...product, prices: levels });
      }
    }

    // Students work through the student levels before the application levels,
    // so the fee schedule reads in that order. Stripe returns them in the
    // order the products happened to be created.
    levelProducts.sort(
      (a, b) =>
        Number(b.name.toLowerCase().includes('student')) -
        Number(a.name.toLowerCase().includes('student')),
    );

    if (additional.length && gradingCatalogue[0]) {
      levelProducts.push({
        ...gradingCatalogue[0],
        id: 'grading-additional',
        name: 'GRADING : Additional Gradings',
        description: null,
        prices: additional,
      });
    }

    return levelProducts;
  });

  // Checkout redirecting
  isRedirecting = signal(false);
  checkoutError = signal<string | null>(null);

  // Free retake creation state
  isCreatingRetake = signal(false);
  retakeError = signal<string | null>(null);

  // Whether user explicitly chose to buy advance subsequent level while retake is available
  buyingAdvanceLevel = signal(false);

  // ──────────────────────────────────────────────────────────────────────────
  //  Wizard state — see become-a-member.ts for the same pattern.
  //
  //  Step 2 carries a real choice (free retake vs. buying the next level in
  //  advance) and the fee for it, so the grading is chosen and paid for in the
  //  one place.
  // ──────────────────────────────────────────────────────────────────────────

  readonly StepAccount = 1;
  readonly StepLevel = 2;

  flow = new StepFlow(
    computed(() => (this.isLoggedIn() ? this.StepLevel : this.StepAccount)),
    ['Account', 'Your Level'],
  );

  accountSummary = computed(() => {
    const u = this.user();
    return u?.member?.emails?.[0] || u?.firebaseUser?.email || '';
  });

  levelSummary = computed(() => {
    const target = this.targetLevel();
    const from = this.currentStudentLevel();
    if (!target) return `${from} — highest level achieved`;
    const isFreeRetake = this.retakeEligible() && !this.buyingAdvanceLevel();
    if (isFreeRetake) return `${from} → ${target} (free retake)`;
    const selected = this.selectedPurchases().map((o) => o.level);
    return `${from} → ${selected.length > 1 ? selected.join(', ') : target}`;
  });

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
    return m ? hasActiveMembership(m, this.today()) : false;
  });

  // The member's current levels as display labels: 'Student 3' (or 'Student
  // None'), and 'Application 1' or '' when they have no application level.
  currentStudentLevel = computed(
    () => studentLevelLabel(this.user()?.member.studentLevel) || 'Student None',
  );

  currentApplicationLevel = computed(() =>
    applicationLevelLabel(this.user()?.member.applicationLevel),
  );

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
      const idxA = progressionIndex(a.level);
      const idxB = progressionIndex(b.level);
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

  // The level the member can retake for free ('' if none) — the same shared
  // rule the server uses to skip it when checking a grading purchase.
  retakeEligibleLevel = computed(() => {
    const m = this.user()?.member;
    if (!m) return '';
    return freeRetakeLevel(m.studentLevel, m.applicationLevel, this.dataService.myGradings.entries());
  });

  retakeEligible = computed(() => !!this.retakeEligibleLevel());

  // Every grading payment the member could still make, in the order they are
  // applied. This is the same `nextGradingPayment` rule Stripe fulfillment uses
  // to decide which grading a payment settles, applied repeatedly — so each
  // level offered is exactly the level that payment will settle or create. A
  // free retake is handled separately, so it is skipped.
  upcomingPayments = computed<NextGradingPayment<Grading>[]>(() => {
    const m = this.user()?.member;
    if (!m) return [];
    return upcomingGradingPayments(
      m.studentLevel,
      m.applicationLevel,
      this.dataService.myGradings.entries(),
      this.retakeEligibleLevel(),
    );
  });

  // What the member's next grading payment applies to (the first of
  // `upcomingPayments`).
  nextPayment = computed<NextGradingPayment<Grading>>(
    () => this.upcomingPayments()[0] ?? { level: '', grading: null },
  );

  nextPurchasableLevel = computed(() => this.nextPayment().level);

  // True when the level being purchased settles an existing unpaid grading
  // record rather than starting a brand-new one.
  isPayingForExistingGrading = computed(() => {
    const target = this.targetLevel();
    return !!target && target === this.nextPayment().level && !!this.nextPayment().grading;
  });

  // Grading levels that can be purchased via Stripe, in the order they must be
  // bought (and graded). `settlesExisting` marks a level whose payment settles
  // an existing unpaid grading rather than creating a new one.
  selectableLevels = computed<
    Array<{ level: string; description: string; settlesExisting: boolean }>
  >(() => {
    const retake = this.retakeEligibleLevel();
    const paidPending = this.pendingGradings().filter((g) => isGradingPaid(g));

    return this.upcomingPayments().map((p, i, all) => {
      let desc = 'Next target grading level in the curriculum';
      if (p.grading) {
        desc = `Outstanding fee for your existing ${p.level} grading`;
      } else if (i > 0) {
        desc = `In advance — graded after your ${all[i - 1].level} grading`;
      } else if (retake) {
        desc = `Subsequent progression level (in advance, after your ${retake} retake)`;
      } else if (paidPending.length > 0) {
        desc = `Subsequent progression level (after your pending ${paidPending[paidPending.length - 1].level} grading)`;
      }
      return { level: p.level, description: desc, settlesExisting: !!p.grading };
    });
  });

  // How many of `selectableLevels` (from the start) the member has chosen to
  // buy. Levels are bought in order, so the selection is always a prefix.
  selectedCount = signal(1);

  // Tick or untick the level at `index`. Ticking a level also ticks every
  // earlier one; unticking it also unticks every later one.
  toggleLevel(index: number): void {
    this.selectedCount.set(index < this.selectedCount() ? index : index + 1);
  }

  // The levels on offer with their Stripe price (null when no price is found),
  // and whether each is currently selected.
  purchaseOptions = computed(() =>
    this.selectableLevels().map((opt, i) => ({
      ...opt,
      selected: i < this.selectedCount(),
      match: this.findGradingPrice(opt.level),
    })),
  );

  // The selected levels, in purchase order.
  selectedPurchases = computed(() =>
    this.purchaseOptions().filter((o) => o.selected),
  );

  // Selected levels the catalogue has no price for; checkout is blocked while
  // any exist.
  selectedLevelsWithoutPrice = computed(() =>
    this.selectedPurchases()
      .filter((o) => !o.match)
      .map((o) => o.level),
  );

  // True when the selected levels are priced in more than one currency.
  // Stripe can't charge mixed currencies in one checkout, so such a selection
  // must be split into separate orders (the server refuses it too).
  selectedMixedCurrencies = computed(() => {
    const currencies = new Set(
      this.selectedPurchases()
        .filter((o) => !!o.match)
        .map((o) => (o.match?.price.currency || '').toLowerCase()),
    );
    return currencies.size > 1;
  });

  // Total of the selected levels' fees, formatted (e.g. "$160.00"). '' when
  // nothing priced is selected, or the prices are in different currencies.
  selectedTotal = computed(() => {
    const priced = this.selectedPurchases().filter((o) => !!o.match);
    if (priced.length === 0 || this.selectedMixedCurrencies()) return '';
    const cents = priced.reduce(
      (sum, o) => sum + (o.match?.price.unitAmount ?? 0),
      0,
    );
    return this.formatPrice(cents, priced[0].match?.price.currency);
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
    return this.findGradingPrice(target);
  });

  // The Stripe product & price for grading `level`, or null when the
  // catalogue has none — the shared rule the server also uses to charge
  // (see `findGradingPrice`). Reads the reactive catalogue, so it is safe to
  // call from a `computed`. Display only: the server picks the actual prices.
  findGradingPrice(level: string): GradingPrice | null {
    return findGradingPrice(this.allProducts(), level);
  }

  // Check if member already has a pending or open grading for this target level
  alreadyHasGrading = computed(() => {
    return this.pendingGradings()[0] || null;
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

  // Buys every selected level in one Stripe checkout. Only the levels are sent:
  // the server checks they are the member's next levels and picks the prices
  // and order metadata itself (see createGradingCheckoutSession).
  async onPurchaseNextGrading(): Promise<void> {
    const selected = this.selectedPurchases();
    if (selected.length === 0 || this.selectedLevelsWithoutPrice().length > 0) {
      this.checkoutError.set('Grading pricing is currently unavailable.');
      return;
    }
    if (this.selectedMixedCurrencies()) {
      this.checkoutError.set(
        'These gradings are priced in different currencies, so please buy them in separate orders.',
      );
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
      const { checkoutUrl } = await this.stripeService.createGradingCheckoutSession({
        memberDocId: user.member.docId,
        levels: selected.map((o) => o.level),
        origin: window.location.origin,
      });
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
