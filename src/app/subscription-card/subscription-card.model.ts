import { InstructorLicenseType } from '../../../functions/src/data-model/curriculum';
import {
  Member,
  MemberSubscriptionItem,
  MembershipType,
  SubscriptionInterval,
  SubscriptionItemType,
  SubscriptionStatus,
  hasActiveMembership,
  isLifeInstructor as isLifeInstructorStatus,
  isLifeMember as isLifeMemberStatus,
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
  computeProjectedRenewalExpirationDate,
  computeRenewalEditBounds,
  formatAmountWithCurrency,
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
  identifierChip?: string;
  schoolDocId?: string;
  schoolId?: string;
  category: SubscriptionCardCategory;
  status: SubscriptionCardStatus;
  statusLabel: string;
  statusClass: string;
  expirationDate: string; // YYYY-MM-DD, 'Never expires', or 'Not active'
  nextAutoRenewDate: string; // YYYY-MM-DD or ''
  renewalAmountText: string; // e.g. '$25.00 USD' or ''
  autoRenewalPaymentText: string; // e.g. '2026-11-23 ($25.00 USD)' or ''
  projectedExpirationDate: string; // YYYY-MM-DD after next auto-renewal, or ''
  interval: 'month' | 'year';
  isAutoRenewing: boolean;
  canCancel: boolean;
  canResume: boolean;
  canSubscribe: boolean;
  subscribeUrl?: string;
  canEditRenewalDate: boolean;
  defaultRenewalEditDate: string;
  minRenewalEditDate: string;
  maxRenewalEditDate: string;
  canUpdatePaymentMethod: boolean;
  paymentMethodSummary?: string;
  payerLabel?: string;
  isCurrentUserPayer?: boolean;
  warningTitle?: string;
  warningText?: string;
}

export function getManagedSchoolsForUser(
  allSchools: School[],
  user: { member: Member; schoolsManaged?: string[] } | null | undefined,
): School[] {
  if (!user) return [];
  const managedIds = new Set(user.schoolsManaged || []);
  const insId = user.member.instructorId?.trim();
  const mDocId = user.member.docId;

  return allSchools.filter((s) => {
    if (s.docId && managedIds.has(s.docId)) return true;
    if (s.schoolId && managedIds.has(s.schoolId)) return true;
    if (insId && s.ownerInstructorId === insId) return true;
    if (insId && s.managerInstructorIds?.includes(insId)) return true;
    if (mDocId && s.ownerMemberDocId === mDocId) return true;
    return false;
  });
}

function parseLevelNumber(rawLevel?: string | null): number {
  const lvl = (rawLevel || '').trim();
  if (!lvl || lvl.toLowerCase() === 'entry') return 0;
  const match = lvl.match(/\d+/);
  if (match) return parseInt(match[0], 10);
  const num = parseInt(lvl, 10);
  return isNaN(num) ? 0 : num;
}

export function isMemberInstructorTier(member: Member): boolean {
  return (
    parseLevelNumber(member.applicationLevel) >= 1 ||
    Boolean(member.instructorId?.trim()) ||
    isLifeInstructorStatus(member)
  );
}

export function isMemberGroupLeaderTier(member: Member): boolean {
  return (
    !isMemberInstructorTier(member) &&
    parseLevelNumber(member.studentLevel) >= 2
  );
}

function emptyEditFields() {
  return {
    canEditRenewalDate: false,
    defaultRenewalEditDate: '',
    minRenewalEditDate: '',
    maxRenewalEditDate: '',
    canUpdatePaymentMethod: false,
  };
}

function buildEditAndPaymentFields(opts: {
  subscriptionId: string;
  rawExpirationDate: string;
  todayStr: string;
  isManageableActiveSub: boolean;
  paymentMethodSummary?: string;
}) {
  const subId = (opts.subscriptionId || '').trim();
  if (!subId || !opts.isManageableActiveSub) {
    return {
      ...emptyEditFields(),
      ...(opts.paymentMethodSummary
        ? { paymentMethodSummary: opts.paymentMethodSummary }
        : {}),
    };
  }
  const bounds = computeRenewalEditBounds(opts.rawExpirationDate, opts.todayStr);
  return {
    canEditRenewalDate: Boolean(bounds),
    defaultRenewalEditDate: bounds?.defaultDate || '',
    minRenewalEditDate: bounds?.minDate || '',
    maxRenewalEditDate: bounds?.maxDate || '',
    canUpdatePaymentMethod: true,
    ...(opts.paymentMethodSummary
      ? { paymentMethodSummary: opts.paymentMethodSummary }
      : {}),
  };
}

export function buildMembershipSubscriptionCard(opts: {
  member: Member;
  todayStr: string;
  subscribeUrl?: string;
  includeIfNeverSubscribed?: boolean;
}): DisplaySubscriptionCard | null {
  const m = opts.member;
  const includeIfNever = opts.includeIfNeverSubscribed ?? true;

  if (isLifeMemberStatus(m) || m.membershipType === MembershipType.Life) {
    return {
      id: 'membership-card',
      subscriptionId: '',
      title: 'ILC Membership',
      identifierChip: m.memberId?.trim() || undefined,
      category: SubscriptionCardCategory.Membership,
      status: SubscriptionCardStatus.Lifetime,
      statusLabel: 'Lifetime Access',
      statusClass: 'status-active',
      expirationDate: 'Never expires',
      nextAutoRenewDate: '',
      renewalAmountText: '',
      autoRenewalPaymentText: '',
      projectedExpirationDate: '',
      interval: 'year',
      isAutoRenewing: false,
      canCancel: false,
      canResume: false,
      canSubscribe: false,
      subscribeUrl: opts.subscribeUrl,
      ...emptyEditFields(),
    };
  }

  const rawExpires = (m.currentMembershipExpires || '').trim();
  const subId = (m.membershipSubscriptionId || '').trim();
  if (!includeIfNever && !rawExpires && !subId) {
    return null;
  }

  const isExpired = !rawExpires || rawExpires < opts.todayStr;
  const resolved = resolveMemberSubscriptionRenewal({
    subscriptionId: subId,
    expirationDate: rawExpires,
    defaultInterval: 'year',
    todayStr: opts.todayStr,
    stripeSubscriptions: m.stripeSubscriptions,
  });

  const status = isExpired
    ? SubscriptionCardStatus.Expired
    : SubscriptionCardStatus.Active;
  const subRecord = subId ? m.stripeSubscriptions?.[subId] : undefined;
  const isSubActiveInStripe =
    !subRecord ||
    subRecord.status === SubscriptionStatus.Active ||
    subRecord.status === SubscriptionStatus.Trialing;

  return {
    id: subId || 'membership-card',
    subscriptionId: subId,
    title: 'Annual ILC Membership',
    identifierChip: m.memberId?.trim() || undefined,
    category: SubscriptionCardCategory.Membership,
    status,
    statusLabel: !rawExpires
      ? 'Not Active'
      : isExpired
        ? 'Expired'
        : resolved.isAutoRenewing
          ? 'Active (Auto-Renewing)'
          : 'Active (Expires on date)',
    statusClass: isExpired ? 'status-expired' : 'status-active',
    expirationDate: rawExpires || 'Not active',
    nextAutoRenewDate: resolved.nextAutoRenewDate,
    renewalAmountText: resolved.renewalAmountText,
    autoRenewalPaymentText: resolved.autoRenewalPaymentText,
    projectedExpirationDate: resolved.projectedExpirationDate,
    interval: resolved.interval,
    isAutoRenewing: resolved.isAutoRenewing,
    canCancel: resolved.isAutoRenewing && Boolean(subId),
    canResume: !resolved.isAutoRenewing && Boolean(subId) && !isExpired && isSubActiveInStripe,
    canSubscribe: isExpired && Boolean(opts.subscribeUrl),
    subscribeUrl: opts.subscribeUrl,
    ...buildEditAndPaymentFields({
      subscriptionId: subId,
      rawExpirationDate: rawExpires,
      todayStr: opts.todayStr,
      isManageableActiveSub: !isExpired && isSubActiveInStripe,
      paymentMethodSummary: resolved.paymentMethodSummary,
    }),
  };
}

export function buildInstructorLicenseSubscriptionCard(opts: {
  member: Member;
  todayStr: string;
  subscribeUrl?: string;
}): DisplaySubscriptionCard | null {
  const m = opts.member;
  const isLife =
    m.instructorLicenseType === InstructorLicenseType.Life ||
    m.instructorLicenseExpires === '9999-12-31';
  const rawExpires = (m.instructorLicenseExpires || '').trim();
  const subId = (m.instructorLicenseSubscriptionId || '').trim();

  if (!m.instructorId && !rawExpires && !subId && !isLife) {
    return null;
  }

  const isGroupLeader = isMemberGroupLeaderTier(m);
  const isInstructor = isMemberInstructorTier(m);
  const licenseTitle = isGroupLeader
    ? 'Group Leader License'
    : isInstructor
      ? 'Instructor License'
      : 'Instructor & Group Leader License';
  const identifierChip = m.instructorId?.trim() || undefined;
  const memberActive =
    hasActiveMembership(m, opts.todayStr) ||
    (m.membershipType !== MembershipType.Inactive &&
      m.membershipType !== MembershipType.Deceased &&
      Boolean(m.currentMembershipExpires) &&
      m.currentMembershipExpires >= opts.todayStr);

  const membershipWarning = !memberActive
    ? {
        warningTitle: 'Active Membership Required for Instructor Status',
        warningText: isLife
          ? 'You hold an official Lifetime Instructor License, but your association membership has expired. Maintaining active instructor or group leader status (directory listing, leading events, and certifying students) requires both an active license and an active association membership.'
          : `Your ${licenseTitle} is valid through ${rawExpires}, but your association membership has expired. Maintaining active instructor or group leader status (directory listing, leading events, and certifying students) requires both an active license and an active association membership.`,
      }
    : {};

  if (isLife) {
    return {
      id: 'instructor-license-card',
      subscriptionId: '',
      title: licenseTitle,
      identifierChip,
      category: SubscriptionCardCategory.InstructorLicense,
      status: SubscriptionCardStatus.Lifetime,
      statusLabel: memberActive ? 'Lifetime Access' : 'Membership Required',
      statusClass: memberActive ? 'status-active' : 'status-warning',
      expirationDate: 'Never expires',
      nextAutoRenewDate: '',
      renewalAmountText: '',
      autoRenewalPaymentText: '',
      projectedExpirationDate: '',
      interval: 'year',
      isAutoRenewing: false,
      canCancel: false,
      canResume: false,
      canSubscribe: false,
      subscribeUrl: opts.subscribeUrl,
      ...emptyEditFields(),
      ...membershipWarning,
    };
  }

  const isExpired = !rawExpires || rawExpires < opts.todayStr;
  const resolved = resolveMemberSubscriptionRenewal({
    subscriptionId: subId,
    expirationDate: rawExpires,
    defaultInterval: 'year',
    todayStr: opts.todayStr,
    stripeSubscriptions: m.stripeSubscriptions,
  });

  const status = isExpired
    ? SubscriptionCardStatus.Expired
    : SubscriptionCardStatus.Active;
  const subRecord = subId ? m.stripeSubscriptions?.[subId] : undefined;
  const isSubActiveInStripe =
    !subRecord ||
    subRecord.status === SubscriptionStatus.Active ||
    subRecord.status === SubscriptionStatus.Trialing;

  return {
    id: subId || 'instructor-license-card',
    subscriptionId: subId,
    title: licenseTitle,
    identifierChip,
    category: SubscriptionCardCategory.InstructorLicense,
    status,
    statusLabel: !rawExpires
      ? 'Not Active'
      : isExpired
        ? 'Expired'
        : !memberActive
          ? 'Membership Required'
          : resolved.isAutoRenewing
            ? 'Active (Auto-Renewing)'
            : 'Active (Expires on date)',
    statusClass: isExpired
      ? 'status-expired'
      : !memberActive
        ? 'status-warning'
        : 'status-active',
    expirationDate: rawExpires || 'Not active',
    nextAutoRenewDate: resolved.nextAutoRenewDate,
    renewalAmountText: resolved.renewalAmountText,
    autoRenewalPaymentText: resolved.autoRenewalPaymentText,
    projectedExpirationDate: resolved.projectedExpirationDate,
    interval: resolved.interval,
    isAutoRenewing: resolved.isAutoRenewing,
    canCancel: resolved.isAutoRenewing && Boolean(subId),
    canResume: !resolved.isAutoRenewing && Boolean(subId) && !isExpired && isSubActiveInStripe,
    canSubscribe: isExpired && Boolean(opts.subscribeUrl),
    subscribeUrl: opts.subscribeUrl,
    ...buildEditAndPaymentFields({
      subscriptionId: subId,
      rawExpirationDate: rawExpires,
      todayStr: opts.todayStr,
      isManageableActiveSub: !isExpired && isSubActiveInStripe,
      paymentMethodSummary: resolved.paymentMethodSummary,
    }),
    ...(!isExpired ? membershipWarning : {}),
  };
}

export function buildVideoLibrarySubscriptionCard(opts: {
  member: Member;
  todayStr: string;
  subscribeUrl?: string;
}): DisplaySubscriptionCard | null {
  const m = opts.member;
  const rawExpires = (m.classVideoLibraryExpirationDate || '').trim();
  const subId = (m.classVideoLibrarySubscriptionId || '').trim();

  if (!m.classVideoLibrarySubscription && !rawExpires && !subId) {
    return null;
  }

  // Unlimited / lifetime video library access: `classVideoLibrarySubscription === true` with no expiration date
  if (
    m.classVideoLibrarySubscription &&
    ((!rawExpires && !subId) || rawExpires === '9999-12-31')
  ) {
    return {
      id: 'video-library-card',
      subscriptionId: '',
      title: 'Class Video Library',
      category: SubscriptionCardCategory.VideoLibrary,
      status: SubscriptionCardStatus.Lifetime,
      statusLabel: 'Lifetime Access',
      statusClass: 'status-active',
      expirationDate: 'Never expires',
      nextAutoRenewDate: '',
      renewalAmountText: '',
      autoRenewalPaymentText: '',
      projectedExpirationDate: '',
      interval: 'month',
      isAutoRenewing: false,
      canCancel: false,
      canResume: false,
      canSubscribe: false,
      subscribeUrl: opts.subscribeUrl,
      ...emptyEditFields(),
    };
  }

  // If the subscription boolean is explicitly false despite a future date and no Stripe subscription,
  // access has been disabled — do not report it as active.
  if (!m.classVideoLibrarySubscription && !subId && rawExpires >= opts.todayStr) {
    return null;
  }

  const isExpired =
    !m.classVideoLibrarySubscription || !rawExpires || rawExpires < opts.todayStr;
  const resolved = resolveMemberSubscriptionRenewal({
    subscriptionId: subId,
    expirationDate: rawExpires,
    defaultInterval: 'month',
    todayStr: opts.todayStr,
    stripeSubscriptions: m.stripeSubscriptions,
  });

  const status = isExpired
    ? SubscriptionCardStatus.Expired
    : SubscriptionCardStatus.Active;
  const subRecord = subId ? m.stripeSubscriptions?.[subId] : undefined;
  const isSubActiveInStripe =
    !subRecord ||
    subRecord.status === SubscriptionStatus.Active ||
    subRecord.status === SubscriptionStatus.Trialing;

  return {
    id: subId || 'video-library-card',
    subscriptionId: subId,
    title: 'Class Video Library',
    category: SubscriptionCardCategory.VideoLibrary,
    status,
    statusLabel: !rawExpires
      ? 'Not Active'
      : isExpired
        ? 'Expired'
        : resolved.isAutoRenewing
          ? 'Active (Auto-Renewing)'
          : 'Active (Expires on date)',
    statusClass: isExpired ? 'status-expired' : 'status-active',
    expirationDate: rawExpires || 'Not active',
    nextAutoRenewDate: resolved.nextAutoRenewDate,
    renewalAmountText: resolved.renewalAmountText,
    autoRenewalPaymentText: resolved.autoRenewalPaymentText,
    projectedExpirationDate: resolved.projectedExpirationDate,
    interval: resolved.interval,
    isAutoRenewing: resolved.isAutoRenewing,
    canCancel: resolved.isAutoRenewing && Boolean(subId),
    canResume: !resolved.isAutoRenewing && Boolean(subId) && !isExpired && isSubActiveInStripe,
    canSubscribe: isExpired && Boolean(opts.subscribeUrl),
    subscribeUrl: opts.subscribeUrl,
    ...buildEditAndPaymentFields({
      subscriptionId: subId,
      rawExpirationDate: rawExpires,
      todayStr: opts.todayStr,
      isManageableActiveSub: !isExpired && isSubActiveInStripe,
      paymentMethodSummary: resolved.paymentMethodSummary,
    }),
  };
}

export function buildSchoolSubscriptionCards(opts: {
  member: Member;
  schools: School[];
  billingMap: Record<string, ManagedSchoolBillingInfo>;
  orders: MemberOrder[];
  todayStr: string;
  baseSchoolLicenseUrl: string;
}): {
  allSchoolCards: DisplaySubscriptionCard[];
  ownPayerCards: DisplaySubscriptionCard[];
  otherPayerCards: DisplaySubscriptionCard[];
  handledSubIds: Set<string>;
} {
  const m = opts.member;
  const todayStr = opts.todayStr;
  const schools = opts.schools;
  const billingMap = opts.billingMap;
  const myOrders = opts.orders;
  const handledSubIds = new Set<string>();
  const allSchoolCards: DisplaySubscriptionCard[] = [];
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

  for (const school of schools) {
    const schoolTitle = `School License: ${school.schoolName || school.schoolId || 'School'}`;
    const subscribeUrl = school.schoolId
      ? `${opts.baseSchoolLicenseUrl}?schoolId=${encodeURIComponent(school.schoolId)}`
      : opts.baseSchoolLicenseUrl;

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
        identifierChip: school.schoolId || undefined,
        schoolDocId: school.docId,
        schoolId: school.schoolId || undefined,
        category: SubscriptionCardCategory.SchoolLicense,
        status: SubscriptionCardStatus.Lifetime,
        statusLabel: 'Lifetime Access',
        statusClass: 'status-active',
        expirationDate: 'Never expires',
        nextAutoRenewDate: '',
        renewalAmountText: '',
        autoRenewalPaymentText: '',
        projectedExpirationDate: '',
        interval: 'year',
        isAutoRenewing: false,
        canCancel: false,
        canResume: false,
        canSubscribe: false,
        subscribeUrl,
        payerLabel,
        isCurrentUserPayer,
        ...emptyEditFields(),
      };
      allSchoolCards.push(card);
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
    let renewalAmountText = '';
    let autoRenewalPaymentText = '';
    let projectedExpirationDate = '';
    let interval: 'month' | 'year' =
      ownSub?.interval === SubscriptionInterval.Month ? 'month' : 'year';
    let paymentMethodSummary = '';

    if (ownSubId) {
      const resolved = resolveMemberSubscriptionRenewal({
        subscriptionId: ownSubId,
        expirationDate: school.schoolLicenseExpires,
        defaultInterval: interval,
        todayStr,
        stripeSubscriptions: m.stripeSubscriptions,
      });
      isAutoRenewing = resolved.isAutoRenewing;
      nextAutoRenewDate = resolved.nextAutoRenewDate;
      renewalAmountText = resolved.renewalAmountText;
      autoRenewalPaymentText = resolved.autoRenewalPaymentText;
      projectedExpirationDate = resolved.projectedExpirationDate;
      interval = resolved.interval;
      paymentMethodSummary = resolved.paymentMethodSummary;
    } else if (
      billingInfo?.isAutoRenewing &&
      billingInfo.nextAutoRenewDate &&
      billingInfo.nextAutoRenewDate >= todayStr
    ) {
      isAutoRenewing = true;
      nextAutoRenewDate = billingInfo.nextAutoRenewDate;
      interval = billingInfo.interval || 'year';
      renewalAmountText =
        billingInfo.amount !== null && billingInfo.amount >= 0
          ? formatAmountWithCurrency(billingInfo.amount, billingInfo.currency)
          : '';
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
    const isOwnSubActiveInStripe =
      !ownSub ||
      ownSub.status === SubscriptionStatus.Active ||
      ownSub.status === SubscriptionStatus.Trialing;

    const card: DisplaySubscriptionCard = {
      id: ownSubId || `school-card-${school.docId}`,
      subscriptionId: canManageOwnSub ? ownSubId : '',
      title: schoolTitle,
      identifierChip: school.schoolId || undefined,
      schoolDocId: school.docId,
      schoolId: school.schoolId || undefined,
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
      renewalAmountText,
      autoRenewalPaymentText,
      projectedExpirationDate,
      interval,
      isAutoRenewing,
      canCancel: canManageOwnSub && isAutoRenewing,
      canResume:
        canManageOwnSub && !isAutoRenewing && !isExpired && isOwnSubActiveInStripe,
      canSubscribe: isExpired,
      subscribeUrl,
      payerLabel,
      isCurrentUserPayer,
      ...buildEditAndPaymentFields({
        subscriptionId: canManageOwnSub ? ownSubId : '',
        rawExpirationDate: school.schoolLicenseExpires,
        todayStr,
        isManageableActiveSub:
          canManageOwnSub && !isExpired && isOwnSubActiveInStripe,
        paymentMethodSummary: canManageOwnSub ? paymentMethodSummary : undefined,
      }),
    };

    allSchoolCards.push(card);
    if (isCurrentUserPayer) {
      ownPayerCards.push(card);
    } else {
      otherPayerCards.push(card);
    }
  }

  // Include any SchoolLicense Stripe subscription on the member doc whose school wasn't in `schools`
  for (const [subId, sub] of ownSchoolSubs) {
    if (handledSubIds.has(subId)) continue;
    handledSubIds.add(subId);
    const resolved = resolveMemberSubscriptionRenewal({
      subscriptionId: subId,
      expirationDate: sub.currentPeriodEnd,
      defaultInterval:
        sub.interval === SubscriptionInterval.Month ? 'month' : 'year',
      todayStr,
      stripeSubscriptions: m.stripeSubscriptions,
    });
    const isActiveSub =
      sub.status === SubscriptionStatus.Active ||
      sub.status === SubscriptionStatus.Trialing;
    const extraCard: DisplaySubscriptionCard = {
      id: subId,
      subscriptionId: subId,
      title: sub.schoolName
        ? `School License: ${sub.schoolName}`
        : sub.planName || 'School License',
      identifierChip: sub.schoolId || undefined,
      schoolDocId: sub.schoolDocId,
      schoolId: sub.schoolId,
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
      renewalAmountText: resolved.renewalAmountText,
      autoRenewalPaymentText: resolved.autoRenewalPaymentText,
      projectedExpirationDate: resolved.projectedExpirationDate,
      interval: resolved.interval,
      isAutoRenewing: resolved.isAutoRenewing,
      canCancel: resolved.isAutoRenewing,
      canResume: !resolved.isAutoRenewing && isActiveSub,
      canSubscribe: !isActiveSub,
      subscribeUrl: sub.schoolId
        ? `${opts.baseSchoolLicenseUrl}?schoolId=${encodeURIComponent(sub.schoolId)}`
        : opts.baseSchoolLicenseUrl,
      payerLabel: selfLabel,
      isCurrentUserPayer: true,
      ...buildEditAndPaymentFields({
        subscriptionId: subId,
        rawExpirationDate: sub.currentPeriodEnd,
        todayStr,
        isManageableActiveSub: isActiveSub,
        paymentMethodSummary: resolved.paymentMethodSummary,
      }),
    };
    allSchoolCards.push(extraCard);
    ownPayerCards.push(extraCard);
  }

  return { allSchoolCards, ownPayerCards, otherPayerCards, handledSubIds };
}

export function buildAllMemberSubscriptionCards(opts: {
  member: Member;
  managedSchools: School[];
  billingMap: Record<string, ManagedSchoolBillingInfo>;
  orders: MemberOrder[];
  todayStr: string;
  urls: {
    membership: string;
    instructorLicense: string;
    videoLibrary: string;
    schoolLicense: string;
  };
}): {
  subscriptions: DisplaySubscriptionCard[];
  otherPayerSchoolSubscriptions: DisplaySubscriptionCard[];
} {
  const m = opts.member;
  const cards: DisplaySubscriptionCard[] = [];

  const membershipCard = buildMembershipSubscriptionCard({
    member: m,
    todayStr: opts.todayStr,
    subscribeUrl: opts.urls.membership,
    includeIfNeverSubscribed: true,
  });
  if (membershipCard) cards.push(membershipCard);

  const instructorCard = buildInstructorLicenseSubscriptionCard({
    member: m,
    todayStr: opts.todayStr,
    subscribeUrl: opts.urls.instructorLicense,
  });
  if (instructorCard) cards.push(instructorCard);

  const videoCard = buildVideoLibrarySubscriptionCard({
    member: m,
    todayStr: opts.todayStr,
    subscribeUrl: opts.urls.videoLibrary,
  });
  if (videoCard) cards.push(videoCard);

  const schoolCardsInfo = buildSchoolSubscriptionCards({
    member: m,
    schools: opts.managedSchools,
    billingMap: opts.billingMap,
    orders: opts.orders,
    todayStr: opts.todayStr,
    baseSchoolLicenseUrl: opts.urls.schoolLicense,
  });
  cards.push(...schoolCardsInfo.ownPayerCards);

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
        expirationDate: sub.currentPeriodEnd,
        defaultInterval:
          sub.interval === SubscriptionInterval.Month ? 'month' : 'year',
        todayStr: opts.todayStr,
        stripeSubscriptions: m.stripeSubscriptions,
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
        renewalAmountText: resolved.renewalAmountText,
        autoRenewalPaymentText: resolved.autoRenewalPaymentText,
        projectedExpirationDate: resolved.projectedExpirationDate,
        interval: resolved.interval,
        isAutoRenewing: resolved.isAutoRenewing,
        canCancel: resolved.isAutoRenewing,
        canResume: !resolved.isAutoRenewing && isActiveSub,
        canSubscribe: false,
        ...buildEditAndPaymentFields({
          subscriptionId: subId,
          rawExpirationDate: sub.currentPeriodEnd,
          todayStr: opts.todayStr,
          isManageableActiveSub: isActiveSub,
          paymentMethodSummary: resolved.paymentMethodSummary,
        }),
      });
    }
  }

  return {
    subscriptions: cards,
    otherPayerSchoolSubscriptions: schoolCardsInfo.otherPayerCards,
  };
}
