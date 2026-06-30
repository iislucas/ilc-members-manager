import { describe, it, expect, vi } from 'vitest';
import { parseMembershipRenewalInfo, processMembershipRenewal } from './membership';
import { SquareSpaceLineItem, SquareSpaceOrder, SquareSpaceLineItemType, MembershipType } from '../data-model';
import { resolveCountryCode } from '../country-codes';
import * as admin from 'firebase-admin';

const realLineItem: SquareSpaceLineItem = {
  id: '69a46442795c546cc28cdac6',
  sku: 'MEM-YEAR-21',
  productId: '67e994caacb4bf75c1bddf0b',
  productName: 'MEMBERSHIP : Annual',
  lineItemType: SquareSpaceLineItemType.Service,
  quantity: '1',
  unitPricePaid: { value: '55.00' },
  variantOptions: [
    { value: 'Annual : Under 21', optionName: 'Type' },
  ],
  customizations: [
    { value: 'Renewing an existing member', label: 'Is this membership for a new member?' },
    { value: 'FR102', label: 'Member ID' },
    { label: 'Name', value: 'Lucas testing' },
    { value: 'member@example.com', label: 'Email' },
    { value: '11/23/1979', label: 'Date of birth' },
    { label: 'Country', value: 'France' },
    { label: 'Terms and conditions', value: 'I agree' },
  ],
};

// Real example order from an annual membership renewal.
const realOrder: SquareSpaceOrder = {
  docId: 'hCOisrVLNt976lvRH5N1',
  lastUpdated: '2026-03-01T16:11:17.601Z',
  ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
  ilcAppOrderStatus: 'processed',
  ilcAppOrderIssues: [],
  id: '69a46525f2556a3a5a087b28',
  orderNumber: '61811',
  createdOn: '2026-03-01T16:11:17.601Z',
  modifiedOn: '2026-03-01T16:12:19.244Z',
  customerEmail: 'member@example.com',
  fulfillmentStatus: 'FULFILLED',
  billingAddress: {
    postalCode: '93500',
    state: undefined,
    countryCode: 'FR',
    city: 'Pantin',
    firstName: 'Lucas',
    lastName: 'Dixon',
    phone: '',
    address2: undefined,
    address1: '8 Rue Eugène et Marie-Louise Cornet',
  },
  lineItems: [realLineItem],
};

describe('parseMembershipRenewalInfo', () => {
  it('should correctly parse a membership renewal from real example data', () => {
    const parsed = parseMembershipRenewalInfo(realOrder, realLineItem);

    expect(parsed).toEqual({
      member: {
        memberId: 'FR102',
        email: 'member@example.com',
        name: 'Lucas testing',
        dateOfBirth: '11/23/1979',
        country: 'France',
        isNewMember: false,
      },
      renewalDate: '2026-03-01',
      expirationDate: '2027-03-01',
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
    };

    const parsed = parseMembershipRenewalInfo(realOrder, newMemberLineItem);
    expect(parsed.member.isNewMember).toBe(true);
    expect(parsed.member.memberId).toBe(''); // No member ID for new members
    expect(parsed.member.country).toBe('Germany');
    expect(parsed.member.name).toBe('Test User');
    expect(parsed.member.email).toBe('test@example.com');
  });

  it('should fall back to customerEmail when no email in customizations', () => {
    const noEmailLineItem = {
      ...realLineItem,
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Renewing an existing member' },
        { value: 'US100', label: 'Member ID' },
        { value: 'Test User', label: 'Name' },
      ],
    };

    const parsed = parseMembershipRenewalInfo(realOrder, noEmailLineItem);
    expect(parsed.member.email).toBe('member@example.com');
  });

  it('should fall back to billing address country when no country in customizations', () => {
    const noCountryLineItem = {
      ...realLineItem,
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
        { value: 'Test User', label: 'Name' },
        { label: 'Email', value: 'test@example.com' },
      ],
    };

    const orderWithBillingCountry: SquareSpaceOrder = {
      ...realOrder,
      billingAddress: {
        ...realOrder.billingAddress,
        country: 'France',
      },
    };

    const parsed = parseMembershipRenewalInfo(orderWithBillingCountry, noCountryLineItem);
    expect(parsed.member.country).toBe('France');
  });

  it('should handle missing customizations gracefully', () => {
    const emptyLineItem = {
      ...realLineItem,
      customizations: [],
    };

    const parsed = parseMembershipRenewalInfo(realOrder, emptyLineItem);
    expect(parsed.member.memberId).toBe('');
    expect(parsed.member.email).toBe('member@example.com');
    expect(parsed.member.name).toBe('');
    expect(parsed.member.country).toBe('');
    expect(parsed.member.isNewMember).toBeUndefined();
  });

  it('should compute correct expiration dates', () => {
    // Order on Mar 1, 2026 → expires Mar 1, 2027
    const parsed = parseMembershipRenewalInfo(realOrder, realLineItem);
    expect(parsed.renewalDate).toBe('2026-03-01');
    expect(parsed.expirationDate).toBe('2027-03-01');

    // Order on a leap day
    const leapDayOrder: SquareSpaceOrder = {
      ...realOrder,
      createdOn: '2024-02-29T12:00:00Z',
    };
    const leapParsed = parseMembershipRenewalInfo(leapDayOrder, realLineItem);
    expect(leapParsed.renewalDate).toBe('2024-02-29');
    // Feb 29 + 1 year = Mar 1 (2025 is not a leap year)
    expect(leapParsed.expirationDate).toBe('2025-03-01');

    // Order on Dec 31
    const yearEndOrder: SquareSpaceOrder = {
      ...realOrder,
      createdOn: '2026-12-31T23:59:00Z',
    };
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
    };

    const parsed = parseMembershipRenewalInfo(realOrder, lineItemWithCountry);
    expect(parsed.member.country).toBe('United States');
    expect(parsed.member.isNewMember).toBe(true);
    expect(parsed.member.name).toBe('New Person');
  });

  it('should override country with ilcAppCountryOverride using a country name', () => {
    const lineItemWithOverride = {
      ...realLineItem,
      ilcAppCountryOverride: 'Slovenia',
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
        { value: 'New Person', label: 'Name' },
        { label: 'Email', value: 'new@example.com' },
        { label: 'Country', value: 'Slovinia' }, // misspelled by user
      ],
    };

    const parsed = parseMembershipRenewalInfo(realOrder, lineItemWithOverride);
    // The override should replace the misspelled country
    expect(parsed.member.country).toBe('Slovenia');
  });

  it('should handle legacy ilcAppCountryOverride with a country code', () => {
    const lineItemWithCodeOverride = {
      ...realLineItem,
      ilcAppCountryOverride: 'SL', // legacy: a country code instead of name
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
        { value: 'New Person', label: 'Name' },
        { label: 'Email', value: 'new@example.com' },
        { label: 'Country', value: 'Slovinia' },
      ],
    };

    const parsed = parseMembershipRenewalInfo(realOrder, lineItemWithCodeOverride);
    // The code 'SL' should resolve to the country name 'Slovenia'
    expect(parsed.member.country).toBe('Slovenia');
  });
});

// Integration tests: verify the full chain from form data → parsed country → country code.
// This simulates what processNewMemberRegistration does: parse the order, then
// call resolveCountryCode on the parsed country to generate a member ID.
describe('parseMembershipRenewalInfo → resolveCountryCode (end-to-end)', () => {
  // Helper: parse a new-member line item with the given country value and optional
  // override, then resolve the resulting country to a code.
  function parseAndResolveCountry(
    formCountry: string,
    countryOverride?: string
  ): { country: string; countryCode: string | null } {
    const lineItem: SquareSpaceLineItem = {
      ...realLineItem,
      ...(countryOverride ? { ilcAppCountryOverride: countryOverride } : {}),
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
        { value: 'New Person', label: 'Name' },
        { label: 'Email', value: 'new@example.com' },
        { label: 'Country', value: formCountry },
      ],
    };
    const parsed = parseMembershipRenewalInfo(realOrder, lineItem);
    return {
      country: parsed.member.country,
      countryCode: resolveCountryCode(parsed.member.country),
    };
  }

  it('should resolve common correctly-spelled countries', () => {
    expect(parseAndResolveCountry('France')).toEqual({ country: 'France', countryCode: 'FR' });
    expect(parseAndResolveCountry('United States')).toEqual({ country: 'United States', countryCode: 'US' });
    expect(parseAndResolveCountry('Germany')).toEqual({ country: 'Germany', countryCode: 'DE' });
    expect(parseAndResolveCountry('Slovenia')).toEqual({ country: 'Slovenia', countryCode: 'SL' });
    expect(parseAndResolveCountry('Australia')).toEqual({ country: 'Australia', countryCode: 'AUS' });
    expect(parseAndResolveCountry('United Kingdom')).toEqual({ country: 'United Kingdom', countryCode: 'UK' });
    expect(parseAndResolveCountry('China')).toEqual({ country: 'China', countryCode: 'CN' });
    expect(parseAndResolveCountry('India')).toEqual({ country: 'India', countryCode: 'IN' });
  });

  it('should resolve case-insensitive country names', () => {
    expect(parseAndResolveCountry('france')).toEqual({ country: 'france', countryCode: 'FR' });
    expect(parseAndResolveCountry('GERMANY')).toEqual({ country: 'GERMANY', countryCode: 'DE' });
  });

  it('should fail to resolve a misspelled country without an override', () => {
    const result = parseAndResolveCountry('Slovinia');
    expect(result.country).toBe('Slovinia');
    // resolveCountryCode has partial match, so "Slovinia" actually does NOT match
    // "Slovenia" because "slovinia" is not contained in "slovenia". This is correct —
    // the admin needs to set a country override.
    expect(result.countryCode).toBe(null);
  });

  it('should resolve a misspelled country when a valid override is set', () => {
    const result = parseAndResolveCountry('Slovinia', 'Slovenia');
    expect(result.country).toBe('Slovenia');
    expect(result.countryCode).toBe('SL');
  });

  it('should resolve a misspelled country when a legacy code override is set', () => {
    const result = parseAndResolveCountry('Slovinia', 'SL');
    expect(result.country).toBe('Slovenia');
    expect(result.countryCode).toBe('SL');
  });

  it('should use the billing address country as fallback when form has no country', () => {
    const lineItem: SquareSpaceLineItem = {
      ...realLineItem,
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
        { value: 'New Person', label: 'Name' },
        { label: 'Email', value: 'new@example.com' },
        // No country field in form
      ],
    };
    const orderWithBillingCountry: SquareSpaceOrder = {
      ...realOrder,
      billingAddress: { ...realOrder.billingAddress, country: 'France' },
    };
    const parsed = parseMembershipRenewalInfo(orderWithBillingCountry, lineItem);
    expect(parsed.member.country).toBe('France');
    expect(resolveCountryCode(parsed.member.country)).toBe('FR');
  });
});

describe('processMembershipRenewal - Guest Adoption', () => {
  it('should adopt an existing guest profile if it matches the email and lacks a memberId', async () => {
    const newMemberLineItem: SquareSpaceLineItem = {
      ...realLineItem,
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
        { value: 'Guest Adoptee', label: 'Name' },
        { label: 'Email', value: 'guest@example.com' },
        { label: 'Date of birth', value: '12/15/1995' },
        { label: 'Country', value: 'United States' },
      ],
    };

    const order: SquareSpaceOrder = {
      ...realOrder,
      lineItems: [newMemberLineItem],
    };

    // 1. Mock lookups by email to return a guest profile (no memberId).
    const mockLookupDocs = [
      {
        id: 'guest-doc-id-123',
        data: () => ({
          memberId: '',
          name: '',
          emails: ['guest@example.com'],
        }),
      },
    ];

    const mockGet = vi.fn().mockResolvedValue({
      empty: false,
      docs: mockLookupDocs,
    });

    // Mock counters doc fetch for assignNextMemberId
    const mockCountersGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        memberIdCounters: { US: 100 },
      }),
    });

    const mockSet = vi.fn().mockResolvedValue({});
    const mockDoc = vi.fn().mockImplementation((path) => {
      if (path === 'system/counters') {
        return {
          get: mockCountersGet,
          set: mockSet,
        };
      }
      return {
        id: path || 'guest-doc-id-123',
        set: mockSet,
      };
    });

    const mockDb = {
      runTransaction: vi.fn().mockImplementation(async (fn) => {
        return fn({
          get: vi.fn().mockImplementation(async (ref) => {
            if (ref.get === mockCountersGet) return await mockCountersGet();
            return { exists: false };
          }),
          set: vi.fn(),
        });
      }),
      collection: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: mockGet,
        doc: mockDoc,
      }),
      doc: mockDoc,
    } as unknown as admin.firestore.Firestore;

    const result = await processMembershipRenewal(order, 'ORD-123', newMemberLineItem, mockDb);

    expect(result.kind).toBe('success');
    
    // It should have queried the existing member record by email.
    expect(mockDb.collection).toHaveBeenCalledWith('members');
    
    // It should have targeted the existing guest's docId 'guest-doc-id-123' rather than creating a new doc.
    expect(mockDoc).toHaveBeenCalledWith('guest-doc-id-123');
    
    // It should have saved the complete Member record to that doc, with a newly assigned member ID.
    expect(mockSet).toHaveBeenCalled();
    const savedData = mockSet.mock.calls[0][0];
    expect(savedData.memberId).toBe('US101'); // US100 + 1
    expect(savedData.docId).toBe('guest-doc-id-123');
    expect(savedData.name).toBe('Guest Adoptee');
    expect(savedData.membershipType).toBe(MembershipType.Annual);
  });

  it('should create a brand new member document if no matching guest profile exists', async () => {
    const newMemberLineItem: SquareSpaceLineItem = {
      ...realLineItem,
      customizations: [
        { label: 'Is this membership for a new member?', value: 'Yes, a new member' },
        { value: 'Brand New Person', label: 'Name' },
        { label: 'Email', value: 'newperson@example.com' },
        { label: 'Date of birth', value: '12/15/1995' },
        { label: 'Country', value: 'United States' },
      ],
    };

    const order: SquareSpaceOrder = {
      ...realOrder,
      lineItems: [newMemberLineItem],
    };

    // Mock lookups by email to return empty.
    const mockGet = vi.fn().mockResolvedValue({
      empty: true,
      docs: [],
    });

    const mockCountersGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        memberIdCounters: { US: 200 },
      }),
    });

    const mockSet = vi.fn().mockResolvedValue({});
    const mockDoc = vi.fn().mockImplementation((path) => {
      if (path === 'system/counters') {
        return {
          get: mockCountersGet,
          set: mockSet,
        };
      }
      return {
        id: path || 'new-random-doc-id',
        set: mockSet,
      };
    });

    const mockDb = {
      runTransaction: vi.fn().mockImplementation(async (fn) => {
        return fn({
          get: vi.fn().mockImplementation(async (ref) => {
            if (ref.get === mockCountersGet) return await mockCountersGet();
            return { exists: false };
          }),
          set: vi.fn(),
        });
      }),
      collection: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: mockGet,
        doc: mockDoc,
      }),
      doc: mockDoc,
    } as unknown as admin.firestore.Firestore;

    const result = await processMembershipRenewal(order, 'ORD-124', newMemberLineItem, mockDb);

    expect(result.kind).toBe('success');
    
    // It should have targeted a new document reference
    expect(mockDoc).not.toHaveBeenCalledWith('');
    expect(mockDoc).not.toHaveBeenCalledWith(undefined);
    
    expect(mockSet).toHaveBeenCalled();
    const savedData = mockSet.mock.calls[0][0];
    expect(savedData.memberId).toBe('US201'); // US200 + 1
    expect(savedData.name).toBe('Brand New Person');
    expect(savedData.membershipType).toBe(MembershipType.Annual);
  });
});
