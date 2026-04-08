/* compute-statistics.spec.ts
 *
 * Tests for the computeStatisticsFromMembers function, verifying that
 * statistics are correctly computed from a set of member records.
 */
import { describe, it, expect } from 'vitest';
import { computeStatisticsFromMembers, computeOrderStatistics } from './compute-statistics';
import {
  initMember,
  initSchool,
  Member,
  School,
  SquareSpaceOrder,
  SquareSpaceLineItem,
  SquareSpaceLineItemType,
  MembershipType,
  StudentLevel,
  ApplicationLevel,
  InstructorLicenseType,
  MasterLevel,
} from './data-model';

function makeMember(overrides: Partial<Member>): Member {
  return { ...initMember(), ...overrides };
}

function makeSchool(overrides: Partial<School>): School {
  return { ...initSchool(), ...overrides };
}

describe('computeStatisticsFromMembers', () => {
  const today = '2026-03-01';

  it('should return zero counts for empty input', () => {
    const result = computeStatisticsFromMembers([], today);
    expect(result.totalMembers).toBe(0);
    expect(result.activeMembers).toBe(0);
    expect(result.activeInstructors).toBe(0);
    expect(result.membershipTypeHistogram).toEqual({});
    expect(result.studentLevelHistogram).toEqual({});
    expect(result.dataQuality.missingMastersLevels).toBe(0);
    expect(result.dataQuality.nonArrayMastersLevels).toBe(0);
  });

  it('should count active annual members correctly', () => {
    const members: Member[] = [
      makeMember({
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2026-06-01',
        country: 'United States',
      }),
      makeMember({
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2025-12-31', // expired
        country: 'Malaysia',
      }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.totalMembers).toBe(2);
    expect(result.activeMembers).toBe(1);
  });

  it('should count life members as active', () => {
    const members: Member[] = [
      makeMember({
        membershipType: MembershipType.Life,
        country: 'United States',
      }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.activeMembers).toBe(1);
  });

  it('should not count Inactive or Deceased as active', () => {
    const members: Member[] = [
      makeMember({ membershipType: MembershipType.Inactive }),
      makeMember({ membershipType: MembershipType.Deceased }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.activeMembers).toBe(0);
  });

  it('should count active instructors correctly', () => {
    const members: Member[] = [
      makeMember({
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2026-06-01',
        instructorId: 'I-001',
        instructorLicenseType: InstructorLicenseType.Annual,
        instructorLicenseExpires: '2026-12-31',
      }),
      makeMember({
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2026-06-01',
        instructorId: 'I-002',
        instructorLicenseType: InstructorLicenseType.Annual,
        instructorLicenseExpires: '2025-01-01', // expired instructor license
      }),
      makeMember({
        membershipType: MembershipType.Life,
        instructorId: 'I-003',
        instructorLicenseType: InstructorLicenseType.Life,
      }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.activeInstructors).toBe(2); // I-001 and I-003
  });

  it('should build membership type histogram', () => {
    const members: Member[] = [
      makeMember({ membershipType: MembershipType.Annual }),
      makeMember({ membershipType: MembershipType.Annual }),
      makeMember({ membershipType: MembershipType.Life }),
      makeMember({ membershipType: MembershipType.Inactive }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.membershipTypeHistogram).toEqual({
      Annual: 2,
      Life: 1,
      Inactive: 1,
    });
  });

  it('should build student level histogram', () => {
    const members: Member[] = [
      makeMember({ studentLevel: StudentLevel.Entry }),
      makeMember({ studentLevel: StudentLevel.Level1 }),
      makeMember({ studentLevel: StudentLevel.Entry }),
      makeMember({ studentLevel: StudentLevel.None }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.studentLevelHistogram['Entry']).toBe(2);
    expect(result.studentLevelHistogram['1']).toBe(1);
    expect(result.studentLevelHistogram['(none)']).toBe(1);
  });

  it('should build application level histogram', () => {
    const members: Member[] = [
      makeMember({ applicationLevel: ApplicationLevel.Level1 }),
      makeMember({ applicationLevel: ApplicationLevel.Level2 }),
      makeMember({ applicationLevel: ApplicationLevel.None }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.applicationLevelHistogram['1']).toBe(1);
    expect(result.applicationLevelHistogram['2']).toBe(1);
    expect(result.applicationLevelHistogram['(none)']).toBe(1);
  });

  it('should build country histogram', () => {
    const members: Member[] = [
      makeMember({ country: 'United States' }),
      makeMember({ country: 'Malaysia' }),
      makeMember({ country: 'United States' }),
      makeMember({ country: '' }), // no country
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.countryHistogram['United States']).toBe(2);
    expect(result.countryHistogram['Malaysia']).toBe(1);
    expect(result.countryHistogram['(none)']).toBe(1);
  });

  it('should build masters level histogram', () => {
    const members: Member[] = [
      makeMember({ mastersLevels: [MasterLevel.Good, MasterLevel.Wonder] }),
      makeMember({ mastersLevels: [MasterLevel.Good] }),
      makeMember({ mastersLevels: [] }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.mastersLevelHistogram['Good Hands']).toBe(2);
    expect(result.mastersLevelHistogram['Wonder Hands']).toBe(1);
  });

  it('should build instructor license type histogram', () => {
    const members: Member[] = [
      makeMember({ instructorLicenseType: InstructorLicenseType.Annual }),
      makeMember({ instructorLicenseType: InstructorLicenseType.Life }),
      makeMember({ instructorLicenseType: InstructorLicenseType.None }),
      makeMember({ instructorLicenseType: InstructorLicenseType.None }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.instructorLicenseTypeHistogram['Annual']).toBe(1);
    expect(result.instructorLicenseTypeHistogram['Life']).toBe(1);
    expect(result.instructorLicenseTypeHistogram['None']).toBe(2);
  });

  it('should count missing mastersLevels when field is undefined', () => {
    const members: Member[] = [
      makeMember({ mastersLevels: undefined as never }),
      makeMember({ mastersLevels: null as never }),
      makeMember({ mastersLevels: [MasterLevel.Good] }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.dataQuality.missingMastersLevels).toBe(2);
    expect(result.dataQuality.nonArrayMastersLevels).toBe(0);
    expect(result.mastersLevelHistogram['Good Hands']).toBe(1);
  });

  it('should count non-array mastersLevels when field is a string', () => {
    const members: Member[] = [
      makeMember({ mastersLevels: 'Good Hands, Wonder Hands' as never }),
      makeMember({ mastersLevels: 'Mystery Hands' as never }),
      makeMember({ mastersLevels: [MasterLevel.Good] }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.dataQuality.nonArrayMastersLevels).toBe(2);
    expect(result.dataQuality.missingMastersLevels).toBe(0);
    // String values should be parsed as comma-separated and counted.
    expect(result.mastersLevelHistogram['Good Hands']).toBe(2);
    expect(result.mastersLevelHistogram['Wonder Hands']).toBe(1);
    expect(result.mastersLevelHistogram['Mystery Hands']).toBe(1);
  });

  it('should handle empty string mastersLevels without counting histogram entries', () => {
    const members: Member[] = [
      makeMember({ mastersLevels: '' as never }),
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.dataQuality.nonArrayMastersLevels).toBe(1);
    expect(Object.keys(result.mastersLevelHistogram)).toHaveLength(0);
  });

  // --- Expiry Histograms ---

  it('should build membership expiry histogram for annual members', () => {
    const members: Member[] = [
      makeMember({ membershipType: MembershipType.Annual, currentMembershipExpires: '2026-06-15' }),
      makeMember({ membershipType: MembershipType.Annual, currentMembershipExpires: '2026-06-01' }),
      makeMember({ membershipType: MembershipType.Annual, currentMembershipExpires: '2027-01-31' }),
      makeMember({ membershipType: MembershipType.Life }), // Life members excluded
      makeMember({ membershipType: MembershipType.Annual, currentMembershipExpires: '' }), // No date
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.membershipExpiryHistogram).toEqual({
      '2026-06': 2,
      '2027-01': 1,
    });
  });

  it('should build instructor license expiry histogram excluding life licenses', () => {
    const members: Member[] = [
      makeMember({
        instructorId: 'I-001',
        instructorLicenseType: InstructorLicenseType.Annual,
        instructorLicenseExpires: '2026-12-31',
      }),
      makeMember({
        instructorId: 'I-002',
        instructorLicenseType: InstructorLicenseType.Annual,
        instructorLicenseExpires: '2026-12-31',
      }),
      makeMember({
        instructorId: 'I-003',
        instructorLicenseType: InstructorLicenseType.Life,
        instructorLicenseExpires: '9999-12-31',
      }), // Life excluded
      makeMember({
        instructorId: '',
        instructorLicenseType: InstructorLicenseType.Annual,
        instructorLicenseExpires: '2026-06-01',
      }), // No instructorId excluded
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.instructorLicenseExpiryHistogram).toEqual({
      '2026-12': 2,
    });
  });

  it('should build video library expiry histogram', () => {
    const members: Member[] = [
      makeMember({ classVideoLibraryExpirationDate: '2026-09-15' }),
      makeMember({ classVideoLibraryExpirationDate: '2026-09-01' }),
      makeMember({ classVideoLibraryExpirationDate: '2027-03-01' }),
      makeMember({ classVideoLibraryExpirationDate: '' }), // No date
    ];

    const result = computeStatisticsFromMembers(members, today);
    expect(result.videoLibraryExpiryHistogram).toEqual({
      '2026-09': 2,
      '2027-03': 1,
    });
  });

  it('should build school license expiry histogram from schools parameter', () => {
    const schools: School[] = [
      makeSchool({ schoolLicenseExpires: '2026-06-01' }),
      makeSchool({ schoolLicenseExpires: '2026-06-15' }),
      makeSchool({ schoolLicenseExpires: '2027-02-28' }),
      makeSchool({ schoolLicenseExpires: '' }), // No date
    ];

    const result = computeStatisticsFromMembers([], today, schools);
    expect(result.schoolLicenseExpiryHistogram).toEqual({
      '2026-06': 2,
      '2027-02': 1,
    });
  });

  it('should return empty expiry histograms when no relevant data', () => {
    const result = computeStatisticsFromMembers([], today);
    expect(result.membershipExpiryHistogram).toEqual({});
    expect(result.schoolLicenseExpiryHistogram).toEqual({});
    expect(result.instructorLicenseExpiryHistogram).toEqual({});
    expect(result.videoLibraryExpiryHistogram).toEqual({});
  });
});

// --- Order Statistics ---

function makeOrder(createdOn: string, lineItems: Partial<SquareSpaceLineItem>[]): SquareSpaceOrder {
  return {
    docId: '',
    lastUpdated: '',
    ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
    id: '',
    orderNumber: '',
    createdOn,
    modifiedOn: '',
    customerEmail: '',
    fulfillmentStatus: 'PENDING',
    lineItems: lineItems.map((li, i) => ({
      id: `li-${i}`,
      sku: li.sku || '',
      productName: li.productName || '',
      quantity: li.quantity || '1',
      unitPricePaid: { value: '0' },
      lineItemType: SquareSpaceLineItemType.Service,
      ...li,
    })),
  };
}

describe('computeOrderStatistics', () => {
  it('should group line items by category and month', () => {
    const orders = [
      makeOrder('2025-06-15T00:00:00Z', [
        { sku: 'MEM-YEAR-US' },
        { sku: 'VID-LIBRARY' },
      ]),
      makeOrder('2025-06-20T00:00:00Z', [
        { sku: 'MEM-YEAR-MY' },
      ]),
      makeOrder('2025-07-01T00:00:00Z', [
        { sku: 'MEM-YEAR-US' },
      ]),
    ];

    const result = computeOrderStatistics(orders);
    expect(result['Membership (Annual)']).toEqual({
      '2025-06': 2,
      '2025-07': 1,
    });
    expect(result['Video Library']).toEqual({
      '2025-06': 1,
    });
  });

  it('should map known SKUs to human-readable categories', () => {
    const orders = [
      makeOrder('2025-01-15T00:00:00Z', [
        { sku: 'MEM-LIFE-US' },
        { sku: 'LIS-YEAR-GL' },
        { sku: 'LIS-SCH-YRL' },
        { sku: 'LIS-SCH-MTH' },
        { sku: 'GRD-STUDENT' },
      ]),
    ];

    const result = computeOrderStatistics(orders);
    expect(Object.keys(result).sort()).toEqual([
      'Grading',
      'Instructor License',
      'Membership (Life)',
      'School License (Annual)',
      'School License (Monthly)',
    ]);
  });

  it('should respect quantity on line items', () => {
    const orders = [
      makeOrder('2025-03-10T00:00:00Z', [
        { sku: 'MEM-YEAR-US', quantity: '3' },
      ]),
    ];

    const result = computeOrderStatistics(orders);
    expect(result['Membership (Annual)']['2025-03']).toBe(3);
  });

  it('should skip orders with no createdOn date', () => {
    const orders = [
      makeOrder('', [{ sku: 'MEM-YEAR-US' }]),
    ];

    const result = computeOrderStatistics(orders);
    expect(result).toEqual({});
  });

  it('should skip line items with no SKU', () => {
    const orders = [
      makeOrder('2025-03-10T00:00:00Z', [
        { sku: '' },
      ]),
    ];

    const result = computeOrderStatistics(orders);
    expect(result).toEqual({});
  });

  it('should use raw SKU for unknown SKUs', () => {
    const orders = [
      makeOrder('2025-03-10T00:00:00Z', [
        { sku: 'UNKNOWN-SKU' },
      ]),
    ];

    const result = computeOrderStatistics(orders);
    expect(result['UNKNOWN-SKU']).toEqual({ '2025-03': 1 });
  });

  it('should return empty map for empty input', () => {
    const result = computeOrderStatistics([]);
    expect(result).toEqual({});
  });
});
