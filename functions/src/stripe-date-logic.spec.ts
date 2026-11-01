import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { InstructorLicenseType } from './data-model/curriculum';
import {
  initMember,
  MembershipType,
  SubscriptionInterval,
  SubscriptionItemType,
  SubscriptionStatus,
} from './data-model/members';
import { OrderKind, StripeOrder, StripeOrderType, StripeCheckoutMode } from './data-model/orders';
import {
  extendDateByYears,
  extendDateByMonths,
  fulfillStripeOrder,
  fulfillSpouseLifeMembership,
  syncSubscriptionStatusToMember,
} from './stripe-fulfillment';
import {
  buildMemberSubscriptionItemFromStripe,
  computeRecurringSubscriptionAmount,
  enrichSubscriptionWithPaymentMethod,
  performCreateSubscriptionPaymentMethodSession,
  performRemoveSubscriptionPaymentMethod,
  performUpdateSubscriptionRenewalDate,
  resolveManagedSchoolsBillingForEmail,
} from './stripe-subscriptions';

describe('Stripe Date Logic & Expiration Guarantees', () => {
  let mockDb: any;
  let mockMemberRef: any;
  let updatedMemberData: Record<string, unknown>;

  const baseMember = {
    ...initMember(),
    docId: 'mem_regression_test',
    memberId: 'US777',
    name: 'Master Wang',
    emails: ['wang@example.com'],
    country: 'United States',
    firstMembershipStarted: '2019-06-15',
    lastRenewalDate: '2025-06-15',
    currentMembershipExpires: '2026-06-15',
    membershipSubscriptionId: '',
    membershipNextAutoRenewDate: '',
    instructorLicenseRenewalDate: '2025-06-15',
    instructorLicenseExpires: '2026-06-15',
    instructorLicenseSubscriptionId: '',
    instructorLicenseNextAutoRenewDate: '',
    classVideoLibraryLastRenewalDate: '',
    classVideoLibraryExpirationDate: '',
    classVideoLibrarySubscriptionId: '',
    classVideoLibraryNextAutoRenewDate: '',
  };

  beforeEach(() => {
    updatedMemberData = {};
    mockMemberRef = {
      update: vi.fn().mockImplementation(async (data) => {
        Object.assign(updatedMemberData, data);
        return {};
      }),
      get: vi.fn().mockResolvedValue({
        exists: true,
        id: baseMember.docId,
        data: () => ({ ...baseMember }),
      }),
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          id: 'sub_doc_id',
          set: vi.fn().mockResolvedValue({}),
        }),
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        }),
      }),
    };

    mockDb = {
      collection: vi.fn((colName: string) => {
        if (colName === 'members') {
          return {
            doc: vi.fn().mockReturnValue(mockMemberRef),
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [{ id: baseMember.docId, data: () => ({ ...baseMember }) }],
                }),
              }),
            }),
          };
        }
        if (colName === 'mail') {
          return {
            add: vi.fn().mockResolvedValue({ id: 'mail_mock_id' }),
          };
        }
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: false }),
            set: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          }),
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
            }),
          }),
        };
      }),
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      }),
    };
  });

  // =========================================================================
  // 1. PURE DATE ARITHMETIC UNIT TESTS
  // =========================================================================
  describe('Pure Date Arithmetic (extendDateByYears & extendDateByMonths)', () => {
    describe('extendDateByYears', () => {
      it('adds exactly 1 year to empty date string starting from order date', () => {
        const result = extendDateByYears('', 1, '2026-08-15');
        expect(result).toBe('2027-08-15');
        expect(result).not.toBe('2026-08-15');
      });

      it('adds exactly 1 year to null/undefined date starting from order date', () => {
        expect(extendDateByYears(null, 1, '2026-08-15')).toBe('2027-08-15');
        expect(extendDateByYears(undefined, 1, '2026-08-15')).toBe('2027-08-15');
      });

      it('adds exactly 1 year to an expired date starting from order date (NOT from old expired date)', () => {
        const expiredDate = '2024-03-01';
        const orderDate = '2026-08-15';
        const result = extendDateByYears(expiredDate, 1, orderDate);
        expect(result).toBe('2027-08-15');
      });

      it('adds exactly 1 year from CURRENT EXPIRATION when renewing an active membership early', () => {
        const currentActiveExpiry = '2027-02-28';
        const orderDate = '2026-08-15';
        const result = extendDateByYears(currentActiveExpiry, 1, orderDate);
        expect(result).toBe('2028-02-28');
      });

      it('handles multi-year quantity (e.g. 2 years, 3 years)', () => {
        expect(extendDateByYears('', 2, '2026-08-15')).toBe('2028-08-15');
        expect(extendDateByYears('2027-01-01', 3, '2026-08-15')).toBe('2030-01-01');
      });

      it('preserves lifetime sentinel date 9999-12-31', () => {
        expect(extendDateByYears('9999-12-31', 1, '2026-08-15')).toBe('9999-12-31');
      });

      it('sanitizes ISO timestamp strings with T00:00:00Z without corruption', () => {
        expect(extendDateByYears('2026-11-15T00:00:00.000Z', 1, '2026-08-15')).toBe('2027-11-15');
      });
    });

    describe('extendDateByMonths', () => {
      it('adds exactly 1 month to empty date string starting from order date', () => {
        const result = extendDateByMonths('', 1, '2026-08-15');
        expect(result).toBe('2026-09-15');
        expect(result).not.toBe('2026-08-15');
      });

      it('adds exactly 1 month to null/undefined starting from order date', () => {
        expect(extendDateByMonths(null, 1, '2026-08-15')).toBe('2026-09-15');
        expect(extendDateByMonths(undefined, 1, '2026-08-15')).toBe('2026-09-15');
      });

      it('adds exactly 1 month to an expired date starting from order date', () => {
        const expiredDate = '2025-01-01';
        const orderDate = '2026-08-15';
        expect(extendDateByMonths(expiredDate, 1, orderDate)).toBe('2026-09-15');
      });

      it('adds exactly 1 month from CURRENT EXPIRATION when renewing an active monthly subscription early', () => {
        const currentExpiry = '2026-09-10';
        const orderDate = '2026-08-20';
        expect(extendDateByMonths(currentExpiry, 1, orderDate)).toBe('2026-10-10');
      });

      it('correctly crosses year boundaries (e.g. December to January)', () => {
        expect(extendDateByMonths('2026-12-15', 1, '2026-11-01')).toBe('2027-01-15');
      });
    });
  });

  // =========================================================================
  // 2. ANNUAL MEMBERSHIP RENEWAL & FIRST MEMBERSHIP IMMUTABILITY
  // =========================================================================
  describe('Annual Membership Fulfillment', () => {
    it('REGRESSION GUARD: Expiration must be 1 year AFTER lastRenewalDate, NEVER the same date', async () => {
      const orderDate = '2026-08-15';
      const expiredMember = {
        ...baseMember,
        lastRenewalDate: '2024-05-01',
        currentMembershipExpires: '2025-05-01',
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: `${orderDate}T10:00:00Z`,
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_test_mem_renew',
        mode: StripeCheckoutMode.Payment,
        created: `${orderDate}T10:00:00Z`,
        amountTotal: 8500,
        currency: 'usd',
        metadata: { memberDocId: expiredMember.docId },
        lineItems: [
          {
            productId: 'prod_mem',
            priceId: 'price_mem_ann',
            description: 'Annual Membership Renewal',
            quantity: 1,
            amountTotal: 8500,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, expiredMember, order, 'order_123');

      expect(updatedMemberData['lastRenewalDate']).toBe('2026-08-15');
      expect(updatedMemberData['currentMembershipExpires']).toBe('2027-08-15');
      // Crucial assertion: Expires and Last Renewed MUST NOT be equal
      expect(updatedMemberData['currentMembershipExpires']).not.toBe(
        updatedMemberData['lastRenewalDate'],
      );
    });

    it('REGRESSION GUARD: Existing firstMembershipStarted MUST NEVER be overwritten on renewal', async () => {
      const originalStartDate = '2019-06-15';
      const renewingMember = {
        ...baseMember,
        firstMembershipStarted: originalStartDate,
        lastRenewalDate: '2025-06-15',
        currentMembershipExpires: '2026-06-15',
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T12:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_mem_renew_preserve',
        mode: StripeCheckoutMode.Payment,
        created: '2026-08-15T12:00:00Z',
        amountTotal: 8500,
        currency: 'usd',
        metadata: { memberDocId: renewingMember.docId },
        lineItems: [
          {
            productId: 'prod_mem',
            priceId: 'price_mem_ann',
            description: 'Annual Membership Renewal',
            quantity: 1,
            amountTotal: 8500,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, renewingMember, order, 'order_preserve');

      // firstMembershipStarted MUST NOT be present in updates payload
      expect(updatedMemberData['firstMembershipStarted']).toBeUndefined();
      expect(renewingMember.firstMembershipStarted).toBe(originalStartDate);
    });

    it('Initializes firstMembershipStarted on brand-new member first purchase', async () => {
      const brandNewMember = {
        ...baseMember,
        firstMembershipStarted: '',
        lastRenewalDate: '',
        currentMembershipExpires: '',
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T12:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_mem_first_join',
        mode: StripeCheckoutMode.Payment,
        created: '2026-08-15T12:00:00Z',
        amountTotal: 8500,
        currency: 'usd',
        metadata: { memberDocId: brandNewMember.docId },
        lineItems: [
          {
            productId: 'prod_mem',
            priceId: 'price_mem_ann',
            description: 'Annual Membership',
            quantity: 1,
            amountTotal: 8500,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, brandNewMember, order, 'order_join');

      expect(updatedMemberData['firstMembershipStarted']).toBe('2026-08-15');
      expect(updatedMemberData['lastRenewalDate']).toBe('2026-08-15');
      expect(updatedMemberData['currentMembershipExpires']).toBe('2027-08-15');
    });

    it('Extends from current expiration when renewing early while active', async () => {
      const activeMember = {
        ...baseMember,
        lastRenewalDate: '2026-01-01',
        currentMembershipExpires: '2027-01-01',
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T12:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_mem_early',
        mode: StripeCheckoutMode.Payment,
        created: '2026-08-15T12:00:00Z',
        amountTotal: 8500,
        currency: 'usd',
        metadata: { memberDocId: activeMember.docId },
        lineItems: [
          {
            productId: 'prod_mem',
            priceId: 'price_mem_ann',
            description: 'Annual Membership',
            quantity: 1,
            amountTotal: 8500,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, activeMember, order, 'order_early');

      expect(updatedMemberData['lastRenewalDate']).toBe('2026-08-15');
      expect(updatedMemberData['currentMembershipExpires']).toBe('2028-01-01');
    });
  });

  // =========================================================================
  // 3. CLASS VIDEO LIBRARY (MONTHLY VS ANNUAL)
  // =========================================================================
  describe('Class Video Library Subscriptions', () => {
    it('REGRESSION GUARD: Monthly video subscription must expire 1 MONTH after renewal, NOT 1 year and NOT same day', async () => {
      const videoSubscriber = {
        ...baseMember,
        classVideoLibraryLastRenewalDate: '',
        classVideoLibraryExpirationDate: '',
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T08:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_video_month',
        mode: StripeCheckoutMode.Subscription,
        subscriptionId: 'sub_video_month_999',
        created: '2026-08-15T08:00:00Z',
        amountTotal: 2500,
        currency: 'usd',
        metadata: { memberDocId: videoSubscriber.docId },
        lineItems: [
          {
            productId: 'prod_vid',
            priceId: 'price_vid_monthly',
            description: 'Class Video Library Subscription (Monthly)',
            quantity: 1,
            amountTotal: 2500,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, videoSubscriber, order, 'order_vid_month');

      expect(updatedMemberData['classVideoLibrarySubscription']).toBe(true);
      expect(updatedMemberData['classVideoLibraryLastRenewalDate']).toBe('2026-08-15');
      expect(updatedMemberData['classVideoLibraryExpirationDate']).toBe('2026-09-15');
      expect(updatedMemberData['classVideoLibraryNextAutoRenewDate']).toBe('2026-09-15');

      // Crucial: Expiry is 1 month later, not equal to renewal date and not 1 year
      expect(updatedMemberData['classVideoLibraryExpirationDate']).not.toBe('2026-08-15');
      expect(updatedMemberData['classVideoLibraryExpirationDate']).not.toBe('2027-08-15');

      // Subscription map check
      const subEntry = (updatedMemberData.stripeSubscriptions as any)?.['sub_video_month_999'];
      expect(subEntry).toBeDefined();
      expect(subEntry.interval).toBe(SubscriptionInterval.Month);
      expect(subEntry.currentPeriodStart).toBe('2026-08-15');
      expect(subEntry.currentPeriodEnd).toBe('2026-09-15');
    });

    it('REGRESSION GUARD: Annual video subscription must expire 1 YEAR after renewal', async () => {
      const videoSubscriber = {
        ...baseMember,
        classVideoLibraryLastRenewalDate: '',
        classVideoLibraryExpirationDate: '',
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T08:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_video_annual',
        mode: StripeCheckoutMode.Subscription,
        subscriptionId: 'sub_video_ann_888',
        created: '2026-08-15T08:00:00Z',
        amountTotal: 25000,
        currency: 'usd',
        metadata: { memberDocId: videoSubscriber.docId },
        lineItems: [
          {
            productId: 'prod_vid',
            priceId: 'price_vid_annual',
            description: 'Class Video Library Annual Access',
            quantity: 1,
            amountTotal: 25000,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, videoSubscriber, order, 'order_vid_ann');

      expect(updatedMemberData['classVideoLibrarySubscription']).toBe(true);
      expect(updatedMemberData['classVideoLibraryLastRenewalDate']).toBe('2026-08-15');
      expect(updatedMemberData['classVideoLibraryExpirationDate']).toBe('2027-08-15');

      const subEntry = (updatedMemberData.stripeSubscriptions as any)?.['sub_video_ann_888'];
      expect(subEntry.interval).toBe(SubscriptionInterval.Year);
      expect(subEntry.currentPeriodEnd).toBe('2027-08-15');
    });

    it('Video subscription purchase does NOT touch membership dates or firstMembershipStarted', async () => {
      const videoSubscriber = { ...baseMember };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T08:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_video_only',
        mode: StripeCheckoutMode.Payment,
        created: '2026-08-15T08:00:00Z',
        amountTotal: 2500,
        currency: 'usd',
        metadata: { memberDocId: videoSubscriber.docId },
        lineItems: [
          {
            productId: 'prod_vid',
            priceId: 'price_vid',
            description: 'Class Video Library',
            quantity: 1,
            amountTotal: 2500,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, videoSubscriber, order, 'order_vid_iso');

      expect(updatedMemberData['lastRenewalDate']).toBeUndefined();
      expect(updatedMemberData['currentMembershipExpires']).toBeUndefined();
      expect(updatedMemberData['firstMembershipStarted']).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. INSTRUCTOR LICENSE & SCHOOL LICENSE
  // =========================================================================
  describe('Instructor License & School License Fulfillment', () => {
    it('REGRESSION GUARD: Annual Instructor License must expire 1 year after renewal date', async () => {
      const instructorMember = {
        ...baseMember,
        instructorLicenseRenewalDate: '2024-01-01',
        instructorLicenseExpires: '2025-01-01', // expired
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T09:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_inst_lic',
        mode: StripeCheckoutMode.Payment,
        created: '2026-08-15T09:00:00Z',
        amountTotal: 15000,
        currency: 'usd',
        metadata: { memberDocId: instructorMember.docId },
        lineItems: [
          {
            productId: 'prod_lic',
            priceId: 'price_lic',
            description: '1-Year Certified Instructor License',
            quantity: 1,
            amountTotal: 15000,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, instructorMember, order, 'order_lic');

      expect(updatedMemberData['instructorLicenseRenewalDate']).toBe('2026-08-15');
      expect(updatedMemberData['instructorLicenseExpires']).toBe('2027-08-15');
      expect(updatedMemberData['instructorLicenseType']).toBe(InstructorLicenseType.Annual);
      expect(updatedMemberData['instructorLicenseExpires']).not.toBe(
        updatedMemberData['instructorLicenseRenewalDate'],
      );
    });

    it('Life Instructor License sets sentinel expiration 9999-12-31', async () => {
      const instructorMember = {
        ...baseMember,
        instructorLicenseType: InstructorLicenseType.Life,
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T09:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_inst_life',
        mode: StripeCheckoutMode.Payment,
        created: '2026-08-15T09:00:00Z',
        amountTotal: 150000,
        currency: 'usd',
        metadata: { memberDocId: instructorMember.docId },
        lineItems: [
          {
            productId: 'prod_lic',
            priceId: 'price_lic_life',
            description: 'Life Instructor License',
            quantity: 1,
            amountTotal: 150000,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, instructorMember, order, 'order_lic_life');

      expect(updatedMemberData['instructorLicenseRenewalDate']).toBe('2026-08-15');
      expect(updatedMemberData['instructorLicenseExpires']).toBe('9999-12-31');
    });

    it('School License extends 1 year for annual and 1 month for monthly', async () => {
      const mockSchoolDoc = {
        schoolLicenseRenewalDate: '2025-01-01',
        schoolLicenseExpires: '2026-01-01', // expired
      };

      const mockSchoolRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => mockSchoolDoc,
        }),
        update: vi.fn().mockResolvedValue({}),
      };

      const customDb = {
        ...mockDb,
        collection: vi.fn((col: string) => {
          if (col === 'schools') {
            return {
              doc: vi.fn().mockReturnValue(mockSchoolRef),
            };
          }
          return mockDb.collection(col);
        }),
      };

      // Annual School Order
      const annualSchoolOrder: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T12:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_sch_ann',
        mode: StripeCheckoutMode.Payment,
        created: '2026-08-15T12:00:00Z',
        amountTotal: 60000,
        currency: 'usd',
        metadata: {
          orderType: 'school',
          schoolDocId: 'school_abc',
          memberDocId: baseMember.docId,
        },
        lineItems: [
          {
            productId: 'prod_sch',
            priceId: 'price_sch_ann',
            description: '1-Year School Affiliation License',
            quantity: 1,
            amountTotal: 60000,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(customDb, baseMember, annualSchoolOrder, 'order_sch_ann');

      expect(mockSchoolRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolLicenseRenewalDate: '2026-08-15',
          schoolLicenseExpires: '2027-08-15',
        }),
      );

      // Monthly School Order
      mockSchoolRef.update.mockClear();
      const monthlySchoolOrder: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T12:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_sch_month',
        mode: StripeCheckoutMode.Subscription,
        created: '2026-08-15T12:00:00Z',
        amountTotal: 5500,
        currency: 'usd',
        metadata: {
          orderType: 'school',
          schoolDocId: 'school_abc',
          memberDocId: baseMember.docId,
        },
        lineItems: [
          {
            productId: 'prod_sch',
            priceId: 'price_sch_mo',
            description: 'School Affiliation License (Monthly)',
            quantity: 1,
            amountTotal: 5500,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(customDb, baseMember, monthlySchoolOrder, 'order_sch_mo');

      expect(mockSchoolRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolLicenseRenewalDate: '2026-08-15',
          schoolLicenseExpires: '2026-09-15',
        }),
      );
    });
  });

  // =========================================================================
  // 5. SPOUSE LIFE MEMBERSHIP
  // =========================================================================
  describe('Spouse Life Membership Fulfillment', () => {
    it('Preserves existing spouse member firstMembershipStarted and sets life expiry', async () => {
      const existingSpouseMember = {
        ...initMember(),
        docId: 'mem_spouse_existing',
        memberId: 'US888',
        name: 'Jane Doe',
        emails: ['jane@example.com'],
        firstMembershipStarted: '2017-02-10',
        lastRenewalDate: '2024-01-01',
        currentMembershipExpires: '2025-01-01',
      };

      const mockSpouseRef = {
        update: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: existingSpouseMember.docId,
          data: () => existingSpouseMember,
        }),
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({
            id: 'spouse_sub_doc',
            set: vi.fn().mockResolvedValue({}),
          }),
        }),
      };

      const customDb = {
        ...mockDb,
        collection: vi.fn((col: string) => {
          if (col === 'acl') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({ memberDocIds: [existingSpouseMember.docId] }),
                }),
              }),
            };
          }
          if (col === 'members') {
            return {
              doc: vi.fn().mockReturnValue(mockSpouseRef),
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ id: existingSpouseMember.docId, data: () => existingSpouseMember }],
                  }),
                }),
              }),
            };
          }
          return mockDb.collection(col);
        }),
      };

      const order: StripeOrder = {
        docId: '',
        lastUpdated: '2026-08-15T12:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Checkout,
        stripeObjectId: 'cs_life_spouse_order',
        mode: StripeCheckoutMode.Payment,
        created: '2026-08-15T12:00:00Z',
        amountTotal: 225000,
        currency: 'usd',
        metadata: {
          memberDocId: baseMember.docId,
          spouseName: 'Jane Doe',
          spouseEmail: 'jane@example.com',
        },
        lineItems: [
          {
            productId: 'prod_life_spouse',
            priceId: 'price_life_spouse',
            description: 'Lifetime Member + Spouse Membership',
            quantity: 1,
            amountTotal: 225000,
            currency: 'usd',
          },
        ],
      };

      await fulfillSpouseLifeMembership(customDb, order, 'order_spouse_life', baseMember);

      expect(mockSpouseRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipType: MembershipType.Life,
          currentMembershipExpires: '9999-12-31',
          lastRenewalDate: '2026-08-15',
        }),
      );

      const updatePayload = mockSpouseRef.update.mock.calls[0][0];
      // firstMembershipStarted must not be overwritten
      expect(updatePayload.firstMembershipStarted).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. STRIPE SUBSCRIPTION LIFECYCLE SYNC
  // =========================================================================
  describe('Subscription Lifecycle Sync (syncSubscriptionStatusToMember)', () => {
    it('Updates currentMembershipExpires and video expiration when active subscription cycle renews', async () => {
      const activeSubscriber = {
        ...baseMember,
        membershipSubscriptionId: 'sub_membership_active',
        currentMembershipExpires: '2026-08-15',
        classVideoLibrarySubscriptionId: 'sub_video_active',
        classVideoLibraryExpirationDate: '2026-08-15',
        stripeSubscriptions: {
          sub_membership_active: {
            subscriptionId: 'sub_membership_active',
            status: SubscriptionStatus.Active,
            currentPeriodEnd: '2026-08-15',
          },
        },
      };

      mockMemberRef.get = vi.fn().mockResolvedValue({
        exists: true,
        id: activeSubscriber.docId,
        data: () => activeSubscriber,
      });

      const stripeSubUpdated: any = {
        id: 'sub_membership_active',
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: Math.floor(new Date('2027-08-15T00:00:00Z').getTime() / 1000),
        metadata: { memberDocId: activeSubscriber.docId },
      };

      await syncSubscriptionStatusToMember(mockDb, stripeSubUpdated);

      expect(mockMemberRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipNextAutoRenewDate: '2027-08-15',
          currentMembershipExpires: '2027-08-15',
          stripeSubscriptions: expect.objectContaining({
            sub_membership_active: expect.objectContaining({
              status: 'active',
              currentPeriodEnd: '2027-08-15',
            }),
          }),
        }),
      );
    });

    it('Clears nextAutoRenewDate when subscription is canceled at period end', async () => {
      const cancelingSubscriber = {
        ...baseMember,
        membershipSubscriptionId: 'sub_membership_cancel',
        currentMembershipExpires: '2027-08-15',
        stripeSubscriptions: {
          sub_membership_cancel: {
            subscriptionId: 'sub_membership_cancel',
            status: SubscriptionStatus.Active,
            currentPeriodEnd: '2027-08-15',
          },
        },
      };

      mockMemberRef.get = vi.fn().mockResolvedValue({
        exists: true,
        id: cancelingSubscriber.docId,
        data: () => cancelingSubscriber,
      });

      const stripeSubCanceled: any = {
        id: 'sub_membership_cancel',
        status: 'active',
        cancel_at_period_end: true,
        current_period_end: Math.floor(new Date('2027-08-15T00:00:00Z').getTime() / 1000),
        metadata: { memberDocId: cancelingSubscriber.docId },
      };

      await syncSubscriptionStatusToMember(mockDb, stripeSubCanceled);

      expect(mockMemberRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipNextAutoRenewDate: '',
          stripeSubscriptions: expect.objectContaining({
            sub_membership_cancel: expect.objectContaining({
              cancelAtPeriodEnd: true,
              nextAutoRenewDate: '',
            }),
          }),
        }),
      );
      // Expiration must remain intact even when canceling auto-renew
      expect(updatedMemberData['currentMembershipExpires']).toBeUndefined();
    });

    it('Keeps stacked advance expiration distinct from actual next Stripe billing date & recurring amount', async () => {
      const advanceMember = {
        ...baseMember,
        classVideoLibrarySubscription: true,
        classVideoLibrarySubscriptionId: 'sub_vid_monthly',
        classVideoLibraryExpirationDate: '2028-02-23',
        classVideoLibraryNextAutoRenewDate: '2026-10-23',
      };

      const renewalOrder: StripeOrder = {
        docId: '',
        lastUpdated: '2026-10-23T10:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Renewal,
        stripeObjectId: 'in_vid_oct',
        invoiceId: 'in_vid_oct',
        subscriptionId: 'sub_vid_monthly',
        mode: StripeCheckoutMode.Subscription,
        created: '2026-10-23T10:00:00Z',
        amountTotal: 1500, // e.g. one-time promo applied to this invoice
        currency: 'usd',
        metadata: { memberDocId: advanceMember.docId, orderType: 'video_library' },
        lineItems: [
          {
            productId: 'prod_video_lib',
            priceId: 'price_video_monthly',
            description: 'Class Video Library Subscription',
            quantity: 1,
            amountTotal: 1500,
            currency: 'usd',
          },
        ],
      };

      const liveSubscription: any = {
        id: 'sub_vid_monthly',
        status: 'active',
        cancel_at_period_end: false,
        currency: 'usd',
        items: {
          data: [
            {
              quantity: 1,
              current_period_start: Math.floor(new Date('2026-10-23T00:00:00Z').getTime() / 1000),
              current_period_end: Math.floor(new Date('2026-11-23T00:00:00Z').getTime() / 1000),
              price: {
                id: 'price_video_monthly',
                product: 'prod_video_lib',
                unit_amount: 2500,
                currency: 'usd',
                recurring: { interval: 'month' },
              },
            },
          ],
        },
        discounts: [{ coupon: { duration: 'once', amount_off: 1000 } }],
      };

      await fulfillStripeOrder(
        mockDb,
        advanceMember,
        renewalOrder,
        'order_vid_oct',
        liveSubscription,
      );

      // Stacked access expiration extends by 1 month from 2028-02-23 -> 2028-03-23
      expect(updatedMemberData['classVideoLibraryExpirationDate']).toBe('2028-03-23');
      // Next auto-renewal payment date MUST be Stripe's actual next billing date (2026-11-23)
      expect(updatedMemberData['classVideoLibraryNextAutoRenewDate']).toBe('2026-11-23');
      const subs = updatedMemberData['stripeSubscriptions'] as Record<string, any>;
      expect(subs['sub_vid_monthly']).toEqual(
        expect.objectContaining({
          subscriptionId: 'sub_vid_monthly',
          type: SubscriptionItemType.VideoLibrary,
          amount: 2500, // Full recurring price (ignoring one-time discount)
          currency: 'usd',
          interval: SubscriptionInterval.Month,
          currentPeriodEnd: '2026-11-23',
          nextAutoRenewDate: '2026-11-23',
        }),
      );
    });

    it('Applies forever coupon discount to computeRecurringSubscriptionAmount', () => {
      const discountedSub: any = {
        id: 'sub_disc',
        status: 'active',
        cancel_at_period_end: false,
        currency: 'usd',
        items: {
          data: [
            {
              quantity: 1,
              current_period_end: Math.floor(new Date('2026-12-01T00:00:00Z').getTime() / 1000),
              price: {
                id: 'price_1',
                product: 'prod_1',
                unit_amount: 6000,
                currency: 'usd',
                recurring: { interval: 'month' },
              },
            },
          ],
        },
        discounts: [{ coupon: { duration: 'forever', percent_off: 25 } }],
      };
      expect(computeRecurringSubscriptionAmount(discountedSub)).toBe(4500);
      const built = buildMemberSubscriptionItemFromStripe(discountedSub);
      expect(built.amount).toBe(4500);
    });

    it('Does NOT extend expiration or update member on StripeOrderType.Cancellation', async () => {
      const cancelOrder: StripeOrder = {
        docId: '',
        lastUpdated: '2026-10-25T00:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Cancellation,
        stripeObjectId: 'sub_canceled_1',
        subscriptionId: 'sub_canceled_1',
        created: '2026-10-25T00:00:00Z',
        amountTotal: null,
        currency: 'usd',
        lineItems: [
          {
            productId: 'prod_mem',
            priceId: 'price_mem',
            description: 'Annual Membership',
            quantity: 1,
            amountTotal: 0,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(mockDb, baseMember, cancelOrder, 'order_cancel_1');
      expect(mockMemberRef.update).not.toHaveBeenCalled();
    });

    it('Renews existing school instead of creating duplicate school on renewal of a newly-registered school subscription', async () => {
      const existingSchoolDocRef = {
        id: 'school_doc_existing',
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'school_doc_existing',
          data: () => ({
            schoolId: 'SCH-501',
            schoolName: 'Brooklyn Zhong Xin Dao',
            schoolLicenseExpires: '2026-11-01',
          }),
        }),
        update: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue({}),
      };

      const customDb: any = {
        ...mockDb,
        collection: vi.fn((colName: string) => {
          if (colName === 'schools') {
            return {
              doc: vi.fn((id?: string) =>
                id === 'school_doc_existing'
                  ? existingSchoolDocRef
                  : { id: 'unexpected_new_doc', set: vi.fn() },
              ),
              where: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [
                    {
                      id: 'school_doc_existing',
                      ref: existingSchoolDocRef,
                      data: () => ({
                        schoolId: 'SCH-501',
                        schoolName: 'Brooklyn Zhong Xin Dao',
                        schoolLicenseExpires: '2026-11-01',
                      }),
                    },
                  ],
                }),
                limit: vi.fn().mockReturnValue({
                  get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
                }),
              }),
            };
          }
          return mockDb.collection(colName);
        }),
      };

      const schoolOwner = {
        ...baseMember,
        stripeSubscriptions: {
          sub_school_monthly: {
            subscriptionId: 'sub_school_monthly',
            type: SubscriptionItemType.SchoolLicense,
            status: SubscriptionStatus.Active,
            planName: 'Monthly School License',
            amount: 6000,
            currency: 'usd',
            interval: SubscriptionInterval.Month,
            currentPeriodStart: '2026-10-01',
            currentPeriodEnd: '2026-11-01',
            nextAutoRenewDate: '2026-11-01',
            cancelAtPeriodEnd: false,
            schoolDocId: 'school_doc_existing',
            schoolId: 'SCH-501',
            schoolName: 'Brooklyn Zhong Xin Dao',
          },
        },
      };

      const renewalWithLegacyMetadata: StripeOrder = {
        docId: '',
        lastUpdated: '2026-11-01T00:00:00Z',
        ilcAppOrderKind: OrderKind.Stripe,
        stripeOrderType: StripeOrderType.Renewal,
        stripeObjectId: 'in_school_nov',
        subscriptionId: 'sub_school_monthly',
        mode: StripeCheckoutMode.Subscription,
        created: '2026-11-01T00:00:00Z',
        amountTotal: 6000,
        currency: 'usd',
        metadata: {
          orderType: 'school',
          isNewSchool: 'true',
          schoolName: 'Brooklyn Zhong Xin Dao',
          memberDocId: schoolOwner.docId,
        },
        lineItems: [
          {
            productId: 'prod_school',
            priceId: 'price_school_monthly',
            description: 'Monthly School License',
            quantity: 1,
            amountTotal: 6000,
            currency: 'usd',
          },
        ],
      };

      await fulfillStripeOrder(
        customDb,
        schoolOwner,
        renewalWithLegacyMetadata,
        'order_school_nov',
      );

      expect(existingSchoolDocRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolLicenseRenewalDate: '2026-11-01',
          schoolLicenseExpires: '2026-12-01',
        }),
      );
      const subs = updatedMemberData['stripeSubscriptions'] as Record<string, any>;
      expect(subs['sub_school_monthly']).toEqual(
        expect.objectContaining({
          schoolDocId: 'school_doc_existing',
          schoolId: 'SCH-501',
          schoolName: 'Brooklyn Zhong Xin Dao',
          nextAutoRenewDate: '2026-12-01',
        }),
      );
    });

    it('resolveManagedSchoolsBillingForEmail returns payer attribution only for authorized managed schools', async () => {
      const ownerMember = {
        ...initMember(),
        docId: 'mem_owner_1',
        memberId: 'US101',
        instructorId: 'INS-10',
        name: 'Sifu Alice',
        stripeSubscriptions: {
          sub_sch_1: {
            subscriptionId: 'sub_sch_1',
            type: SubscriptionItemType.SchoolLicense,
            status: SubscriptionStatus.Active,
            planName: 'Annual School License',
            amount: 60000,
            currency: 'usd',
            interval: SubscriptionInterval.Year,
            currentPeriodStart: '2026-06-01',
            currentPeriodEnd: '2027-06-01',
            nextAutoRenewDate: '2027-06-01',
            cancelAtPeriodEnd: false,
            schoolDocId: 'sch_doc_1',
            schoolId: 'SCH-100',
            schoolName: 'Alice Academy',
          },
        },
      };

      const managerMember = {
        ...initMember(),
        docId: 'mem_mgr_2',
        memberId: 'US202',
        instructorId: 'INS-20',
        name: 'Instructor Bob',
      };

      const schoolData = {
        schoolId: 'SCH-100',
        schoolName: 'Alice Academy',
        ownerMemberDocId: 'mem_owner_1',
        ownerInstructorId: 'INS-10',
        managerInstructorIds: ['INS-20'],
        schoolLicenseRenewalDate: '2026-06-01',
        schoolLicenseExpires: '2027-06-01',
      };

      const billingDb: any = {
        collection: vi.fn((colName: string) => {
          if (colName === 'acl') {
            return {
              doc: vi.fn((email: string) => ({
                get: vi.fn().mockResolvedValue(
                  email === 'bob@example.com'
                    ? {
                        exists: true,
                        data: () => ({
                          memberDocIds: ['mem_mgr_2'],
                          instructorIds: ['INS-20'],
                          schoolDocIds: ['sch_doc_1'],
                          isAdmin: false,
                        }),
                      }
                    : { exists: false },
                ),
              })),
            };
          }
          if (colName === 'schools') {
            return {
              doc: vi.fn((id: string) => ({
                get: vi.fn().mockResolvedValue(
                  id === 'sch_doc_1'
                    ? { exists: true, id: 'sch_doc_1', data: () => schoolData }
                    : { exists: false },
                ),
              })),
              where: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
              }),
            };
          }
          if (colName === 'members') {
            return {
              doc: vi.fn((id: string) => ({
                get: vi.fn().mockResolvedValue(
                  id === 'mem_owner_1'
                    ? { exists: true, id: 'mem_owner_1', data: () => ownerMember }
                    : id === 'mem_mgr_2'
                      ? { exists: true, id: 'mem_mgr_2', data: () => managerMember }
                      : { exists: false },
                ),
              })),
              where: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [
                    { id: 'mem_owner_1', data: () => ownerMember },
                    { id: 'mem_mgr_2', data: () => managerMember },
                  ],
                }),
              }),
            };
          }
          if (colName === 'orders') {
            return {
              where: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
              }),
            };
          }
          return mockDb.collection(colName);
        }),
      };

      const res = await resolveManagedSchoolsBillingForEmail(billingDb, 'bob@example.com');
      expect(res.schools['sch_doc_1']).toEqual({
        schoolDocId: 'sch_doc_1',
        schoolId: 'SCH-100',
        payerMemberDocId: 'mem_owner_1',
        payerMemberId: 'US101',
        payerName: 'Sifu Alice',
        isAutoRenewing: true,
        nextAutoRenewDate: '2027-06-01',
        amount: 60000,
        currency: 'usd',
        interval: 'year',
        lastPaymentDate: '2026-06-01',
      });

      // Unknown email with no ACL fails closed (empty result)
      const unknownRes = await resolveManagedSchoolsBillingForEmail(
        billingDb,
        'stranger@example.com',
      );
      expect(unknownRes.schools).toEqual({});
    });
  });

  // =========================================================================
  // 8. RENEWAL DATE EDITING & TRIALING EXPIRATION PROTECTION
  // =========================================================================
  describe('Subscription Renewal Date Editing & Trialing Safety', () => {
    it('REGRESSION GUARD: syncSubscriptionStatusToMember NEVER extends paid expiration dates when status is trialing', async () => {
      const memberWithPaidExpiry = {
        ...baseMember,
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2027-06-15',
        membershipSubscriptionId: 'sub_mem_trial_1',
        membershipNextAutoRenewDate: '2026-11-15',
      };

      mockMemberRef.get = vi.fn().mockResolvedValue({
        exists: true,
        id: memberWithPaidExpiry.docId,
        data: () => memberWithPaidExpiry,
      });

      const trialingStripeSub = {
        id: 'sub_mem_trial_1',
        status: 'trialing',
        customer: 'cus_test123',
        trial_end: Math.floor(Date.UTC(2027, 5, 8, 12, 0, 0) / 1000),
        cancel_at_period_end: false,
        currency: 'usd',
        metadata: {
          memberDocId: memberWithPaidExpiry.docId,
          orderType: 'membership',
        },
        items: {
          data: [
            {
              price: {
                id: 'price_ann',
                unit_amount: 8500,
                currency: 'usd',
                recurring: { interval: 'year' },
                product: { id: 'prod_mem', name: 'Annual Membership' },
              },
            },
          ],
        },
      } as unknown as Stripe.Subscription;

      await syncSubscriptionStatusToMember(mockDb, trialingStripeSub);

      // nextAutoRenewDate updates to 2027-06-08, while currentMembershipExpires is NOT extended or overwritten
      expect(updatedMemberData['membershipNextAutoRenewDate']).toBe('2027-06-08');
      expect(updatedMemberData['currentMembershipExpires']).toBeUndefined();

      // Even if a trialing periodEnd were somehow beyond currentMembershipExpires, it still MUST NOT extend paid access
      updatedMemberData = {};
      await syncSubscriptionStatusToMember(mockDb, {
        ...trialingStripeSub,
        trial_end: Math.floor(Date.UTC(2029, 0, 1, 12, 0, 0) / 1000),
      } as unknown as Stripe.Subscription);
      expect(updatedMemberData['currentMembershipExpires']).toBeUndefined();
    });

    it('performUpdateSubscriptionRenewalDate updates Stripe with trial_end and proration_behavior none, and rejects dates past paid expiration', async () => {
      const activeMember = {
        ...baseMember,
        docId: 'mem_edit_date',
        emails: ['wang@example.com'],
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2028-04-23',
        membershipSubscriptionId: 'sub_edit_1',
        membershipNextAutoRenewDate: '2026-11-15',
        stripeSubscriptions: {
          sub_edit_1: {
            subscriptionId: 'sub_edit_1',
            type: SubscriptionItemType.Membership,
            status: SubscriptionStatus.Active,
            planName: 'Annual Membership',
            amount: 8500,
            currency: 'usd',
            interval: SubscriptionInterval.Year,
            currentPeriodStart: '2025-11-15',
            currentPeriodEnd: '2026-11-15',
            nextAutoRenewDate: '2026-11-15',
            cancelAtPeriodEnd: false,
          },
        },
      };

      const editDb: any = {
        collection: vi.fn((colName: string) => {
          if (colName === 'acl') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({
                    memberDocIds: ['mem_edit_date'],
                    isAdmin: false,
                  }),
                }),
              }),
            };
          }
          if (colName === 'members') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  id: 'mem_edit_date',
                  data: () => activeMember,
                }),
                update: vi.fn(async (data: Record<string, unknown>) => {
                  updatedMemberData = { ...updatedMemberData, ...data };
                }),
              }),
            };
          }
          return mockDb.collection(colName);
        }),
      };

      const stripeRetrieveSpy = vi.fn().mockResolvedValue({
        id: 'sub_edit_1',
        status: 'active',
        customer: 'cus_wang',
        cancel_at_period_end: false,
        metadata: { memberDocId: 'mem_edit_date', orderType: 'membership' },
        items: {
          data: [
            {
              price: {
                id: 'price_ann',
                unit_amount: 8500,
                currency: 'usd',
                recurring: { interval: 'year' },
                product: { id: 'prod_mem', name: 'Annual Membership' },
              },
            },
          ],
        },
      });
      const expectedTrialEndUnix = Math.floor(
        Date.UTC(2028, 3, 16, 12, 0, 0) / 1000,
      );
      const stripeUpdateSpy = vi.fn().mockResolvedValue({
        id: 'sub_edit_1',
        status: 'trialing',
        customer: 'cus_wang',
        trial_end: expectedTrialEndUnix,
        cancel_at_period_end: false,
        metadata: { memberDocId: 'mem_edit_date', orderType: 'membership' },
        items: {
          data: [
            {
              price: {
                id: 'price_ann',
                unit_amount: 8500,
                currency: 'usd',
                recurring: { interval: 'year' },
                product: { id: 'prod_mem', name: 'Annual Membership' },
              },
            },
          ],
        },
      });
      const mockStripe: any = {
        subscriptions: {
          retrieve: stripeRetrieveSpy,
          update: stripeUpdateSpy,
        },
      };

      const fixedNowMs = Date.parse('2026-11-01T10:00:00Z');

      // Rejects renewalDate > currentMembershipExpires (free-access extension attempt)
      await expect(
        performUpdateSubscriptionRenewalDate({
          db: editDb,
          stripe: mockStripe,
          authEmail: 'wang@example.com',
          subscriptionId: 'sub_edit_1',
          renewalDate: '2028-04-24',
          nowMs: fixedNowMs,
        }),
      ).rejects.toThrow(/expiration date/);
      expect(stripeUpdateSpy).not.toHaveBeenCalled();

      // Rejects past/today date
      await expect(
        performUpdateSubscriptionRenewalDate({
          db: editDb,
          stripe: mockStripe,
          authEmail: 'wang@example.com',
          subscriptionId: 'sub_edit_1',
          renewalDate: '2026-11-01',
          nowMs: fixedNowMs,
        }),
      ).rejects.toThrow(/on or after 2026-11-02/);

      // Valid renewalDate (default 1 week before expiration: 2028-04-16) succeeds
      updatedMemberData = {};
      const res = await performUpdateSubscriptionRenewalDate({
        db: editDb,
        stripe: mockStripe,
        authEmail: 'wang@example.com',
        subscriptionId: 'sub_edit_1',
        renewalDate: '2028-04-16',
        nowMs: fixedNowMs,
      });

      expect(stripeUpdateSpy).toHaveBeenCalledWith(
        'sub_edit_1',
        expect.objectContaining({
          trial_end: expectedTrialEndUnix,
          proration_behavior: 'none',
          cancel_at_period_end: false,
        }),
      );
      expect(res.success).toBe(true);
      expect(res.nextAutoRenewDate).toBe('2028-04-16');
      expect(
        (updatedMemberData['stripeSubscriptions'] as Record<string, any>)?.[
          'sub_edit_1'
        ]?.status,
      ).toBe('trialing');
    });

    it('performCreateSubscriptionPaymentMethodSession omits payment_method_types and validates returnUrl origin', async () => {
      const ownerMember = {
        ...baseMember,
        docId: 'mem_pm_owner',
        stripeCustomerId: 'cus_pm_123',
        membershipSubscriptionId: 'sub_pm_1',
      };
      const pmDb: any = {
        collection: vi.fn((colName: string) => {
          if (colName === 'acl') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({ memberDocIds: ['mem_pm_owner'], isAdmin: false }),
                }),
              }),
            };
          }
          if (colName === 'members') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  id: 'mem_pm_owner',
                  data: () => ownerMember,
                }),
              }),
            };
          }
          return mockDb.collection(colName);
        }),
      };

      const sessionCreateSpy = vi.fn().mockResolvedValue({
        id: 'cs_setup_pm_1',
        url: 'https://checkout.stripe.com/c/pay/cs_setup_pm',
      });
      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'sub_pm_1',
            status: 'active',
            customer: 'cus_pm_123',
            currency: 'usd',
            items: {
              data: [{ price: { currency: 'usd' } }],
            },
          }),
        },
        checkout: {
          sessions: {
            create: sessionCreateSpy,
          },
        },
      };

      // Rejects disallowed open-redirect returnUrl
      await expect(
        performCreateSubscriptionPaymentMethodSession({
          db: pmDb,
          stripe: mockStripe,
          authEmail: 'wang@example.com',
          subscriptionId: 'sub_pm_1',
          returnUrl: 'https://evil.example.org/phish',
        }),
      ).rejects.toThrow(/recognised app origin/);
      expect(sessionCreateSpy).not.toHaveBeenCalled();

      // Valid localhost returnUrl succeeds and omits payment_method_types
      const res = await performCreateSubscriptionPaymentMethodSession({
        db: pmDb,
        stripe: mockStripe,
        authEmail: 'wang@example.com',
        subscriptionId: 'sub_pm_1',
        returnUrl: 'http://localhost:4200/become-a-member',
      });

      expect(res.url).toBe('https://checkout.stripe.com/c/pay/cs_setup_pm');
      expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
      const sessionParams = sessionCreateSpy.mock.calls[0][0];
      expect(sessionParams.mode).toBe('setup');
      expect(sessionParams.payment_method_types).toBeUndefined();
      expect(sessionParams.setup_intent_data?.metadata?.subscriptionId).toBe(
        'sub_pm_1',
      );
    });

    it('enrichSubscriptionWithPaymentMethod falls back to customer invoice_settings and customers.listPaymentMethods', async () => {
      const baseSub = {
        id: 'sub_enrich_1',
        status: 'active',
        customer: 'cus_enrich_1',
        current_period_start: 1793491200,
        current_period_end: 1825027200,
        cancel_at_period_end: false,
        currency: 'usd',
        items: {
          data: [
            {
              price: {
                id: 'price_1',
                product: { id: 'prod_1', name: 'Annual Membership' },
                unit_amount: 8500,
                currency: 'usd',
                recurring: { interval: 'year' },
              },
            },
          ],
        },
      } as unknown as Stripe.Subscription;

      // Case 1: Customer has no invoice_settings.default_payment_method, resolved via listPaymentMethods
      const listPmSpy = vi.fn().mockResolvedValue({
        data: [{ id: 'pm_card_8469', type: 'card', card: { brand: 'visa', last4: '8469' } }],
      });
      const mockStripeFallback: any = {
        customers: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'cus_enrich_1',
            invoice_settings: { default_payment_method: null },
          }),
          listPaymentMethods: listPmSpy,
        },
        paymentMethods: { retrieve: vi.fn() },
      };

      const enriched = await enrichSubscriptionWithPaymentMethod(
        mockStripeFallback,
        baseSub,
      );
      const item = buildMemberSubscriptionItemFromStripe(enriched);
      expect(listPmSpy).toHaveBeenCalledWith('cus_enrich_1', { limit: 1 });
      expect(item.paymentMethodBrand).toBe('visa');
      expect(item.paymentMethodLast4).toBe('8469');

      // Case 2: Stripe Link payment method populates brand 'link' with no last4
      const mockStripeLink: any = {
        customers: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'cus_enrich_1',
            invoice_settings: {
              default_payment_method: { id: 'pm_link_1', type: 'link' },
            },
          }),
          listPaymentMethods: vi.fn(),
        },
        paymentMethods: { retrieve: vi.fn() },
      };
      const enrichedLink = await enrichSubscriptionWithPaymentMethod(
        mockStripeLink,
        baseSub,
      );
      const linkItem = buildMemberSubscriptionItemFromStripe(enrichedLink);
      expect(linkItem.paymentMethodBrand).toBe('link');
      expect(linkItem.paymentMethodLast4).toBeUndefined();

      // Case 3: Canceled subscription never enriches or resurrects existing payment method fields
      const canceledSub = {
        ...baseSub,
        status: 'canceled',
      } as unknown as Stripe.Subscription;
      const enrichedCanceled = await enrichSubscriptionWithPaymentMethod(
        mockStripeFallback,
        canceledSub,
      );
      const canceledItem = buildMemberSubscriptionItemFromStripe(
        enrichedCanceled,
        {
          existing: {
            subscriptionId: 'sub_enrich_1',
            type: SubscriptionItemType.Membership,
            status: SubscriptionStatus.Active,
            planName: 'Annual Membership',
            amount: 8500,
            currency: 'usd',
            interval: SubscriptionInterval.Year,
            currentPeriodStart: '2026-11-01',
            currentPeriodEnd: '2027-11-01',
            nextAutoRenewDate: '',
            cancelAtPeriodEnd: true,
            paymentMethodBrand: 'visa',
            paymentMethodLast4: '8469',
          },
        },
      );
      expect(canceledItem.status).toBe(SubscriptionStatus.Canceled);
      expect(canceledItem.paymentMethodBrand).toBeUndefined();
      expect(canceledItem.paymentMethodLast4).toBeUndefined();
    });

    it('performRemoveSubscriptionPaymentMethod requires cancelled auto-renewal, cancels sub without revoking expiry, and detaches PM only when unused by sibling subs', async () => {
      let storedMember: Record<string, any> = {
        ...baseMember,
        docId: 'mem_rm_pm',
        emails: ['wang@example.com'],
        currentMembershipExpires: '2027-08-15',
        membershipSubscriptionId: 'sub_rm_1',
        membershipNextAutoRenewDate: '',
        stripeSubscriptions: {
          sub_rm_1: {
            subscriptionId: 'sub_rm_1',
            type: SubscriptionItemType.Membership,
            status: SubscriptionStatus.Active,
            planName: 'Annual Membership',
            amount: 8500,
            currency: 'usd',
            interval: SubscriptionInterval.Year,
            currentPeriodStart: '2026-08-15',
            currentPeriodEnd: '2027-08-15',
            nextAutoRenewDate: '',
            cancelAtPeriodEnd: true,
            paymentMethodBrand: 'visa',
            paymentMethodLast4: '4242',
          },
        },
      };

      const memberDocUpdateSpy = vi.fn(async (patch: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(patch)) {
          if (k.startsWith('stripeSubscriptions.')) {
            const subKey = k.slice('stripeSubscriptions.'.length);
            storedMember.stripeSubscriptions[subKey] = v;
          } else {
            storedMember[k] = v;
          }
        }
      });

      const rmDb: any = {
        collection: vi.fn((colName: string) => {
          if (colName === 'acl') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({ memberDocIds: ['mem_rm_pm'], isAdmin: false }),
                }),
              }),
            };
          }
          if (colName === 'members') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockImplementation(async () => ({
                  exists: true,
                  id: 'mem_rm_pm',
                  data: () => storedMember,
                })),
                update: memberDocUpdateSpy,
              }),
            };
          }
          return mockDb.collection(colName);
        }),
      };

      const cancelSubSpy = vi.fn().mockResolvedValue({
        id: 'sub_rm_1',
        status: 'canceled',
        cancel_at_period_end: false,
        customer: 'cus_rm_1',
        current_period_start: 1786752000,
        current_period_end: 1818288000,
        currency: 'usd',
        metadata: { memberDocId: 'mem_rm_pm', orderType: 'membership' },
        items: {
          data: [
            {
              price: {
                id: 'price_mem',
                product: { id: 'prod_mem', name: 'Annual Membership' },
                unit_amount: 8500,
                currency: 'usd',
                recurring: { interval: 'year' },
              },
            },
          ],
        },
      });
      const detachSpy = vi.fn().mockResolvedValue({ id: 'pm_card_4242' });

      // 1. Precondition failure if auto-renewal is still active
      const activeSubMockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'sub_rm_1',
            status: 'active',
            cancel_at_period_end: false,
            customer: 'cus_rm_1',
            default_payment_method: { id: 'pm_card_4242', type: 'card' },
            items: { data: [] },
          }),
          cancel: cancelSubSpy,
          list: vi.fn(),
        },
        paymentMethods: { detach: detachSpy },
      };

      await expect(
        performRemoveSubscriptionPaymentMethod({
          db: rmDb,
          stripe: activeSubMockStripe,
          authEmail: 'wang@example.com',
          subscriptionId: 'sub_rm_1',
        }),
      ).rejects.toThrow(/Cancel auto-renewal before removing/);
      expect(cancelSubSpy).not.toHaveBeenCalled();
      expect(detachSpy).not.toHaveBeenCalled();

      // 2. Shared card: another active subscription on cus_rm_1 uses pm_card_4242 -> do NOT detach
      const sharedCardStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'sub_rm_1',
            status: 'active',
            cancel_at_period_end: true,
            customer: {
              id: 'cus_rm_1',
              invoice_settings: { default_payment_method: 'pm_card_4242' },
            },
            default_payment_method: null,
            items: { data: [] },
          }),
          cancel: cancelSubSpy,
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'sub_rm_1', status: 'canceled', default_payment_method: null },
              {
                id: 'sub_vid_sibling',
                status: 'active',
                default_payment_method: null, // implicitly uses customer default pm_card_4242
              },
            ],
          }),
        },
        customers: {
          listPaymentMethods: vi.fn(),
        },
        paymentMethods: { detach: detachSpy },
      };

      const sharedRes = await performRemoveSubscriptionPaymentMethod({
        db: rmDb,
        stripe: sharedCardStripe,
        authEmail: 'wang@example.com',
        subscriptionId: 'sub_rm_1',
      });
      expect(cancelSubSpy).toHaveBeenCalledWith('sub_rm_1', {
        invoice_now: false,
        prorate: false,
      });
      expect(detachSpy).not.toHaveBeenCalled();
      expect(sharedRes.detachedPaymentMethod).toBe(false);
      // Paid expiration date is untouched!
      expect(storedMember.currentMembershipExpires).toBe('2027-08-15');
      expect(storedMember.stripeSubscriptions.sub_rm_1.status).toBe(
        SubscriptionStatus.Canceled,
      );
      expect(
        storedMember.stripeSubscriptions.sub_rm_1.paymentMethodBrand,
      ).toBeUndefined();
      expect(
        storedMember.stripeSubscriptions.sub_rm_1.paymentMethodLast4,
      ).toBeUndefined();

      // 3. Exclusive card: no other live subscription uses pm_card_4242 -> detaches PM from customer
      cancelSubSpy.mockClear();
      const exclusiveCardStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'sub_rm_1',
            status: 'canceled',
            cancel_at_period_end: false,
            customer: {
              id: 'cus_rm_1',
              invoice_settings: { default_payment_method: 'pm_card_4242' },
            },
            default_payment_method: 'pm_card_4242',
            current_period_start: 1786752000,
            current_period_end: 1818288000,
            currency: 'usd',
            metadata: { memberDocId: 'mem_rm_pm', orderType: 'membership' },
            items: {
              data: [
                {
                  price: {
                    id: 'price_mem',
                    product: { id: 'prod_mem', name: 'Annual Membership' },
                    unit_amount: 8500,
                    currency: 'usd',
                    recurring: { interval: 'year' },
                  },
                },
              ],
            },
          }),
          cancel: cancelSubSpy,
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'sub_rm_1',
                status: 'canceled',
                default_payment_method: 'pm_card_4242',
              },
            ],
          }),
        },
        customers: {
          listPaymentMethods: vi.fn(),
        },
        paymentMethods: { detach: detachSpy },
      };

      const exclusiveRes = await performRemoveSubscriptionPaymentMethod({
        db: rmDb,
        stripe: exclusiveCardStripe,
        authEmail: 'wang@example.com',
        subscriptionId: 'sub_rm_1',
      });
      expect(detachSpy).toHaveBeenCalledWith('pm_card_4242');
      expect(exclusiveRes.detachedPaymentMethod).toBe(true);
    });
  });
});
