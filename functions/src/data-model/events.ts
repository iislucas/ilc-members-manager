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
  maxInPersonAttendees?: number; // Optional in-person capacity limit (0 or unset for unlimited)
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
    maxInPersonAttendees: 0,
    inPersonRegistrationsCount: 0,
    updatedByEmail: '',
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
  const fallbackEmail = event.ownerEmails && event.ownerEmails.length > 0 ? event.ownerEmails[0] : '';
  const hasOwner = memberDocId !== '' || Boolean(event.ownerName) || Boolean(contactEmail) || Boolean(contactUrl);
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
// Products & Pricing Matrix for Classes, Workshops & Events
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

export type ProductPricingTier = {
  role: AttendeeRole;
  attendance: AttendanceType;
  includeVideo: boolean;
  tierType?: PricingTierType;
  enabled: boolean;
  price: number; // in standard currency units (e.g. 50.00)
};

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
  descriptionMarkdown?: string;
  eventDocId: string; // Linked IlcEvent docId (or '' if standalone)
  currency: string; // e.g. 'usd'
  stripeProductId?: string; // Optional linked Stripe product
  allowNonMembers: boolean;
  allowMembers: boolean;
  allowInstructors: boolean;
  allowInPerson: boolean;
  allowOnline: boolean;
  allowVideo: boolean;
  allowVideoOnly: boolean;
  hasMemberPrice?: boolean;
  hasInstructorPrice?: boolean;
  hasEarlyBird?: boolean;
  earlyBirdDeadline?: string; // YYYY-MM-DD cutoff date (paying online before/on this date)
  lateDeltaPrice?: number; // Extra fee for registering after early-bird deadline
  allowPayInPerson?: boolean; // Whether paying in person at event is enabled
  hasDoorDelta?: boolean; // Whether an extra charge applies for paying at the door
  doorDeltaPrice?: number; // Extra fee for paying at the door
  videoDeltaPrice?: number; // Extra fee for video recording add-on
  maxInPersonAttendees?: number; // Optional capacity limit for in-person attendance
  inPersonRegistrationsCount?: number; // Maintained by trigger
  onlineJoiningLink?: string;
  purchaseDetailsMarkdown?: string;
  inPersonDetailsMarkdown?: string;
  recordedVideoId?: string;
  recordedVideoUrl?: string;
  tiers: Record<string, { enabled: boolean; price: number }>;
  createdAt?: string;
  lastUpdated?: string;
};

/**
 * Calculates the price difference for adding video recording access to an event.
 * If product.videoDeltaPrice is set to a positive number, returns that value.
 * If product.videoDeltaPrice is 0, returns 0.
 * If product.videoDeltaPrice is undefined, inspects enabled tiers with video vs without video.
 * Returns 0 if video is included for free or product does not allow video.
 */
export function getVideoDelta(
  product: Product,
  role?: AttendeeRole,
  attendance?: AttendanceType,
  tierType?: PricingTierType,
): number {
  if (!product.allowVideo) return 0;
  if (typeof product.videoDeltaPrice === 'number' && product.videoDeltaPrice > 0) {
    return product.videoDeltaPrice;
  }

  if (!product.tiers) return 0;

  const rolesToCheck = role
    ? [role, AttendeeRole.NonMember, AttendeeRole.Member, AttendeeRole.Instructor]
    : [AttendeeRole.NonMember, AttendeeRole.Member, AttendeeRole.Instructor];

  const attendancesToCheck = attendance && attendance !== AttendanceType.VideoOnly
    ? [attendance, AttendanceType.Online, AttendanceType.InPerson]
    : [AttendanceType.Online, AttendanceType.InPerson];

  const tierTypesToCheck = tierType
    ? [tierType, PricingTierType.Standard, PricingTierType.EarlyBird]
    : [PricingTierType.Standard, PricingTierType.EarlyBird];

  for (const att of attendancesToCheck) {
    for (const r of rolesToCheck) {
      for (const tt of tierTypesToCheck) {
        const noVidKey = getPricingTierKey(r, att, false, tt);
        const withVidKey = getPricingTierKey(r, att, true, tt);
        const noVidTier = product.tiers[noVidKey];
        const withVidTier = product.tiers[withVidKey];
        if (
          noVidTier?.enabled &&
          withVidTier?.enabled &&
          typeof withVidTier.price === 'number' &&
          typeof noVidTier.price === 'number'
        ) {
          const diff = withVidTier.price - noVidTier.price;
          if (diff > 0) {
            return diff;
          }
        }
      }
    }
  }

  return 0;
}

/**
 * Returns true if the event allows video and video recording is included for free
 * (i.e. no extra charge for video access).
 */
export function isVideoIncludedForFree(
  product: Product,
  role?: AttendeeRole,
  attendance?: AttendanceType,
  tierType?: PricingTierType,
): boolean {
  if (!product.allowVideo) return false;
  if (attendance === AttendanceType.VideoOnly) return false;
  return getVideoDelta(product, role, attendance, tierType) <= 0;
}

/**
 * Detects whether a product has a special price configured for a given role (Member or Instructor)
 * that differs from the standard NonMember price.
 */
export function hasSpecialRolePrice(product: Product, role: AttendeeRole): boolean {
  if (role === AttendeeRole.NonMember) {
    return false;
  }
  if (role === AttendeeRole.Member && typeof product.hasMemberPrice === 'boolean') {
    return product.hasMemberPrice;
  }
  if (role === AttendeeRole.Instructor && typeof product.hasInstructorPrice === 'boolean') {
    return product.hasInstructorPrice;
  }

  // Fallback / legacy inspection: inspect enabled tiers across attendance modes
  if (!product.tiers) return false;
  const attendances = [
    AttendanceType.InPerson,
    AttendanceType.Online,
    AttendanceType.VideoOnly,
  ];
  const tierTypes = [
    PricingTierType.Standard,
    PricingTierType.EarlyBird,
  ];

  for (const att of attendances) {
    const videoOptions = att === AttendanceType.VideoOnly ? [true] : [false, true];
    for (const incVid of videoOptions) {
      for (const tt of tierTypes) {
        const roleKey = getPricingTierKey(role, att, incVid, tt);
        const roleTier = product.tiers[roleKey];
        if (roleTier?.enabled) {
          const stdKey = getPricingTierKey(AttendeeRole.NonMember, att, incVid, tt);
          const stdTier = product.tiers[stdKey];
          if (!stdTier || !stdTier.enabled || roleTier.price !== stdTier.price) {
            return true;
          }
        }
      }
    }
  }

  return false;
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

export function initProduct(): Product {
  const tiers: Record<string, { enabled: boolean; price: number }> = {};
  const roles: AttendeeRole[] = [
    AttendeeRole.NonMember,
    AttendeeRole.Member,
    AttendeeRole.Instructor,
  ];
  const attendances: AttendanceType[] = [
    AttendanceType.InPerson,
    AttendanceType.Online,
  ];
  for (const r of roles) {
    for (const a of attendances) {
      tiers[getPricingTierKey(r, a, false)] = { enabled: true, price: 0 };
      tiers[getPricingTierKey(r, a, true)] = { enabled: true, price: 0 };
      tiers[getPricingTierKey(r, a, false, PricingTierType.EarlyBird)] = { enabled: true, price: 0 };
      tiers[getPricingTierKey(r, a, true, PricingTierType.EarlyBird)] = { enabled: true, price: 0 };
      if (a === AttendanceType.InPerson) {
        tiers[getPricingTierKey(r, a, false, PricingTierType.InPerson)] = { enabled: true, price: 0 };
        tiers[getPricingTierKey(r, a, true, PricingTierType.InPerson)] = { enabled: true, price: 0 };
      }
    }
    tiers[getPricingTierKey(r, AttendanceType.VideoOnly, true)] = { enabled: false, price: 0 };
    tiers[getPricingTierKey(r, AttendanceType.VideoOnly, true, PricingTierType.EarlyBird)] = { enabled: false, price: 0 };
  }
  return {
    docId: '',
    title: '',
    description: '',
    descriptionMarkdown: '',
    eventDocId: '',
    currency: 'usd',
    stripeProductId: '',
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
    lateDeltaPrice: 0,
    allowPayInPerson: false,
    hasDoorDelta: false,
    doorDeltaPrice: 0,
    videoDeltaPrice: 0,
    maxInPersonAttendees: 0,
    inPersonRegistrationsCount: 0,
    onlineJoiningLink: '',
    purchaseDetailsMarkdown: '',
    inPersonDetailsMarkdown: '',
    recordedVideoId: '',
    recordedVideoUrl: '',
    tiers,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

export function firestoreDocToProduct(doc: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): Product {
  const data = doc.data() || {};
  const defaults = initProduct();
  return {
    ...defaults,
    ...data,
    docId: doc.id,
    tiers: {
      ...defaults.tiers,
      ...((data['tiers'] as Record<string, { enabled: boolean; price: number }>) || {}),
    },
  };
}

// ------------------------------------------------------------------
// Event Registrations
// ------------------------------------------------------------------

export enum EventRegistrationStatus {
  Paid = 'paid',
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
  phone?: string;
  notes?: string;
  memberDocId?: string;
  memberId?: string;
  studentLevel?: string;
  applicationLevel?: string;
  role: AttendeeRole;
  attendance: AttendanceType;
  hasVideoAccess: boolean;
  amountPaidCents: number;
  amountDueCents?: number;
  originalAmountPaidCents?: number;
  upgradeHistory?: EventRegistrationUpgrade[];
  currency: string;
  status: EventRegistrationStatus;
  paymentMethod?: RegistrationPaymentMethod;
  pricingTierType?: PricingTierType;
  paidAt?: string;
  lastUpdated?: string;
};

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
  return {
    docId: '',
    eventDocId: '',
    productId: '',
    orderDocId: '',
    stripeSessionId: '',
    registeredAt: new Date().toISOString(),
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
    currency: 'usd',
    status: EventRegistrationStatus.Paid,
    paymentMethod: RegistrationPaymentMethod.Stripe,
    pricingTierType: PricingTierType.Standard,
    lastUpdated: new Date().toISOString(),
  };
}

export function firestoreDocToEventRegistration(doc: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): EventRegistration {
  const data = doc.data() || {};
  return {
    ...initEventRegistration(),
    ...data,
    docId: doc.id,
  };
}
