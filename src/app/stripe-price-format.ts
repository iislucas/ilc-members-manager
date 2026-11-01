/* stripe-price-format.ts
 *
 * Formatting helpers shared by every page that shows a Stripe price.
 *
 * The catalogue namespaces its names with a colon — products are called
 * "MEMBERSHIP : Annual" and "GRADING : Student Levels", and their prices are
 * nicknamed "Annual : 65+ Senior" or "Student Level 1". The prefix is useful
 * for finding things in the Stripe dashboard but only repeats context the page
 * already gives the reader, so `tidyStripeLabel` drops it for display.
 */

import { MemberSubscriptionItem, SubscriptionInterval, SubscriptionStatus } from '../../functions/src/data-model/members';
import { MemberOrder, MemberOrderPaymentStatus, MemberOrderType } from '../../functions/src/data-model/orders';
import { StripeProductPrice } from '../../functions/src/stripe-types';

/**
 * Format a price as an amount plus its billing period, e.g. "$85.00/year" or
 * "$850.00 one-time". Returns '' for a price with no amount, so callers can
 * skip it rather than render a stray currency symbol.
 *
 * Pass `omitOneTimeSuffix` where a one-time charge is the only kind on show
 * and the words would just repeat down the column.
 */
export function formatStripePrice(
  price: StripeProductPrice | null | undefined,
  opts: { omitOneTimeSuffix?: boolean } = {},
): string {
  if (!price || price.unitAmount === null || price.unitAmount === undefined) {
    return '';
  }

  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (price.currency || 'usd').toUpperCase(),
  }).format(price.unitAmount / 100);

  if (price.type === 'recurring' && price.recurringInterval) {
    const count = price.recurringIntervalCount ?? 1;
    const interval =
      count > 1
        ? `${count} ${price.recurringInterval}s`
        : price.recurringInterval;
    return `${amount}/${interval}`;
  }
  // On a card where every rate is a single charge, "one-time" on each line
  // says nothing the reader does not already know.
  return opts.omitOneTimeSuffix ? amount : `${amount} one-time`;
}

/**
 * Format a bare amount with no billing period, for callers that supply the
 * period themselves (e.g. "$90.00 / year" laid out in the template).
 */
export function formatStripeAmount(
  unitAmount?: number | null,
  currency?: string | null,
): string {
  if (unitAmount === null || unitAmount === undefined) return '';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(unitAmount / 100);
}

/**
 * Strip the catalogue's namespace prefix: "MEMBERSHIP : Annual" becomes
 * "Annual", and "Annual : 65+ Senior" becomes "65+ Senior". Names without a
 * " : " separator are returned unchanged.
 */
export function tidyStripeLabel(label: string | null | undefined): string {
  if (!label) return '';
  const parts = label.split(' : ');
  return (parts[parts.length - 1] || '').trim() || label.trim();
}

/**
 * Format an integer minor-unit amount with its uppercase ISO currency code,
 * e.g. `2500, 'usd'` -> `'$25.00 USD'`. Returns `''` when no amount is known.
 */
export function formatAmountWithCurrency(
  unitAmount?: number | null,
  currency?: string | null,
): string {
  if (unitAmount === null || unitAmount === undefined) return '';
  const curr = (currency || 'usd').toUpperCase();
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: curr,
    currencyDisplay: 'narrowSymbol',
  }).format(unitAmount / 100);
  return `${formatted} ${curr}`;
}

/**
 * Format a next auto-renewal payment date and optional recurring payment amount:
 * e.g. `'2026-11-23', 2500, 'usd'` -> `'2026-11-23 ($25.00 USD)'`,
 * or `'2026-11-23'` when no positive recurring amount is recorded.
 */
export function formatNextAutoRenewalPayment(
  nextDate?: string | null,
  unitAmount?: number | null,
  currency?: string | null,
): string {
  const dateStr = (nextDate || '').trim();
  if (!dateStr) return '';
  if (unitAmount !== null && unitAmount !== undefined && unitAmount > 0) {
    const amt = formatAmountWithCurrency(unitAmount, currency);
    if (amt) {
      return `${dateStr} (${amt})`;
    }
  }
  return dateStr;
}

/**
 * Add `count` months or years to a `YYYY-MM-DD` string in UTC, clamping end-of-month
 * overflow to the last valid day of the target month.
 */
export function addBillingIntervalToDateString(
  dateStr: string,
  interval: 'month' | 'year',
  count = 1,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return '';
  const startYear = Number(match[1]);
  const startMonthIndex = Number(match[2]) - 1;
  const startDay = Number(match[3]);

  const totalMonths =
    startYear * 12 + startMonthIndex + (interval === 'year' ? count * 12 : count);
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(startDay, daysInTargetMonth);
  const yyyy = String(targetYear).padStart(4, '0');
  const mm = String(targetMonthIndex + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface ResolvedSubscriptionRenewal {
  isAutoRenewing: boolean;
  nextAutoRenewDate: string;
  amount: number | null;
  currency: string;
  interval: 'month' | 'year';
  autoRenewalPaymentText: string;
  projectedExpirationDate: string;
  paymentMethodSummary: string;
}

/**
 * Add or subtract integer days from a `YYYY-MM-DD` string in UTC.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || '').trim());
  if (!match) return '';
  const dt = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().split('T')[0];
}

/**
 * Format a strictly masked payment method summary from brand and last4, e.g.
 * `'visa', '4242'` -> `'Visa •••• 4242'`. Never exposes unmasked card numbers.
 */
export function formatMaskedPaymentMethod(
  brand?: string | null,
  last4?: string | null,
): string {
  const rawBrand = (brand || '').trim();
  const rawLast4 = (last4 || '').trim();
  const validLast4 = /^\d{4}$/.test(rawLast4) ? rawLast4 : '';

  const brandMap: Record<string, string> = {
    amex: 'American Express',
    american_express: 'American Express',
    diners: 'Diners Club',
    discover: 'Discover',
    jcb: 'JCB',
    link: 'Link',
    mastercard: 'Mastercard',
    sepa: 'SEPA',
    sepa_debit: 'SEPA Debit',
    unionpay: 'UnionPay',
    us_bank_account: 'Bank Account',
    visa: 'Visa',
  };
  const lower = rawBrand.toLowerCase();
  const prettyBrand = rawBrand
    ? (brandMap[lower] ?? rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1))
    : '';

  if (prettyBrand && validLast4) {
    return `${prettyBrand} •••• ${validLast4}`;
  }
  if (validLast4) {
    return `Card •••• ${validLast4}`;
  }
  return prettyBrand;
}

export interface RenewalEditBounds {
  defaultDate: string;
  minDate: string;
  maxDate: string;
}

/**
 * Compute the allowed `[minDate, maxDate]` bounds and default selection
 * (`expirationDate - 7 days`, clamped into `[minDate, maxDate]`) for editing a
 * subscription's next renewal charge date. Returns `null` when `expirationDate`
 * is missing, lifetime (`9999-12-31`), or earlier than tomorrow (`minDate`).
 */
export function computeRenewalEditBounds(
  expirationDate: string | null | undefined,
  todayStr: string,
): RenewalEditBounds | null {
  const minDate = addDaysToDateString(todayStr, 1);
  if (!minDate) return null;
  const cleanedExp = (expirationDate || '').split('T')[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanedExp) || cleanedExp === '9999-12-31') {
    return null;
  }
  if (cleanedExp < minDate) {
    return null;
  }
  const fiveYearCap = addDaysToDateString(todayStr, 365 * 5 - 1);
  const maxDate =
    fiveYearCap && cleanedExp > fiveYearCap ? fiveYearCap : cleanedExp;
  const oneWeekBefore = addDaysToDateString(cleanedExp, -7);
  const defaultDate =
    !oneWeekBefore || oneWeekBefore < minDate
      ? minDate
      : oneWeekBefore > maxDate
        ? maxDate
        : oneWeekBefore;
  return { defaultDate, minDate, maxDate };
}

/**
 * Compute the new access expiration date (`YYYY-MM-DD`) that will apply once
 * a forthcoming auto-renewal payment succeeds on `nextAutoRenewDate`.
 *
 * Matches backend fulfillment stacking (`extendDateByYears` / `extendDateByMonths`):
 * if `currentExpirationDate` is on or after `nextAutoRenewDate` (e.g. when access
 * was purchased in advance), 1 billing interval is stacked onto `currentExpirationDate`;
 * otherwise 1 billing interval is added starting from `nextAutoRenewDate`.
 */
export function computeProjectedRenewalExpirationDate(opts: {
  currentExpirationDate?: string | null;
  nextAutoRenewDate?: string | null;
  interval: 'month' | 'year';
}): string {
  const renewDate = (opts.nextAutoRenewDate || '').split('T')[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewDate)) return '';

  const cleanedCurrent = (opts.currentExpirationDate || '').split('T')[0].trim();
  if (cleanedCurrent === '9999-12-31') return '';

  const baseDateStr =
    /^\d{4}-\d{2}-\d{2}$/.test(cleanedCurrent) && cleanedCurrent >= renewDate
      ? cleanedCurrent
      : renewDate;

  return addBillingIntervalToDateString(baseDateStr, opts.interval, 1);
}

/**
 * Resolve the true next Stripe auto-renewal payment date and recurring charge
 * amount for a member subscription, keeping stacked access expiration dates
 * separate from the billing cycle end.
 */
export function resolveMemberSubscriptionRenewal(opts: {
  subscriptionId?: string | null;
  fallbackNextAutoRenewDate?: string | null;
  expirationDate?: string | null;
  defaultInterval: 'month' | 'year';
  todayStr: string;
  stripeSubscriptions?: Record<string, MemberSubscriptionItem>;
  orders?: MemberOrder[];
  orderMatcher?: (order: MemberOrder) => boolean;
  fallbackPrice?: { unitAmount: number | null; currency: string } | null;
}): ResolvedSubscriptionRenewal {
  const subId = (opts.subscriptionId || '').trim();
  const sub = subId ? opts.stripeSubscriptions?.[subId] : undefined;
  const orders = opts.orders || [];

  let storedNextDate = '';
  if (sub) {
    const isActive =
      (sub.status === SubscriptionStatus.Active ||
        sub.status === SubscriptionStatus.Trialing) &&
      !sub.cancelAtPeriodEnd;
    storedNextDate = isActive ? (sub.nextAutoRenewDate || '').trim() : '';
  } else if (subId && opts.fallbackNextAutoRenewDate) {
    storedNextDate = opts.fallbackNextAutoRenewDate.trim();
  }

  const isAutoRenewing = Boolean(storedNextDate && storedNextDate >= opts.todayStr);
  let nextAutoRenewDate = isAutoRenewing ? storedNextDate : '';

  const paidOrders = orders
    .filter(
      (o) =>
        o.paymentStatus === MemberOrderPaymentStatus.Paid &&
        o.orderType !== MemberOrderType.Cancellation,
    )
    .sort((a, b) =>
      ((b.date || b.created || '').split('T')[0]).localeCompare(
        (a.date || a.created || '').split('T')[0],
      ),
    );

  // Guard against pre-migration records where fulfillStripeOrder wrote stacked
  // expirationDate into nextAutoRenewDate instead of the billing period end.
  // Skip when the subscription is in `trialing` status (which happens when a
  // member intentionally rescheduled their renewal date via `trial_end`).
  if (
    isAutoRenewing &&
    sub?.status !== SubscriptionStatus.Trialing &&
    opts.expirationDate &&
    nextAutoRenewDate === opts.expirationDate.trim()
  ) {
    const latestSubOrder = paidOrders.find(
      (o) =>
        (subId && o.subscriptionId === subId) ||
        (o.orderType === MemberOrderType.Renewal && Boolean(opts.orderMatcher?.(o))),
    );
    const orderCycleStart = latestSubOrder
      ? (latestSubOrder.date || latestSubOrder.created || '').split('T')[0]
      : '';
    const subCycleStart = (sub?.currentPeriodStart || '').trim();
    const cycleStart =
      orderCycleStart > subCycleStart ? orderCycleStart : subCycleStart;
    const interval: 'month' | 'year' =
      sub?.interval === SubscriptionInterval.Month
        ? 'month'
        : sub?.interval === SubscriptionInterval.Year
          ? 'year'
          : opts.defaultInterval;

    if (/^\d{4}-\d{2}-\d{2}$/.test(cycleStart)) {
      const expectedCycleEnd = addBillingIntervalToDateString(cycleStart, interval, 1);
      if (
        expectedCycleEnd &&
        expectedCycleEnd >= opts.todayStr &&
        expectedCycleEnd < nextAutoRenewDate
      ) {
        nextAutoRenewDate = expectedCycleEnd;
      }
    }
  }

  let amount: number | null = null;
  let currency = 'usd';

  if (sub && typeof sub.amount === 'number' && sub.amount > 0) {
    amount = sub.amount;
    currency = sub.currency || 'usd';
  } else {
    const matchedOrder =
      (subId
        ? paidOrders.find((o) => o.subscriptionId === subId && (o.amountTotal ?? 0) > 0)
        : undefined) ||
      (opts.orderMatcher
        ? paidOrders.find((o) => opts.orderMatcher!(o) && (o.amountTotal ?? 0) > 0)
        : undefined);

    if (matchedOrder && matchedOrder.amountTotal !== null && matchedOrder.amountTotal > 0) {
      const totalQty =
        matchedOrder.lineItems && matchedOrder.lineItems.length > 0
          ? matchedOrder.lineItems.reduce((sum, li) => sum + (li.quantity || 1), 0)
          : 1;
      amount =
        totalQty > 1 && matchedOrder.subscriptionId !== subId
          ? Math.round(matchedOrder.amountTotal / totalQty)
          : matchedOrder.amountTotal;
      currency = matchedOrder.currency || 'usd';
    } else if (
      opts.fallbackPrice &&
      opts.fallbackPrice.unitAmount !== null &&
      opts.fallbackPrice.unitAmount > 0
    ) {
      amount = opts.fallbackPrice.unitAmount;
      currency = opts.fallbackPrice.currency || 'usd';
    }
  }

  let resolvedInterval: 'month' | 'year' =
    sub?.interval === SubscriptionInterval.Month
      ? 'month'
      : sub?.interval === SubscriptionInterval.Year
        ? 'year'
        : opts.defaultInterval;

  if (!sub?.interval) {
    const orderForInterval =
      (subId ? paidOrders.find((o) => o.subscriptionId === subId) : undefined) ||
      (opts.orderMatcher ? paidOrders.find((o) => opts.orderMatcher!(o)) : undefined);
    if (orderForInterval) {
      const descLower = [
        orderForInterval.description || '',
        ...(orderForInterval.lineItems || []).map((li) => li.description || ''),
      ]
        .join(' ')
        .toLowerCase();
      if (descLower.includes('annual') || descLower.includes('year')) {
        resolvedInterval = 'year';
      } else if (descLower.includes('month')) {
        resolvedInterval = 'month';
      }
    }
  }

  const paymentMethodSummary = sub
    ? formatMaskedPaymentMethod(sub.paymentMethodBrand, sub.paymentMethodLast4)
    : '';

  return {
    isAutoRenewing,
    nextAutoRenewDate,
    amount,
    currency,
    interval: resolvedInterval,
    autoRenewalPaymentText: isAutoRenewing
      ? formatNextAutoRenewalPayment(nextAutoRenewDate, amount, currency)
      : '',
    projectedExpirationDate: isAutoRenewing
      ? computeProjectedRenewalExpirationDate({
          currentExpirationDate: opts.expirationDate,
          nextAutoRenewDate,
          interval: resolvedInterval,
        })
      : '',
    paymentMethodSummary,
  };
}
