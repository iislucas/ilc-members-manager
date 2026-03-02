import { describe, it, expect } from 'vitest';
import { parseInstructorLicenseInfo } from './instructor-license';
import { SquareSpaceOrder, SquareSpaceLineItem } from '../data-model';

// Real example line item from an Instructor license purchase.
const realLineItem: SquareSpaceLineItem = {
  id: '69a569f0b4b34f71a9f9e2f3',
  productId: '68ab8406c1bfc45b6dc2798a',
  productName: 'LICENSE : Instructor + Group Leader',
  sku: 'LIS-YEAR-INS',
  quantity: '1',
  unitPricePaid: { value: '150.00' },
  variantOptions: [
    { optionName: 'Type', value: 'Instructor : $150 Yearly' },
  ],
  customizations: [
    { label: 'Name', value: 'Lucas Dixon' },
    { value: 'lucas.dixon@gmail.com', label: 'Email ' },
    { label: 'Member ID', value: 'US402' },
  ],
};

// Real example order from an Instructor license purchase.
const realOrder: SquareSpaceOrder = {
  docId: 'a2S2CJ96y8AGFbY0XzTm',
  lastUpdated: '2026-03-02T10:44:42.835Z',
  ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
  ilcAppOrderStatus: 'processed',
  ilcAppOrderIssues: [],
  id: '69a56a0b0cff766a1a83284e',
  orderNumber: '61815',
  createdOn: '2026-03-02T10:44:26.747Z',
  modifiedOn: '2026-03-02T10:44:27.148Z',
  customerEmail: 'lucas.dixon@gmail.com',
  fulfillmentStatus: 'PENDING',
  billingAddress: {
    address2: 'Apt 4',
    city: 'PANTIN',
    lastName: 'Dixon',
    countryCode: 'FR',
    state: undefined,
    postalCode: '93500',
    address1: '8 Rue Eugène et Marie-Louise Cornet',
    phone: '',
    firstName: 'Lucas',
  },
  lineItems: [realLineItem],
};

describe('parseInstructorLicenseInfo', () => {
  it('should correctly parse an instructor license order from real example data', () => {
    const parsed = parseInstructorLicenseInfo(realOrder, realLineItem);
    expect(parsed).toEqual({
      memberId: 'US402',
      email: 'lucas.dixon@gmail.com',
      orderDate: '2026-03-02',
    });
  });

  it('should fall back to customerEmail when no email in customizations', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [
        { label: 'Member ID', value: 'US102' },
      ],
    };

    const parsed = parseInstructorLicenseInfo(realOrder, lineItem);
    expect(parsed.email).toBe('lucas.dixon@gmail.com');
  });

  it('should handle empty customizations', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [],
    };

    const parsed = parseInstructorLicenseInfo(realOrder, lineItem);
    expect(parsed.memberId).toBe('');
    expect(parsed.email).toBe('lucas.dixon@gmail.com');
    expect(parsed.orderDate).toBe('2026-03-02');
  });
});
