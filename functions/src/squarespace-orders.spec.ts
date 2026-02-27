import { describe, it, expect } from 'vitest';

import {
  parseGradingOrderInfo,
  parseMembershipRenewalInfo,
  clearOrderProcessingState,
  computeRenewalAndExpiration,
  parseInstructorLicenseInfo,
} from './squarespace-orders';
import { SquareSpaceOrder, SquareSpaceLineItem } from './data-model';
import { resolveCountryCode } from './country-codes';

describe('squarespace-orders', () => {
  describe('parseGradingOrderInfo', () => {
    it('should correctly parse a grading order line item based on a real example', () => {
      const orderData = {
        docId: "699b9753b4562909908cae78",
        orderNumber: "14",
        createdOn: "2026-02-22T23:54:59.673Z",
        modifiedOn: "2026-02-22T23:54:59.953Z",
        customerEmail: "lucas.dixon@iliqchuan.com",
        lastUpdated: "2026-02-22T23:54:59.953Z",
      } as SquareSpaceOrder;

      const gradingItem = {
        id: "699b970af7cf551e039ed675",
        productId: "68abe24c78e7345c36e3d386",
        productName: "GRADING : Student Levels",
        variantOptions: [
          {
            optionName: "Level",
            value: "Student Level 7"
          }
        ],
        customizations: [
          {
            label: "Name of person being graded",
            value: "Lucas Dixon"
          },
          {
            label: "Member ID of the person being graded",
            value: "US402"
          },
          {
            label: "Email of person being graded",
            value: "lucas.dixon@gmail.com"
          },
          {
            label: "Current Student Level",
            value: "Student Level 6"
          },
          {
            label: "Current Application Level",
            value: "Application Level 3"
          },
          {
            label: "Where / when are you planning to grade?",
            value: "Sam Chin Poland Retreat in November 2026"
          },
          {
            label: " Name of the Evaluating Instructor",
            value: "Sam Chin"
          },
          {
            label: "InstructorID of the evaluating instructor",
            value: "1"
          }
        ],
      } as SquareSpaceLineItem;

      const parsed = parseGradingOrderInfo(orderData, gradingItem);

      expect(parsed).toEqual({
        email: 'lucas.dixon@gmail.com',
        currentStudentLevel: 'Student 6',
        currentApplicationLevel: 'Application 3',
        gradingInfo: {
          docId: '',
          lastUpdated: expect.any(String),
          gradingPurchaseDate: '2026-02-22',
          orderId: '699b9753b4562909908cae78',
          level: 'Student 7',
          gradingInstructorId: '1',
          assistantInstructorIds: [],
          schoolId: '',
          studentMemberId: 'US402',
          studentMemberDocId: '',
          status: 'pending',
          gradingEventDate: '',
          notes: "Evaluating Instructor Name: Sam Chin",
          gradingEvent: "Sam Chin Poland Retreat in November 2026"
        }
      });
    });

    it('should correctly map various level formats to canonical representation', () => {
      const orderData = { docId: 'o1', customerEmail: 'a@b.com', lastUpdated: '2026-02-22' } as SquareSpaceOrder;

      const testLevels = [
        { input: 'Student Level 1', expected: 'Student 1' },
        { input: 'Application Level 2', expected: 'Application 2' },
        { input: 'Student 3', expected: 'Student 3' },
        { input: 'Application 4', expected: 'Application 4' },
        { input: 'Entry', expected: 'Student Entry' },
        { input: '5', expected: 'Student 5' },
      ];

      for (const { input, expected } of testLevels) {
        const item = {
          variantOptions: [{ optionName: 'Level', value: input }]
        } as SquareSpaceLineItem;
        const parsed = parseGradingOrderInfo(orderData, item);
        expect(parsed.gradingInfo.level).toBe(expected);
      }
    });

    it('should fall back to customerEmail and productName if fields are missing', () => {
      const orderData = {
        docId: '123',
        customerEmail: "test@example.com",
        createdOn: "2024-05-01T12:00:00Z",
        lastUpdated: "2024-05-01T12:00:00Z"
      } as SquareSpaceOrder;

      const gradingItem = {
        productName: "Generic Grading",
        customizations: []
      } as unknown as SquareSpaceLineItem;

      const parsed = parseGradingOrderInfo(orderData, gradingItem);

      expect(parsed).toEqual({
        email: 'test@example.com',
        currentStudentLevel: '',
        currentApplicationLevel: '',
        gradingInfo: {
          docId: '',
          lastUpdated: expect.any(String),
          gradingPurchaseDate: '2024-05-01',
          orderId: '123',
          level: 'Generic Grading',
          gradingInstructorId: '',
          assistantInstructorIds: [],
          schoolId: '',
          studentMemberId: '',
          studentMemberDocId: '',
          status: 'in-review',
          gradingEventDate: '',
          notes: '',
          gradingEvent: ''
        }
      });
    });
  });

  describe('parseMembershipRenewalInfo', () => {
    // Real example order data (without ilcApp fields, as they get filled in during processing)
    const realOrderData = {
      subtotal: { currency: 'USD', value: '85.00' },
      externalOrderReference: null,
      testmode: false,
      channel: 'web',
      billingAddress: {
        city: 'PANTIN',
        firstName: 'Lucas',
        state: null,
        postalCode: '93500',
        countryCode: 'FR',
        phone: '',
        address1: '8 Rue Eugène et Marie-Louise Cornet',
        address2: 'Apt 4',
        lastName: 'Dixon',
      },
      customerEmail: 'lucas.dixon@gmail.com',
      channelName: 'Squarespace',
      fulfillments: [],
      id: '69a16c3a01f14d7197340287',
      internalNotes: [],
      shippingLines: [],
      discountTotal: { currency: 'USD', value: '85.00' },
      shippingTotal: { currency: 'USD', value: '0.00' },
      shippingAddress: null,
      lastUpdated: '2026-02-27T10:08:33.171Z',
      refundedTotal: { currency: 'USD', value: '0.00' },
      fulfilledOn: null,
      formSubmission: null,
      orderNumber: '61805',
      fulfillmentStatus: 'PENDING' as const,
      grandTotal: { currency: 'USD', value: '0.00' },
      createdOn: '2026-02-27T10:04:42.344Z',
      lineItems: [],
      priceTaxInterpretation: 'EXCLUSIVE',
      taxTotal: { currency: 'USD', value: '0.00' },
      customerId: '680d801c3ecc754ee0083526',
      modifiedOn: '2026-02-27T10:04:42.669Z',
      discountLines: [
        {
          promoCode: 'XEEPB93',
          amount: { currency: 'USD', value: '85.00' },
          description: 'Item testing discount - make it free',
          name: 'Item testing discount - make it free',
        },
      ],
      docId: '96RjBHRRC720SJsBrfP5',
    } as unknown as SquareSpaceOrder;

    const realLineItem = {
      variantId: '1b15e5c2-2e38-4f58-8caf-e31fdea104fb',
      productName: 'MEMBERSHIP : Annual',
      unitPricePaid: { currency: 'USD', value: '85.00' },
      productId: '67e994caacb4bf75c1bddf0b',
      lineItemType: 'SERVICE',
      height: 0,
      variantOptions: [
        { optionName: 'Type', value: 'Annual : Regular' },
      ],
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Renewing an existing member' },
        { value: 'FR11', label: 'Member ID' },
        { value: 'April Dixon', label: 'Name' },
        { label: 'Email', value: 'aprilhopedixon@gmail.com' },
        { label: 'Date of birth', value: '4/4/1986' },
        { label: 'Country', value: 'France' },
        { value: 'I agree', label: 'Terms and conditions' },
      ],
      length: 0,
      sku: 'MEM-YEAR-REG',
      imageUrl: 'https://images.squarespace-cdn.com/content/v1/example.png',
      id: '69a16c24795c546cc28b0993',
      quantity: 1,
      width: 0,
      weight: 0,
    } as unknown as SquareSpaceLineItem;

    it('should correctly parse a membership renewal from real example data', () => {
      const parsed = parseMembershipRenewalInfo(realOrderData, realLineItem);

      expect(parsed).toEqual({
        memberId: 'FR11',
        email: 'aprilhopedixon@gmail.com',
        name: 'April Dixon',
        dateOfBirth: '4/4/1986',
        country: 'France',
        isNewMember: false,
        renewalDate: '2026-02-27',
        expirationDate: '2027-02-27',
      });
    });

    it('should detect a new member order (not a renewal)', () => {
      const newMemberLineItem = {
        ...realLineItem,
        customizations: [
          { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
          { value: 'Test User', label: 'Name' },
          { label: 'Email', value: 'test@example.com' },
          { label: 'Date of birth', value: '1/1/2000' },
          { label: 'Country', value: 'Germany' },
        ],
      } as unknown as SquareSpaceLineItem;

      const parsed = parseMembershipRenewalInfo(realOrderData, newMemberLineItem);
      expect(parsed.isNewMember).toBe(true);
      expect(parsed.memberId).toBe(''); // No member ID for new members
      expect(parsed.country).toBe('Germany');
      expect(parsed.name).toBe('Test User');
      expect(parsed.email).toBe('test@example.com');
    });

    it('should fall back to customerEmail when no email in customizations', () => {
      const noEmailLineItem = {
        ...realLineItem,
        customizations: [
          { label: 'Is this membership for a new member?', value: 'Renewing an existing member' },
          { value: 'US100', label: 'Member ID' },
          { value: 'Test User', label: 'Name' },
        ],
      } as unknown as SquareSpaceLineItem;

      const parsed = parseMembershipRenewalInfo(realOrderData, noEmailLineItem);
      expect(parsed.email).toBe('lucas.dixon@gmail.com');
    });

    it('should fall back to billing address country when no country in customizations', () => {
      const noCountryLineItem = {
        ...realLineItem,
        customizations: [
          { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
          { value: 'Test User', label: 'Name' },
          { label: 'Email', value: 'test@example.com' },
        ],
      } as unknown as SquareSpaceLineItem;

      // The realOrderData has billingAddress.country undefined, but billingAddress.countryCode = 'FR'
      // billingAddress.country is what the type specifies; the real data uses countryCode
      const orderWithBillingCountry = {
        ...realOrderData,
        billingAddress: {
          ...realOrderData.billingAddress,
          country: 'France',
        },
      } as unknown as SquareSpaceOrder;

      const parsed = parseMembershipRenewalInfo(orderWithBillingCountry, noCountryLineItem);
      expect(parsed.country).toBe('France');
    });

    it('should handle missing customizations gracefully', () => {
      const emptyLineItem = {
        ...realLineItem,
        customizations: [],
      } as unknown as SquareSpaceLineItem;

      const parsed = parseMembershipRenewalInfo(realOrderData, emptyLineItem);
      expect(parsed.memberId).toBe('');
      expect(parsed.email).toBe('lucas.dixon@gmail.com');
      expect(parsed.name).toBe('');
      expect(parsed.country).toBe('');
      expect(parsed.isNewMember).toBe(false);
    });

    it('should compute correct expiration dates', () => {
      // Order on Feb 27, 2026 → expires Feb 28, 2027
      const parsed = parseMembershipRenewalInfo(realOrderData, realLineItem);
      expect(parsed.renewalDate).toBe('2026-02-27');
      expect(parsed.expirationDate).toBe('2027-02-27');

      // Order on a leap day
      const leapDayOrder = {
        ...realOrderData,
        createdOn: '2024-02-29T12:00:00Z',
      } as unknown as SquareSpaceOrder;
      const leapParsed = parseMembershipRenewalInfo(leapDayOrder, realLineItem);
      expect(leapParsed.renewalDate).toBe('2024-02-29');
      // Feb 29 + 1 year = Mar 1 (2025 is not a leap year)
      expect(leapParsed.expirationDate).toBe('2025-03-01');

      // Order on Dec 31
      const yearEndOrder = {
        ...realOrderData,
        createdOn: '2026-12-31T23:59:00Z',
      } as unknown as SquareSpaceOrder;
      const yearEndParsed = parseMembershipRenewalInfo(yearEndOrder, realLineItem);
      expect(yearEndParsed.renewalDate).toBe('2026-12-31');
      expect(yearEndParsed.expirationDate).toBe('2027-12-31');
    });

    it('should parse country from form customizations with "Country" label', () => {
      const lineItemWithCountry = {
        ...realLineItem,
        customizations: [
          { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
          { value: 'New Person', label: 'Name' },
          { label: 'Email', value: 'new@example.com' },
          { label: 'Date of birth', value: '5/15/1990' },
          { label: 'Country', value: 'United States' },
        ],
      } as unknown as SquareSpaceLineItem;

      const parsed = parseMembershipRenewalInfo(realOrderData, lineItemWithCountry);
      expect(parsed.country).toBe('United States');
      expect(parsed.isNewMember).toBe(true);
      expect(parsed.name).toBe('New Person');
    });
  });

  describe('resolveCountryCode', () => {
    it('should resolve country names to codes', () => {
      expect(resolveCountryCode('France')).toBe('FR');
      expect(resolveCountryCode('United States')).toBe('US');
      expect(resolveCountryCode('Germany')).toBe('DE');
      expect(resolveCountryCode('Australia')).toBe('AUS');
      expect(resolveCountryCode('United Kingdom')).toBe('UK');
    });

    it('should resolve country codes directly', () => {
      expect(resolveCountryCode('FR')).toBe('FR');
      expect(resolveCountryCode('US')).toBe('US');
      expect(resolveCountryCode('DE')).toBe('DE');
      expect(resolveCountryCode('uk')).toBe('UK');
    });

    it('should be case-insensitive', () => {
      expect(resolveCountryCode('france')).toBe('FR');
      expect(resolveCountryCode('FRANCE')).toBe('FR');
      expect(resolveCountryCode('united states')).toBe('US');
    });

    it('should return null for unrecognized countries', () => {
      expect(resolveCountryCode('')).toBe(null);
      expect(resolveCountryCode('Narnia')).toBe(null);
      expect(resolveCountryCode('ZZZ')).toBe(null);
    });
  });

  describe('clearOrderProcessingState', () => {
    it('should clear order-level and line-item-level processing fields', () => {
      const order = {
        orderNumber: '123',
        ilcAppOrderStatus: 'processed',
        ilcAppOrderIssues: ['some issue'],
        lineItems: [
          {
            id: 'item1',
            sku: 'VID-LIBRARY',
            quantity: '1',
            unitPricePaid: { value: '50.00' },
            ilcAppProcessingStatus: 'processed',
          },
          {
            id: 'item2',
            sku: 'GRA-STU',
            quantity: '1',
            unitPricePaid: { value: '100.00' },
            ilcAppProcessingStatus: 'error',
            ilcAppProcessingIssue: 'Member not found',
          },
        ],
      } as unknown as SquareSpaceOrder;

      clearOrderProcessingState(order);

      expect(order.ilcAppOrderStatus).toBeUndefined();
      expect(order.ilcAppOrderIssues).toBeUndefined();
      expect(order.lineItems![0].ilcAppProcessingStatus).toBeUndefined();
      expect(order.lineItems![1].ilcAppProcessingStatus).toBeUndefined();
      expect(order.lineItems![1].ilcAppProcessingIssue).toBeUndefined();
      // Non-ilcApp fields should be preserved
      expect(order.orderNumber).toBe('123');
      expect(order.lineItems![0].sku).toBe('VID-LIBRARY');
      expect(order.lineItems![1].sku).toBe('GRA-STU');
    });

    it('should handle orders with no line items', () => {
      const order = {
        orderNumber: '456',
        ilcAppOrderStatus: 'error',
        ilcAppOrderIssues: ['fail'],
      } as unknown as SquareSpaceOrder;

      clearOrderProcessingState(order);

      expect(order.ilcAppOrderStatus).toBeUndefined();
      expect(order.ilcAppOrderIssues).toBeUndefined();
      expect(order.orderNumber).toBe('456');
    });

    it('should be a no-op on a fresh order with no processing state', () => {
      const order = {
        orderNumber: '789',
        lineItems: [
          { id: 'item1', sku: 'MEM-YEAR-REG', quantity: '1', unitPricePaid: { value: '85.00' } },
        ],
      } as unknown as SquareSpaceOrder;

      clearOrderProcessingState(order);

      expect(order.orderNumber).toBe('789');
      expect(order.lineItems![0].sku).toBe('MEM-YEAR-REG');
      expect(order.ilcAppOrderStatus).toBeUndefined();
    });
  });

  describe('computeRenewalAndExpiration', () => {
    it('should extend from current expiration when renewed early (before expiry)', () => {
      // Member expires 2027-06-15, order placed 2027-03-01.
      // Renewal should start from the expiration.
      const result = computeRenewalAndExpiration('2027-06-15', '2027-03-01');
      expect(result.renewalDate).toBe('2027-06-15');
      expect(result.expirationDate).toBe('2028-06-15');
    });

    it('should use order date when renewed after expiration (lapsed)', () => {
      // Member expired 2026-01-01, order placed 2026-05-10.
      // Renewal should start from the order date since they lapsed.
      const result = computeRenewalAndExpiration('2026-01-01', '2026-05-10');
      expect(result.renewalDate).toBe('2026-05-10');
      expect(result.expirationDate).toBe('2027-05-10');
    });

    it('should use order date when there is no prior expiration', () => {
      const result = computeRenewalAndExpiration('', '2026-02-27');
      expect(result.renewalDate).toBe('2026-02-27');
      expect(result.expirationDate).toBe('2027-02-27');
    });

    it('should handle leap day renewals correctly', () => {
      // Renewal on Feb 29 of a leap year → expiration shifts to Mar 1 in non-leap year.
      const result = computeRenewalAndExpiration('', '2024-02-29');
      expect(result.renewalDate).toBe('2024-02-29');
      expect(result.expirationDate).toBe('2025-03-01');
    });

    it('should use order date when expiration equals order date', () => {
      // Edge case: renewal right on the expiry day.
      const result = computeRenewalAndExpiration('2026-03-15', '2026-03-15');
      expect(result.renewalDate).toBe('2026-03-15');
      expect(result.expirationDate).toBe('2027-03-15');
    });
  });

  describe('parseInstructorLicenseInfo', () => {
    const baseOrderData = {
      docId: 'order-doc-1',
      orderNumber: '100',
      createdOn: '2026-06-15T10:00:00Z',
      customerEmail: 'customer@example.com',
      lastUpdated: '2026-06-15T10:00:00Z',
    } as SquareSpaceOrder;

    it('should parse member ID and email from customizations', () => {
      const lineItem = {
        sku: 'LIC-INST',
        customizations: [
          { label: 'Member ID', value: 'US101' },
          { label: 'Email', value: 'instructor@example.com' },
        ],
      } as unknown as SquareSpaceLineItem;

      const parsed = parseInstructorLicenseInfo(baseOrderData, lineItem);
      expect(parsed).toEqual({
        memberId: 'US101',
        email: 'instructor@example.com',
        orderDate: '2026-06-15',
      });
    });

    it('should fall back to customerEmail when no email in customizations', () => {
      const lineItem = {
        sku: 'LIC-INST',
        customizations: [
          { label: 'Member ID', value: 'US102' },
        ],
      } as unknown as SquareSpaceLineItem;

      const parsed = parseInstructorLicenseInfo(baseOrderData, lineItem);
      expect(parsed.email).toBe('customer@example.com');
    });

    it('should handle empty customizations', () => {
      const lineItem = {
        sku: 'LIC-INST',
        customizations: [],
      } as unknown as SquareSpaceLineItem;

      const parsed = parseInstructorLicenseInfo(baseOrderData, lineItem);
      expect(parsed.memberId).toBe('');
      expect(parsed.email).toBe('customer@example.com');
      expect(parsed.orderDate).toBe('2026-06-15');
    });
  });
});
