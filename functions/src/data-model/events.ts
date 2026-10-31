import { GenericFsDoc, normalizeLastUpdated } from './base';
import {
  applyDiscount,
  buildEarlyBirdDiscountsFromOptionMap,
  DepositPolicyKind,
  EarlyBirdPolicyKind,
  EventAddOn,
  EventAddOnKind,
  EventCapacity,
  EventDiscount,
  EventPricingRules,
  EventRegistrationOption,
  EventRegistrationQuestionResponse,
  initEventAddOn,
  initEventCapacity,
  initEventDiscount,
  initEventPricingRules,
  initEventRegistrationOption,
  initEventRuleConditions,
  matchesRegistrationCondition,
  normalizeCapacityMap,
  normalizeEventCapacity,
  normalizeEventPricingRules,
  normalizeQuestionResponseList,
  PaymentChoice,
  PersonStatusKind,
  RegistrationConditionKind,
  TimingConditionKind,
  TimingWindow,
  WhoCondition,
  WhoConditionKind,
} from './event-pricing-rules';
export * from './event-pricing-rules';

// Event status values for the unified /events collection.
export enum EventStatus {
  Draft = 'draft',
  Proposed = 'proposed',
  Listed = 'listed',
  Unlisted = 'unlisted',
  Rejected = 'rejected',
  Cancelled = 'cancelled',
}

// Maps an EventStatus value to a user-friendly display label.
export function eventStatusLabel(status: EventStatus | undefined): string {
  switch (status) {
    case EventStatus.Draft:
      return 'Draft';
    case EventStatus.Proposed:
      return 'Waiting for Approval';
    case EventStatus.Listed:
      return 'Listed Publicly';
    case EventStatus.Unlisted:
      return 'Unlisted (Direct Link Only)';
    case EventStatus.Rejected:
      return 'Rejected';
    case EventStatus.Cancelled:
      return 'Cancelled';
    default:
      return '';
  }
}

// A document attached to an event (e.g. flyer, schedule, waiver).
export type EventDocument = {
  name: string; // Display name for the document
  url: string; // Download URL in Firebase Storage
};

// One publicly-listed contact for an event. Membership of `IlcEvent.contacts`
// IS the "listed as a contact" flag: a contact must be the event's creator
// (ownerDocId) or one of its managerDocIds, and onEventUpdated prunes entries
// that are neither. The display fields are cached on the (publicly readable)
// event because /members is not public, so a visitor cannot resolve a member
// doc ID into a name. `contactEmail`/`contactUrl` are opt-in and typed by the
// editor — a member's own emails are never copied here automatically.
export type EventContact = {
  memberDocId: string;
  name: string; // Cached member name / contact display name.
  memberId: string; // Cached human-readable memberId.
  instructorId: string; // Cached instructorId, or '' if not an instructor.
  contactEmail: string; // Optional public contact email.
  contactUrl: string; // Optional public contact link.
};

export function initEventContact(): EventContact {
  return {
    memberDocId: '',
    name: '',
    memberId: '',
    instructorId: '',
    contactEmail: '',
    contactUrl: '',
  };
}

// A single unified event type. All events live in /events/{docId}.
// Every event is authored in the app; member-proposed events start at
// status='proposed'.
//
// Events predating the removal of the Google Calendar sync still carry a
// `kind` field in Firestore ('calendar-sourced' or 'firebase-sourced'). It is
// deliberately not modelled here: nothing reads it, and all events are now
// treated identically regardless of how they originally arrived.
export type IlcEvent = {
  docId: string; // Firestore document ID (not stored in doc, added on read)
  title: string;
  start: string; // ISO date-time or YYYY-MM-DD
  end: string; // ISO date-time or YYYY-MM-DD
  description: string; // Always HTML if from calendar
  descriptionMarkdown?: string; // Markdown version for editing and display
  heroImageUrl: string; // URL of the hero image
  heroImageLargeUrl?: string; // URL of the 600x400 large image
  heroImageThumbUrl?: string; // URL of the 120x80 thumbnail
  heroImageOriginalUrl?: string; // URL of the original uncropped image
  location: string;
  status: EventStatus;
  googleMapsUrl?: string;
  googleCalEventLink?: string;
  createdAt?: string; // ISO date-time
  // The event creator (historically called the owner; the field names are kept).
  // `ownerDocId` is the member's Firestore doc ID and stays the authoritative
  // membership field (used by firestore.rules, the /members/{docId}/events
  // mirror, and notifications). The creator does NOT need to be an instructor;
  // the fields below cache their identity and an optional inline "mini-profile"
  // contact so a non-instructor can be listed as a contact without depending on
  // an instructorId. '' throughout when there is no creator. Who is shown
  // publicly is `contacts` below, NOT this field.
  ownerDocId: string;
  ownerEmails: string[];
  ownerName: string; // Cached member name / contact display name.
  ownerMemberId: string; // Cached human-readable memberId.
  ownerInstructorId: string; // Cached instructorId, or '' if the owner is not an instructor.
  ownerContactEmail: string; // Optional mini-profile contact email (may be set even for an instructor owner).
  ownerContactUrl: string; // Optional mini-profile contact URL.
  leadingInstructorId: string; // Primary instructor leading the event
  // The human-readable schoolId (e.g. SCH-123) this event is hosted by /
  // associated with, or '' if none. Used to list a school's events on its
  // public profile page and to filter the events search page by school.
  schoolId: string;
  schoolDocId: string; // Firestore doc ID of the associated school, or ''.
  managerDocIds: string[];
  managerEmails: string[];
  // The subset of the creator + managers that is listed publicly as a contact
  // for the event, in display order. Empty means "nobody chosen" — the UI then
  // falls back to the creator, and then to the leading instructor.
  contacts: EventContact[];
  // Attached documents (max 10). Each entry has a display name and a
  // Firebase Storage download URL.
  documents: EventDocument[];
  productId?: string; // Firestore doc ID of the linked Product (or '' if none)
  onlineJoiningLink?: string; // Online attendance / Zoom joining URL / instructions (for paid online attendees)
  purchaseDetailsMarkdown?: string; // Markdown details shared upon purchase (meeting link, password, instructions)
  inPersonDetailsMarkdown?: string; // Markdown details for in-person attendees (training space directions, building access codes, arrival info)
  recordedVideoId?: string; // Catalog video doc ID from /videos (or '' if none)
  recordedVideoUrl?: string; // Direct external video recording URL (or '' if none)
  // Named resource capacities & live transactionally-maintained counts.
  capacities: EventCapacity[];
  capacityCounts: Record<string, number>;
  maxInPersonAttendees?: number; // Legacy in-person capacity limit (0 or unset for unlimited)
  inPersonRegistrationsCount?: number; // Cached count of in-person registrations
  lastUpdated?: string; // ISO date-time; managed by sync logic
  updatedByEmail?: string; // Email of the user who last updated this event
};

export type SubmitProposedEventRequest = {
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  status?: EventStatus;
  leadingInstructorId?: string;
  ownerDocId?: string;
  managerDocIds?: string[];
  contactDocIds?: string[];
  ownerContactName?: string;
  ownerContactEmail?: string;
  ownerContactUrl?: string;
  productId?: string;
  onlineJoiningLink?: string;
  purchaseDetailsMarkdown?: string;
  inPersonDetailsMarkdown?: string;
  recordedVideoId?: string;
  recordedVideoUrl?: string;
};

export function initEvent(): IlcEvent {
  return {
    docId: '',
    title: '',
    start: '',
    end: '',
    description: '',
    descriptionMarkdown: '',
    heroImageUrl: '',
    heroImageLargeUrl: '',
    heroImageThumbUrl: '',
    heroImageOriginalUrl: '',
    location: '',
    status: EventStatus.Proposed,
    ownerDocId: '',
    ownerEmails: [],
    ownerName: '',
    ownerMemberId: '',
    ownerInstructorId: '',
    ownerContactEmail: '',
    ownerContactUrl: '',
    leadingInstructorId: '',
    schoolId: '',
    schoolDocId: '',
    managerDocIds: [],
    managerEmails: [],
    contacts: [],
    documents: [],
    productId: '',
    onlineJoiningLink: '',
    purchaseDetailsMarkdown: '',
    inPersonDetailsMarkdown: '',
    recordedVideoId: '',
    recordedVideoUrl: '',
    capacities: [],
    capacityCounts: {},
    maxInPersonAttendees: 0,
    inPersonRegistrationsCount: 0,
    updatedByEmail: '',
  };
}

export function firestoreDocToIlcEvent(doc: GenericFsDoc): IlcEvent {
  const raw = (doc.data() || {}) as Record<string, unknown>;
  const data = raw as Partial<IlcEvent> & { startDate?: string; endDate?: string };
  const lastUpdated = normalizeLastUpdated(data.lastUpdated);
  const start = data.start || data.startDate || '';
  const end = data.end || data.endDate || start;

  let capacities: EventCapacity[] = [];
  if (Array.isArray(raw['capacities'])) {
    capacities = raw['capacities'].map((c, idx) => normalizeEventCapacity(c, idx));
  } else if (
    typeof data.maxInPersonAttendees === 'number' &&
    Number.isFinite(data.maxInPersonAttendees) &&
    data.maxInPersonAttendees > 0
  ) {
    capacities = [
      initEventCapacity({
        id: 'in_person_venue',
        label: 'In-Person Venue',
        description: '',
        limit: Math.round(data.maxInPersonAttendees),
      }),
    ];
  }

  let capacityCounts = normalizeCapacityMap(raw['capacityCounts']);
  if (
    Object.keys(capacityCounts).length === 0 &&
    capacities.some((c) => c.id === 'in_person_venue') &&
    typeof data.inPersonRegistrationsCount === 'number' &&
    data.inPersonRegistrationsCount > 0
  ) {
    capacityCounts = { in_person_venue: Math.round(data.inPersonRegistrationsCount) };
  }

  return {
    ...initEvent(),
    ...data,
    start,
    end,
    capacities,
    capacityCounts,
    docId: doc.id,
    lastUpdated,
  };
}

// A normalised view of an event's creator for display. Callers must
// NOT branch on the creator being an instructor: `instructorId` is only a hint for
// optionally linking to the public instructor profile page. `hasMiniProfile` is
// independent — an instructor owner may also set an event-specific contact.
export type EventOwnerContact = {
  hasOwner: boolean; // Whether the event has an assigned owner at all.
  memberDocId: string;
  name: string; // Display name (falls back to memberId, then email).
  memberId: string;
  instructorId: string; // '' if not an instructor; links to /instructors/{id} when set.
  contactEmail: string;
  contactUrl: string;
  hasMiniProfile: boolean; // Whether an inline contact email/url is present.
};

// Resolve an event's owner into a normalised contact for the UI. Tolerates old
// events that predate the cached owner fields (name/memberId/instructorId absent).
export function eventOwnerContact(event: {
  ownerDocId?: string;
  ownerName?: string;
  ownerMemberId?: string;
  ownerInstructorId?: string;
  ownerContactEmail?: string;
  ownerContactUrl?: string;
  ownerEmails?: string[];
}): EventOwnerContact {
  const memberDocId = event.ownerDocId || '';
  const contactEmail = event.ownerContactEmail || '';
  const contactUrl = event.ownerContactUrl || '';
  const memberId = event.ownerMemberId || '';
  const fallbackEmail =
    event.ownerEmails && event.ownerEmails.length > 0 ? event.ownerEmails[0] : '';
  const hasOwner =
    memberDocId !== '' ||
    Boolean(event.ownerName) ||
    Boolean(contactEmail) ||
    Boolean(contactUrl);
  return {
    hasOwner,
    memberDocId,
    name: event.ownerName || memberId || fallbackEmail,
    memberId,
    instructorId: event.ownerInstructorId || '',
    contactEmail,
    contactUrl,
    hasMiniProfile: contactEmail !== '' || contactUrl !== '',
  };
}

// The event fields `contactFromCreator` / `eventContacts` read. Every field is
// optional so old event documents (and partial form models) can be passed in.
export type EventContactFields = {
  contacts?: EventContact[];
  ownerDocId?: string;
  ownerName?: string;
  ownerMemberId?: string;
  ownerInstructorId?: string;
  ownerContactEmail?: string;
  ownerContactUrl?: string;
  ownerEmails?: string[];
};

// Build the contact entry for an event's creator from the cached owner* fields.
// Returns null when the event has no creator.
export function contactFromCreator(event: EventContactFields): EventContact | null {
  const creator = eventOwnerContact(event);
  if (!creator.hasOwner) return null;
  const { hasOwner: _, hasMiniProfile: __, ...contact } = creator;
  return contact;
}

// Resolve the contacts to list publicly for an event: the explicitly chosen
// `contacts`, or — when nobody has been chosen — the creator, so events that
// predate the contacts list still show someone. An empty result means the
// caller should fall back to the leading instructor.
export function eventContacts(event: EventContactFields): EventContact[] {
  const listed = (event.contacts || []).filter((c) => c && c.memberDocId);
  if (listed.length > 0) {
    return listed.map((c) => ({ ...initEventContact(), ...c }));
  }
  const creator = contactFromCreator(event);
  return creator ? [creator] : [];
}

// ------------------------------------------------------------------
// Products & Unified Rule-Based Pricing for Classes, Workshops & Events
// ------------------------------------------------------------------

export enum AttendeeRole {
  NonMember = 'non_member',
  Member = 'member',
  Instructor = 'instructor',
}

export enum AttendanceType {
  InPerson = 'in_person',
  Online = 'online',
  InPersonAndOnline = 'in_person_and_online',
  VideoOnly = 'video_only',
}

export enum PricingTierType {
  Standard = 'standard',
  EarlyBird = 'early_bird',
  InPerson = 'in_person',
}

// Retained for interpreting legacy Firestore /products documents with `tiers`.
export function getPricingTierKey(
  role: AttendeeRole,
  attendance: AttendanceType,
  includeVideo: boolean,
  tierType: PricingTierType = PricingTierType.Standard,
): string {
  let base: string;
  if (attendance === AttendanceType.VideoOnly) {
    base = `${role}_video_only`;
  } else {
    base = `${role}_${attendance}_${includeVideo ? 'video' : 'novideo'}`;
  }
  if (tierType === PricingTierType.Standard) {
    return base;
  }
  return `${base}_${tierType}`;
}

export type Product = {
  docId: string;
  title: string;
  description: string;
  descriptionMarkdown: string;
  eventDocId: string; // Linked IlcEvent docId (or '' if standalone)
  currency: string; // e.g. 'usd'
  stripeProductId: string; // Linked Stripe product ID (or '')
  pricingRules: EventPricingRules;
  capacityCounts: Record<string, number>;
  // Derived summary flags maintained automatically from pricingRules:
  allowNonMembers: boolean;
  allowMembers: boolean;
  allowInstructors: boolean;
  allowInPerson: boolean;
  allowOnline: boolean;
  allowVideo: boolean;
  allowVideoOnly: boolean;
  hasMemberPrice: boolean;
  hasInstructorPrice: boolean;
  hasEarlyBird: boolean;
  earlyBirdDeadline: string;
  allowPayInPerson: boolean;
  videoDeltaPrice: number;
  maxInPersonAttendees: number;
  inPersonRegistrationsCount: number;
  onlineJoiningLink: string;
  purchaseDetailsMarkdown: string;
  inPersonDetailsMarkdown: string;
  recordedVideoId: string;
  recordedVideoUrl: string;
  createdAt: string;
  lastUpdated: string;
};

type RawTierMap = Record<string, { enabled?: boolean; price?: number }>;

function lookupLegacyTier(
  tiers: RawTierMap,
  role: AttendeeRole,
  attendance: AttendanceType,
  includeVideo: boolean,
  tierType: PricingTierType = PricingTierType.Standard,
): { enabled: boolean; price: number } | null {
  const direct = tiers[getPricingTierKey(role, attendance, includeVideo, tierType)];
  if (direct && direct.enabled && typeof direct.price === 'number') {
    return { enabled: true, price: direct.price };
  }
  if (role === AttendeeRole.Instructor) {
    const memberFallback =
      tiers[getPricingTierKey(AttendeeRole.Member, attendance, includeVideo, tierType)];
    if (memberFallback && memberFallback.enabled && typeof memberFallback.price === 'number') {
      return { enabled: true, price: memberFallback.price };
    }
  }
  if (role === AttendeeRole.Member || role === AttendeeRole.Instructor) {
    const publicFallback =
      tiers[getPricingTierKey(AttendeeRole.NonMember, attendance, includeVideo, tierType)];
    if (publicFallback && publicFallback.enabled && typeof publicFallback.price === 'number') {
      return { enabled: true, price: publicFallback.price };
    }
  }
  return null;
}

// Deterministically converts a legacy Matrix Product document into EventPricingRules.
export function matrixProductToEventPricingRules(
  rawData: Record<string, unknown>,
): EventPricingRules {
  const tiers = ((rawData['tiers'] as RawTierMap) || {}) as RawTierMap;
  const hasAnyEnabledTiers = Object.values(tiers).some((t) => Boolean(t?.enabled));

  const allowNonMembers =
    rawData['allowNonMembers'] !== undefined ? Boolean(rawData['allowNonMembers']) : true;
  const allowMembers =
    rawData['allowMembers'] !== undefined ? Boolean(rawData['allowMembers']) : true;
  const allowInstructors =
    rawData['allowInstructors'] !== undefined ? Boolean(rawData['allowInstructors']) : true;

  const allowInPerson =
    rawData['allowInPerson'] !== undefined ? Boolean(rawData['allowInPerson']) : true;
  const allowOnline = Boolean(rawData['allowOnline']);
  const allowVideo = Boolean(rawData['allowVideo']);
  const allowVideoOnly = Boolean(rawData['allowVideoOnly']);
  const allowPayInPerson = Boolean(rawData['allowPayInPerson']);

  const hasEarlyBird = Boolean(rawData['hasEarlyBird']);
  const earlyBirdDeadline =
    typeof rawData['earlyBirdDeadline'] === 'string' ? rawData['earlyBirdDeadline'].trim() : '';

  const baselineWho: WhoCondition = !allowNonMembers
    ? !allowMembers && allowInstructors
      ? { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor }
      : { kind: WhoConditionKind.Status, status: PersonStatusKind.Member }
    : { kind: WhoConditionKind.Anyone };

  const maxInPerson =
    typeof rawData['maxInPersonAttendees'] === 'number' &&
    Number.isFinite(rawData['maxInPersonAttendees']) &&
    rawData['maxInPersonAttendees'] > 0
      ? Math.round(rawData['maxInPersonAttendees'])
      : 0;

  const capacities: EventCapacity[] =
    maxInPerson > 0
      ? [
          initEventCapacity({
            id: 'in_person_venue',
            label: 'In-Person Venue',
            description: '',
            limit: maxInPerson,
          }),
        ]
      : [];

  const resolveOptionPricing = (
    attendance: AttendanceType,
  ): {
    who: WhoCondition;
    standardCents: number;
    earlyDiscountCents: number;
    memberDiscountCents: number;
    instructorDiscountCents: number;
  } => {
    const incVid = attendance === AttendanceType.VideoOnly;
    if (!hasAnyEnabledTiers) {
      return {
        who: baselineWho,
        standardCents: 0,
        earlyDiscountCents: 0,
        memberDiscountCents: 0,
        instructorDiscountCents: 0,
      };
    }

    const nonMemStd = allowNonMembers
      ? tiers[getPricingTierKey(AttendeeRole.NonMember, attendance, incVid, PricingTierType.Standard)]
      : undefined;
    const memStd = allowMembers
      ? lookupLegacyTier(tiers, AttendeeRole.Member, attendance, incVid, PricingTierType.Standard)
      : null;
    const instStd = allowInstructors
      ? lookupLegacyTier(tiers, AttendeeRole.Instructor, attendance, incVid, PricingTierType.Standard)
      : null;

    let who: WhoCondition = baselineWho;
    let baseMajor = 0;
    let baseRole = AttendeeRole.NonMember;

    if (allowNonMembers && nonMemStd?.enabled && typeof nonMemStd.price === 'number') {
      who = { kind: WhoConditionKind.Anyone };
      baseMajor = nonMemStd.price;
      baseRole = AttendeeRole.NonMember;
    } else if (allowMembers && memStd?.enabled) {
      who = { kind: WhoConditionKind.Status, status: PersonStatusKind.Member };
      baseMajor = memStd.price;
      baseRole = AttendeeRole.Member;
    } else if (allowInstructors && instStd?.enabled) {
      who = { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor };
      baseMajor = instStd.price;
      baseRole = AttendeeRole.Instructor;
    } else if (allowNonMembers && allowVideo && !incVid) {
      // Fallback if only _video tier was enabled in legacy doc
      const withVid = lookupLegacyTier(tiers, AttendeeRole.NonMember, attendance, true, PricingTierType.Standard);
      if (withVid) baseMajor = withVid.price;
    }

    const standardCents = Math.max(0, Math.round(baseMajor * 100));

    let earlyDiscountCents = 0;
    if (hasEarlyBird && earlyBirdDeadline) {
      const ebTier = lookupLegacyTier(tiers, baseRole, attendance, incVid, PricingTierType.EarlyBird);
      if (ebTier) {
        const ebCents = Math.max(0, Math.round(ebTier.price * 100));
        if (ebCents < standardCents) {
          earlyDiscountCents = standardCents - ebCents;
        }
      }
    }

    const memberCents =
      memStd && who.kind === WhoConditionKind.Anyone
        ? Math.max(0, Math.round(memStd.price * 100))
        : standardCents;
    const instructorCents = instStd
      ? Math.max(0, Math.round(instStd.price * 100))
      : memberCents;

    return {
      who,
      standardCents,
      earlyDiscountCents,
      memberDiscountCents: Math.max(0, standardCents - memberCents),
      instructorDiscountCents: Math.max(0, standardCents - instructorCents),
    };
  };

  const optionSpecs: {
    option: EventRegistrationOption;
    standardCents: number;
    earlyDiscountCents: number;
    memberDiscountCents: number;
    instructorDiscountCents: number;
  }[] = [];

  if (allowInPerson) {
    const info = resolveOptionPricing(AttendanceType.InPerson);
    optionSpecs.push({
      option: initEventRegistrationOption({
        id: 'in_person',
        label: 'In-Person Attendance',
        attendanceType: AttendanceType.InPerson,
        conditions: initEventRuleConditions({ who: info.who }),
        capacityUsage: maxInPerson > 0 ? { in_person_venue: 1 } : {},
      }),
      standardCents: info.standardCents,
      earlyDiscountCents: info.earlyDiscountCents,
      memberDiscountCents: info.memberDiscountCents,
      instructorDiscountCents: info.instructorDiscountCents,
    });
  }

  if (allowOnline) {
    const info = resolveOptionPricing(AttendanceType.Online);
    optionSpecs.push({
      option: initEventRegistrationOption({
        id: 'online',
        label: 'Online Attendance (Live)',
        attendanceType: AttendanceType.Online,
        conditions: initEventRuleConditions({ who: info.who }),
        capacityUsage: {},
      }),
      standardCents: info.standardCents,
      earlyDiscountCents: info.earlyDiscountCents,
      memberDiscountCents: info.memberDiscountCents,
      instructorDiscountCents: info.instructorDiscountCents,
    });
  }

  if (allowInPerson && allowOnline) {
    const info = resolveOptionPricing(AttendanceType.InPerson);
    optionSpecs.push({
      option: initEventRegistrationOption({
        id: 'in_person_and_online',
        label: 'In-Person & Online Attendance',
        attendanceType: AttendanceType.InPersonAndOnline,
        conditions: initEventRuleConditions({ who: info.who }),
        capacityUsage: maxInPerson > 0 ? { in_person_venue: 1 } : {},
      }),
      standardCents: info.standardCents,
      earlyDiscountCents: info.earlyDiscountCents,
      memberDiscountCents: info.memberDiscountCents,
      instructorDiscountCents: info.instructorDiscountCents,
    });
  }

  if (allowVideoOnly) {
    const info = resolveOptionPricing(AttendanceType.VideoOnly);
    optionSpecs.push({
      option: initEventRegistrationOption({
        id: 'video_only',
        label: 'Video Recording Only',
        attendanceType: AttendanceType.VideoOnly,
        conditions: initEventRuleConditions({ who: info.who }),
        capacityUsage: {},
      }),
      standardCents: info.standardCents,
      earlyDiscountCents: info.earlyDiscountCents,
      memberDiscountCents: info.memberDiscountCents,
      instructorDiscountCents: info.instructorDiscountCents,
    });
  }

  if (optionSpecs.length === 0) {
    optionSpecs.push({
      option: initEventRegistrationOption({
        id: 'full_event',
        label: 'Full Event',
        attendanceType: AttendanceType.InPerson,
        conditions: initEventRuleConditions({ who: baselineWho }),
        capacityUsage: maxInPerson > 0 ? { in_person_venue: 1 } : {},
      }),
      standardCents: 0,
      earlyDiscountCents: 0,
      memberDiscountCents: 0,
      instructorDiscountCents: 0,
    });
  }

  const firstSpec = optionSpecs[0];

  const registrationOptions: EventRegistrationOption[] = optionSpecs.map((spec) => ({
    ...spec.option,
    priceCents: spec.standardCents,
  }));

  const earlyDiscountByOptId = new Map<string, number>();
  for (const spec of optionSpecs) {
    if (spec.earlyDiscountCents > 0) {
      earlyDiscountByOptId.set(spec.option.id, spec.earlyDiscountCents);
    }
  }
  const discounts: EventDiscount[] = buildEarlyBirdDiscountsFromOptionMap(
    earlyDiscountByOptId,
    registrationOptions.map((o) => o.id),
  );

  let appliedMemberDiscountCents = 0;
  const maxMemberDiscount = Math.max(
    ...optionSpecs.map((s) => s.memberDiscountCents),
    rawData['hasMemberPrice'] === true ? 1 : 0,
  );
  if (firstSpec.memberDiscountCents > 0) {
    appliedMemberDiscountCents = firstSpec.memberDiscountCents;
  } else if (maxMemberDiscount > 0 && rawData['hasMemberPrice'] !== false) {
    appliedMemberDiscountCents = Math.max(...optionSpecs.map((s) => s.memberDiscountCents));
  }
  if (appliedMemberDiscountCents > 0) {
    discounts.push(
      initEventDiscount({
        id: 'member_discount',
        label: 'ILC Member Discount',
        discountCents: appliedMemberDiscountCents,
        conditions: initEventRuleConditions({
          who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
          registration: { kind: RegistrationConditionKind.AllOptions },
        }),
      }),
    );
  }

  const bestInstDiscount = Math.max(...optionSpecs.map((s) => s.instructorDiscountCents));
  if (bestInstDiscount > 0 && rawData['hasInstructorPrice'] !== false) {
    // Active Instructors also satisfy ActiveMember, so emit the incremental instructor savings above Member.
    const incrementalInstDiscount = Math.max(0, bestInstDiscount - appliedMemberDiscountCents);
    if (incrementalInstDiscount > 0) {
      discounts.push(
        initEventDiscount({
          id: 'instructor_discount',
          label: 'Certified Instructor Discount',
          discountCents: incrementalInstDiscount,
          conditions: initEventRuleConditions({
            who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
            registration: { kind: RegistrationConditionKind.AllOptions },
          }),
        }),
      );
    }
  }

  const addOns: EventAddOn[] = [];
  const liveOptionIds = registrationOptions
    .filter((o) => o.attendanceType !== AttendanceType.VideoOnly)
    .map((o) => o.id);

  if (allowVideo && liveOptionIds.length > 0) {
    let videoDeltaCents = 0;
    if (typeof rawData['videoDeltaPrice'] === 'number' && rawData['videoDeltaPrice'] > 0) {
      videoDeltaCents = Math.round(rawData['videoDeltaPrice'] * 100);
    } else if (hasAnyEnabledTiers) {
      for (const att of [AttendanceType.InPerson, AttendanceType.Online]) {
        for (const r of [AttendeeRole.NonMember, AttendeeRole.Member, AttendeeRole.Instructor]) {
          const noVid = tiers[getPricingTierKey(r, att, false, PricingTierType.Standard)];
          const withVid = tiers[getPricingTierKey(r, att, true, PricingTierType.Standard)];
          if (
            noVid?.enabled &&
            withVid?.enabled &&
            typeof withVid.price === 'number' &&
            typeof noVid.price === 'number' &&
            withVid.price > noVid.price
          ) {
            videoDeltaCents = Math.round((withVid.price - noVid.price) * 100);
            break;
          }
        }
        if (videoDeltaCents > 0) break;
      }
    }

    addOns.push(
      initEventAddOn({
        id: 'event_recording',
        label: 'Event Video Recording',
        description:
          videoDeltaCents === 0 ? 'Included video recording access' : 'Add event video recording access',
        spec: { kind: EventAddOnKind.EventRecording },
        conditions: initEventRuleConditions({
          registration: registrationOptions.some((o) => o.attendanceType === AttendanceType.VideoOnly)
            ? { kind: RegistrationConditionKind.SpecificOptions, optionIds: liveOptionIds }
            : { kind: RegistrationConditionKind.AllOptions },
        }),
        priceCents: videoDeltaCents,
      }),
    );
  }

  return {
    capacities,
    earlyBird:
      hasEarlyBird && earlyBirdDeadline
        ? { kind: EarlyBirdPolicyKind.Enabled, deadlineDate: earlyBirdDeadline }
        : { kind: EarlyBirdPolicyKind.Disabled },
    registrationOptions,
    discounts,
    addOns,
    questions: [],
    payment: {
      allowFullPayment: true,
      depositPolicy: { kind: DepositPolicyKind.Disabled },
      allowZeroDepositInPerson: allowPayInPerson,
    },
  };
}

/**
 * Calculates the major-unit price difference for adding the event's video recording add-on.
 */
export function getVideoDelta(product: Product): number {
  const recordingAddOn = product.pricingRules.addOns.find(
    (a) => a.spec.kind === EventAddOnKind.EventRecording,
  );
  if (recordingAddOn) {
    return recordingAddOn.priceCents / 100;
  }
  return product.videoDeltaPrice > 0 ? product.videoDeltaPrice : 0;
}

/**
 * Returns true if the product includes a free EventRecording add-on ($0).
 */
export function isVideoIncludedForFree(
  product: Product,
  _role?: AttendeeRole,
  attendance?: AttendanceType,
): boolean {
  if (attendance === AttendanceType.VideoOnly) return false;
  const recordingAddOn = product.pricingRules.addOns.find(
    (a) => a.spec.kind === EventAddOnKind.EventRecording,
  );
  return Boolean(recordingAddOn && recordingAddOn.priceCents === 0);
}

/**
 * Detects whether a product has a special discount configured for a given role (Member or Instructor).
 */
export function hasSpecialRolePrice(product: Product, role: AttendeeRole): boolean {
  if (role === AttendeeRole.NonMember) {
    return false;
  }
  const targetKind =
    role === AttendeeRole.Instructor ? PersonStatusKind.Instructor : PersonStatusKind.Member;
  if (
    product.pricingRules.discounts.some(
      (d) =>
        d.conditions.who.kind === WhoConditionKind.Status &&
        d.conditions.who.status === targetKind &&
        d.discountCents > 0,
    )
  ) {
    return true;
  }
  if (role === AttendeeRole.Member) {
    return Boolean(product.hasMemberPrice);
  }
  return Boolean(product.hasInstructorPrice);
}

/**
 * Returns true if the product has special member or instructor pricing.
 */
export function hasAnySpecialPricing(product: Product): boolean {
  return (
    hasSpecialRolePrice(product, AttendeeRole.Member) ||
    hasSpecialRolePrice(product, AttendeeRole.Instructor)
  );
}

// Derives top-level Product summary flags from Product.pricingRules.
export function syncProductSummaryFlagsFromRules(product: Product): Product {
  const rules = product.pricingRules;
  const allowInPerson = rules.registrationOptions.some(
    (o) =>
      o.attendanceType === AttendanceType.InPerson ||
      o.attendanceType === AttendanceType.InPersonAndOnline,
  );
  const allowOnline = rules.registrationOptions.some(
    (o) =>
      o.attendanceType === AttendanceType.Online ||
      o.attendanceType === AttendanceType.InPersonAndOnline,
  );
  const recordingAddOn = rules.addOns.find((a) => a.spec.kind === EventAddOnKind.EventRecording);
  const allowVideoOnly = rules.registrationOptions.some(
    (o) => o.attendanceType === AttendanceType.VideoOnly,
  );
  const allowVideo = Boolean(recordingAddOn) || allowVideoOnly;
  const allowPayInPerson =
    rules.payment.allowZeroDepositInPerson ||
    rules.payment.depositPolicy.kind === DepositPolicyKind.Enabled;
  const hasEarlyBird = rules.earlyBird.kind === EarlyBirdPolicyKind.Enabled;
  const earlyBirdDeadline =
    rules.earlyBird.kind === EarlyBirdPolicyKind.Enabled ? rules.earlyBird.deadlineDate : '';

  const allowNonMembers = rules.registrationOptions.some(
    (o) => o.conditions.who.kind === WhoConditionKind.Anyone,
  );
  const allowMembers = rules.registrationOptions.some(
    (o) =>
      o.conditions.who.kind === WhoConditionKind.Anyone ||
      o.conditions.who.status === PersonStatusKind.Member,
  );

  // Derive legacy maxInPersonAttendees from the first capacity used by an in-person option (if any).
  let maxInPersonAttendees = 0;
  for (const cap of rules.capacities) {
    const usedByInPerson = rules.registrationOptions.some(
      (o) =>
        (o.attendanceType === AttendanceType.InPerson ||
          o.attendanceType === AttendanceType.InPersonAndOnline) &&
        (o.capacityUsage[cap.id] ?? 0) > 0,
    );
    if (usedByInPerson) {
      maxInPersonAttendees = cap.limit;
      break;
    }
  }

  return {
    ...product,
    allowNonMembers,
    allowMembers,
    allowInstructors: true,
    allowInPerson,
    allowOnline,
    allowVideo,
    allowVideoOnly,
    allowPayInPerson,
    hasEarlyBird,
    earlyBirdDeadline,
    videoDeltaPrice: recordingAddOn ? recordingAddOn.priceCents / 100 : 0,
    maxInPersonAttendees,
    hasMemberPrice: rules.discounts.some(
      (d) =>
        d.conditions.who.kind === WhoConditionKind.Status &&
        d.conditions.who.status === PersonStatusKind.Member &&
        d.discountCents > 0,
    ),
    hasInstructorPrice: rules.discounts.some(
      (d) =>
        d.conditions.who.kind === WhoConditionKind.Status &&
        d.conditions.who.status === PersonStatusKind.Instructor &&
        d.discountCents > 0,
    ),
  };
}

export function initProduct(): Product {
  const nowIso = new Date().toISOString();
  return syncProductSummaryFlagsFromRules({
    docId: '',
    title: '',
    description: '',
    descriptionMarkdown: '',
    eventDocId: '',
    currency: 'usd',
    stripeProductId: '',
    pricingRules: initEventPricingRules(),
    capacityCounts: {},
    allowNonMembers: true,
    allowMembers: true,
    allowInstructors: true,
    allowInPerson: true,
    allowOnline: false,
    allowVideo: false,
    allowVideoOnly: false,
    hasMemberPrice: false,
    hasInstructorPrice: false,
    hasEarlyBird: false,
    earlyBirdDeadline: '',
    allowPayInPerson: false,
    videoDeltaPrice: 0,
    maxInPersonAttendees: 0,
    inPersonRegistrationsCount: 0,
    onlineJoiningLink: '',
    purchaseDetailsMarkdown: '',
    inPersonDetailsMarkdown: '',
    recordedVideoId: '',
    recordedVideoUrl: '',
    createdAt: nowIso,
    lastUpdated: nowIso,
  });
}

// Formats a concise human-readable price range summary for any Product.
export function formatProductPriceRange(product: Product): string {
  const currency = (product.currency || 'usd').toUpperCase();
  const rules = product.pricingRules;
  const majorPrices: number[] = [];
  const earlyPolicyEnabled = rules.earlyBird.kind === EarlyBirdPolicyKind.Enabled;

  for (const opt of rules.registrationOptions) {
    const stdCents = Math.max(0, Math.round(opt.priceCents));
    if (stdCents > 0) {
      majorPrices.push(stdCents / 100);
    }
    if (earlyPolicyEnabled) {
      const publicEarlyDiscountSum = rules.discounts
        .filter(
          (d) =>
            d.discountCents > 0 &&
            d.conditions.who.kind === WhoConditionKind.Anyone &&
            d.conditions.timing.kind === TimingConditionKind.Window &&
            d.conditions.timing.window === TimingWindow.BeforeEarlyBird &&
            matchesRegistrationCondition(d.conditions.registration, opt.id),
        )
        .reduce((sum, d) => sum + d.discountCents, 0);
      if (publicEarlyDiscountSum > 0) {
        const earlyCents = applyDiscount(stdCents, publicEarlyDiscountSum);
        if (earlyCents > 0) {
          majorPrices.push(earlyCents / 100);
        }
      }
    }
  }

  if (majorPrices.length === 0) return 'Free / Custom';
  const min = Math.min(...majorPrices);
  const max = Math.max(...majorPrices);
  if (min === max) {
    return `${min.toFixed(2)} ${currency}`;
  }
  return `${min.toFixed(2)} – ${max.toFixed(2)} ${currency}`;
}

export function firestoreDocToProduct(doc: GenericFsDoc): Product {
  const data = (doc.data() as Record<string, unknown>) || {};
  const defaults = initProduct();

  // Interpret legacy Matrix documents (those with `tiers` and without explicit `pricingRules` or with legacy `pricingMode: 'matrix'`)
  // directly into unified EventPricingRules.
  const hasExplicitRules =
    data['pricingRules'] !== undefined &&
    data['pricingRules'] !== null &&
    typeof data['pricingRules'] === 'object' &&
    data['pricingMode'] !== 'matrix';

  const pricingRules = hasExplicitRules
    ? normalizeEventPricingRules(data['pricingRules'])
    : data['tiers'] && typeof data['tiers'] === 'object'
      ? matrixProductToEventPricingRules(data)
      : normalizeEventPricingRules(data['pricingRules']);

  let capacityCounts = normalizeCapacityMap(data['capacityCounts']);
  const legacyInPersonCount =
    typeof data['inPersonRegistrationsCount'] === 'number'
      ? Math.max(0, Math.round(data['inPersonRegistrationsCount']))
      : 0;
  if (
    Object.keys(capacityCounts).length === 0 &&
    legacyInPersonCount > 0 &&
    pricingRules.capacities.some((c) => c.id === 'in_person_venue')
  ) {
    capacityCounts = { in_person_venue: legacyInPersonCount };
  }

  const product: Product = {
    ...defaults,
    docId: doc.id,
    title: typeof data['title'] === 'string' ? data['title'] : defaults.title,
    description: typeof data['description'] === 'string' ? data['description'] : defaults.description,
    descriptionMarkdown:
      typeof data['descriptionMarkdown'] === 'string'
        ? data['descriptionMarkdown']
        : defaults.descriptionMarkdown,
    eventDocId: typeof data['eventDocId'] === 'string' ? data['eventDocId'] : defaults.eventDocId,
    currency: typeof data['currency'] === 'string' && data['currency'] ? data['currency'] : defaults.currency,
    stripeProductId:
      typeof data['stripeProductId'] === 'string' ? data['stripeProductId'] : defaults.stripeProductId,
    pricingRules,
    capacityCounts,
    inPersonRegistrationsCount: legacyInPersonCount,
    onlineJoiningLink:
      typeof data['onlineJoiningLink'] === 'string' ? data['onlineJoiningLink'] : '',
    purchaseDetailsMarkdown:
      typeof data['purchaseDetailsMarkdown'] === 'string' ? data['purchaseDetailsMarkdown'] : '',
    inPersonDetailsMarkdown:
      typeof data['inPersonDetailsMarkdown'] === 'string' ? data['inPersonDetailsMarkdown'] : '',
    recordedVideoId:
      typeof data['recordedVideoId'] === 'string' ? data['recordedVideoId'] : '',
    recordedVideoUrl:
      typeof data['recordedVideoUrl'] === 'string' ? data['recordedVideoUrl'] : '',
    createdAt:
      typeof data['createdAt'] === 'string' && data['createdAt']
        ? data['createdAt']
        : defaults.createdAt,
    lastUpdated: normalizeLastUpdated(data['lastUpdated']) || defaults.lastUpdated,
  };

  return syncProductSummaryFlagsFromRules(product);
}

// ------------------------------------------------------------------
// Event Registrations
// ------------------------------------------------------------------

export enum EventRegistrationStatus {
  Paid = 'paid',
  DepositPaid = 'deposit_paid',
  PendingInPerson = 'pending_in_person',
  Cancelled = 'cancelled',
  Refunded = 'refunded',
}

export enum RegistrationPaymentMethod {
  Stripe = 'stripe',
  InPerson = 'in_person',
}

export type EventRegistrationUpgrade = {
  timestamp: string;
  previousAttendance: AttendanceType;
  previousHasVideoAccess: boolean;
  upgradeAmountCents: number;
  stripeSessionId: string;
};

export type EventRegistration = {
  docId: string;
  eventDocId: string;
  productId: string;
  orderDocId: string;
  stripeSessionId: string;
  registeredAt: string; // ISO timestamp
  name: string;
  email: string;
  phone: string;
  notes: string;
  memberDocId: string;
  memberId: string;
  studentLevel: string;
  applicationLevel: string;
  role: AttendeeRole;
  attendance: AttendanceType;
  hasVideoAccess: boolean;
  amountPaidCents: number;
  amountDueCents: number;
  originalAmountPaidCents: number;
  upgradeHistory: EventRegistrationUpgrade[];
  currency: string;
  status: EventRegistrationStatus;
  paymentMethod: RegistrationPaymentMethod;
  pricingTierType: PricingTierType;
  paidAt: string;
  lastUpdated: string;
  // Rule-based registration details:
  optionId: string;
  optionLabel: string;
  selectedSuboptions: string[];
  selectedAddOnIds: string[];
  selectedAddOnLabels: string[];
  capacityUsage: Record<string, number>;
  paymentChoice: PaymentChoice;
  totalPriceCents: number;
  depositPaidCents: number;
  questionResponses: EventRegistrationQuestionResponse[];
};

export function computeEffectiveCapacityUsage(
  reg: Pick<EventRegistration, 'attendance' | 'capacityUsage'>,
  capacities: EventCapacity[],
): Record<string, number> {
  const explicit = normalizeCapacityMap(reg.capacityUsage);
  if (Object.keys(explicit).length > 0) {
    return explicit;
  }
  if (
    capacities.some((c) => c.id === 'in_person_venue') &&
    (reg.attendance === AttendanceType.InPerson ||
      reg.attendance === AttendanceType.InPersonAndOnline)
  ) {
    return { in_person_venue: 1 };
  }
  return {};
}

export function isEventPast(
  event: { start?: string; end?: string } | null | undefined,
): boolean {
  if (!event) return false;
  const dateStr = event.end || event.start;
  if (!dateStr) return false;
  const isoStr = dateStr.length === 10 ? `${dateStr}T23:59:59` : dateStr;
  const eventDate = new Date(isoStr);
  if (isNaN(eventDate.getTime())) return false;
  return new Date() > eventDate;
}

export function initEventRegistration(): EventRegistration {
  const nowIso = new Date().toISOString();
  return {
    docId: '',
    eventDocId: '',
    productId: '',
    orderDocId: '',
    stripeSessionId: '',
    registeredAt: nowIso,
    name: '',
    email: '',
    phone: '',
    notes: '',
    memberDocId: '',
    memberId: '',
    studentLevel: '',
    applicationLevel: '',
    role: AttendeeRole.NonMember,
    attendance: AttendanceType.InPerson,
    hasVideoAccess: false,
    amountPaidCents: 0,
    amountDueCents: 0,
    originalAmountPaidCents: 0,
    upgradeHistory: [],
    currency: 'usd',
    status: EventRegistrationStatus.Paid,
    paymentMethod: RegistrationPaymentMethod.Stripe,
    pricingTierType: PricingTierType.Standard,
    paidAt: '',
    lastUpdated: nowIso,
    optionId: '',
    optionLabel: '',
    selectedSuboptions: [],
    selectedAddOnIds: [],
    selectedAddOnLabels: [],
    capacityUsage: {},
    paymentChoice: PaymentChoice.Full,
    totalPriceCents: 0,
    depositPaidCents: 0,
    questionResponses: [],
  };
}

export function firestoreDocToEventRegistration(doc: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): EventRegistration {
  const data = doc.data() || {};
  const defaults = initEventRegistration();
  const amountPaidCents =
    typeof data['amountPaidCents'] === 'number' && Number.isFinite(data['amountPaidCents'])
      ? Math.round(data['amountPaidCents'])
      : 0;
  const amountDueCents =
    typeof data['amountDueCents'] === 'number' && Number.isFinite(data['amountDueCents'])
      ? Math.round(data['amountDueCents'])
      : 0;
  const rawTotalPrice = data['totalPriceCents'] ?? data['agreedTotalCents'];

  return {
    ...defaults,
    ...data,
    docId: doc.id,
    phone: typeof data['phone'] === 'string' ? data['phone'] : defaults.phone,
    notes: typeof data['notes'] === 'string' ? data['notes'] : defaults.notes,
    memberDocId: typeof data['memberDocId'] === 'string' ? data['memberDocId'] : defaults.memberDocId,
    memberId: typeof data['memberId'] === 'string' ? data['memberId'] : defaults.memberId,
    studentLevel: typeof data['studentLevel'] === 'string' ? data['studentLevel'] : defaults.studentLevel,
    applicationLevel:
      typeof data['applicationLevel'] === 'string'
        ? data['applicationLevel']
        : defaults.applicationLevel,
    amountPaidCents,
    amountDueCents,
    originalAmountPaidCents:
      typeof data['originalAmountPaidCents'] === 'number' &&
      Number.isFinite(data['originalAmountPaidCents'])
        ? Math.round(data['originalAmountPaidCents'])
        : amountPaidCents,
    upgradeHistory: Array.isArray(data['upgradeHistory'])
      ? (data['upgradeHistory'] as EventRegistrationUpgrade[])
      : [],
    paymentMethod:
      data['paymentMethod'] === RegistrationPaymentMethod.InPerson
        ? RegistrationPaymentMethod.InPerson
        : RegistrationPaymentMethod.Stripe,
    pricingTierType:
      data['pricingTierType'] === PricingTierType.EarlyBird
        ? PricingTierType.EarlyBird
        : data['pricingTierType'] === PricingTierType.InPerson
          ? PricingTierType.InPerson
          : PricingTierType.Standard,
    paidAt: typeof data['paidAt'] === 'string' ? data['paidAt'] : '',
    lastUpdated: normalizeLastUpdated(data['lastUpdated']) || defaults.lastUpdated,
    optionId: typeof data['optionId'] === 'string' ? data['optionId'] : '',
    optionLabel: typeof data['optionLabel'] === 'string' ? data['optionLabel'] : '',
    selectedSuboptions: Array.isArray(data['selectedSuboptions'])
      ? data['selectedSuboptions'].filter((s): s is string => typeof s === 'string')
      : [],
    selectedAddOnIds: Array.isArray(data['selectedAddOnIds'])
      ? data['selectedAddOnIds'].filter((s): s is string => typeof s === 'string')
      : [],
    selectedAddOnLabels: Array.isArray(data['selectedAddOnLabels'])
      ? data['selectedAddOnLabels'].filter((s): s is string => typeof s === 'string')
      : [],
    capacityUsage: normalizeCapacityMap(data['capacityUsage']),
    paymentChoice:
      data['paymentChoice'] === PaymentChoice.Deposit
        ? PaymentChoice.Deposit
        : data['paymentChoice'] === PaymentChoice.PayAtDoor
          ? PaymentChoice.PayAtDoor
          : PaymentChoice.Full,
    totalPriceCents:
      typeof rawTotalPrice === 'number' && Number.isFinite(rawTotalPrice)
        ? Math.round(rawTotalPrice)
        : amountPaidCents + amountDueCents,
    depositPaidCents:
      typeof data['depositPaidCents'] === 'number' && Number.isFinite(data['depositPaidCents'])
        ? Math.round(data['depositPaidCents'])
        : 0,
    questionResponses: normalizeQuestionResponseList(data['questionResponses']),
  };
}

/**
 * Helper to resolve start and end date strings (YYYY-MM-DD) from an IlcEvent.
 */
export function resolveEventDates(evt: IlcEvent): { start: string; end: string } {
  const start = evt.start ? evt.start.split('T')[0] : '';
  const end = evt.end ? evt.end.split('T')[0] : '';
  return { start, end: end || start };
}

export enum EventDigestAttendanceLabel {
  InPersonAndOnline = 'In-Person & Online',
  Online = 'Online',
  InPerson = 'In-Person',
}

export enum EventDigestPriceLabel {
  Paid = 'Paid',
  FreeOrIncluded = 'Free / Included',
}

export type EventDigestItemContext = {
  eventTitle: string;
  eventDates: string;
  eventLocation: string;
  attendanceType: EventDigestAttendanceLabel;
  eventInstructors: string;
  eventPrice: EventDigestPriceLabel;
  eventSummary: string;
  eventDetailsUrl: string;
  appBase: string;
};

export type EventDigestOverallContext = {
  name: string;
  period: string;
  eventsCount: string;
  eventsList: string;
  calendarUrl: string;
  preferencesUrl: string;
  unsubscribeUrl?: string;
  unsubscribeKindName?: string;
  unsubscribeCategoryUrl?: string;
  unsubscribeCategoryName?: string;
  unsubscribeAllUrl?: string;
  appBase: string;
};

/**
 * Builds template replacement parameters for an individual event item card in event digests.
 */
export function formatEventDigestItemContext(
  evt: IlcEvent,
  appBase = 'https://app.iliqchuan.com',
): EventDigestItemContext {
  const eventDocId = evt.docId;
  const { start: startDate, end: endDate } = resolveEventDates(evt);
  const dates =
    startDate === endDate || !endDate
      ? startDate || ''
      : `${startDate} - ${endDate}`;
  const hasOnline = Boolean(evt.onlineJoiningLink && evt.onlineJoiningLink.trim());
  const hasInPerson = Boolean(
    (evt.location && evt.location.trim()) ||
      (evt.inPersonDetailsMarkdown && evt.inPersonDetailsMarkdown.trim()),
  );
  const attendanceType =
    hasInPerson && hasOnline
      ? EventDigestAttendanceLabel.InPersonAndOnline
      : hasOnline
        ? EventDigestAttendanceLabel.Online
        : EventDigestAttendanceLabel.InPerson;

  const contactsList = (evt.contacts || []).map((c) => c.name).filter(Boolean);
  if (contactsList.length === 0 && evt.ownerName) {
    contactsList.push(evt.ownerName);
  }
  const instructors = contactsList.join(', ') || 'ILC Instructors';

  const rawDesc = evt.descriptionMarkdown || evt.description || '';
  const cleanDesc = rawDesc.replace(/<[^>]*>?/gm, '').trim();
  const summary = cleanDesc
    ? cleanDesc.length > 200
      ? cleanDesc.slice(0, 197) + '...'
      : cleanDesc
    : '';
  const detailsUrl = `${appBase}/events/${eventDocId}`;

  const price = evt.productId
    ? EventDigestPriceLabel.Paid
    : EventDigestPriceLabel.FreeOrIncluded;

  return {
    eventTitle: evt.title || 'Untitled Event',
    eventDates: dates,
    eventLocation: evt.location || (hasOnline ? 'Online via Zoom' : 'TBD'),
    attendanceType,
    eventInstructors: instructors,
    eventPrice: price,
    eventSummary: summary,
    eventDetailsUrl: detailsUrl,
    appBase,
  };
}
