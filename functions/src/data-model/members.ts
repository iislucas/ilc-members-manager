import { FsTimestamp, GenericFsDoc, normalizeLastUpdated } from './base';
import {
  StudentLevel,
  ApplicationLevel,
  MasterLevel,
  InstructorLicenseType,
} from './curriculum';
import { MemberNotificationSettings } from './notifications';

export * from './member-status';
import { MembershipType } from './member-status';


// A single Web Push subscription for one of a member's devices/browsers.
// Firestore path: /members/{memberDocId}/pushSubscriptions/{subId}
// The {subId} is a SHA-256 hash of the endpoint so the same device re-subscribing
// overwrites its entry rather than creating duplicates. Written by the client
// (via SwPush) and read/pruned by the push-sending Cloud Function.
export type PushSubscriptionDoc = {
  docId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string; // ISO string
  userAgent?: string;
};

export enum SubscriptionItemType {
  Membership = 'membership',
  InstructorLicense = 'instructor_license',
  SchoolLicense = 'school_license',
  VideoLibrary = 'video_library',
  Vod = 'vod',
}

export enum SubscriptionStatus {
  Active = 'active',
  Trialing = 'trialing',
  PastDue = 'past_due',
  Canceled = 'canceled',
  Unpaid = 'unpaid',
  Incomplete = 'incomplete',
}

export enum SubscriptionInterval {
  Month = 'month',
  Year = 'year',
}

export interface MemberSubscriptionItem {
  subscriptionId: string; // Stripe sub_... ID
  type: SubscriptionItemType;
  status: SubscriptionStatus;
  planName: string; // e.g. "Annual Membership", "Class Video Library"
  amount: number; // in currency minor units (cents)
  currency: string; // e.g. 'usd'
  interval: SubscriptionInterval;
  currentPeriodStart: string; // YYYY-MM-DD
  currentPeriodEnd: string; // YYYY-MM-DD (when current access expires)
  nextAutoRenewDate: string; // YYYY-MM-DD or '' if cancelled
  cancelAtPeriodEnd: boolean; // true if renewal was cancelled
  canceledAt?: string; // YYYY-MM-DD or ISO string if cancelled
  stripePriceId?: string;
  stripeProductId?: string;
}

export type StripeSubscriptions = Record<string, MemberSubscriptionItem>;

// Members are in firestore path /member/{email} (they use email as the doc id).
export type Member = {
  // Note this is needed by SearchableSet.
  docId: string; // Firestore document ID, UNIQUE, auto-generated.

  lastUpdated: string; // ISO string: YYYY-MM-DD ; Converted from server Timestamp;

  /**
   * @deprecated Admin privilege is a property of the login email in `/acl/{email}`, not the member profile.
   * Kept optional for backwards compatibility.
   */
  isAdmin?: boolean;

  // Internal ILC HQ Information
  memberId: string; // ILC Member Id (human readable): UNIQUE
  // Note: This is NOT the document ID.

  primaryInstructorId: string; // ILC issues Instructor ID of the member's Sifu
  // SchoolID managing this member. If empty, managed by HQ.
  primarySchoolId: string;
  // School document ID managing this member. Used for firestore.rules and structured lookups.
  // Set programmatically whenever the primarySchoolId is changed.
  primarySchoolDocId: string;

  membershipType: MembershipType;
  firstMembershipStarted: string; // YYYY-MM-DD, or empty if unknown.
  lastRenewalDate: string; // YYYY-MM-DD, or empty if none.
  currentMembershipExpires: string; // Date membership expires
  membershipNextAutoRenewDate: string; // YYYY-MM-DD, or empty if not auto-renewing
  membershipSubscriptionId: string; // Active Stripe subscription ID or empty

  // Personal & Contact information
  name: string; // Full name
  address: string; // Mailing address
  city: string; // Country of residence
  zipCode: string; // Country of residence
  countyOrState: string; // County or State
  country: string; // Country of residence
  phone: string; // Phone number
  emails: string[]; // List of contact email addresses, UNIQUE across members? (Business rule: each email maps to one member? No, one email can manage multiple. But a member has multiple emails)

  gender: string; // Male/Female/whatever string they choose.
  dateOfBirth: string; // Date of birth

  publicEmail: string; // publicly listed email address for contacting them
  publicPhone: string; // publicly listed phone number for contacting them
  publicRegionOrCity: string; // publicly listed area/city
  publicCountyOrState: string; // publicly listed county or state
  instructorWebsite: string; // Optional website URL
  publicClassGoogleCalendarId: string; // Optional Google Calendar ID for public class schedule

  // Public instructor profile media (shown on the instructor's public page).
  // URLs point to Firebase Storage under instructors/{docId}/images/.
  publicProfileImageUrl: string; // Square profile picture (large, e.g. 400x400).
  publicProfileImageThumbUrl: string; // Square profile thumbnail (e.g. 96x96), used in cards.
  publicCoverImageUrl: string; // Cover/banner image (e.g. 1200x450).
  // Markdown self-description shown on the instructor's public profile page.
  publicBioMarkdown: string;

  // Level information
  studentLevel: StudentLevel; // e.g., 'Certified Instructor', 'Student Teacher'
  applicationLevel: ApplicationLevel; // e.g., 'Level 1', 'Level 2'
  // Saved as a string list to allow search within these.
  mastersLevels: MasterLevel[];

  // Instructor information.
  //
  // ILC HQ issued a unique instructor ID, empty = not instructor.
  instructorId: string;
  // Date instructor license expires; string version of Date, YYYY-MM-DD; We
  // use strings not Timestmp because this allows a null value of empty
  // string.
  instructorLicenseExpires: string; // YYYY-MM-DD, or empty if none.
  instructorLicenseType: InstructorLicenseType;
  instructorLicenseRenewalDate: string; // YYYY-MM-DD, or empty if none.
  instructorLicenseNextAutoRenewDate: string; // YYYY-MM-DD, or empty if not auto-renewing
  instructorLicenseSubscriptionId: string; // Active Stripe subscription ID or empty

  // A list of tags for the member.
  tags: string[];

  // A list of grading document IDs for gradings the student has purchased.
  gradingDocIds: string[];

  // Class Video Library
  classVideoLibrarySubscription: boolean;
  classVideoLibraryLastRenewalDate: string; // YYYY-MM-DD
  classVideoLibraryExpirationDate: string; // YYYY-MM-DD or empty if never expires
  classVideoLibraryNextAutoRenewDate: string; // YYYY-MM-DD, or empty if not auto-renewing
  classVideoLibrarySubscriptionId: string; // Active Stripe subscription ID or empty

  // Stripe customer identity
  stripeCustomerId: string; // Stripe cus_... ID or empty

  // Structured active subscriptions map
  stripeSubscriptions?: StripeSubscriptions;

  // Notes only for ILC HQ.
  notes: string;

  // Scheduled Deletion Date (YYYY-MM-DD), empty if not scheduled.
  scheduledDeletionDate: string;

  notificationSettings?: MemberNotificationSettings;
};

export type MemberFsDoc = Omit<Member, 'lastUpdated' | 'docId'> & {
  lastUpdated: FsTimestamp;
};

export type MemberUpdates = Omit<Partial<Member>, 'lastUpdated' | 'docId'> & {
  lastUpdated?: FsTimestamp;
};

export function initMember(): Member {
  return {
    docId: '',
    lastUpdated: new Date().toISOString(),
    isAdmin: false,
    name: '',
    address: '',
    city: '',
    zipCode: '',
    countyOrState: '',
    country: '',
    phone: '',
    emails: [],
    gender: '',
    dateOfBirth: '',
    publicEmail: '',
    publicPhone: '',
    publicRegionOrCity: '',
    publicCountyOrState: '',
    instructorWebsite: '',
    publicClassGoogleCalendarId: '',
    publicProfileImageUrl: '',
    publicProfileImageThumbUrl: '',
    publicCoverImageUrl: '',
    publicBioMarkdown: '',
    memberId: '',
    primaryInstructorId: '',
    primarySchoolId: '',
    primarySchoolDocId: '',
    membershipType: MembershipType.Annual,
    firstMembershipStarted: '',
    lastRenewalDate: '',
    currentMembershipExpires: '',
    membershipNextAutoRenewDate: '',
    membershipSubscriptionId: '',
    instructorId: '',
    instructorLicenseExpires: '',
    instructorLicenseType: InstructorLicenseType.None,
    instructorLicenseRenewalDate: '',
    instructorLicenseNextAutoRenewDate: '',
    instructorLicenseSubscriptionId: '',
    studentLevel: StudentLevel.None,
    applicationLevel: ApplicationLevel.None,
    mastersLevels: [],
    tags: [],
    gradingDocIds: [],
    classVideoLibrarySubscription: false,
    classVideoLibraryLastRenewalDate: '',
    classVideoLibraryExpirationDate: '',
    classVideoLibraryNextAutoRenewDate: '',
    classVideoLibrarySubscriptionId: '',
    stripeCustomerId: '',
    stripeSubscriptions: {},
    notes: '',
    scheduledDeletionDate: '',
    notificationSettings: {
      pushEnabled: {},
      homeEnabled: {},
    },
  };
}

export function firestoreDocToMember(doc: GenericFsDoc): Member {
  const docData = (doc.data() || {}) as Partial<MemberFsDoc>;
  const lastUpdated = normalizeLastUpdated(docData.lastUpdated);

  return {
    ...initMember(),
    ...docData,
    emails: Array.isArray(docData.emails) ? docData.emails : [],
    lastUpdated,
    docId: doc.id,
  };
}

// Public information about instructors; mirrored from the member data into
// firestore path /instructors/{instructorId}
export type InstructorPublicData = {
  docId: string; // Firebase document ID. Unique. This is not the same as instructorId.
  name: string; // Full name
  memberId: string; // ILC Member Id: UNIQUE
  instructorWebsite: string; // Optional website URL
  publicClassGoogleCalendarId: string; // Optional Google Calendar ID for public class schedule
  publicProfileImageUrl: string; // Square profile picture (large).
  publicProfileImageThumbUrl: string; // Square profile thumbnail, used in cards.
  publicCoverImageUrl: string; // Cover/banner image (e.g. 1200x450).
  publicBioMarkdown: string; // Markdown self-description.
  studentLevel: StudentLevel; // e.g., 'Certified Instructor', 'Student Teacher'
  applicationLevel: ApplicationLevel; // e.g., 'Level 1', 'Level 2'
  mastersLevels: MasterLevel[];
  instructorId: string;
  instructorLicenseType: InstructorLicenseType;
  instructorLicenseExpires: string; // YYYY-MM-DD or '9999-12-31' for Life
  publicRegionOrCity: string;
  publicCountyOrState: string;
  country: string;
  publicEmail: string;
  publicPhone: string;
  tags: string[];
  lastUpdated: string; // ISO 8601 UTC string (YYYY-MM-DDTHH:mm:ss.sssZ)
};

export type InstructorPublicDataFsDoc = Omit<InstructorPublicData, 'lastUpdated' | 'docId'> & {
  lastUpdated: FsTimestamp;
};

export function initInstructor(): InstructorPublicData {
  return {
    docId: '',
    name: '',
    memberId: '',
    instructorWebsite: '',
    publicClassGoogleCalendarId: '',
    publicProfileImageUrl: '',
    publicProfileImageThumbUrl: '',
    publicCoverImageUrl: '',
    publicBioMarkdown: '',
    studentLevel: StudentLevel.None,
    applicationLevel: ApplicationLevel.None,
    mastersLevels: [],
    instructorId: '',
    instructorLicenseType: InstructorLicenseType.None,
    instructorLicenseExpires: '',
    publicRegionOrCity: '',
    publicCountyOrState: '',
    country: '',
    publicEmail: '',
    publicPhone: '',
    tags: [],
    lastUpdated: new Date().toISOString(),
  };
}

export function firestoreDocToInstructorPublicData(
  doc: GenericFsDoc,
): InstructorPublicData {
  const docData = (doc.data() || {}) as Partial<InstructorPublicDataFsDoc> & { lastUpdated?: unknown };
  const lastUpdated = normalizeLastUpdated(docData?.lastUpdated);
  return { ...initInstructor(), ...docData, lastUpdated, docId: doc.id };
}
