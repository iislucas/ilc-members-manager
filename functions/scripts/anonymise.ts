/*
 * Anonymisation rules shared by the data-export scripts.
 *
 * Deliberately free of side effects (no Firestore, no filesystem, no CLI
 * parsing) so the rules can be unit-tested directly — see
 * tests/unit/anonymise-export.spec.ts.
 */

export type RawDoc = Record<string, unknown>;

function str(doc: RawDoc, key: string): string {
  const v = doc[key];
  return typeof v === 'string' ? v : '';
}

function strArr(doc: RawDoc, key: string): string[] {
  const v = doc[key];
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

// Email addresses must be lowercase — checkEmailStatus normalises with .toLowerCase()
export function memberEmail(memberId: string): string {
  return `member-${memberId.toLowerCase()}@example.com`;
}

// Stand-in for a personal contact URL (event mini-profiles link to a member's
// own site / socials, which is PII).
export function memberContactUrl(memberId: string): string {
  return `https://example.com/contact/${memberId.toLowerCase()}`;
}

// Lookups from a member's Firestore doc ID / real email to their human-readable
// memberId, so documents that reference a member by doc ID or email can be
// rewritten to the same anonymised identity that members.json gets.
export type MemberIndex = {
  memberIdByDocId: Map<string, string>;
  memberIdByEmail: Map<string, string>; // keys are lowercased
};

export function buildMemberIndex(rawMembers: Array<{ id: string } & RawDoc>): MemberIndex {
  const memberIdByDocId = new Map<string, string>();
  const memberIdByEmail = new Map<string, string>();
  for (const m of rawMembers) {
    const memberId = str(m, 'memberId');
    if (!memberId) continue;
    memberIdByDocId.set(m.id, memberId);
    for (const email of strArr(m, 'emails')) {
      memberIdByEmail.set(email.toLowerCase(), memberId);
    }
  }
  return { memberIdByDocId, memberIdByEmail };
}

// The anonymised identity to use for a member referenced by doc ID. Falls back
// to the doc ID itself when the member is missing from the export (dangling
// ref), which is still PII-free. Returns '' when there is no reference at all.
function memberKey(index: MemberIndex, memberDocId: string, cachedMemberId: string): string {
  if (cachedMemberId) return cachedMemberId;
  if (!memberDocId) return '';
  return index.memberIdByDocId.get(memberDocId) ?? memberDocId;
}

export function anonymiseMember(doc: RawDoc, memberId: string): RawDoc {
  return {
    ...doc,
    name: `Test Member ${memberId}`,
    emails: [memberEmail(memberId)],
    phone: doc['phone'] ? '555-0000' : '',
    address: doc['address'] ? '123 Test St' : '',
    city: doc['city'] ? 'Test City' : '',
    zipCode: doc['zipCode'] ? '00000' : '',
    countyOrState: doc['countyOrState'] ? 'Test State' : '',
    // publicEmail / publicPhone appear on member AND instructor records
    publicEmail: doc['publicEmail'] ? memberEmail(memberId) : '',
    publicPhone: doc['publicPhone'] ? '555-0000' : '',
    // Clear admin-only free-text notes
    notes: '',
  };
}

export function anonymiseInstructor(doc: RawDoc, instructorId: string): RawDoc {
  return {
    ...doc,
    name: `Instructor ${instructorId}`,
    publicEmail: doc['publicEmail'] ? `instructor-${instructorId}@example.com` : '',
    publicPhone: doc['publicPhone'] ? '555-0000' : '',
  };
}

export function anonymiseSchool(doc: RawDoc, schoolId: string): RawDoc {
  return {
    ...doc,
    schoolName: `Test School ${schoolId}`,
    // Contact fields
    contactEmail: doc['contactEmail'] ? `school-${schoolId}@example.com` : '',
    contactPhone: doc['contactPhone'] ? '555-0000' : '',
    address: doc['address'] ? '123 Test St' : '',
    city: doc['city'] ? 'Test City' : '',
    zipCode: doc['zipCode'] ? '00000' : '',
  };
}

// One entry of an event's `contacts` array (see EventContact in
// functions/src/data-model.ts). Every entry is the event's creator or one of
// its managers, so its identity is anonymised the same way theirs is; the
// memberDocId / memberId / instructorId keys are left untouched so the seeded
// data still resolves each contact to a seeded member.
function anonymiseEventContact(contact: RawDoc, index: MemberIndex): RawDoc {
  const key = memberKey(index, str(contact, 'memberDocId'), str(contact, 'memberId'));
  return {
    ...contact,
    name: contact['name'] ? `Test Member ${key}` : '',
    contactEmail: contact['contactEmail'] && key ? memberEmail(key) : '',
    contactUrl: contact['contactUrl'] && key ? memberContactUrl(key) : '',
  };
}

/*
 * Events carry the creator's cached name (the `owner*` field names predate the
 * rename), the creator's and managers' real login emails, an optional
 * mini-profile contact (email + URL), the email of whoever last edited the
 * event, and — on events created since the contacts feature — a `contacts`
 * array with the same identity fields again.
 *
 * Emails are rebuilt from the creator/manager doc IDs rather than scrambled in
 * place, so they match the single `member-{memberId}@example.com` address that
 * anonymiseMember() gives each member. That keeps the seeded data usable:
 * firestore.rules and the event notifications both match a signed-in user to an
 * event by looking their email up in ownerEmails / managerEmails.
 */
export function anonymiseEvent(doc: RawDoc, index: MemberIndex): RawDoc {
  const ownerKey = memberKey(index, str(doc, 'ownerDocId'), str(doc, 'ownerMemberId'));
  const managerDocIds = strArr(doc, 'managerDocIds');
  const updatedBy = str(doc, 'updatedByEmail');
  const updatedByMemberId = index.memberIdByEmail.get(updatedBy.toLowerCase());
  const contacts = doc['contacts'];

  return {
    ...doc,
    ownerName: doc['ownerName'] ? `Test Member ${ownerKey}` : '',
    ownerEmails: ownerKey ? [memberEmail(ownerKey)] : [],
    // A member's real `emails` array can hold several addresses, so the stored
    // managerEmails is a flattened list; after anonymisation each member has
    // exactly one address, hence one per manager doc ID. Events that predate
    // managerDocIds keep their length with a placeholder rather than a real
    // address.
    managerEmails:
      managerDocIds.length > 0
        ? managerDocIds.map((id) => memberEmail(memberKey(index, id, '')))
        : strArr(doc, 'managerEmails').map((_, i) => `event-manager-${i}@example.com`),
    ownerContactEmail: doc['ownerContactEmail'] && ownerKey ? memberEmail(ownerKey) : '',
    ownerContactUrl: doc['ownerContactUrl'] && ownerKey ? memberContactUrl(ownerKey) : '',
    updatedByEmail: updatedBy
      ? updatedByMemberId
        ? memberEmail(updatedByMemberId)
        : 'event-editor@example.com'
      : '',
    ...(Array.isArray(contacts)
      ? {
          contacts: contacts.map((c) =>
            c && typeof c === 'object' ? anonymiseEventContact(c as RawDoc, index) : c,
          ),
        }
      : {}),
  };
}

export function anonymiseSheetsOrder(doc: RawDoc): RawDoc {
  const externalId = str(doc, 'externalId');
  return {
    ...doc,
    firstName: 'Test',
    lastName: `Member${externalId}`,
    email: externalId ? `member-${externalId}@example.com` : 'unknown@example.com',
  };
}

export function anonymiseSquarespaceOrder(doc: RawDoc): RawDoc {
  const email = str(doc, 'customerEmail');
  const anonEmail = email ? `order-${Buffer.from(email).toString('base64').substring(0, 8)}@example.com` : 'unknown@example.com';
  // Anonymise billing address if present
  let billingAddress = doc['billingAddress'];
  if (billingAddress && typeof billingAddress === 'object') {
    billingAddress = {
      ...(billingAddress as Record<string, unknown>),
      firstName: 'Test',
      lastName: 'Customer',
      address1: '123 Test St',
      address2: '',
      city: 'Test City',
      postalCode: '00000',
      phone: '',
    };
  }
  return { ...doc, customerEmail: anonEmail, billingAddress };
}
