import { describe, it, expect, vi } from 'vitest';
import { parseSchoolLicenseInfo, processSchoolLicense, SchoolLicenseInfo } from './school-license';
import { computeRenewalAndExpiration } from './common';
import { SquareSpaceLineItem, SquareSpaceOrder, SquareSpaceLineItemType } from '../data-model';
import * as admin from 'firebase-admin';

// Helper to build a mock Firestore that returns a school document.
// Returns the mock db and a spy on the update function.
function mockFirestoreWithSchool(schoolData: Record<string, unknown>) {
  const updateSpy = vi.fn().mockResolvedValue(undefined);
  const docRef = { id: 'mock-school-doc-id', update: updateSpy };

  const querySnapshot = {
    empty: false,
    docs: [{ ref: docRef, data: () => schoolData }],
  };

  const db = {
    collection: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(querySnapshot),
        }),
      }),
    }),
  } as never as admin.firestore.Firestore;

  return { db, updateSpy };
}

// Helper to build a mock Firestore that returns an empty query (school not found).
function mockFirestoreEmpty() {
  const querySnapshot = { empty: true, docs: [] };

  const db = {
    collection: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(querySnapshot),
        }),
      }),
    }),
  } as never as admin.firestore.Firestore;

  return { db };
}

const realLineItem: SquareSpaceLineItem = {
  id: '69a466d14275d06d96da8493',
  sku: 'LIS-SCH-YRL',
  productId: '6999404b0ccc755adde0f466',
  productName: 'LICENSE : School (YEARLY)',
  lineItemType: SquareSpaceLineItemType.Service,
  quantity: '1',
  unitPricePaid: { value: '600.00' },
  variantOptions: [
    { value: 'LICENSE : School Yearly', optionName: 'Type' },
  ],
  customizations: [
    { label: 'Name', value: 'Lucas Dixon' },
    { label: 'Email ', value: 'lucas.dixon@gmail.com' },
    { value: 'US402', label: 'MemberID' },
    { label: 'School ID', value: 'SCH-101' },
    { value: 'Paris Zhong Xin Dao', label: 'Name of the School' },
  ],
};

// Real example order from a school annual license renewal.
const realOrder: SquareSpaceOrder = {
  docId: 'h1DsVIATxDEeSZbO9Yjv',
  lastUpdated: '2026-03-01T16:19:19.698Z',
  ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
  ilcAppOrderStatus: 'processed',
  ilcAppOrderIssues: [],
  id: '69a46708ac554b426366e788',
  orderNumber: '61813',
  createdOn: '2026-03-01T16:19:19.698Z',
  modifiedOn: '2026-03-01T16:19:20.081Z',
  customerEmail: 'moilucasdixon@gmail.com',
  fulfillmentStatus: 'PENDING',
  billingAddress: {
    lastName: 'Dixon',
    firstName: 'Lucas',
    state: undefined,
    postalCode: '93500',
    countryCode: 'FR',
    city: 'Pantin',
    address1: '8 Rue Eugène et Marie-Louise Cornet',
    address2: undefined,
    phone: '',
  },
  lineItems: [realLineItem],
};
// Real example monthly school license order.
const monthlyLineItem: SquareSpaceLineItem = {
  id: '69a3ce82b4b34f71a9f8fa2c',
  sku: 'LIS-SCH-MTH',
  productId: '69a3a553db7fc05e5f349587',
  productName: 'LICENSE : School (Monthly)',
  lineItemType: SquareSpaceLineItemType.Service,
  quantity: '1',
  unitPricePaid: { value: '60.00' },
  variantOptions: [],
  customizations: [
    { value: 'Yen Chin', label: 'Name' },
    { label: 'Email ', value: 'yen@iliqchuan.com' },
    { label: 'MemberID', value: 'Family' },
    { label: 'School ID', value: 'ILC NYC' },
  ],
};

const monthlyOrder: SquareSpaceOrder = {
  docId: 'lU2evNWdFALq1XqBp8k2',
  lastUpdated: '2026-03-01T05:30:18.579Z',
  ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
  ilcAppOrderStatus: 'processed',
  ilcAppOrderIssues: [],
  id: '69a3ceeaac554b426366db11',
  orderNumber: '61808',
  createdOn: '2026-03-01T05:30:18.579Z',
  modifiedOn: '2026-03-01T22:48:58.056Z',
  customerEmail: 'yen@iliqchuan.com',
  fulfillmentStatus: 'FULFILLED',
  billingAddress: {
    lastName: 'Chin',
    firstName: 'Yen',
    postalCode: '11354',
    state: 'NY',
    countryCode: 'US',
    city: 'FLUSHING',
    address1: '25-55 126th St',
    address2: undefined,
    phone: '',
  },
  lineItems: [monthlyLineItem],
};


// ---------------------------------------------------------------
// parseSchoolLicenseInfo tests (pure parsing, no Firestore)
// ---------------------------------------------------------------
describe('parseSchoolLicenseInfo', () => {
  it('should correctly parse an annual school license order', () => {
    const parsed = parseSchoolLicenseInfo(realOrder, realLineItem);

    expect(parsed).toEqual({
      schoolId: 'SCH-101',
      email: 'lucas.dixon@gmail.com',
      memberId: 'US402',
      orderDate: '2026-03-01',
    });
  });

  it('should correctly parse a monthly school license order', () => {
    const parsed = parseSchoolLicenseInfo(monthlyOrder, monthlyLineItem);

    expect(parsed).toEqual({
      schoolId: 'ILC NYC',
      email: 'yen@iliqchuan.com',
      memberId: 'Family',
      orderDate: '2026-03-01',
    });
  });

  it('should fall back to customerEmail when no email in customizations', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [
        { label: 'School ID', value: 'SCH-200' },
        { value: '100', label: 'MemberID' },
      ],
    };

    const parsed = parseSchoolLicenseInfo(realOrder, lineItem);
    expect(parsed.email).toBe('moilucasdixon@gmail.com');
    expect(parsed.schoolId).toBe('SCH-200');
  });

  it('should handle "Member ID" label with space', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [
        { label: 'School ID', value: 'SCH-300' },
        { label: 'Member ID', value: '555' },
        { label: 'Email', value: 'test@example.com' },
      ],
    };

    const parsed = parseSchoolLicenseInfo(realOrder, lineItem);
    expect(parsed.memberId).toBe('555');
    expect(parsed.schoolId).toBe('SCH-300');
    expect(parsed.email).toBe('test@example.com');
  });

  it('should use ilcAppSchoolIdInferred when present', () => {
    const lineItem = {
      ...realLineItem,
      ilcAppSchoolIdInferred: 'SCH-OVERRIDE',
      customizations: [
        { label: 'School ID', value: 'SCH-300' },
      ],
    };

    const parsed = parseSchoolLicenseInfo(realOrder, lineItem);
    expect(parsed.schoolId).toBe('SCH-OVERRIDE');
  });

  it('should return empty schoolId when School ID is missing', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [
        { label: 'Name', value: 'Someone' },
        { label: 'Email', value: 'someone@test.com' },
        { value: '100', label: 'MemberID' },
      ],
    };

    const parsed = parseSchoolLicenseInfo(realOrder, lineItem);
    expect(parsed.schoolId).toBe('');
  });

  it('should handle empty customizations gracefully', () => {
    const lineItem = {
      ...realLineItem,
      customizations: [],
    };

    const parsed = parseSchoolLicenseInfo(realOrder, lineItem);
    expect(parsed.schoolId).toBe('');
    expect(parsed.memberId).toBe('');
    expect(parsed.email).toBe('moilucasdixon@gmail.com');
    expect(parsed.orderDate).toBe('2026-03-01');
  });
});

// ---------------------------------------------------------------
// computeRenewalAndExpiration duration tests
// ---------------------------------------------------------------
describe('school license renewal durations', () => {
  it('should compute annual expiration (12 months) for LIS-SCH-YRL', () => {
    const result = computeRenewalAndExpiration('', '2026-02-27', 12);
    expect(result.renewalDate).toBe('2026-02-27');
    expect(result.expirationDate).toBe('2027-02-27');
  });

  it('should compute monthly expiration (1 month) for LIS-SCH-MTH', () => {
    const result = computeRenewalAndExpiration('', '2026-02-27', 1);
    expect(result.renewalDate).toBe('2026-02-27');
    expect(result.expirationDate).toBe('2026-03-27');
  });

  it('should extend from current expiration for monthly renewal', () => {
    const result = computeRenewalAndExpiration('2026-06-15', '2026-05-01', 1);
    expect(result.renewalDate).toBe('2026-06-15');
    expect(result.expirationDate).toBe('2026-07-15');
  });

  it('should extend from order date for lapsed monthly renewal', () => {
    const result = computeRenewalAndExpiration('2026-01-01', '2026-03-15', 1);
    expect(result.renewalDate).toBe('2026-03-15');
    expect(result.expirationDate).toBe('2026-04-15');
  });
});

// ---------------------------------------------------------------
// processSchoolLicense tests (with mocked Firestore)
// ---------------------------------------------------------------
describe('processSchoolLicense', () => {
  function mockLineItem(): SquareSpaceLineItem {
    return { id: 'li-1', sku: 'LIS-SCH-YRL', quantity: '1', unitPricePaid: { value: '100' }, lineItemType: SquareSpaceLineItemType.Service };
  }

  it('should return an error when schoolId is missing', async () => {
    const info: SchoolLicenseInfo = {
      schoolId: '',
      email: 'test@example.com',
      memberId: '100',
      orderDate: '2026-03-01',
    };
    const { db } = mockFirestoreEmpty();
    const result = await processSchoolLicense('ORD-1', info, 12, mockLineItem(), db);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('missing a School ID');
    }
  });

  it('should return an error when school is not found', async () => {
    const info: SchoolLicenseInfo = {
      schoolId: 'SCH-MISSING',
      email: 'test@example.com',
      memberId: '100',
      orderDate: '2026-03-01',
    };
    const { db } = mockFirestoreEmpty();
    const result = await processSchoolLicense('ORD-2', info, 12, mockLineItem(), db);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('not found in database');
    }
  });

  it('should update the school with annual renewal dates (12 months)', async () => {
    const info: SchoolLicenseInfo = {
      schoolId: 'SCH-101',
      email: 'test@example.com',
      memberId: 'US402',
      orderDate: '2026-03-01',
    };
    const { db, updateSpy } = mockFirestoreWithSchool({
      schoolId: 'SCH-101',
      schoolLicenseExpires: '',
    });

    const result = await processSchoolLicense('ORD-3', info, 12, mockLineItem(), db);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.renewalDate).toBe('2026-03-01');
      expect(result.expirationDate).toBe('2027-03-01');
    }

    expect(updateSpy).toHaveBeenCalledOnce();
    const updateArg = updateSpy.mock.calls[0][0];
    expect(updateArg.schoolLicenseRenewalDate).toBe('2026-03-01');
    expect(updateArg.schoolLicenseExpires).toBe('2027-03-01');
  });

  it('should update the school with monthly renewal dates (1 month)', async () => {
    const info: SchoolLicenseInfo = {
      schoolId: 'SCH-101',
      email: 'test@example.com',
      memberId: 'US402',
      orderDate: '2026-03-01',
    };
    const { db, updateSpy } = mockFirestoreWithSchool({
      schoolId: 'SCH-101',
      schoolLicenseExpires: '',
    });

    const result = await processSchoolLicense('ORD-4', info, 1, mockLineItem(), db);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.renewalDate).toBe('2026-03-01');
      expect(result.expirationDate).toBe('2026-04-01');
    }

    expect(updateSpy).toHaveBeenCalledOnce();
    const updateArg = updateSpy.mock.calls[0][0];
    expect(updateArg.schoolLicenseRenewalDate).toBe('2026-03-01');
    expect(updateArg.schoolLicenseExpires).toBe('2026-04-01');
  });

  it('should extend from current expiration for early renewal', async () => {
    const info: SchoolLicenseInfo = {
      schoolId: 'SCH-101',
      email: 'test@example.com',
      memberId: 'US402',
      orderDate: '2026-05-01',
    };
    const { db, updateSpy } = mockFirestoreWithSchool({
      schoolId: 'SCH-101',
      schoolLicenseExpires: '2026-08-15', // still valid
    });

    const result = await processSchoolLicense('ORD-5', info, 1, mockLineItem(), db);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.renewalDate).toBe('2026-08-15');
      expect(result.expirationDate).toBe('2026-09-15');
    }

    const updateArg = updateSpy.mock.calls[0][0];
    // Should extend from current expiration, not from order date
    expect(updateArg.schoolLicenseRenewalDate).toBe('2026-08-15');
    expect(updateArg.schoolLicenseExpires).toBe('2026-09-15');
  });

  it('should extend monthly from far-future expiration', async () => {
    const info: SchoolLicenseInfo = {
      schoolId: 'SCH-101',
      email: 'test@example.com',
      memberId: 'US402',
      orderDate: '2026-03-01',
    };
    const { db, updateSpy } = mockFirestoreWithSchool({
      schoolId: 'SCH-101',
      schoolLicenseExpires: '2027-06-01',
    });

    const result = await processSchoolLicense('ORD-6', info, 1, mockLineItem(), db);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.renewalDate).toBe('2027-06-01');
      expect(result.expirationDate).toBe('2027-07-01');
    }

    // renewalDate = max(2027-06-01, 2026-03-01) = 2027-06-01
    // expirationDate = 2027-07-01
    const updateArg = updateSpy.mock.calls[0][0];
    expect(updateArg.schoolLicenseRenewalDate).toBe('2027-06-01');
    expect(updateArg.schoolLicenseExpires).toBe('2027-07-01');
  });

  it('should snapshot pre-order dates on the lineItem', async () => {
    const info: SchoolLicenseInfo = {
      schoolId: 'SCH-101',
      email: 'test@example.com',
      memberId: 'US402',
      orderDate: '2026-03-01',
    };
    const { db } = mockFirestoreWithSchool({
      schoolId: 'SCH-101',
      schoolLicenseRenewalDate: '2025-06-01',
      schoolLicenseExpires: '2026-06-01',
    });
    const lineItem = mockLineItem();

    await processSchoolLicense('ORD-7', info, 12, lineItem, db);
    expect(lineItem.ilcAppPreOrderRenewalDate).toBe('2025-06-01');
    expect(lineItem.ilcAppPreOrderExpiryDate).toBe('2026-06-01');
  });
});
