/* order-complete.ts
 *
 * The "thanks for your order" / order confirmation page.
 * Stripe redirects the buyer here after checkout (or buyers view their receipt).
 * We read the session back via getStripeCheckoutSession and render tailored
 * welcome, benefits, and next-steps based on what was purchased (membership,
 * grading, license, video library, etc.).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { SpinnerComponent } from '../spinner/spinner.component';
import { IconComponent } from '../icons/icon.component';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { StripeService } from '../stripe.service';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { CheckoutSessionSummary } from '../../../functions/src/stripe-types';
import { Grading, School } from '../../../functions/src/data-model';

export type OrderKind =
  | 'membership'
  | 'grading'
  | 'license'
  | 'school_license'
  | 'video'
  | 'general';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; summary: CheckoutSessionSummary }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-order-complete',
  standalone: true,
  imports: [SpinnerComponent, IconComponent],
  templateUrl: './order-complete.html',
  styleUrl: './order-complete.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderCompleteComponent {
  private stripeService = inject(StripeService);
  private dataService = inject(DataManagerService);
  private firebaseStateService = inject(FirebaseStateService);
  public readonly Views = Views;
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  private sessionId = computed(() =>
    this.routingService.signals[Views.OrderComplete].urlParams.session_id(),
  );

  protected state = signal<LoadState>({ kind: 'idle' });

  latestGrading = computed<Grading | null>(() => {
    const user = this.firebaseStateService.user();
    if (!user) return null;
    const gradings = this.dataService.myGradings.entries();
    if (!gradings || gradings.length === 0) return null;

    const s = this.state();
    const summaryMeta = s.kind === 'loaded' ? s.summary.metadata : null;
    const targetLevel = summaryMeta?.['gradingLevel'];

    if (targetLevel) {
      const match = gradings.find((g) => g.level === targetLevel);
      if (match) return match;
    }

    // Sort by date / lastUpdated descending
    const sorted = [...gradings].sort((a, b) => {
      const dateA = a.gradingPurchaseDate || a.lastUpdated || '';
      const dateB = b.gradingPurchaseDate || b.lastUpdated || '';
      return dateB.localeCompare(dateA);
    });

    return sorted[0] || null;
  });

  latestGradingHref = computed<string>(() => {
    const g = this.latestGrading();
    if (!g) return this.routingService.hrefForView(Views.MemberGradings);
    return this.routingService.hrefForView(
      Views.GradingView,
      { gradingId: g.docId },
      { from: 'my-gradings' },
    );
  });

  isNewSchoolOrder = computed<boolean>(() => {
    const s = this.state();
    if (s.kind !== 'loaded') return false;
    const meta = s.summary.metadata || {};
    return meta['isNewSchool'] === 'true';
  });

  targetSchool = computed<School | null>(() => {
    const s = this.state();
    if (s.kind !== 'loaded') return null;
    const meta = s.summary.metadata || {};
    const isSchool =
      meta['orderType'] === 'school' ||
      meta['isNewSchool'] === 'true' ||
      !!meta['schoolDocId'] ||
      !!meta['schoolId'] ||
      s.summary.lineItems.some((item) =>
        item.description.toLowerCase().includes('school'),
      );

    if (!isSchool) return null;

    const allSchools = this.dataService.schools.entries();
    if (!allSchools || allSchools.length === 0) return null;

    const schoolDocId = meta['schoolDocId'];
    if (schoolDocId) {
      const found = allSchools.find((sch) => sch.docId === schoolDocId);
      if (found) return found;
    }

    const schoolId = meta['schoolId'];
    if (schoolId) {
      const found = allSchools.find((sch) => sch.schoolId === schoolId);
      if (found) return found;
    }

    const schoolName = meta['schoolName']?.trim();
    const user = this.firebaseStateService.user();
    const memberDocId = meta['memberDocId'] || user?.member?.docId;

    if (schoolName) {
      const found = allSchools.find(
        (sch) => sch.schoolName?.toLowerCase() === schoolName.toLowerCase(),
      );
      if (found) return found;
    }

    const isNew = meta['isNewSchool'] === 'true';
    if (memberDocId && !isNew) {
      const owned = allSchools.filter(
        (sch) => sch.ownerMemberDocId === memberDocId,
      );
      if (owned.length > 0) {
        const sorted = [...owned].sort((a, b) =>
          (b.lastUpdated || '').localeCompare(a.lastUpdated || ''),
        );
        return sorted[0];
      }
    }

    return null;
  });

  schoolNameFromOrder = computed<string>(() => {
    const s = this.state();
    if (s.kind !== 'loaded') return '';
    const meta = s.summary.metadata || {};
    return (
      meta['schoolName'] ||
      this.targetSchool()?.schoolName ||
      this.targetSchool()?.schoolId ||
      'Affiliated School'
    );
  });

  schoolProfileHref = computed<string>(() => {
    const school = this.targetSchool();
    if (!school) return this.routingService.hrefForView(Views.MySchools);
    return this.routingService.hrefForView(Views.SchoolView, {
      schoolId: school.schoolId || school.docId,
    });
  });

  schoolEditHref = computed<string>(() => {
    const school = this.targetSchool();
    if (!school) return this.routingService.hrefForView(Views.MySchools);
    return this.routingService.hrefForView(Views.MySchoolEdit, {
      schoolId: school.schoolId || school.docId,
    });
  });

  orderKind = computed<OrderKind>(() => {
    const s = this.state();
    if (s.kind !== 'loaded') return 'general';
    const meta = s.summary.metadata || {};
    if (meta['orderType'] === 'membership' || meta['membershipOption']) {
      return 'membership';
    }
    if (meta['gradingLevel'] || meta['orderType'] === 'grading') {
      return 'grading';
    }
    if (
      meta['orderType'] === 'school' ||
      meta['isNewSchool'] === 'true' ||
      !!meta['schoolDocId'] ||
      !!meta['schoolId']
    ) {
      return 'school_license';
    }
    if (meta['orderType'] === 'license') {
      return 'license';
    }
    if (meta['orderType'] === 'video') {
      return 'video';
    }

    const text = s.summary.lineItems
      .map((i) => i.description.toLowerCase())
      .join(' ');

    if (
      text.includes('membership') ||
      text.includes('annual') ||
      text.includes('lifetime') ||
      text.includes('life member')
    ) {
      return 'membership';
    }
    if (text.includes('grading')) {
      return 'grading';
    }
    if (text.includes('school')) {
      return 'school_license';
    }
    if (text.includes('license') || text.includes('instructor')) {
      return 'license';
    }
    if (text.includes('video') || text.includes('library')) {
      return 'video';
    }
    return 'general';
  });

  spouseInfo = computed<{ name: string; email: string } | null>(() => {
    const s = this.state();
    if (s.kind !== 'loaded') return null;
    const meta = s.summary.metadata || {};
    const email = meta['spouseEmail']?.trim() || '';
    const name = meta['spouseName']?.trim() || '';
    const isSpouseMembership =
      meta['membershipOption'] === 'life_spouse' ||
      !!email ||
      !!name ||
      s.summary.lineItems.some((item) =>
        item.description.toLowerCase().includes('spouse'),
      );

    if (isSpouseMembership) {
      return {
        email,
        name,
      };
    }
    return null;
  });

  constructor() {
    // Load (or reload) whenever the session_id in the URL changes.
    effect(() => {
      const sessionId = this.sessionId();
      if (!sessionId) {
        this.state.set({
          kind: 'error',
          message: 'No checkout session was provided.',
        });
        return;
      }
      void this.load(sessionId);
    });
  }

  private async load(sessionId: string): Promise<void> {
    this.state.set({ kind: 'loading' });
    try {
      const summary = await this.stripeService.getCheckoutSession(sessionId);
      this.state.set({ kind: 'loaded', summary });
    } catch (error) {
      this.state.set({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not load your order details.',
      });
    }
  }

  /** True once payment has completed (vs. still processing/unpaid). */
  isPaid(summary: CheckoutSessionSummary): boolean {
    return summary.paymentStatus === 'paid' || summary.status === 'complete';
  }

  formatMoney(amount: number | null, currency: string | null): string {
    if (amount === null || !currency) {
      return '';
    }
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  }
}
