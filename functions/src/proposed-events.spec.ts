/* proposed-events.spec.ts — tests for event proposal validation. */
import { describe, it, expect } from 'vitest';
import { validateProposal, buildManagerDocIds } from './proposed-events';
import { Member, MembershipType } from './data-model';

describe('validateProposal', () => {
  const validMember: Member = {
    memberId: 'FR102',
    membershipType: MembershipType.Annual,
    currentMembershipExpires: '2999-01-01',
    name: 'Test Member',
  } as Member;

  const validData: Record<string, unknown> = {
    title: 'Test Event',
    start: '2026-05-01T10:00:00Z',
    end: '2026-05-01T12:00:00Z',
  };

  it('should return null for valid proposal', () => {
    expect(validateProposal(validMember, validData)).toBeNull();
  });

  it('should return error if memberId is missing', () => {
    const invalidMember = { ...validMember, memberId: '' };
    expect(validateProposal(invalidMember, validData)).toBe('Must have a valid Member ID to propose events.');
  });

  it('should return error if membership is expired', () => {
    const invalidMember = { ...validMember, currentMembershipExpires: '2020-01-01' };
    expect(validateProposal(invalidMember, validData)).toBe('Must have an active membership to propose events.');
  });

  it('should return null for Life member even if currentMembershipExpires is missing', () => {
    const lifeMember = { ...validMember, membershipType: MembershipType.Life, currentMembershipExpires: '' };
    expect(validateProposal(lifeMember, validData)).toBeNull();
  });

  it('should return error if title is missing', () => {
    const invalidData: Record<string, unknown> = { ...validData, title: '' };
    expect(validateProposal(validMember, invalidData)).toBe('Title, start, and end dates are required.');
  });

  it('should return error if start date is missing', () => {
    const invalidData: Record<string, unknown> = { ...validData, start: '' };
    expect(validateProposal(validMember, invalidData)).toBe('Title, start, and end dates are required.');
  });

  it('should return error if end date is missing', () => {
    const invalidData: Record<string, unknown> = { ...validData, end: '' };
    expect(validateProposal(validMember, invalidData)).toBe('Title, start, and end dates are required.');
  });
});

describe('buildManagerDocIds', () => {
  it('always includes the submitter when no managers are provided', () => {
    expect(buildManagerDocIds(undefined, 'member-1')).toEqual(['member-1']);
    expect(buildManagerDocIds([], 'member-1')).toEqual(['member-1']);
  });

  it('appends the submitter to the provided managers', () => {
    expect(buildManagerDocIds(['mgr-a', 'mgr-b'], 'member-1')).toEqual(['mgr-a', 'mgr-b', 'member-1']);
  });

  it('does not duplicate the submitter if already listed', () => {
    expect(buildManagerDocIds(['mgr-a', 'member-1'], 'member-1')).toEqual(['mgr-a', 'member-1']);
  });

  it('removes empty entries and de-duplicates', () => {
    expect(buildManagerDocIds(['mgr-a', '', 'mgr-a', ''], 'member-1')).toEqual(['mgr-a', 'member-1']);
  });
});
