/* proposed-events.spec.ts — tests for event proposal validation. */
import { describe, it, expect } from 'vitest';
import { validateProposal, buildManagerDocIds, resolveEventContacts, sameContacts } from './proposed-events';
import { EventContact, Member, MembershipType, initEventContact } from './data-model';

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
  it('returns empty list when no managers are provided', () => {
    expect(buildManagerDocIds(undefined, 'member-1')).toEqual([]);
    expect(buildManagerDocIds([], 'member-1')).toEqual([]);
  });

  it('keeps the provided managers without appending the creator', () => {
    expect(buildManagerDocIds(['mgr-a', 'mgr-b'], 'member-1')).toEqual(['mgr-a', 'mgr-b']);
  });

  it('excludes the creator if included in the provided managers', () => {
    expect(buildManagerDocIds(['mgr-a', 'member-1'], 'member-1')).toEqual(['mgr-a']);
  });

  it('removes empty entries and de-duplicates', () => {
    expect(buildManagerDocIds(['mgr-a', '', 'mgr-a', ''], 'member-1')).toEqual(['mgr-a']);
  });
});

describe('resolveEventContacts', () => {
  const members: Record<string, Partial<Member>> = {
    'owner-1': { name: 'Owner One', memberId: 'MEM-1', instructorId: 'I-1' },
    'mgr-a': { name: 'Manager A', memberId: 'MEM-2', instructorId: '' },
  };
  const loadMember = async (docId: string) => members[docId] as Member | undefined;

  const contact = (memberDocId: string, over: Partial<EventContact> = {}): EventContact =>
    ({ ...initEventContact(), memberDocId, ...over });

  it('drops contacts who are neither the creator nor a manager', async () => {
    const result = await resolveEventContacts(
      [contact('owner-1'), contact('ex-mgr'), contact('mgr-a')],
      'owner-1', ['mgr-a'], loadMember,
    );
    expect(result.map((c) => c.memberDocId)).toEqual(['owner-1', 'mgr-a']);
  });

  it('refreshes cached identifiers but keeps typed-in name and contact details', async () => {
    const result = await resolveEventContacts(
      [contact('owner-1', {
        name: 'Ring the school',
        memberId: 'STALE',
        instructorId: 'STALE',
        contactEmail: 'hi@example.com',
        contactUrl: 'https://example.com',
      })],
      'owner-1', [], loadMember,
    );
    expect(result).toEqual([{
      memberDocId: 'owner-1',
      name: 'Ring the school',
      memberId: 'MEM-1',
      instructorId: 'I-1',
      contactEmail: 'hi@example.com',
      contactUrl: 'https://example.com',
    }]);
  });

  it('fills a missing name from the member and de-duplicates', async () => {
    const result = await resolveEventContacts(
      [contact('mgr-a'), contact('mgr-a')], '', ['mgr-a'], loadMember,
    );
    expect(result).toEqual([{
      memberDocId: 'mgr-a',
      name: 'Manager A',
      memberId: 'MEM-2',
      instructorId: '',
      contactEmail: '',
      contactUrl: '',
    }]);
  });

  it('keeps the cached fields when the member document is gone', async () => {
    const result = await resolveEventContacts(
      [contact('mgr-gone', { name: 'Gone', memberId: 'MEM-9', instructorId: 'I-9' })],
      '', ['mgr-gone'], loadMember,
    );
    expect(result[0]).toMatchObject({ name: 'Gone', memberId: 'MEM-9', instructorId: 'I-9' });
  });
});

describe('sameContacts', () => {
  const a: EventContact = {
    memberDocId: 'owner-1', name: 'Owner One', memberId: 'MEM-1',
    instructorId: 'I-1', contactEmail: '', contactUrl: '',
  };

  it('ignores the key order Firestore returns fields in', () => {
    const reordered = JSON.parse(JSON.stringify({
      contactUrl: '', contactEmail: '', instructorId: 'I-1',
      memberId: 'MEM-1', name: 'Owner One', memberDocId: 'owner-1',
    })) as EventContact;
    expect(sameContacts([a], [reordered])).toBe(true);
  });

  it('is sensitive to order and content', () => {
    expect(sameContacts([a], [])).toBe(false);
    expect(sameContacts([a], [{ ...a, name: 'Someone Else' }])).toBe(false);
  });
});
