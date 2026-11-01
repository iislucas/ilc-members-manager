import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { InstructorLicenseType } from '../../../functions/src/data-model/curriculum';
import { Grading, gradingDisplayId, orderDisplayNumber } from '../../../functions/src/data-model/gradings';
import {
  MemberSubscriptionItem,
  MembershipType,
  SubscriptionInterval,
  SubscriptionItemType,
  SubscriptionStatus,
  isLifeMember as isLifeMemberStatus,
  isLifeInstructor as isLifeInstructorStatus,
} from '../../../functions/src/data-model/members';
import {
  MemberOrder,
  MemberOrderPaymentStatus,
  MemberOrderType,
  OrderItemCategory,
} from '../../../functions/src/data-model/orders';
import { School } from '../../../functions/src/data-model/schools';
import { ManagedSchoolBillingInfo } from '../../../functions/src/stripe-types';
import {
  addBillingIntervalToDateString,
  computeProjectedRenewalExpirationDate,
  formatNextAutoRenewalPayment,
  resolveMemberSubscriptionRenewal,
} from '../stripe-price-format';

export enum SubscriptionCardCategory {
  Membership = 'membership',
  InstructorLicense = 'instructor_license',
  VideoLibrary = 'video_library',
  SchoolLicense = 'school_license',
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
  autoRenewalPaymentText: string; // e.g. '2026-11-23 ($25.00 USD)' or ''
  projectedExpirationDate: string; // YYYY-MM-DD after next auto-renewal, or ''
  isAutoRenewing: boolean;
  canCancel: boolean;
  canResume: boolean;
  canSubscribe: boolean;
  subscribeUrl?: string;
  payerLabel?: string;
  isCurrentUserPayer?: boolean;
}

@Component({
  selector: 'app-member-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
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
  portalLoading = signal(false);
  managedSchoolsBilling = signal<Record<string, ManagedSchoolBillingInfo>>({});
  private lastLoadedBillingKey = '';

  today = computed(() => new Date().toISOString().split('T')[0]);

  mySchools = computed<School[]>(() => {
    const u = this.user();
    if (!u) return [];
    const all = this.dataService.schools?.entries() ?? [];
    const managedIds = new Set(u.schoolsManaged || []);
    const insId = u.member.instructorId?.trim();
    const mDocId = u.member.docId;

    return all.filter((s) => {
      if (s.docId && managedIds.has(s.docId)) return true;
      if (s.schoolId && managedIds.has(s.schoolId)) return true;
      if (insId && s.ownerInstructorId === insId) return true;
      if (insId && s.managerInstructorIds?.includes(insId)) return true;
      if (mDocId && s.ownerMemberDocId === mDocId) return true;
      return false;
    });
  });

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

  studentLevelNum = computed<number>(() => {
    const lvl = this.user()?.member.studentLevel?.trim() || '';
    if (!lvl || lvl.toLowerCase() === 'entry') return 0;
    const match = lvl.match(/\d+/);
    if (match) return parseInt(match[0], 10);
    const num = parseInt(lvl, 10);
    return isNaN(num) ? 0 : num;
  });

  applicationLevelNum = computed<number>(() => {
    const lvl = this.user()?.member.applicationLevel?.trim() || '';
    if (!lvl) return 0;
    const match = lvl.match(/\d+/);
    if (match) return parseInt(match[0], 10);
    const num = parseInt(lvl, 10);
    return isNaN(num) ? 0 : num;
  });

  isInstructorTier = computed<boolean>(() => {
    const m = this.user()?.member;
    if (!m) return false;
    return (
      this.applicationLevelNum() >= 1 ||
      !!m.instructorId?.trim() ||
      m.instructorLicenseType === InstructorLicenseType.Life ||
      m.instructorLicenseExpires === '9999-12-31'
    );
  });

  isGroupLeaderTier = computed<boolean>(() => {
    return !this.isInstructorTier() && this.studentLevelNum() >= 2;
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

  private schoolSubscriptionCards = computed<{
    ownPayerCards: DisplaySubscriptionCard[];
    otherPayerCards: DisplaySubscriptionCard[];
    handledSubIds: Set<string>;
  }>(() => {
    const u = this.user();
    if (!u) {
      return {
        ownPayerCards: [],
        otherPayerCards: [],
        handledSubIds: new Set<string>(),
      };
    }

    const m = u.member;
    const todayStr = this.today();
    const schools = this.mySchools();
    const billingMap = this.managedSchoolsBilling();
    const myOrders = this.dataService.myOrders.entries();
    const handledSubIds = new Set<string>();
    const ownPayerCards: DisplaySubscriptionCard[] = [];
    const otherPayerCards: DisplaySubscriptionCard[] = [];

    const ownSchoolSubs: Array<[string, MemberSubscriptionItem]> = Object.entries(
      m.stripeSubscriptions || {},
    ).filter(
      ([, sub]) =>
        sub.type === SubscriptionItemType.SchoolLicense ||
        (sub.planName || '').toLowerCase().includes('school'),
    );

    const selfLabel = m.name ? `You (${m.name})` : 'You';
    const baseSchoolLicenseUrl = this.routingService.hrefForView(
      Views.SchoolLicensePurchase,
    );

    for (const school of schools) {
      const schoolTitle = `School License: ${school.schoolName || school.schoolId || 'School'}`;
      const subscribeUrl = school.schoolId
        ? `${baseSchoolLicenseUrl}?schoolId=${encodeURIComponent(school.schoolId)}`
        : baseSchoolLicenseUrl;

      const matchedOwnPair = ownSchoolSubs.find(([subId, sub]) => {
        if (handledSubIds.has(subId)) return false;
        if (sub.schoolDocId && sub.schoolDocId === school.docId) return true;
        if (sub.schoolId && school.schoolId && sub.schoolId === school.schoolId) {
          return true;
        }
        if (
          sub.schoolName &&
          school.schoolName &&
          sub.schoolName.trim().toLowerCase() ===
            school.schoolName.trim().toLowerCase()
        ) {
          return true;
        }
        if (
          !sub.schoolDocId &&
          !sub.schoolId &&
          !sub.schoolName &&
          schools.length === 1
        ) {
          return true;
        }
        return false;
      });

      const ownSubId = matchedOwnPair?.[0] || '';
      const ownSub = matchedOwnPair?.[1];
      if (ownSubId) {
        handledSubIds.add(ownSubId);
      }

      const billingInfo = billingMap[school.docId];
      const matchSchoolOrder = (o: MemberOrder): boolean => {
        const hasSchoolLine =
          o.lineItems?.some(
            (li) =>
              li.category === OrderItemCategory.SchoolLicense ||
              (li.description || '').toLowerCase().includes('school'),
          ) || (o.description || '').toLowerCase().includes('school');
        if (!hasSchoolLine) return false;
        const text = [
          o.description || '',
          ...(o.lineItems || []).map((li) => li.description || ''),
        ].join(' ');
        if (
          school.schoolId &&
          text.includes('SCH-') &&
          !text.includes(school.schoolId)
        ) {
          return false;
        }
        return true;
      };

      const hasOwnPaidOrder = myOrders.some(
        (o) =>
          o.paymentStatus === MemberOrderPaymentStatus.Paid &&
          o.orderType !== MemberOrderType.Cancellation &&
          matchSchoolOrder(o),
      );

      const isLifetime = !school.schoolLicenseExpires;
      const isSchoolOwner =
        Boolean(m.docId && school.ownerMemberDocId === m.docId) ||
        Boolean(
          m.instructorId?.trim() &&
            school.ownerInstructorId === m.instructorId.trim(),
        );

      const isCurrentUserPayer = Boolean(
        ownSub ||
          (billingInfo?.payerMemberDocId &&
            billingInfo.payerMemberDocId === m.docId) ||
          (billingInfo?.payerMemberId &&
            m.memberId &&
            billingInfo.payerMemberId === m.memberId) ||
          (!billingInfo?.payerMemberDocId && hasOwnPaidOrder) ||
          (isLifetime && isSchoolOwner && !billingInfo?.payerMemberDocId),
      );

      let payerLabel = '';
      if (isCurrentUserPayer) {
        payerLabel = selfLabel;
      } else if (billingInfo?.payerName || billingInfo?.payerMemberId) {
        payerLabel =
          billingInfo.payerName && billingInfo.payerMemberId
            ? `${billingInfo.payerName} (${billingInfo.payerMemberId})`
            : billingInfo.payerName || billingInfo.payerMemberId;
      } else if (isLifetime) {
        payerLabel = school.ownerInstructorId
          ? `School Owner (${school.ownerInstructorId})`
          : 'Lifetime license';
      } else {
        payerLabel = 'No payment linked';
      }

      if (isLifetime) {
        const card: DisplaySubscriptionCard = {
          id: `school-card-${school.docId}`,
          subscriptionId: '',
          title: schoolTitle,
          category: SubscriptionCardCategory.SchoolLicense,
          status: SubscriptionCardStatus.Lifetime,
          statusLabel: 'Lifetime Access',
          statusClass: 'status-active',
          expirationDate: 'Never expires',
          nextAutoRenewDate: '',
          autoRenewalPaymentText: '',
          projectedExpirationDate: '',
          isAutoRenewing: false,
          canCancel: false,
          canResume: false,
          canSubscribe: false,
          subscribeUrl,
          payerLabel,
          isCurrentUserPayer,
        };
        if (isCurrentUserPayer) {
          ownPayerCards.push(card);
        } else {
          otherPayerCards.push(card);
        }
        continue;
      }

      const isExpired = school.schoolLicenseExpires < todayStr;
      let isAutoRenewing = false;
      let nextAutoRenewDate = '';
      let autoRenewalPaymentText = '';
      let projectedExpirationDate = '';

      if (ownSubId) {
        const resolved = resolveMemberSubscriptionRenewal({
          subscriptionId: ownSubId,
          fallbackNextAutoRenewDate: ownSub?.nextAutoRenewDate || '',
          expirationDate: school.schoolLicenseExpires,
          defaultInterval:
            ownSub?.interval === SubscriptionInterval.Month ? 'month' : 'year',
          todayStr,
          stripeSubscriptions: m.stripeSubscriptions,
          orders: myOrders,
          orderMatcher: matchSchoolOrder,
        });
        isAutoRenewing = resolved.isAutoRenewing;
        nextAutoRenewDate = resolved.nextAutoRenewDate;
        autoRenewalPaymentText = resolved.autoRenewalPaymentText;
        projectedExpirationDate = resolved.projectedExpirationDate;
      } else if (
        billingInfo?.isAutoRenewing &&
        billingInfo.nextAutoRenewDate &&
        billingInfo.nextAutoRenewDate >= todayStr
      ) {
        isAutoRenewing = true;
        nextAutoRenewDate = billingInfo.nextAutoRenewDate;
        const interval: 'month' | 'year' =
          billingInfo.interval ||
          (billingInfo.amount !== null && billingInfo.amount <= 15000
            ? 'month'
            : 'year');
        if (
          nextAutoRenewDate === school.schoolLicenseExpires &&
          /^\d{4}-\d{2}-\d{2}$/.test(billingInfo.lastPaymentDate)
        ) {
          const expectedEnd = addBillingIntervalToDateString(
            billingInfo.lastPaymentDate,
            interval,
            1,
          );
          if (
            expectedEnd &&
            expectedEnd >= todayStr &&
            expectedEnd < nextAutoRenewDate
          ) {
            nextAutoRenewDate = expectedEnd;
          }
        }
        autoRenewalPaymentText = formatNextAutoRenewalPayment(
          nextAutoRenewDate,
          billingInfo.amount,
          billingInfo.currency,
        );
        projectedExpirationDate = computeProjectedRenewalExpirationDate({
          currentExpirationDate: school.schoolLicenseExpires,
          nextAutoRenewDate,
          interval,
        });
      }

      const status = isExpired
        ? SubscriptionCardStatus.Expired
        : SubscriptionCardStatus.Active;
      const canManageOwnSub = isCurrentUserPayer && Boolean(ownSubId);

      const card: DisplaySubscriptionCard = {
        id: ownSubId || `school-card-${school.docId}`,
        subscriptionId: canManageOwnSub ? ownSubId : '',
        title: schoolTitle,
        category: SubscriptionCardCategory.SchoolLicense,
        status,
        statusLabel: isExpired
          ? 'Expired'
          : isAutoRenewing
            ? 'Active (Auto-Renewing)'
            : 'Active (Expires on date)',
        statusClass: isExpired ? 'status-expired' : 'status-active',
        expirationDate: school.schoolLicenseExpires || 'Not active',
        nextAutoRenewDate,
        autoRenewalPaymentText,
        projectedExpirationDate,
        isAutoRenewing,
        canCancel: canManageOwnSub && isAutoRenewing,
        canResume: canManageOwnSub && !isAutoRenewing && !isExpired,
        canSubscribe: isExpired,
        subscribeUrl,
        payerLabel,
        isCurrentUserPayer,
      };

      if (isCurrentUserPayer) {
        ownPayerCards.push(card);
      } else {
        otherPayerCards.push(card);
      }
    }

    // Include any SchoolLicense Stripe subscription on the member doc whose school wasn't in mySchools()
    for (const [subId, sub] of ownSchoolSubs) {
      if (handledSubIds.has(subId)) continue;
      handledSubIds.add(subId);
      const resolved = resolveMemberSubscriptionRenewal({
        subscriptionId: subId,
        fallbackNextAutoRenewDate: sub.nextAutoRenewDate,
        expirationDate: sub.currentPeriodEnd,
        defaultInterval:
          sub.interval === SubscriptionInterval.Month ? 'month' : 'year',
        todayStr,
        stripeSubscriptions: m.stripeSubscriptions,
        orders: myOrders,
      });
      const isActiveSub =
        sub.status === SubscriptionStatus.Active ||
        sub.status === SubscriptionStatus.Trialing;
      ownPayerCards.push({
        id: subId,
        subscriptionId: subId,
        title: sub.schoolName
          ? `School License: ${sub.schoolName}`
          : sub.planName || 'School License',
        category: SubscriptionCardCategory.SchoolLicense,
        status: isActiveSub
          ? SubscriptionCardStatus.Active
          : SubscriptionCardStatus.Canceled,
        statusLabel: isActiveSub
          ? resolved.isAutoRenewing
            ? 'Active (Auto-Renewing)'
            : 'Active (Expires on date)'
          : 'Cancelled',
        statusClass: isActiveSub ? 'status-active' : 'status-expired',
        expirationDate: sub.currentPeriodEnd || 'Not active',
        nextAutoRenewDate: resolved.nextAutoRenewDate,
        autoRenewalPaymentText: resolved.autoRenewalPaymentText,
        projectedExpirationDate: resolved.projectedExpirationDate,
        isAutoRenewing: resolved.isAutoRenewing,
        canCancel: resolved.isAutoRenewing,
        canResume: !resolved.isAutoRenewing && isActiveSub,
        canSubscribe: !isActiveSub,
        subscribeUrl: sub.schoolId
          ? `${baseSchoolLicenseUrl}?schoolId=${encodeURIComponent(sub.schoolId)}`
          : baseSchoolLicenseUrl,
        payerLabel: selfLabel,
        isCurrentUserPayer: true,
      });
    }

    return { ownPayerCards, otherPayerCards, handledSubIds };
  });

  // Schools owned or managed by this member where another member (or nobody) is the payer
  otherPayerSchoolSubscriptions = computed<DisplaySubscriptionCard[]>(
    () => this.schoolSubscriptionCards().otherPayerCards,
  );

  // Active Subscriptions Card List (member's own subscriptions + school licenses they pay for)
  subscriptions = computed<DisplaySubscriptionCard[]>(() => {
    const u = this.user();
    if (!u) return [];
    const m = u.member;
    const cards: DisplaySubscriptionCard[] = [];
    const todayStr = this.today();
    const myOrders = this.dataService.myOrders.entries();

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
        autoRenewalPaymentText: '',
        projectedExpirationDate: '',
        isAutoRenewing: false,
        canCancel: false,
        canResume: false,
        canSubscribe: false,
      });
    } else {
      const isExpired =
        !m.currentMembershipExpires || m.currentMembershipExpires < todayStr;
      const resolved = resolveMemberSubscriptionRenewal({
        subscriptionId: m.membershipSubscriptionId,
        fallbackNextAutoRenewDate: m.membershipNextAutoRenewDate,
        expirationDate: m.currentMembershipExpires,
        defaultInterval: 'year',
        todayStr,
        stripeSubscriptions: m.stripeSubscriptions,
        orders: myOrders,
        orderMatcher: (o) =>
          o.lineItems?.some(
            (li) =>
              li.category === OrderItemCategory.Membership ||
              (li.description || '').toLowerCase().includes('membership'),
          ) || (o.description || '').toLowerCase().includes('membership'),
      });
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
          : resolved.isAutoRenewing
            ? 'Active (Auto-Renewing)'
            : 'Active (Expires on date)',
        statusClass: isExpired ? 'status-expired' : 'status-active',
        expirationDate: m.currentMembershipExpires || 'Not active',
        nextAutoRenewDate: resolved.nextAutoRenewDate,
        autoRenewalPaymentText: resolved.autoRenewalPaymentText,
        projectedExpirationDate: resolved.projectedExpirationDate,
        isAutoRenewing: resolved.isAutoRenewing,
        canCancel: resolved.isAutoRenewing && !!m.membershipSubscriptionId,
        canResume:
          !resolved.isAutoRenewing &&
          !!m.membershipSubscriptionId &&
          !isExpired,
        canSubscribe: isExpired,
        subscribeUrl: this.routingService.hrefForView(Views.BecomeAMember),
      });
    }

    // 2. Instructor / Group Leader License Card (if member has instructor status or had license)
    if (
      m.instructorId ||
      m.instructorLicenseExpires ||
      m.instructorLicenseSubscriptionId ||
      m.instructorLicenseType === InstructorLicenseType.Life
    ) {
      const licenseTitle = this.isGroupLeaderTier()
        ? 'Group Leader License'
        : this.isInstructorTier()
          ? 'Instructor License'
          : 'Instructor & Group Leader License';

      if (
        m.instructorLicenseType === InstructorLicenseType.Life ||
        m.instructorLicenseExpires === '9999-12-31'
      ) {
        cards.push({
          id: 'instructor-license-card',
          subscriptionId: '',
          title: licenseTitle,
          category: SubscriptionCardCategory.InstructorLicense,
          status: SubscriptionCardStatus.Lifetime,
          statusLabel: 'Lifetime Access',
          statusClass: 'status-active',
          expirationDate: 'Never expires',
          nextAutoRenewDate: '',
          autoRenewalPaymentText: '',
          projectedExpirationDate: '',
          isAutoRenewing: false,
          canCancel: false,
          canResume: false,
          canSubscribe: false,
        });
      } else {
        const isExpired =
          !m.instructorLicenseExpires ||
          m.instructorLicenseExpires < todayStr;
        const resolved = resolveMemberSubscriptionRenewal({
          subscriptionId: m.instructorLicenseSubscriptionId,
          fallbackNextAutoRenewDate: m.instructorLicenseNextAutoRenewDate,
          expirationDate: m.instructorLicenseExpires,
          defaultInterval: 'year',
          todayStr,
          stripeSubscriptions: m.stripeSubscriptions,
          orders: myOrders,
          orderMatcher: (o) => {
            const d = (o.description || '').toLowerCase();
            return (
              o.lineItems?.some((li) => {
                const lid = (li.description || '').toLowerCase();
                return (
                  li.category === OrderItemCategory.InstructorLicense ||
                  lid.includes('instructor') ||
                  lid.includes('group leader')
                );
              }) ||
              d.includes('instructor') ||
              d.includes('group leader')
            );
          },
        });
        const status = isExpired
          ? SubscriptionCardStatus.Expired
          : SubscriptionCardStatus.Active;

        cards.push({
          id: m.instructorLicenseSubscriptionId || 'instructor-license-card',
          subscriptionId: m.instructorLicenseSubscriptionId || '',
          title: licenseTitle,
          category: SubscriptionCardCategory.InstructorLicense,
          status,
          statusLabel: isExpired
            ? 'Expired'
            : resolved.isAutoRenewing
              ? 'Active (Auto-Renewing)'
              : 'Active (Expires on date)',
          statusClass: isExpired ? 'status-expired' : 'status-active',
          expirationDate: m.instructorLicenseExpires || 'Not active',
          nextAutoRenewDate: resolved.nextAutoRenewDate,
          autoRenewalPaymentText: resolved.autoRenewalPaymentText,
          projectedExpirationDate: resolved.projectedExpirationDate,
          isAutoRenewing: resolved.isAutoRenewing,
          canCancel:
            resolved.isAutoRenewing && !!m.instructorLicenseSubscriptionId,
          canResume:
            !resolved.isAutoRenewing &&
            !!m.instructorLicenseSubscriptionId &&
            !isExpired,
          canSubscribe: isExpired,
          subscribeUrl: this.routingService.hrefForView(
            Views.InstructorLicensePurchase,
          ),
        });
      }
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
      const resolved = resolveMemberSubscriptionRenewal({
        subscriptionId: m.classVideoLibrarySubscriptionId,
        fallbackNextAutoRenewDate: m.classVideoLibraryNextAutoRenewDate,
        expirationDate: m.classVideoLibraryExpirationDate,
        defaultInterval: 'month',
        todayStr,
        stripeSubscriptions: m.stripeSubscriptions,
        orders: myOrders,
        orderMatcher: (o) => {
          const d = (o.description || '').toLowerCase();
          return (
            o.lineItems?.some((li) => {
              const lid = (li.description || '').toLowerCase();
              return (
                li.category === OrderItemCategory.VideoLibrary ||
                lid.includes('library') ||
                (lid.includes('class') && lid.includes('video'))
              );
            }) ||
            d.includes('library') ||
            (d.includes('class') && d.includes('video'))
          );
        },
      });
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
          : resolved.isAutoRenewing
            ? 'Active (Auto-Renewing)'
            : 'Active (Expires on date)',
        statusClass: isExpired ? 'status-expired' : 'status-active',
        expirationDate: m.classVideoLibraryExpirationDate || 'Not active',
        nextAutoRenewDate: resolved.nextAutoRenewDate,
        autoRenewalPaymentText: resolved.autoRenewalPaymentText,
        projectedExpirationDate: resolved.projectedExpirationDate,
        isAutoRenewing: resolved.isAutoRenewing,
        canCancel:
          resolved.isAutoRenewing && !!m.classVideoLibrarySubscriptionId,
        canResume:
          !resolved.isAutoRenewing &&
          !!m.classVideoLibrarySubscriptionId &&
          !isExpired,
        canSubscribe: isExpired,
        subscribeUrl: this.routingService.hrefForView(
          Views.ClassVideoLibraryPurchase,
        ),
      });
    }

    // 4. School License Cards where the signed-in member IS the payer
    const schoolCardsInfo = this.schoolSubscriptionCards();
    cards.push(...schoolCardsInfo.ownPayerCards);

    // 5. Any other active Stripe subscriptions in m.stripeSubscriptions map
    if (m.stripeSubscriptions) {
      const handledSubIds = new Set([
        m.membershipSubscriptionId,
        m.instructorLicenseSubscriptionId,
        m.classVideoLibrarySubscriptionId,
        ...schoolCardsInfo.handledSubIds,
      ]);

      for (const [subId, sub] of Object.entries(m.stripeSubscriptions)) {
        if (handledSubIds.has(subId)) continue;
        const resolved = resolveMemberSubscriptionRenewal({
          subscriptionId: subId,
          fallbackNextAutoRenewDate: sub.nextAutoRenewDate,
          expirationDate: sub.currentPeriodEnd,
          defaultInterval:
            sub.interval === SubscriptionInterval.Month ? 'month' : 'year',
          todayStr,
          stripeSubscriptions: m.stripeSubscriptions,
          orders: myOrders,
        });
        const isActiveSub =
          sub.status === SubscriptionStatus.Active ||
          sub.status === SubscriptionStatus.Trialing;

        cards.push({
          id: subId,
          subscriptionId: subId,
          title: sub.planName || 'Subscription',
          category: SubscriptionCardCategory.Other,
          status: isActiveSub
            ? SubscriptionCardStatus.Active
            : SubscriptionCardStatus.Canceled,
          statusLabel: isActiveSub
            ? resolved.isAutoRenewing
              ? 'Active (Auto-Renewing)'
              : 'Active (Expires on date)'
            : 'Cancelled',
          statusClass: isActiveSub ? 'status-active' : 'status-expired',
          expirationDate: sub.currentPeriodEnd,
          nextAutoRenewDate: resolved.nextAutoRenewDate,
          autoRenewalPaymentText: resolved.autoRenewalPaymentText,
          projectedExpirationDate: resolved.projectedExpirationDate,
          isAutoRenewing: resolved.isAutoRenewing,
          canCancel: resolved.isAutoRenewing,
          canResume: !resolved.isAutoRenewing && isActiveSub,
          canSubscribe: false,
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
      if (this.mySchools().length > 0) {
        void this.loadManagedSchoolsBilling();
      }
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
      if (this.mySchools().length > 0) {
        void this.loadManagedSchoolsBilling();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.actionError.set(`Failed to resume auto-renewal: ${msg}`);
    } finally {
      this.actionInProgressSubId.set(null);
    }
  }

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
