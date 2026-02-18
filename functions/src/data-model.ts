import {
  DocumentSnapshot,
  QueryDocumentSnapshot,
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
that are have listed the instructor as their primary instructor. 
This allows for efficient queries of by an instrutcor of all their students.
Both {instructorMemberDocId} and {studentMemberDocId} should correspond to 
entries in the /members/{memberDocId}.

## /counters/singleton : Counters

These counters are used to generate unique IDs for new members and instructors.

## /countries/singleton : CountryCodes

This document contains a map of country names to their 2-letter ISO codes.

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

// ==================================================================
// # COUNTERS
// ==================================================================
// All counters are stored in a single document for atomic updates.
// Firestore path: /counters/singleton
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

export type CountryCodes = {
  codes: { [countryName: string]: string };
};

export enum MembershipType {
  Annual = 'Annual',
  Life = 'Life',
  LifePartner = 'LifeByPartner', // spouse of a Life member.
  Senior = 'Senior',
  Student = 'Student',
  Minor = 'Minor',
  Deceased = 'Deceased',
  Inactive = 'Inactive',
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

// ==================================================================
// # Schools and Members
// ==================================================================

// Firestore path: /school/{doc-id}
export type School = {
  id: string; // Document ID, UNIQUE, firebase managed.
  lastUpdated: string; // ISO string: YYYY-MM-DD; Converted to/from Timestamp on server.

  schoolId: string; // ILC HQ issued School Id
  schoolName: string; // School name
  schoolAddress: string; // Address line of the school
  schoolCity: string; // City address line of the school
  schoolZipCode: string; // Zip or postcode of the school
  schoolCountyOrState: string; // County or State
  schoolCountry: string; // Country the School is in
  schoolWebsite: string; // Optional website URL

  // The `memberId` (human readable) of the owner of this school; can set the managers, and
  // change anything in the school.
  owner: string;
  // The `memberId`s (human readable) of people allowed to manage people within this school.
  managers: string[];

  // Redundant email addresses for firestore rules.
  ownerEmail: string;
  managerEmails: string[];

  // School License
  schoolLicenseRenewalDate: string; // YYYY-MM-DD
  schoolLicenseExpires: string; // YYYY-MM-DD
};

export type SchoolFirebaseDoc = Omit<School, 'lastUpdated' | 'id'> & {
  lastUpdated: Timestamp;
};

export function firestoreDocToSchool(doc: QueryDocumentSnapshot): School {
  const docData = doc.data() as SchoolFirebaseDoc;
  // There's a short time after a write happens where
  // memberData.lastUpdated is full before the server timestamp gets
  // the actual data back.
  const lastUpdated = docData.lastUpdated
    ? docData.lastUpdated.toDate().toISOString()
    : new Date().toISOString();
  return { ...initSchool(), ...docData, lastUpdated, id: doc.id };
}

// Members are in firestore path /member/{email} (they use email as the doc id).
export type Member = {
  // Note this is needed by SearchableSet.
  id: string; // Firestore document ID, UNIQUE, auto-generated.

  lastUpdated: string; // ISO string: YYYY-MM-DD ; Converted from server Timestamp;

  isAdmin: boolean;

  // Internal ILC HQ Information
  memberId: string; // ILC Member Id (human readable): UNIQUE
  // Note: This is NOT the document ID.

  sifuInstructorId: string; // ILC issues Instructor ID of the member's Sifu
  // SchoolID managing this member. If empty, managed by HQ.
  managingOrgId: string;

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

  // Notes only for ILC HQ.
  notes: string;
};

export type MemberFirestoreDoc = Omit<Member, 'lastUpdated' | 'id'> & {
  lastUpdated: Timestamp;
};

export function firestoreDocToMember(doc: QueryDocumentSnapshot): Member {
  const docData = doc.data() as MemberFirestoreDoc;
  // There's a short time after a write happens where
  // memberData.lastUpdated is full before the server timestamp gets
  // the actual data back.
  const lastUpdated = docData.lastUpdated
    ? docData.lastUpdated.toDate().toISOString()
    : new Date().toISOString();
  return { ...initMember(), ...docData, lastUpdated, id: doc.id };
}

// Public information about instructors; mirrored from the member data into
// firestore path /instructors/{instructorId}
export type InstructorPublicData = {
  // Note this is needed by SearchableSet.
  id: string; // Firebase document ID. Unique. This is not the same as instructorId.

  name: string; // Full name
  memberId: string; // ILC Member Id: UNIQUE
  instructorWebsite: string; // Optional website URL

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

  publicRegionOrCity: string;
  publicCountyOrState: string;
  country: string;

  publicEmail: string;
  publicPhone: string;
  tags: string[];
};

export type InstructorPublicDataFirebaseDoc = Omit<InstructorPublicData, 'id'>;

export function firestoreDocToInstructorPublicData(
  doc: QueryDocumentSnapshot,
): InstructorPublicData {
  const docData = doc.data() as InstructorPublicDataFirebaseDoc;
  return { ...initInstructor(), ...docData, id: doc.id };
}

// ==================================================================
// # Orders
// ==================================================================

// Firestore path: /orders/{doc-id}
export type Order = {
  id: string; // Firestore ID
  lastUpdated: string; // ISO string

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

export type OrderFirebaseDoc = Omit<Order, 'lastUpdated' | 'id'> & {
  lastUpdated: Timestamp;
};

export function firestoreDocToOrder(doc: QueryDocumentSnapshot): Order {
  const docData = doc.data() as OrderFirebaseDoc;
  const lastUpdated = docData.lastUpdated
    ? docData.lastUpdated.toDate().toISOString()
    : new Date().toISOString();
  return { ...initOrder(), ...docData, lastUpdated, id: doc.id };
}

// ==================================================================
// # Initial values for Schools and Members
// ==================================================================

export function initMember(): Member {
  return {
    // Firestore auto-generated document ID.
    id: '',
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

    // Student membership status
    memberId: '',
    sifuInstructorId: '', // ILC Member Number of the member's Sifu
    managingOrgId: '', // Default to HQ

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

    // Notes - information only for ILC HQ management.
    notes: '',
  };
}

export function initSchool(): School {
  return {
    id: '',
    lastUpdated: new Date().toISOString(), // // ISO string...

    schoolId: '',
    schoolName: '',
    schoolAddress: '',
    schoolCity: '',
    schoolZipCode: '',
    schoolCountyOrState: '',
    schoolCountry: '',
    schoolWebsite: '',
    owner: '',
    managers: [],
    ownerEmail: '',
    managerEmails: [],
    schoolLicenseRenewalDate: '',
    schoolLicenseExpires: '',
  };
}

export function initOrder(): Order {
  return {
    id: '',
    lastUpdated: new Date().toISOString(),
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

export function initInstructor(): InstructorPublicData {
  return {
    id: '',
    name: '',
    memberId: '',
    instructorWebsite: '',
    studentLevel: StudentLevel.None,
    applicationLevel: ApplicationLevel.None,
    mastersLevels: [],
    instructorId: '',
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
// # API Request types
// ==================================================================

// Used for login to know what kind of user this is.
export type FetchUserDetailsResult = {
  userMemberProfiles: Member[];
  isAdmin: boolean;
  schoolsManaged: string[];
};
