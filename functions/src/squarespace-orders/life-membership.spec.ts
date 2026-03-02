import { describe, it, expect } from 'vitest';
import { parseLifeMembershipInfo } from './life-membership';
import { SquareSpaceOrder } from '../data-model';

// Real example order from a Life + Spouse purchase.
// Extra Squarespace-specific fields that are not part of our SquareSpaceOrder
// type are included for realism; the const is typed loosely on purpose so the
// test data mirrors the raw API payload.
const realOrder: SquareSpaceOrder = {
  docId: '8EXQGoPO7vBLODlFp0C2',
  lastUpdated: '2026-03-02T07:45:11.869Z',
  ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
  ilcAppOrderStatus: 'processed',
  ilcAppOrderIssues: [],
  id: '69a540089836f119b37dd113',
  orderNumber: '61814',
  createdOn: '2026-03-02T07:45:11.869Z',
  modifiedOn: '2026-03-02T07:47:04.763Z',
  customerEmail: 'lucas.dixon@gmail.com',
  fulfillmentStatus: 'FULFILLED',
  billingAddress: {
    countryCode: 'FR',
    city: 'PANTIN',
    phone: '',
    firstName: 'Lucas',
    address1: '8 Rue Eugène et Marie-Louise Cornet',
    lastName: 'Dixon',
    state: undefined,
    address2: 'Apt 4',
    postalCode: '93500',
  },
  lineItems: [
    {
      id: '69a53fd05c7132778df3686d',
      sku: 'MEM-LIFE-SPOUSE',
      productId: '69a20367cf9f9e7ac577fd0e',
      productName: 'MEMBERSHIP : Life + Spouse',
      quantity: '1',
      unitPricePaid: { value: '900.00' },
      variantOptions: [
        { value: 'Life + Spouse : Regular', optionName: 'Type' },
      ],
      customizations: [
        { value: 'Lucas4 Dixon', label: 'Name' },
        { value: 'lucas.dixon+4@gmail.com', label: 'Email' },
        { value: '11/23/1979', label: 'Date of birth' },
        { value: 'New membership', label: 'Is this a new membership?' },
        { value: '', label: 'Member ID' },
        { value: 'France', label: 'Country' },
        { value: 'Lucas5 Dixon', label: 'Spouse name' },
        { value: 'lucas.dixon+4@gmail.com', label: 'Spouse email' },
        { value: '11/23/1979', label: 'Spouse date of birth' },
        { value: 'New membership', label: 'Is this a new membership for the spouse?' },
        { value: '', label: 'Spouse member ID' },
        { value: 'France', label: 'Spouse Country' },
        { value: 'I agree', label: 'Terms and conditions' },
      ],
    },
  ],
};

describe('parseLifeMembershipInfo', () => {
  const realLineItem = realOrder.lineItems![0];

  it('should correctly parse a Life + Spouse order from real example data', () => {
    const parsed = parseLifeMembershipInfo(realOrder, realLineItem);

    expect(parsed.orderDate).toBe('2026-03-02');
    expect(parsed.hasSpouse).toBe(true);

    // Member info
    expect(parsed.member.name).toBe('Lucas4 Dixon');
    expect(parsed.member.email).toBe('lucas.dixon+4@gmail.com');
    expect(parsed.member.dateOfBirth).toBe('11/23/1979');
    expect(parsed.member.country).toBe('France');
    expect(parsed.member.memberId).toBe('');
    expect(parsed.member.isNewMember).toBe(true);

    // Spouse info
    expect(parsed.spouse).toBeDefined();
    expect(parsed.spouse!.name).toBe('Lucas5 Dixon');
    expect(parsed.spouse!.email).toBe('lucas.dixon+4@gmail.com');
    expect(parsed.spouse!.dateOfBirth).toBe('11/23/1979');
    expect(parsed.spouse!.country).toBe('France');
    expect(parsed.spouse!.memberId).toBe('');
    expect(parsed.spouse!.isNewMember).toBe(true);
  });

  it('should parse a Life membership without spouse', () => {
    const soloLineItem = {
      ...realLineItem,
      customizations: [
        { value: 'Solo Member', label: 'Name' },
        { value: 'solo@example.com', label: 'Email' },
        { value: '01/01/1990', label: 'Date of birth' },
        { value: 'Renewing', label: 'Is this a new membership?' },
        { value: 'US100', label: 'Member ID' },
        { value: 'United States', label: 'Country' },
      ],
    };

    const parsed = parseLifeMembershipInfo(realOrder, soloLineItem);

    expect(parsed.hasSpouse).toBe(false);
    expect(parsed.spouse).toBeUndefined();

    expect(parsed.member.name).toBe('Solo Member');
    expect(parsed.member.email).toBe('solo@example.com');
    expect(parsed.member.memberId).toBe('US100');
    expect(parsed.member.isNewMember).toBe(false);
    expect(parsed.member.country).toBe('United States');
  });

  it('should detect spouse when spouse name is provided even without other spouse fields', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [
        { value: 'Member Name', label: 'Name' },
        { value: 'member@example.com', label: 'Email' },
        { value: 'US200', label: 'Member ID' },
        { value: 'Spouse Name', label: 'Spouse name' },
      ],
    };

    const parsed = parseLifeMembershipInfo(realOrder, lineItem);
    expect(parsed.hasSpouse).toBe(true);
    expect(parsed.spouse).toBeDefined();
    expect(parsed.spouse!.name).toBe('Spouse Name');
  });

  it('should detect spouse when spouse memberId is provided', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [
        { value: 'Member Name', label: 'Name' },
        { value: 'US200', label: 'Member ID' },
        { value: 'US201', label: 'Spouse member ID' },
      ],
    };

    const parsed = parseLifeMembershipInfo(realOrder, lineItem);
    expect(parsed.hasSpouse).toBe(true);
    expect(parsed.spouse).toBeDefined();
    expect(parsed.spouse!.memberId).toBe('US201');
  });

  it('should fall back to customerEmail for main member but not for spouse', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [
        { value: 'Main Member', label: 'Name' },
        { value: 'US100', label: 'Member ID' },
        { value: 'Spouse Person', label: 'Spouse name' },
        { value: 'US101', label: 'Spouse member ID' },
      ],
    };

    const parsed = parseLifeMembershipInfo(realOrder, lineItem);
    // Main member should fall back to customerEmail
    expect(parsed.member.email).toBe('lucas.dixon@gmail.com');
    // Spouse should NOT fall back to customerEmail
    expect(parsed.spouse!.email).toBe('');
  });

  it('should handle empty customizations gracefully', () => {
    const emptyLineItem = {
      ...realLineItem,
      customizations: [],
    };

    const parsed = parseLifeMembershipInfo(realOrder, emptyLineItem);
    expect(parsed.hasSpouse).toBe(false);
    expect(parsed.spouse).toBeUndefined();
    expect(parsed.member.memberId).toBe('');
    expect(parsed.member.email).toBe('lucas.dixon@gmail.com');
    expect(parsed.member.name).toBe('');
  });
});
