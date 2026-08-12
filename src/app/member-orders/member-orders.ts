import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { MemberOrder, MembershipType } from '../../../functions/src/data-model';

export enum SubscriptionCardCategory {
  Membership = 'membership',
  InstructorLicense = 'instructor_license',
  VideoLibrary = 'video_library',
  Other = 'other',
}

export enum SubscriptionCardStatus {
  Active = 'active',
  Expired = 'expired',
  Canceled = 'canceled',
  Lifetime = 'lifetime',
  None = 'none',
}

export interface DisplaySubscriptionCard {
  id: string; // Subscription ID or synthetic key
  subscriptionId: string;
  title: string;
  category: SubscriptionCardCategory;
  status: SubscriptionCardStatus;
  statusLabel: string;
  statusClass: string;
  expirationDate: string;
  nextAutoRenewDate: string; // YYYY-MM-DD or ''
  isAutoRenewing: boolean;
  canCancel: boolean;
  canResume: boolean;
  canSubscribe: boolean;
  subscribeUrl?: string;
  amountText?: string;
}

@Component({
  selector: 'app-member-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './member-orders.html',
  styleUrl: './member-orders.scss',
})
export class MemberOrdersComponent {
  dataService = inject(DataManagerService);
  firebaseStateService = inject(FirebaseStateService);
  stripeService = inject(StripeService);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  Views = Views;
  user = this.firebaseStateService.user;

  searchQuery = signal('');
  actionInProgressSubId = signal<string | null>(null);
  actionMessage = signal<string | null>(null);
  actionError = signal<string | null>(null);
  expandedOrderDocIds = signal<Set<string>>(new Set());

  today = computed(() => new Date().toISOString().split('T')[0]);

  // Active Subscriptions Card List
  subscriptions = computed<DisplaySubscriptionCard[]>(() => {
    const u = this.user();
    if (!u) return [];
    const m = u.member;
    const cards: DisplaySubscriptionCard[] = [];
    const todayStr = this.today();

    // 1. Membership Card
    if (m.membershipType === MembershipType.Life) {
      cards.push({
        id: 'membership-card',
        subscriptionId: '',
        title: 'ILC Membership',
        category: SubscriptionCardCategory.Membership,
        status: SubscriptionCardStatus.Lifetime,
        statusLabel: 'Lifetime Access',
        statusClass: 'status-active',
        expirationDate: 'Never expires',
        nextAutoRenewDate: '',
        isAutoRenewing: false,
        canCancel: false,
        canResume: false,
        canSubscribe: false,
      });
    } else {
      const isExpired =
        !m.currentMembershipExpires || m.currentMembershipExpires < todayStr;
      const isAutoRenewing = !!(
        m.membershipSubscriptionId &&
        m.membershipNextAutoRenewDate &&
        m.membershipNextAutoRenewDate >= todayStr
      );
      const status = isExpired
        ? SubscriptionCardStatus.Expired
        : SubscriptionCardStatus.Active;

      cards.push({
        id: m.membershipSubscriptionId || 'membership-card',
        subscriptionId: m.membershipSubscriptionId || '',
        title: 'Annual ILC Membership',
        category: SubscriptionCardCategory.Membership,
        status,
        statusLabel: isExpired
          ? 'Expired'
          : isAutoRenewing
            ? 'Active (Auto-Renewing)'
            : 'Active (Expires on date)',
        statusClass: isExpired ? 'status-expired' : 'status-active',
        expirationDate: m.currentMembershipExpires || 'Not active',
        nextAutoRenewDate: isAutoRenewing ? m.membershipNextAutoRenewDate : '',
        isAutoRenewing,
        canCancel: isAutoRenewing && !!m.membershipSubscriptionId,
        canResume:
          !isAutoRenewing &&
          !!m.membershipSubscriptionId &&
          !isExpired,
        canSubscribe: isExpired,
        subscribeUrl: '/products',
      });
    }

    // 2. Instructor License Card (if member has instructor status or had license)
    if (
      m.instructorId ||
      m.instructorLicenseExpires ||
      m.instructorLicenseSubscriptionId
    ) {
      const isExpired =
        !m.instructorLicenseExpires ||
        m.instructorLicenseExpires < todayStr;
      const isAutoRenewing = !!(
        m.instructorLicenseSubscriptionId &&
        m.instructorLicenseNextAutoRenewDate &&
        m.instructorLicenseNextAutoRenewDate >= todayStr
      );
      const status = isExpired
        ? SubscriptionCardStatus.Expired
        : SubscriptionCardStatus.Active;

      cards.push({
        id: m.instructorLicenseSubscriptionId || 'instructor-license-card',
        subscriptionId: m.instructorLicenseSubscriptionId || '',
        title: 'Instructor License',
        category: SubscriptionCardCategory.InstructorLicense,
        status,
        statusLabel: isExpired
          ? 'Expired'
          : isAutoRenewing
            ? 'Active (Auto-Renewing)'
            : 'Active (Expires on date)',
        statusClass: isExpired ? 'status-expired' : 'status-active',
        expirationDate: m.instructorLicenseExpires || 'Not active',
        nextAutoRenewDate: isAutoRenewing
          ? m.instructorLicenseNextAutoRenewDate
          : '',
        isAutoRenewing,
        canCancel: isAutoRenewing && !!m.instructorLicenseSubscriptionId,
        canResume:
          !isAutoRenewing &&
          !!m.instructorLicenseSubscriptionId &&
          !isExpired,
        canSubscribe: isExpired,
        subscribeUrl: '/products',
      });
    }

    // 3. Class Video Library Card
    if (
      m.classVideoLibrarySubscription ||
      m.classVideoLibraryExpirationDate ||
      m.classVideoLibrarySubscriptionId
    ) {
      const isExpired =
        !m.classVideoLibraryExpirationDate ||
        m.classVideoLibraryExpirationDate < todayStr;
      const isAutoRenewing = !!(
        m.classVideoLibrarySubscriptionId &&
        m.classVideoLibraryNextAutoRenewDate &&
        m.classVideoLibraryNextAutoRenewDate >= todayStr
      );
      const status = isExpired
        ? SubscriptionCardStatus.Expired
        : SubscriptionCardStatus.Active;

      cards.push({
        id: m.classVideoLibrarySubscriptionId || 'video-library-card',
        subscriptionId: m.classVideoLibrarySubscriptionId || '',
        title: 'Class Video Library',
        category: SubscriptionCardCategory.VideoLibrary,
        status,
        statusLabel: isExpired
          ? 'Expired'
          : isAutoRenewing
            ? 'Active (Auto-Renewing)'
            : 'Active (Expires on date)',
        statusClass: isExpired ? 'status-expired' : 'status-active',
        expirationDate: m.classVideoLibraryExpirationDate || 'Not active',
        nextAutoRenewDate: isAutoRenewing
          ? m.classVideoLibraryNextAutoRenewDate
          : '',
        isAutoRenewing,
        canCancel: isAutoRenewing && !!m.classVideoLibrarySubscriptionId,
        canResume:
          !isAutoRenewing &&
          !!m.classVideoLibrarySubscriptionId &&
          !isExpired,
        canSubscribe: isExpired,
        subscribeUrl: '/products',
      });
    }

    // 4. Any other active Stripe subscriptions in m.subscriptions map
    if (m.stripeSubscriptions) {
      const handledSubIds = new Set([
        m.membershipSubscriptionId,
        m.instructorLicenseSubscriptionId,
        m.classVideoLibrarySubscriptionId,
      ]);

      for (const [subId, sub] of Object.entries(m.stripeSubscriptions)) {
        if (handledSubIds.has(subId)) continue;
        const isAuto =
          !sub.cancelAtPeriodEnd &&
          sub.status === 'active' &&
          !!sub.nextAutoRenewDate;

        cards.push({
          id: subId,
          subscriptionId: subId,
          title: sub.planName || 'Subscription',
          category: SubscriptionCardCategory.Other,
          status: sub.status === 'active' ? SubscriptionCardStatus.Active : SubscriptionCardStatus.Canceled,
          statusLabel:
            sub.status === 'active'
              ? isAuto
                ? 'Active (Auto-Renewing)'
                : 'Active (Expires on date)'
              : 'Cancelled',
          statusClass:
            sub.status === 'active' ? 'status-active' : 'status-expired',
          expirationDate: sub.currentPeriodEnd,
          nextAutoRenewDate: isAuto ? sub.nextAutoRenewDate : '',
          isAutoRenewing: isAuto,
          canCancel: isAuto,
          canResume: !isAuto && sub.status === 'active',
          canSubscribe: false,
          amountText: this.formatAmount(sub.amount, sub.currency),
        });
      }
    }

    return cards;
  });

  // Filtered Orders Subcollection List
  orders = computed<MemberOrder[]>(() => {
    const raw = this.dataService.myOrders.entries();
    const query = this.searchQuery().toLowerCase().trim();

    if (!query) return raw;

    return raw.filter((o) => {
      const matchNum = (o.orderNumber || '').toLowerCase().includes(query);
      const matchDesc = (o.description || '').toLowerCase().includes(query);
      const matchDate = (o.date || '').toLowerCase().includes(query);
      const matchType = (o.orderType || '').toLowerCase().includes(query);
      const matchStatus = (o.paymentStatus || '').toLowerCase().includes(query);
      return (
        matchNum || matchDesc || matchDate || matchType || matchStatus
      );
    });
  });

  toggleOrderExpanded(docId: string) {
    const set = new Set(this.expandedOrderDocIds());
    if (set.has(docId)) {
      set.delete(docId);
    } else {
      set.add(docId);
    }
    this.expandedOrderDocIds.set(set);
  }

  isOrderExpanded(docId: string): boolean {
    return this.expandedOrderDocIds().has(docId);
  }

  async onCancelAutoRenew(subscriptionId: string) {
    if (!subscriptionId) return;
    const confirmed = confirm(
      'Are you sure you want to cancel auto-renewal for this subscription? You will continue to have access until your current expiration date.',
    );
    if (!confirmed) return;

    this.actionInProgressSubId.set(subscriptionId);
    this.actionMessage.set(null);
    this.actionError.set(null);

    try {
      const result =
        await this.stripeService.cancelSubscriptionRenewal(subscriptionId);
      this.actionMessage.set(
        `Auto-renewal has been cancelled. Your access remains active until ${result.periodEnd}.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.actionError.set(`Failed to cancel auto-renewal: ${msg}`);
    } finally {
      this.actionInProgressSubId.set(null);
    }
  }

  async onResumeAutoRenew(subscriptionId: string) {
    if (!subscriptionId) return;

    this.actionInProgressSubId.set(subscriptionId);
    this.actionMessage.set(null);
    this.actionError.set(null);

    try {
      const result =
        await this.stripeService.resumeSubscriptionRenewal(subscriptionId);
      this.actionMessage.set(
        `Auto-renewal has been resumed. Next renewal date: ${result.nextAutoRenewDate}.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.actionError.set(`Failed to resume auto-renewal: ${msg}`);
    } finally {
      this.actionInProgressSubId.set(null);
    }
  }

  async onOpenCustomerPortal() {
    this.actionError.set(null);

    try {
      const returnUrl = window.location.href;
      const result =
        await this.stripeService.createCustomerPortalSession(returnUrl);
      if (result?.url) {
        window.location.href = result.url;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.actionError.set(
        `Unable to open billing portal: ${msg}`,
      );
    }
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
