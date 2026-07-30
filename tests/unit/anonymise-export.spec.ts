/*
 * Unit tests for the export anonymisation rules (functions/scripts/anonymise.ts),
 * focused on events — the collection that carries the owner's cached name, the
 * owner's/managers' login emails, mini-profile contacts and the `contacts` array.
 *
 * No emulator or credentials needed; run via `pnpm test:fixtures`.
 */
import { describe, expect, it } from 'vitest';
import { EventContact } from '../../functions/src/data-model';
import {
  anonymiseEvent,
  anonymiseMember,
  buildMemberIndex,
  memberEmail,
} from '../../functions/scripts/anonymise';

const rawMembers = [
  { id: 'ownerDoc', memberId: 'M-100', name: 'Real Owner', emails: ['real.owner@gmail.com', 'owner@work.com'] },
  { id: 'mgrDoc1', memberId: 'M-200', name: 'Real Manager', emails: ['manager@gmail.com'] },
  { id: 'mgrDoc2', memberId: 'M-300', name: 'Other Manager', emails: ['other@gmail.com'] },
  { id: 'contactDoc', memberId: 'M-400', name: 'Real Contact', emails: ['contact@gmail.com'] },
];
const index = buildMemberIndex(rawMembers);

// A realistic firebase-sourced event with a non-instructor owner + mini-profile.
function anEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt1',
    title: 'Sydney Workshop',
    ownerDocId: 'ownerDoc',
    ownerMemberId: 'M-100',
    ownerName: 'Real Owner',
    ownerInstructorId: '',
    ownerEmails: ['real.owner@gmail.com', 'owner@work.com'],
    ownerContactEmail: 'real.owner@gmail.com',
    ownerContactUrl: 'https://realowner.example.org/about',
    managerDocIds: ['mgrDoc1', 'mgrDoc2'],
    managerEmails: ['manager@gmail.com', 'other@gmail.com'],
    updatedByEmail: 'manager@gmail.com',
    ...overrides,
  };
}

// Typed as EventContact so this fixture breaks if the stored shape changes.
const contacts: EventContact[] = [
  {
    memberDocId: 'contactDoc',
    memberId: 'M-400',
    instructorId: '',
    name: 'Real Contact',
    contactEmail: 'contact@gmail.com',
    contactUrl: 'https://realcontact.example.org',
  },
  // A contact with no opt-in public contact details: blanks stay blank.
  {
    memberDocId: 'mgrDoc1',
    memberId: 'M-200',
    instructorId: 'INS-7',
    name: 'Real Manager',
    contactEmail: '',
    contactUrl: '',
  },
];

// Every string anywhere in the doc, so PII checks cannot miss a nested field.
function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

describe('anonymiseEvent', () => {
  it('replaces the cached owner name and owner emails with the member forms', () => {
    const out = anonymiseEvent(anEvent(), index);
    expect(out['ownerName']).toBe('Test Member M-100');
    // One address per member, matching what anonymiseMember writes to members.json.
    expect(out['ownerEmails']).toEqual(['member-m-100@example.com']);
    expect(anonymiseMember(rawMembers[0], 'M-100')['emails']).toEqual(out['ownerEmails']);
  });

  it('rewrites managerEmails from managerDocIds, one per manager', () => {
    const out = anonymiseEvent(anEvent(), index);
    expect(out['managerEmails']).toEqual(['member-m-200@example.com', 'member-m-300@example.com']);
  });

  it('anonymises the mini-profile contact email and URL', () => {
    const out = anonymiseEvent(anEvent(), index);
    expect(out['ownerContactEmail']).toBe('member-m-100@example.com');
    expect(out['ownerContactUrl']).toBe('https://example.com/contact/m-100');
  });

  it('maps updatedByEmail back to the editing member', () => {
    expect(anonymiseEvent(anEvent(), index)['updatedByEmail']).toBe('member-m-200@example.com');
    // An editor who is not a seeded member still must not leak a real address.
    const stranger = anonymiseEvent(anEvent({ updatedByEmail: 'admin@ilc.com' }), index);
    expect(stranger['updatedByEmail']).toBe('event-editor@example.com');
  });

  it('leaves empty owner/contact fields empty rather than inventing data', () => {
    const out = anonymiseEvent(
      anEvent({
        ownerDocId: '',
        ownerMemberId: '',
        ownerName: '',
        ownerEmails: [],
        ownerContactEmail: '',
        ownerContactUrl: '',
        managerDocIds: [],
        managerEmails: [],
        updatedByEmail: '',
      }),
      index,
    );
    expect(out['ownerName']).toBe('');
    expect(out['ownerEmails']).toEqual([]);
    expect(out['ownerContactEmail']).toBe('');
    expect(out['ownerContactUrl']).toBe('');
    expect(out['managerEmails']).toEqual([]);
    expect(out['updatedByEmail']).toBe('');
  });

  it('anonymises a contacts array, keeping its shape and member references', () => {
    const out = anonymiseEvent(anEvent({ contacts }), index);
    expect(out['contacts']).toEqual([
      {
        memberDocId: 'contactDoc',
        memberId: 'M-400',
        instructorId: '',
        name: 'Test Member M-400',
        contactEmail: 'member-m-400@example.com',
        contactUrl: 'https://example.com/contact/m-400',
      },
      {
        memberDocId: 'mgrDoc1',
        memberId: 'M-200',
        instructorId: 'INS-7',
        name: 'Test Member M-200',
        contactEmail: '',
        contactUrl: '',
      },
    ]);
  });

  it('omits `contacts` entirely for events that do not have it', () => {
    expect('contacts' in anonymiseEvent(anEvent(), index)).toBe(false);
  });

  it('falls back to the doc ID for members missing from the export', () => {
    const out = anonymiseEvent(
      anEvent({ ownerDocId: 'unknownDoc', ownerMemberId: '', managerDocIds: ['ghostDoc'] }),
      index,
    );
    expect(out['ownerEmails']).toEqual([memberEmail('unknownDoc')]);
    expect(out['managerEmails']).toEqual([memberEmail('ghostDoc')]);
  });

  it('keeps managerEmails non-empty for legacy events that predate managerDocIds', () => {
    const out = anonymiseEvent(anEvent({ managerDocIds: [] }), index);
    expect(out['managerEmails']).toEqual(['event-manager-0@example.com', 'event-manager-1@example.com']);
  });

  it('leaves no real name, email or personal URL anywhere in the output', () => {
    const out = anonymiseEvent(anEvent({ contacts }), index);
    for (const s of allStrings(out)) {
      expect(s).not.toMatch(/gmail\.com|owner@work\.com|realowner|realcontact/i);
      expect(s).not.toMatch(/Real Owner|Real Manager|Real Contact/);
    }
    // Non-PII event content is preserved.
    expect(out['title']).toBe('Sydney Workshop');
    expect(out['ownerDocId']).toBe('ownerDoc');
    expect(out['managerDocIds']).toEqual(['mgrDoc1', 'mgrDoc2']);
  });
});
