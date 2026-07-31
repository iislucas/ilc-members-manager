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

/*
 * Event copy is written by hand — much of it pasted into Google Calendar — so
 * it routinely carries the organiser's own email, phone number and personal
 * links inline, well away from the structured fields below.
 *
 * This copy is public-facing (it renders on the live events pages), so the PII
 * is substituted in place rather than the field being blanked: the seeded event
 * keeps prose of a realistic shape and length, which is the whole reason the
 * export carries real descriptions at all.
 */
export const REDACTED_EMAIL = 'event-contact@example.com';
export const REDACTED_PHONE = '555-0000';
export const REDACTED_URL = 'https://example.com/event-link';

// Hosts that carry no personal information and that the events pages render
// meaningfully — the venue map, the calendar entry, ILC's own site, and the
// storage buckets images are embedded from. Compared against the host, so
// subdomains are covered. Everything else is treated as somebody's personal
// link and replaced.
const KEPT_URL_HOSTS = [
  'iliqchuan.com',
  'google.com',
  'goo.gl',
  'googleapis.com',
  'googleusercontent.com',
];

// Stops at the delimiters that end a link in HTML (" '), markdown ( ) ] ) or
// prose, so the surrounding copy is left intact.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Anchored on an international (+CC) or trunk (0X) prefix, so the date ranges,
// opening times and prices that fill event copy are not read as phone numbers.
const PHONE_RE = /(?:\+\d|\b0\d)[\d\s().-]{6,}\d/g;

function isKeptUrl(url: string, depth = 0): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.toLowerCase().startsWith('www.') ? `https://${url}` : url);
  } catch {
    return false; // Unparseable, so we cannot vouch for it.
  }
  const host = parsed.hostname.toLowerCase();
  if (!KEPT_URL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;

  // Google Calendar rewrites outbound links through its own /url redirector, so
  // most personal links in this copy arrive wrapped in an allowlisted host with
  // the real destination sitting in the query string. Judge the destination.
  if ((host === 'google.com' || host.endsWith('.google.com')) && parsed.pathname === '/url') {
    const target = parsed.searchParams.get('q') ?? parsed.searchParams.get('url');
    if (!target) return false;
    return depth < 3 && isKeptUrl(target, depth + 1);
  }
  return true;
}

// Replaces personal contact details embedded in free text, leaving the rest of
// the wording untouched.
export function redactFreeText(input: string): string {
  if (!input) return input;

  // Links we keep are stashed behind a NUL sentinel first, so that the email
  // and phone passes below cannot chew through their query strings and place
  // IDs. NUL cannot occur in Firestore string data, so the sentinel can never
  // collide with something that was already in the copy.
  const kept: string[] = [];

  let out = input.replace(URL_RE, (match) => {
    // Trailing punctuation belongs to the sentence, not to the link.
    const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? '';
    const url = match.slice(0, match.length - trailing.length);
    if (!isKeptUrl(url)) return REDACTED_URL + trailing;
    return `\u0000${kept.push(url) - 1}\u0000${trailing}`;
  });

  // Runs after the URL pass, which leaves `mailto:` untouched (it is neither
  // http(s) nor www), so this covers both bare addresses and mailto: hrefs.
  out = out.replace(EMAIL_RE, REDACTED_EMAIL);

  out = out.replace(PHONE_RE, (match) => {
    const digits = match.match(/\d/g)?.length ?? 0;
    // E.164 caps a real number at 15 digits; under 9 and this is far more
    // likely to be a date range, an opening time or a price.
    return digits >= 9 && digits <= 15 ? REDACTED_PHONE : match;
  });

  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]);
}

// The free-text event fields, redacted. Absent fields stay absent rather than
// being materialised as empty strings.
function redactedEventText(doc: RawDoc): RawDoc {
  const out: RawDoc = {};
  for (const key of ['description', 'descriptionMarkdown', 'location']) {
    const value = doc[key];
    if (typeof value === 'string') out[key] = redactFreeText(value);
  }
  return out;
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
 *
 * The same details also turn up loose in the description and location copy, so
 * those are redacted in place — see redactFreeText above.
 */
export function anonymiseEvent(doc: RawDoc, index: MemberIndex): RawDoc {
  const ownerKey = memberKey(index, str(doc, 'ownerDocId'), str(doc, 'ownerMemberId'));
  const managerDocIds = strArr(doc, 'managerDocIds');
  const updatedBy = str(doc, 'updatedByEmail');
  const updatedByMemberId = index.memberIdByEmail.get(updatedBy.toLowerCase());
  const contacts = doc['contacts'];

  return {
    ...doc,
    ...redactedEventText(doc),
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
