import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import {
  initMember,
  MembershipType,
  InstructorLicenseType,
  OrderKind,
  StripeOrder,
  StripeOrderType,
  StripeCheckoutMode,
  SubscriptionInterval,
  SubscriptionStatus,
} from './data-model';
import {
  extendDateByYears,
  extendDateByMonths,
  fulfillStripeOrder,
  fulfillSpouseLifeMembership,
  syncSubscriptionStatusToMember,
} from './stripe-fulfillment';

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
      const subEntry = updatedMemberData['stripeSubscriptions.sub_video_month_999'] as any;
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

      const subEntry = updatedMemberData['stripeSubscriptions.sub_video_ann_888'] as any;
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
          'stripeSubscriptions.sub_membership_active.status': 'active',
          'stripeSubscriptions.sub_membership_active.currentPeriodEnd': '2027-08-15',
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
          'stripeSubscriptions.sub_membership_cancel.cancelAtPeriodEnd': true,
          'stripeSubscriptions.sub_membership_cancel.nextAutoRenewDate': '',
        }),
      );
      // Expiration must remain intact even when canceling auto-renew
      expect(updatedMemberData['currentMembershipExpires']).toBeUndefined();
    });
  });
});
