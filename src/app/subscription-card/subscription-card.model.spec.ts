import { describe, expect, it } from 'vitest';
import { InstructorLicenseType, StudentLevel, ApplicationLevel } from '../../../functions/src/data-model/curriculum';
import {
  MembershipType,
  SubscriptionInterval,
  SubscriptionItemType,
  SubscriptionStatus,
  initMember,
} from '../../../functions/src/data-model/members';
import { initSchool } from '../../../functions/src/data-model/schools';
import {
  computeRenewalEditBounds,
  formatMaskedPaymentMethod,
} from '../stripe-price-format';
import {
  SubscriptionCardStatus,
  buildAllMemberSubscriptionCards,
  buildInstructorLicenseSubscriptionCard,
  buildMembershipSubscriptionCard,
  buildSchoolSubscriptionCards,
  buildVideoLibrarySubscriptionCard,
} from './subscription-card.model';

describe('subscription-card.model and helpers', () => {
  it('computes renewal edit bounds defaulting to 7 days before expiration and clamped to tomorrow', () => {
    // Normal stacked expiration well in the future
    const bounds = computeRenewalEditBounds('2028-04-23', '2026-11-01');
    expect(bounds).toEqual({
      defaultDate: '2028-04-16',
      minDate: '2026-11-02',
      maxDate: '2028-04-23',
    });

    // Expiration less than 7 days away clamps defaultDate to tomorrow
    const tightBounds = computeRenewalEditBounds('2026-11-05', '2026-11-01');
    expect(tightBounds).toEqual({
      defaultDate: '2026-11-02',
      minDate: '2026-11-02',
      maxDate: '2026-11-05',
    });

    // Expired or today returns null (cannot defer past expiration or to today)
    expect(computeRenewalEditBounds('2026-11-01', '2026-11-01')).toBeNull();
    expect(computeRenewalEditBounds('2020-01-01', '2026-11-01')).toBeNull();
  });

  it('formats strictly masked payment method summaries', () => {
    expect(formatMaskedPaymentMethod('visa', '4242')).toBe('Visa •••• 4242');
    expect(formatMaskedPaymentMethod('mastercard', '9876')).toBe('Mastercard •••• 9876');
    expect(formatMaskedPaymentMethod('sepa_debit', '3000')).toBe('SEPA Debit •••• 3000');
    expect(formatMaskedPaymentMethod('link', '')).toBe('Stripe Link');
    expect(formatMaskedPaymentMethod('', '4242')).toBe('Card •••• 4242');
    expect(formatMaskedPaymentMethod('visa', 'not4digits')).toBe('Visa');
    expect(formatMaskedPaymentMethod('', '')).toBe('');
  });

  it('builds Lifetime membership card with no auto-renewal fields and returns null for brand-new user when includeIfNeverSubscribed is false', () => {
    const newMember = initMember();
    expect(
      buildMembershipSubscriptionCard({
        member: newMember,
        todayStr: '2026-11-01',
        includeIfNeverSubscribed: false,
      }),
    ).toBeNull();

    const lifeMember = {
      ...initMember(),
      memberId: 'US100',
      membershipType: MembershipType.Life,
    };
    const card = buildMembershipSubscriptionCard({
      member: lifeMember,
      todayStr: '2026-11-01',
    });
    expect(card?.status).toBe(SubscriptionCardStatus.Lifetime);
    expect(card?.statusLabel).toBe('Lifetime Access');
    expect(card?.isAutoRenewing).toBe(false);
    expect(card?.nextAutoRenewDate).toBe('');
    expect(card?.canEditRenewalDate).toBe(false);
    expect(card?.canUpdatePaymentMethod).toBe(false);
  });

  it('preserves user-selected renewal date equal to expirationDate when subscription status is trialing', () => {
    const member = {
      ...initMember(),
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2028-04-23',
      membershipSubscriptionId: 'sub_mem_trial',
      membershipNextAutoRenewDate: '2028-04-23',
      stripeSubscriptions: {
        sub_mem_trial: {
          subscriptionId: 'sub_mem_trial',
          type: SubscriptionItemType.Membership,
          status: SubscriptionStatus.Trialing,
          planName: 'Annual Membership',
          amount: 8500,
          currency: 'usd',
          interval: SubscriptionInterval.Year,
          currentPeriodStart: '2026-11-01',
          currentPeriodEnd: '2028-04-23',
          nextAutoRenewDate: '2028-04-23',
          cancelAtPeriodEnd: false,
          paymentMethodBrand: 'visa',
          paymentMethodLast4: '4242',
        },
      },
    };

    const card = buildMembershipSubscriptionCard({
      member,
      todayStr: '2026-11-01',
    });

    expect(card?.isAutoRenewing).toBe(true);
    expect(card?.nextAutoRenewDate).toBe('2028-04-23');
    expect(card?.renewalAmountText).toBe('$85.00 USD');
    expect(card?.projectedExpirationDate).toBe('2029-04-23');
    expect(card?.canEditRenewalDate).toBe(true);
    expect(card?.defaultRenewalEditDate).toBe('2028-04-16');
    expect(card?.canUpdatePaymentMethod).toBe(true);
    expect(card?.paymentMethodSummary).toBe('Visa •••• 4242');
  });

  it('adds dual-requirement membership warning on instructor license card when membership is expired', () => {
    const member = {
      ...initMember(),
      instructorId: 'INS-77',
      studentLevel: StudentLevel.Level6,
      applicationLevel: ApplicationLevel.Level1,
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2020-01-01',
      instructorLicenseExpires: '2028-01-01',
      instructorLicenseSubscriptionId: 'sub_ins_77',
      instructorLicenseNextAutoRenewDate: '2027-01-01',
      instructorLicenseType: InstructorLicenseType.Annual,
      stripeSubscriptions: {
        sub_ins_77: {
          subscriptionId: 'sub_ins_77',
          type: SubscriptionItemType.InstructorLicense,
          status: SubscriptionStatus.Active,
          planName: 'Instructor License',
          amount: 15000,
          currency: 'usd',
          interval: SubscriptionInterval.Year,
          currentPeriodStart: '2026-01-01',
          currentPeriodEnd: '2027-01-01',
          nextAutoRenewDate: '2027-01-01',
          cancelAtPeriodEnd: false,
        },
      },
    };

    const card = buildInstructorLicenseSubscriptionCard({
      member,
      todayStr: '2026-11-01',
    });

    expect(card?.status).toBe(SubscriptionCardStatus.Active);
    expect(card?.statusLabel).toBe('Membership Required');
    expect(card?.warningTitle).toContain('Active Membership Required');
    expect(card?.warningText).toContain('valid through 2028-01-01');
    expect(card?.canCancel).toBe(true);
  });

  it('returns null for video library when boolean is false with future expiration and no Stripe subscription', () => {
    const member = {
      ...initMember(),
      classVideoLibrarySubscription: false,
      classVideoLibraryExpirationDate: '2099-12-31',
      classVideoLibrarySubscriptionId: '',
    };
    expect(
      buildVideoLibrarySubscriptionCard({
        member,
        todayStr: '2026-11-01',
      }),
    ).toBeNull();
  });

  it('separates own-payer vs co-managed school cards and blocks non-payers from management actions', () => {
    const school = {
      ...initSchool(),
      docId: 'sch-doc-1',
      schoolId: 'SCH-1',
      schoolName: 'Paris Branch',
      schoolLicenseExpires: '2027-09-01',
    };
    const member = {
      ...initMember(),
      docId: 'mem-co-mgr',
      memberId: 'FR200',
      name: 'Co Manager',
    };

    const { ownPayerCards, otherPayerCards } = buildSchoolSubscriptionCards({
      member,
      schools: [school],
      billingMap: {
        'sch-doc-1': {
          schoolDocId: 'sch-doc-1',
          schoolId: 'SCH-1',
          payerMemberDocId: 'mem-owner',
          payerMemberId: 'FR100',
          payerName: 'Owner Sifu',
          isAutoRenewing: true,
          nextAutoRenewDate: '2027-09-01',
          amount: 60000,
          currency: 'usd',
          lastPaymentDate: '2026-09-01',
        },
      },
      orders: [],
      todayStr: '2026-11-01',
      baseSchoolLicenseUrl: '/school-license',
    });

    expect(ownPayerCards.length).toBe(0);
    expect(otherPayerCards.length).toBe(1);
    expect(otherPayerCards[0].payerLabel).toBe('Owner Sifu (FR100)');
    expect(otherPayerCards[0].canCancel).toBe(false);
    expect(otherPayerCards[0].canEditRenewalDate).toBe(false);
    expect(otherPayerCards[0].canUpdatePaymentMethod).toBe(false);
    expect(otherPayerCards[0].paymentMethodSummary).toBeUndefined();

    const combined = buildAllMemberSubscriptionCards({
      member: {
        ...member,
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2027-05-01',
      },
      managedSchools: [school],
      billingMap: {},
      orders: [],
      todayStr: '2026-11-01',
      urls: {
        membership: '/become-a-member',
        instructorLicense: '/instructor-license',
        videoLibrary: '/class-video-library-subscription',
        schoolLicense: '/school-license',
      },
    });
    expect(combined.subscriptions.length).toBe(1);
    expect(combined.otherPayerSchoolSubscriptions.length).toBe(1);
  });
});
