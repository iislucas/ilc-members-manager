import { Timestamp } from 'firebase/firestore';

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
  Life = 'Life', // includes from spouse of a Life member.
  Senior = 'Senior',
  Student = 'Student',
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
  lastUpdated: Timestamp; // ISO string: YYYY-MM-DD...

  schoolId: string; // ILC HQ issued School Id
  schoolName: string; // School name
  schoolAddress: string; // Address line of the school
  schoolCity: string; // City address line of the school
  schoolZipCode: string; // Zip or postcode of the school
  schoolCountry: string; // Country the School is in
  schoolWebsite: string; // Optional website URL

  // The `memberId` of the owner of this school; can set the managers, and
  // change anything in the school.
  owner: string;
  // The `memberId`s of people allowed to manage people within this school.
  managers: string[];
};

// Members are in firestore path /member/{email} (they use email as the doc id).
export type Member = {
  id: string; // Document ID, UNIQUE, should be the same as email.
  lastUpdated: Timestamp; // ISO string: YYYY-MM-DD...

  isAdmin: boolean;

  // Internal ILC HQ Information
  memberId: string; // ILC Member Id: UNIQUE

  sifuInstructorId: string; // ILC issues Instructor ID of the member's Sifu
  // SchoolID managing this member. If empty, managed by HQ.
  managingOrgId: string;

  membershipType: MembershipType;
  firstMembershipStarted: string; // YYYY-MM-DD, or empty if unknown.
  lastRenewalDate: ''; // YYYY-MM-DD, or empty if none.
  currentMembershipExpires: string; // Date membership expires

  // Personal & Contact information
  name: string; // Full name
  address: string; // Mailing address
  city: string; // Country of residence
  zipCode: string; // Country of residence
  country: string; // Country of residence
  phone: string; // Phone number
  email: string; // Contact email, UNIQUE

  gender: string; // Male/Female/whatever string they choose.
  dateOfBirth: string; // Date of birth

  publicEmail: string; // publicly listed email address for contacting them
  publicPhone: string; // publicly listed phone number for contacting them
  publicRegionOrCity: string; // publicly listed area/city
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

  // Notes only for ILC HQ.
  notes: string;
};

// Public information about instructors; mirrored from the member data into
// firestore path /instructorsPublic/{instructorId}
export type InstructorPublicData = {
  id: string; // Firebase document ID. Unique. Should be instructorId.

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
  // ILC HQ issued a unique instructor ID, empty = not instructor.
  instructorId: string;

  publicRegionOrCity: string;
  country: string;

  publicEmail: string;
  publicPhone: string;
};

// ==================================================================
// # Initial values for Schools and Members
// ==================================================================

export function initMember(): Member {
  return {
    // Unique ID, should be same as email.
    id: '',
    lastUpdated: Timestamp.now(), // ISO string...

    isAdmin: false,

    // Personal & Contact information
    name: '', // The person's full name, first name first.
    address: '', // Mailing address
    city: '', // Mailing address
    zipCode: '', // Mailing address
    country: '', // Country of residence
    phone: '', // optional.
    email: '', // Unique and equal to the id.

    gender: '', // Male/Female/whatever string they choose.
    dateOfBirth: '', // Date of birth: YYYY-MM-DD

    publicEmail: '',
    publicPhone: '',
    publicRegionOrCity: '', // publicly listed area/city
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

    // Level information
    // empty string indicates none graded yet.
    studentLevel: StudentLevel.None, // e.g., 'Certified Instructor', 'Student Teacher'
    applicationLevel: ApplicationLevel.None, // e.g., 'Level 1', 'Level 2'
    mastersLevels: [], // a set of masters levels the person has.

    // Notes - information only for ILC HQ management.
    notes: '',
  };
}

export function initSchool(): School {
  return {
    id: '',
    lastUpdated: Timestamp.now(), // ISO string...

    schoolId: '',
    schoolName: '',
    schoolAddress: '',
    schoolCity: '',
    schoolZipCode: '',
    schoolCountry: '',
    schoolWebsite: '',
    owner: '',
    managers: [],
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
    country: '',
    publicEmail: '',
    publicPhone: '',
  };
}

// ==================================================================
// # API Request types
// ==================================================================

// Used for login to know what kind of user this is.
export type FetchUserDetailsResult = {
  userMemberData: Member;
  isAdmin: boolean;
  schoolsManaged: string[];
};
