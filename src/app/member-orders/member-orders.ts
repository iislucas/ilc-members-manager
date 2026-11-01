import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  Grading,
  gradingDisplayId,
  orderDisplayNumber,
} from '../../../functions/src/data-model/gradings';
import {
  isLifeMember as isLifeMemberStatus,
  isLifeInstructor as isLifeInstructorStatus,
} from '../../../functions/src/data-model/members';
import { MemberOrder } from '../../../functions/src/data-model/orders';
import { School } from '../../../functions/src/data-model/schools';
import { ManagedSchoolBillingInfo } from '../../../functions/src/stripe-types';
import { SubscriptionCardComponent } from '../subscription-card/subscription-card';
import {
  DisplaySubscriptionCard,
  SubscriptionCardCategory,
  SubscriptionCardStatus,
  buildAllMemberSubscriptionCards,
  getManagedSchoolsForUser,
  isMemberGroupLeaderTier,
  isMemberInstructorTier,
} from '../subscription-card/subscription-card.model';

export {
  SubscriptionCardCategory,
  SubscriptionCardStatus,
};
export type { DisplaySubscriptionCard };

@Component({
  selector: 'app-member-orders',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    SubscriptionCardComponent,
  ],
  templateUrl: './member-orders.html',
  styleUrl: './member-orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemberOrdersComponent {
  dataService = inject(DataManagerService);
  firebaseStateService = inject(FirebaseStateService);
  stripeService = inject(StripeService);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  Views = Views;
  user = this.firebaseStateService.user;

  searchQuery = signal('');
  actionError = signal<string | null>(null);
  portalLoading = signal(false);
  managedSchoolsBilling = signal<Record<string, ManagedSchoolBillingInfo>>({});
  private lastLoadedBillingKey = '';

  today = computed(() => new Date().toISOString().split('T')[0]);

  mySchools = computed<School[]>(() =>
    getManagedSchoolsForUser(
      this.dataService.schools?.entries() ?? [],
      this.user(),
    ),
  );

  constructor() {
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

  isLifeMember = computed(() => {
    const m = this.user()?.member;
    return m ? isLifeMemberStatus(m) : false;
  });

  isLifeInstructor = computed(() => {
    const m = this.user()?.member;
    return m ? isLifeInstructorStatus(m) : false;
  });

  isInstructorTier = computed<boolean>(() => {
    const m = this.user()?.member;
    return m ? isMemberInstructorTier(m) : false;
  });

  isGroupLeaderTier = computed<boolean>(() => {
    const m = this.user()?.member;
    return m ? isMemberGroupLeaderTier(m) : false;
  });

  licenseCardSubtitle = computed<string>(() => {
    if (this.isGroupLeaderTier()) {
      return 'Obtain or renew 1-year group leader license (becomes instructor license on grading Application 1).';
    }
    if (this.isInstructorTier()) {
      return 'Obtain or renew 1-year certified instructor teaching license.';
    }
    return 'Obtain or renew 1-year instructor or group leader license.';
  });

  private allSubscriptionCards = computed(() => {
    const u = this.user();
    if (!u) {
      return {
        subscriptions: [] as DisplaySubscriptionCard[],
        otherPayerSchoolSubscriptions: [] as DisplaySubscriptionCard[],
      };
    }
    return buildAllMemberSubscriptionCards({
      member: u.member,
      managedSchools: this.mySchools(),
      billingMap: this.managedSchoolsBilling(),
      orders: this.dataService.myOrders.entries(),
      todayStr: this.today(),
      urls: {
        membership: this.routingService.hrefForView(Views.BecomeAMember),
        instructorLicense: this.routingService.hrefForView(
          Views.InstructorLicensePurchase,
        ),
        videoLibrary: this.routingService.hrefForView(
          Views.ClassVideoLibraryPurchase,
        ),
        schoolLicense: this.routingService.hrefForView(
          Views.SchoolLicensePurchase,
        ),
      },
    });
  });

  // Schools owned or managed by this member where another member (or nobody) is the payer
  otherPayerSchoolSubscriptions = computed<DisplaySubscriptionCard[]>(
    () => this.allSubscriptionCards().otherPayerSchoolSubscriptions,
  );

  // Active Subscriptions Card List (member's own subscriptions + school licenses they pay for)
  subscriptions = computed<DisplaySubscriptionCard[]>(
    () => this.allSubscriptionCards().subscriptions,
  );

  // Filtered Orders Subcollection List
  orders = computed<MemberOrder[]>(() => {
    const raw = this.dataService.myOrders.entries();
    const query = this.searchQuery().toLowerCase().trim();

    if (!query) return raw;

    return raw.filter((o) => {
      const matchDocId = (o.orderDocId || o.docId || '').toLowerCase().includes(query);
      const matchNum = (o.orderNumber || '').toLowerCase().includes(query);
      const matchOrderNumber = this.getOrderNumber(o).toLowerCase().includes(query);
      const matchGradingId = this.getGradingId(o).toLowerCase().includes(query);
      const matchDesc = (o.description || '').toLowerCase().includes(query);
      const matchDate = (o.date || '').toLowerCase().includes(query);
      const matchType = (o.orderType || '').toLowerCase().includes(query);
      const matchStatus = (o.paymentStatus || '').toLowerCase().includes(query);
      return (
        matchDocId ||
        matchNum ||
        matchOrderNumber ||
        matchGradingId ||
        matchDesc ||
        matchDate ||
        matchType ||
        matchStatus
      );
    });
  });

  async onOpenCustomerPortal() {
    this.actionError.set(null);
    this.portalLoading.set(true);

    try {
      const returnUrl = window.location.href;
      const result =
        await this.stripeService.createCustomerPortalSession(returnUrl);
      if (result?.url) {
        window.location.href = result.url;
      } else {
        this.portalLoading.set(false);
      }
    } catch (err: unknown) {
      this.portalLoading.set(false);
      const msg = err instanceof Error ? err.message : String(err);
      this.actionError.set(
        `Unable to open billing portal: ${msg}`,
      );
    }
  }

  copiedOrderId = signal<string | null>(null);

  // The member's gradings, keyed by the order that bought them, so an order row
  // can show the id of the grading it paid for.
  private gradingsByOrderId = computed(() => {
    const byOrder = new Map<string, Grading>();
    for (const g of this.dataService.myGradings.entries()) {
      if (g.orderId) byOrder.set(g.orderId, g);
    }
    return byOrder;
  });

  // The grading this order paid for, or null. Matched on the grading's
  // `orderId`, which fulfillment sets to the order's document id.
  getOrderGrading(order: MemberOrder): Grading | null {
    const byOrder = this.gradingsByOrderId();
    return byOrder.get(order.orderDocId) || byOrder.get(order.docId) || null;
  }

  // The grading id to quote for this order (e.g. '202608-A5b1'), or '' when the
  // order did not buy a grading. Identical to the id on the grading page: both
  // derive it from the grading document.
  getGradingId(order: MemberOrder): string {
    const grading = this.getOrderGrading(order);
    return grading ? gradingDisplayId(grading) : '';
  }

  // The short, human-friendly order number (e.g. '202608-4713'). Derived from
  // the same inputs the server uses, so the number is stable for an order.
  getOrderNumber(order: MemberOrder): string {
    return orderDisplayNumber(
      order.created || order.date || '',
      order.orderNumber || this.getOrderDisplayId(order),
    );
  }

  getOrderDisplayId(order: MemberOrder): string {
    // If order has an invoice ID and orderNumber is a checkout session, prefer invoice ID
    if (
      order.stripeInvoiceId &&
      (!order.orderNumber || order.orderNumber.startsWith('cs_'))
    ) {
      return order.stripeInvoiceId;
    }
    return order.orderNumber || order.orderDocId || order.docId || '';
  }

  async copyOrderId(orderId: string, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!orderId) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(orderId);
      }
      this.copiedOrderId.set(orderId);
      setTimeout(() => {
        if (this.copiedOrderId() === orderId) {
          this.copiedOrderId.set(null);
        }
      }, 2000);
    } catch {
      // Ignore clipboard write error
    }
  }

  getOrderQuantity(order: MemberOrder): number {
    if (!order.lineItems || order.lineItems.length === 0) return 1;
    return order.lineItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
  }

  formatAmount(amount: number | null, currency: string | null): string {
    if (amount === null || amount === undefined) return '—';
    const curr = (currency || 'usd').toUpperCase();
    const formattedNum = (amount / 100).toFixed(2);
    return `$${formattedNum} ${curr}`;
  }

  getOrderTypeBadgeClass(type: string): string {
    switch (type) {
      case 'renewal':
        return 'badge-renewal';
      case 'checkout':
      case 'one_time':
        return 'badge-checkout';
      case 'cancellation':
        return 'badge-cancellation';
      default:
        return 'badge-default';
    }
  }

  getPaymentStatusBadgeClass(status: string | null): string {
    switch (status) {
      case 'paid':
        return 'status-paid';
      case 'unpaid':
      case 'pending':
        return 'status-pending';
      case 'refunded':
        return 'status-refunded';
      default:
        return 'status-default';
    }
  }
}
