import {
  Timestamp,
} from 'firebase/firestore';

// ==================================================================
// # Collections in Firebase
// ==================================================================
/* 

Admins can read and write to all documents.

## /acl/{email} : ACL

Stored the ACLs for a given login email address. It specifies a 
number of members (via their Doc ID in /members/{memberDocId}) that 
this email owns. It also caches if any of those members are an "admin". 
This is readable only by "admins", and by the user that logs in with this 
email. It is writable only by "admins".

## /members/{memberDocId} : Member

This is the primary document for a member. It contains all the 
information about a member, including their name, address, phone, 
email, and other contact information. It is readable by a user that logs 
in with one of the emails associated with this member. 
It is fully writable only by "admins", although a subset of the fields can 
be edited by a user who is logged in as one of this member's emails.

## /schools/{schoolDocId} : School

This document contains public information about a school, including its name, 
address, and contact information. The public information is readable by anyone.
Admins can update the information, and a school manager or owner can also 
write some of the fields.

### /schools/{schoolDocId}/members/{memberDocId}: Member

This document is cached member information (from /members/{memberDocId})
for members of this school. This allows for efficient queries of 
all members of a school by school owners and managers.

## /instructors/{memberDocId} : InstructorPublic

The /instructors/ collection stores cached public information 
for each "instructor" member in /members/{memberDocId} (for each that 
has an `instructorId` that is not empty and `instructorLicenseExpires` 
is in the future). They hold the public profile information of 
instructors, e.g. their contact information.

## /instructors/{instructorMemberDocId}/members/{studentMemberDocId}: Member

This document is cached member information (from /members/{memberDocId})
that has listed the instructor as their primary instructor. 
This allows for efficient queries by an instructor of all their students.
Both {instructorMemberDocId} and {studentMemberDocId} should correspond to 
entries in the /members/{memberDocId}.

## /system/counters : Counters

These counters are used to generate unique IDs for new members and instructors.

## /system/country-codes : CountryCodes

This document contains a map of country names to their 2-letter ISO codes.

## /system/squarespaceSync : SquarespaceSync

This document contains the sync timestamp for the squarespace orders poller.

# Namespaces for IDs: 

 - DocIds: These are the firestore document IDs, and are not human readable.
    - MemberDocId: The document ID for a member in the /members/ collection.
    - InstructorDocId: The document ID for an instructor in the /instructors/ 
      collection. Every instructor is also a member, so this will be the same 
      as a MemberDocId.
    - SchoolDocId: The document ID for a school in the /schools/ collection.
  - MemberId: The ILC headquareters member ID for a member. This is a human 
    readable namespace.
  - InstructorId: The ILC headquareters instructorID. This is a human-readable 
    namespace.
  - SchoolId: The ILC headquareters school ID. This is a human-readable 
    namespace.

*/

export type GenericFirestoreDoc = { data: () => unknown, id: string };

// ==================================================================
// # COUNTERS
// ==================================================================
// All counters are stored in a single document for atomic updates.
// Firestore path: /system/counters
//
export type Counters = {
  // A map from 2-letter country code to the last assigned member ID number.
  memberIdCounters: { [countryCode: string]: number };

  // The last assigned instructor ID number.
  instructorIdCounter: number;
  schoolIdCounter: number;
};

// ==================================================================
// # Enums & Helper Types
// ==================================================================
export enum MembershipType {
  Annual = 'Annual',
  Life = 'Life',
  Deceased = 'Deceased',
  Inactive = 'Inactive',
}

/** Status of a membership or license expiry. */
export enum ExpiryStatus {
  Valid = 'valid',
  Recent = 'recent',
  Expired = 'expired',
  Issue = 'issue',
}

/** Age-based membership category, inferred from date of birth. */
export enum AgeCategory {
  None = '',
  Under21 = 'Under 21',
  Senior = 'Senior',
}

export enum StudentLevel {
  None = '',
  Entry = 'Entry',
  Level1 = '1',
  Level2 = '2',
  Level3 = '3',
  Level4 = '4',
  Level5 = '5',
  Level6 = '6',
  Level7 = '7',
  Level8 = '8',
  Level9 = '9',
  Level10 = '10',
  Level11 = '11',
}

export enum ApplicationLevel {
  None = '',
  Level1 = '1',
  Level2 = '2',
  Level3 = '3',
  Level4 = '4',
  Level5 = '5',
  Level6 = '6',
}

export enum InstructorLicenseType {
  None = 'None',
  Annual = 'Annual',
  Life = 'Life',
}

export enum MasterLevel {
  Good = 'Good Hands',
  Wonder = 'Wonder Hands',
  Mystery = 'Mystery Hands',
  Compassion = 'Compassion Hands',
}

export enum MemberIdUpdateStatus {
  Pending = 'pending',
  Stable = 'stable',
}

export enum GradingStatus {
  Pending = 'pending',
  Passed = 'passed',
  NotPassed = 'not-passed',
  RequiresReview = 'in-review',
}

// ==================================================================
// # Schools and Members
// ==================================================================

// Firestore path: /school/{doc-id}
export type School = {
  docId: string; // Document ID, UNIQUE, auto-generated Firebase ID.
  lastUpdated: string; // ISO string: YYYY-MM-DD; Converted to/from Timestamp on server.

  schoolId: string; // ILC HQ issued School Id
  schoolName: string; // School name
  schoolAddress: string; // Address line of the school
  schoolCity: string; // City address line of the school
  schoolZipCode: string; // Zip or postcode of the school
  schoolCountyOrState: string; // County or State
  schoolCountry: string; // Country the School is in
  schoolWebsite: string; // Optional website URL
  schoolClassGoogleCalendarId: string; // Optional Google Calendar ID for public class schedule

  // The `instructorId` (human readable) of the owner of this school; can set the managers, and
  // change anything in the school.
  ownerInstructorId: string;
  // The `instructorId`s (human readable) of people allowed to manage people within this school.
  managerInstructorIds: string[];

  // Redundant email addresses for firestore rules.
  ownerEmails: string[];
  managerEmails: string[];

  // School License
  schoolLicenseRenewalDate: string; // YYYY-MM-DD
  schoolLicenseExpires: string; // YYYY-MM-DD
};

export type SchoolFirebaseDoc = Omit<School, 'lastUpdated' | 'docId'> & {
  lastUpdated: Timestamp;
};

export function firestoreDocToSchool(doc: GenericFirestoreDoc): School {
  const docData = doc.data() as SchoolFirebaseDoc & {
    owner?: string;
    managers?: string[];
    ownerEmail?: string;
  };
  // There's a short time after a write happens where
  // memberData.lastUpdated is full before the server timestamp gets
  // the actual data back.
  const lastUpdated = docData.lastUpdated
    ? typeof docData.lastUpdated.toDate === 'function' ? docData.lastUpdated.toDate().toISOString() : new Date(docData.lastUpdated as unknown as string).toISOString()
    : new Date().toISOString();

  const ownerInstructorId = docData.ownerInstructorId || docData.owner || '';
  const managerInstructorIds = docData.managerInstructorIds || docData.managers || [];
  // TODO: legacy: remove once full migration to ownerEmails is complete
  const ownerEmails = docData.ownerEmails && docData.ownerEmails.length > 0 ? docData.ownerEmails : (docData.ownerEmail ? [docData.ownerEmail] : []);

  return { ...initSchool(), ...docData, ownerInstructorId, managerInstructorIds, ownerEmails, lastUpdated, docId: doc.id };
}

// Members are in firestore path /member/{email} (they use email as the doc id).
export type Member = {
  // Note this is needed by SearchableSet.
  docId: string; // Firestore document ID, UNIQUE, auto-generated.

  lastUpdated: string; // ISO string: YYYY-MM-DD ; Converted from server Timestamp;

  isAdmin: boolean;

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

  // A list of tags for the member.
  tags: string[];

  // A list of grading document IDs for gradings the student has purchased.
  gradingDocIds: string[];

  // Class Video Library
  classVideoLibrarySubscription: boolean;
  classVideoLibraryLastRenewalDate: string; // YYYY-MM-DD
  classVideoLibraryExpirationDate: string; // YYYY-MM-DD or empty if never expires

  // Notes only for ILC HQ.
  notes: string;
};

export type MemberFirestoreDoc = Omit<Member, 'lastUpdated' | 'docId'> & {
  lastUpdated: Timestamp;
};

export function firestoreDocToMember(doc: GenericFirestoreDoc): Member {
  const docData = doc.data() as MemberFirestoreDoc & {
    managingOrgId?: string;
    sifuInstructorId?: string;
  };
  // There's a short time after a write happens where
  // memberData.lastUpdated is full before the server timestamp gets
  // the actual data back.
  const lastUpdated = docData.lastUpdated
    ? typeof docData.lastUpdated.toDate === 'function' ? docData.lastUpdated.toDate().toISOString() : new Date(docData.lastUpdated as unknown as string).toISOString()
    : new Date().toISOString();

  const primarySchoolId = docData.primarySchoolId || docData.managingOrgId || '';
  const primaryInstructorId = docData.primaryInstructorId || docData.sifuInstructorId || '';

  return { ...initMember(), ...docData, primarySchoolId, primaryInstructorId, lastUpdated, docId: doc.id };
}

// Public information about instructors; mirrored from the member data into
// firestore path /instructors/{instructorId}
export type InstructorPublicData = {
  // Note this is needed by SearchableSet.
  docId: string; // Firebase document ID. Unique. This is not the same as instructorId.

  name: string; // Full name
  memberId: string; // ILC Member Id: UNIQUE
  instructorWebsite: string; // Optional website URL
  publicClassGoogleCalendarId: string; // Optional Google Calendar ID for public class schedule

  // Level information
  studentLevel: StudentLevel; // e.g., 'Certified Instructor', 'Student Teacher'
  applicationLevel: ApplicationLevel; // e.g., 'Level 1', 'Level 2'
  // Saved as a string list to allow search within these.
  mastersLevels: MasterLevel[];

  // Instructor information.
  //
  // This is a human-readable instructor ID, not the same as the Firebase document ID.
  // ILC HQ issued a unique instructor ID, empty = not instructor.
  instructorId: string;
  instructorLicenseType: InstructorLicenseType;
  instructorLicenseExpires: string; // YYYY-MM-DD or '9999-12-31' for Life

  publicRegionOrCity: string;
  publicCountyOrState: string;
  country: string;

  publicEmail: string;
  publicPhone: string;
  tags: string[];
};

export type InstructorPublicDataFirebaseDoc = Omit<InstructorPublicData, 'docId'>;

export function firestoreDocToInstructorPublicData(
  doc: GenericFirestoreDoc,
): InstructorPublicData {
  const docData = doc.data() as InstructorPublicDataFirebaseDoc;
  return { ...initInstructor(), ...docData, docId: doc.id };
}

// ==================================================================
// # Orders
// ==================================================================

export type OrderStatus = 'processed' | 'needs-manual-processing' | 'error' | 'ignore';

export type OrderKind =
  | 'https://api.squarespace.com/1.0/commerce/orders'
  | 'ilc-2005-sheets-db-import';

export type BaseOrder = {
  docId: string; // Firestore ID
  // lastUpdated tracks when the order was created or generated (e.g. datePaid for old sheets, createdOn for Squarespace).
  // It is used for chronological sorting of orders across both old Google Sheets imports and Squarespace webhooks.
  lastUpdated: string; // ISO string
  ilcAppOrderKind?: OrderKind;
  ilcAppOrderStatus?: OrderStatus;
  ilcAppOrderIssues?: string[];
  // Free-form admin notes, editable from the order detail UI.
  ilcAppNotes?: string;
};

// Firestore path: /orders/{doc-id}
export type SheetsImportOrder = BaseOrder & {
  ilcAppOrderKind: 'ilc-2005-sheets-db-import';
  orderType: string; // From CSV (column 'order')
  referenceNumber: string; // From CSV
  externalId: string; // From CSV (matches memberId)
  studentOf: string; // From CSV
  paidFor: string; // From CSV
  newRenew: string; // From CSV
  datePaid: string; // From CSV (YYYY-MM-DD)
  startDate: string; // From CSV (YYYY-MM-DD)
  lastName: string; // From CSV
  firstName: string; // From CSV
  email: string; // From CSV
  country: string; // From CSV
  state: string; // From CSV
  costUsd: string; // From CSV
  collected: string; // From CSV
  split: string; // From CSV
  notes: string; // From CSV
};

export interface SquareSpaceCustomization {
  label?: string;
  value?: string;
}

export interface SquareSpaceVariantOption {
  optionName?: string;
  value?: string;
}

export interface SquareSpaceLineItem {
  id: string;
  sku: string;
  productId?: string;
  productName?: string;
  variantOptions?: SquareSpaceVariantOption[];
  customizations?: SquareSpaceCustomization[];
  quantity: string;
  unitPricePaid: { value: string; }
  // ILC App processing fields added to SquarespaceLineItem.
  ilcAppProcessingStatus?: OrderStatus;
  ilcAppProcessingIssue?: string;
  // Manually set or auto-inferred member ID, used as a fallback when the
  // Squarespace form's "Member ID" field is missing or incorrect. Admins
  // can set this via the order detail UI, or it can be automatically
  // inferred by matching the order's email + date of birth to a member.
  ilcAppMemberIdInferred?: string;
  // When the order is processed successfully and changes an expiry date,
  // these fields record the renewal date and new expiry date that were set.
  ilcAppNewLastRenewalDate?: string; // YYYY-MM-DD
  ilcAppNewExpiryDate?: string; // YYYY-MM-DD
  // Snapshot of the member/school's renewal and expiry dates before this
  // order was processed. Written once at processing time so reprocessing
  // does not overwrite the original baseline.
  ilcAppPreOrderRenewalDate?: string; // YYYY-MM-DD
  ilcAppPreOrderExpiryDate?: string; // YYYY-MM-DD
}

export type SquareSpaceOrder = BaseOrder & {
  ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders';
  id: string; // Squarespace UUID — used in API endpoint URLs (e.g. /orders/{id}/fulfillments)
  orderNumber: string;
  createdOn: string;
  modifiedOn: string;
  customerEmail: string;
  billingAddress?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    countryCode?: string;
  };
  // This is the squarespace fullfillment status.
  fulfillmentStatus: 'FULFILLED' | 'PENDING' | 'CANCELED';
  lineItems?: SquareSpaceLineItem[];
}

export type Order = SheetsImportOrder | SquareSpaceOrder;

export type SheetsImportOrderFirebaseDoc = Omit<SheetsImportOrder, 'lastUpdated' | 'docId'> & {
  lastUpdated: Timestamp;
};

export type SquarespaceOrderFirebaseDoc = Omit<SquareSpaceOrder, 'lastUpdated' | 'docId'> & {
  lastUpdated: Timestamp;
};

export type OrderFirebaseDoc = SheetsImportOrderFirebaseDoc | SquarespaceOrderFirebaseDoc;

export function firestoreDocToOrder(doc: GenericFirestoreDoc): Order {
  const docData = doc.data() as OrderFirebaseDoc;
  const lastUpdated = docData.lastUpdated
    ? typeof docData.lastUpdated.toDate === 'function' ? docData.lastUpdated.toDate().toISOString() : new Date(docData.lastUpdated as unknown as string).toISOString()
    : new Date().toISOString();

  if (!docData.ilcAppOrderKind || docData.ilcAppOrderKind === 'ilc-2005-sheets-db-import') {
    return { ...initSheetsImportOrder(), ...docData, ilcAppOrderKind: 'ilc-2005-sheets-db-import', lastUpdated, docId: doc.id } as SheetsImportOrder;
  }
  return { ...docData, lastUpdated, docId: doc.id } as Order;
}

// ==================================================================
// # Initial values for Schools and Members
// ==================================================================

export function initMember(): Member {
  return {
    // Firestore auto-generated document ID.
    docId: '',
    lastUpdated: new Date().toISOString(), // ISO string...

    isAdmin: false,

    // Personal & Contact information
    name: '', // The person's full name, first name first.
    address: '', // Mailing address
    city: '', // Mailing address
    zipCode: '', // Mailing address
    countyOrState: '', // County or State
    country: '', // Country of residence
    phone: '', // optional.
    emails: [], // List of emails.

    gender: '', // Male/Female/whatever string they choose.
    dateOfBirth: '', // Date of birth: YYYY-MM-DD

    publicEmail: '',
    publicPhone: '',
    publicRegionOrCity: '', // publicly listed area/city
    publicCountyOrState: '', // publicly listed county or state
    instructorWebsite: '', // Optional publicly listed website URL
    publicClassGoogleCalendarId: '', // Optional Google Calendar ID for public class schedule

    // Student membership status
    memberId: '',
    primaryInstructorId: '', // ILC Member Number of the member's Sifu
    primarySchoolId: '', // Default to HQ
    primarySchoolDocId: '', // should be set programatically.

    membershipType: MembershipType.Annual,
    firstMembershipStarted: '', // YYYY-MM-DD, or empty if unknown.
    lastRenewalDate: '', // YYYY-MM-DD, or empty if none.
    currentMembershipExpires: '', // YYYY-MM-DD, or empty if none.

    // Instructor details
    instructorId: '', // must not be empty is isInstructor is true.
    // Date instructor license expires; string version of Date, YYYY-MM-DD; We
    // use strings not Timestmp because this allows a null value of empty
    // string.
    instructorLicenseExpires: '', // YYYY-MM-DD, or empty if none.
    instructorLicenseType: InstructorLicenseType.None,
    instructorLicenseRenewalDate: '', // YYYY-MM-DD, or empty if none.

    // Level information
    // empty string indicates none graded yet.
    studentLevel: StudentLevel.None, // e.g., 'Certified Instructor', 'Student Teacher'
    applicationLevel: ApplicationLevel.None, // e.g., 'Level 1', 'Level 2'
    mastersLevels: [], // a set of masters levels the person has.
    tags: [],
    gradingDocIds: [],

    // Class Video Library
    classVideoLibrarySubscription: false,
    classVideoLibraryLastRenewalDate: '',
    classVideoLibraryExpirationDate: '',

    // Notes - information only for ILC HQ management.
    notes: '',
  };
}

export function initSchool(): School {
  return {
    docId: '',
    lastUpdated: new Date().toISOString(), // // ISO string...

    schoolId: '',
    schoolName: '',
    schoolAddress: '',
    schoolCity: '',
    schoolZipCode: '',
    schoolCountyOrState: '',
    schoolCountry: '',
    schoolWebsite: '',
    schoolClassGoogleCalendarId: '',
    ownerInstructorId: '',
    managerInstructorIds: [],
    ownerEmails: [],
    managerEmails: [],
    schoolLicenseRenewalDate: '',
    schoolLicenseExpires: '',
  };
}

export function initSheetsImportOrder(): SheetsImportOrder {
  return {
    docId: '',
    lastUpdated: new Date().toISOString(),
    ilcAppOrderKind: 'ilc-2005-sheets-db-import',
    orderType: '',
    referenceNumber: '',
    externalId: '',
    studentOf: '',
    paidFor: '',
    newRenew: '',
    datePaid: '',
    startDate: '',
    lastName: '',
    firstName: '',
    email: '',
    country: '',
    state: '',
    costUsd: '',
    collected: '',
    split: '',
    notes: '',
  };
}

// ==================================================================
// # Gradings
// ==================================================================

// Firestore path: /gradings/{doc-id}
export type Grading = {
  docId: string; // Firestore document ID, UNIQUE, auto-generated.
  lastUpdated: string; // ISO string: YYYY-MM-DD; Converted from server Timestamp.

  gradingPurchaseDate: string; // YYYY-MM-DD, the date the grading was purchased.
  orderId: string; // The order ID that created this grading, or '' if manual.
  level: string; // The level the grading is aimed for ('Student X' or 'Application X').
  gradingInstructorId: string; // The instructorId (human readable) of the grading instructor.
  assistantInstructorIds: string[]; // InstructorIds of assistant instructors.
  schoolId: string; // The human-readable schoolId where the grading was conducted. Optional.
  studentMemberId: string; // The human-readable memberId of the student being graded.
  studentMemberDocId: string; // The Firestore doc ID of the student member document.
  status: GradingStatus; // pending, passed, rejected.
  gradingEventDate: string; // YYYY-MM-DD, set when grading is conducted.
  gradingEvent: string; // Text string for event/location/date of the grading.
  notes: string; // Any notes about the grading.
};

export type GradingFirebaseDoc = Omit<Grading, 'lastUpdated' | 'docId'> & {
  lastUpdated: Timestamp;
};

export function firestoreDocToGrading(doc: GenericFirestoreDoc): Grading {
  const docData = doc.data() as GradingFirebaseDoc;
  const lastUpdated = docData.lastUpdated
    ? typeof docData.lastUpdated.toDate === 'function' ? docData.lastUpdated.toDate().toISOString() : new Date(docData.lastUpdated as unknown as string).toISOString()
    : new Date().toISOString();
  return { ...initGrading(), ...docData, lastUpdated, docId: doc.id };
}

export function initGrading(): Grading {
  return {
    docId: '',
    lastUpdated: new Date().toISOString(),
    gradingPurchaseDate: '',
    orderId: '',
    level: '',
    gradingInstructorId: '',
    assistantInstructorIds: [],
    schoolId: '',
    studentMemberId: '',
    studentMemberDocId: '',
    status: GradingStatus.Pending,
    gradingEventDate: '',
    gradingEvent: '',
    notes: '',
  };
}

export function initInstructor(): InstructorPublicData {
  return {
    docId: '',
    name: '',
    memberId: '',
    instructorWebsite: '',
    publicClassGoogleCalendarId: '',
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
  };
}

// ==================================================================
// # ACL
// ==================================================================
// Firestore path: /acl/{email}
// Maps an email to the member IDs it is allowed to manage.
export type ACL = {
  memberDocIds: string[];
  instructorIds: string[];
  isAdmin: boolean;
};

export type ACLFirebaseDoc = ACL;

// ==================================================================
// # Statistics
// ==================================================================
// Firestore path: /statistics/{YYYY-MM}
// Monthly snapshots of aggregate member/instructor statistics.

// A histogram is a map from string keys to counts.
export type Histogram = { [key: string]: number };
// A map of named histograms (e.g. one histogram per product category).
export type HistogramMap = { [category: string]: Histogram };

export type MemberStatistics = {
  docId: string; // Firestore document ID, e.g. '2026-03'
  date: string; // ISO date string when the statistics were computed.

  // Summary counts
  totalMembers: number;
  activeMembers: number; // Members with valid (non-expired) annual or life memberships.
  activeInstructors: number; // Members with a non-empty instructorId and valid instructor license.

  // Histograms for enum fields
  membershipTypeHistogram: Histogram; // Keys are MembershipType values.
  studentLevelHistogram: Histogram; // Keys are StudentLevel values.
  applicationLevelHistogram: Histogram; // Keys are ApplicationLevel values.
  instructorLicenseTypeHistogram: Histogram; // Keys are InstructorLicenseType values.
  countryHistogram: Histogram; // Keys are country names.
  mastersLevelHistogram: Histogram; // Keys are MasterLevel values.

  // Expiry date histograms, keyed by YYYY-MM.
  membershipExpiryHistogram: Histogram; // Annual members' currentMembershipExpires by month.
  schoolLicenseExpiryHistogram: Histogram; // Schools' schoolLicenseExpires by month.
  instructorLicenseExpiryHistogram: Histogram; // Instructor license expiry by month.
  videoLibraryExpiryHistogram: Histogram; // Video library subscription expiry by month.

  // Squarespace order line items by product category and month (YYYY-MM).
  // Outer keys are human-readable product category names (e.g. 'Membership', 'School License').
  // Inner histograms map YYYY-MM to the count of line items in that month.
  squarespaceOrdersByProductMonthly: HistogramMap;

  // Data quality counters for fields that may be missing or malformed.
  dataQuality: {
    missingMastersLevels: number; // Members where mastersLevels is undefined/null.
    nonArrayMastersLevels: number; // Members where mastersLevels is present but not an array (e.g. a string).
  };
};

export type MemberStatisticsFirebaseDoc = Omit<MemberStatistics, 'docId'>;

export function firestoreDocToStatistics(doc: GenericFirestoreDoc): MemberStatistics {
  const docData = doc.data() as MemberStatisticsFirebaseDoc;
  return { ...initStatistics(), ...docData, docId: doc.id };
}

export function initStatistics(): MemberStatistics {
  return {
    docId: '',
    date: '',
    totalMembers: 0,
    activeMembers: 0,
    activeInstructors: 0,
    membershipTypeHistogram: {},
    studentLevelHistogram: {},
    applicationLevelHistogram: {},
    instructorLicenseTypeHistogram: {},
    countryHistogram: {},
    mastersLevelHistogram: {},
    membershipExpiryHistogram: {},
    schoolLicenseExpiryHistogram: {},
    instructorLicenseExpiryHistogram: {},
    videoLibraryExpiryHistogram: {},
    squarespaceOrdersByProductMonthly: {},
    dataQuality: {
      missingMastersLevels: 0,
      nonArrayMastersLevels: 0,
    },
  };
}

// ==================================================================
// # API Request types
// ==================================================================

// Used for login to know what kind of user this is.
export type FetchUserDetailsResult = {
  userMemberProfiles: Member[];
  isAdmin: boolean;
  schoolsManaged: string[];
};
