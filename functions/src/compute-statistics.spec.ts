/* compute-statistics.spec.ts
 *
 * Tests for the computeStatisticsFromMembers function, verifying that
 * statistics are correctly computed from a set of member records.
 */
import { describe, it, expect } from 'vitest';
import { computeStatisticsFromMembers } from './compute-statistics';
import {
  initMember,
  Member,
  MembershipType,
  StudentLevel,
  ApplicationLevel,
  InstructorLicenseType,
  MasterLevel,
} from './data-model';

function makeMember(overrides: Partial<Member>): Member {
  return { ...initMember(), ...overrides };
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
});
