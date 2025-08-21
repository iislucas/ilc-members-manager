import { Timestamp } from 'firebase/firestore';

// 'annual' | 'life' | 'senior' | 'student' | 'deceased' | 'inactive'
export enum MembershipType {
  Annual = 'Annual',
  Life = 'Life',
  Senior = 'Senior',
  Student = 'Student',
  Deceased = 'Deceased',
  Inactive = 'Inactive',
}

export interface School {
  id: string; // Document ID, UNIQUE, firebase managed.

  schoolId: ''; // ILC HQ issued Schhol Id
  schoolName: ''; // School name
  schoolAddress: ''; // Address line of the school
  schoolCity: ''; // City address line of the school
  schoolZipCode: ''; // Zip or postcode of the school
  schoolCountry: ''; // Country the School is in

  schoolWebsite: ''; // Optional website URL
}

export interface Member {
  id: string; // Document ID, UNIQUE, should be the same as email.
  isAdmin: boolean;

  // Internal ILC HQ Information
  membershipType: MembershipType;
  membershipExpires: string; // Date membership expires
  memberId: string; // ILC Member Id: UNIQUE
  sifuMemberId: string; // ILC issues Instructor ID of the member's Sifu

  // Contact information
  name: string; // Full name
  address: string; // Mailing address
  city: string; // Country of residence
  zipCode: string; // Country of residence
  country: string; // Country of residence
  phone: string; // Phone number
  email: string; // Contact email, UNIQUE

  // Level information
  studentLevel: string; // e.g., 'Certified Instructor', 'Student Teacher'
  applicationLevel: string; // e.g., 'Level 1', 'Level 2'
  mastersLevels: string; // Unclear how to annotate this...? string[]?

  // Instructor information.
  //
  // ILC HQ issued unique instructor ID, empty = not instructor.
  // TODO: why not make this the same as member Id?
  instructorId: string;
  // Date instructor license expires; string version of Date, YYYY-MM-DD; We
  // use strings not Timestmp because this allows a null value of empty
  // string.
  instructorLicenseExpires: string; // Date instructor license expires
  instructorWebsite: string; // Optional website URL
  instructorSchoolId: string; // is an instructor in this school ID

  // School information.
  //
  // The Id of the school being managed. Multiple people may be managers for the
  // same school.
  // Assumes: a person can only be a school manager for ONE school.
  schoolIdManaged: string; // ILC HQ issued unique school ID

  // Country manager
  //
  // The Id of the country this person is a manager for. Multiple people may be
  // managers for the same country.
  // Assumes: a person can only be a country manager for ONE country.
  countryManaged: string; // ILC HQ issued country Id
}

export function initMember(): Member {
  return {
    // Unique ID, should be same as email.
    id: '',
    isAdmin: false,

    // Contact information
    name: '', // The person's full name, first name first.
    address: '', // Mailing address
    city: '', // Mailing address
    zipCode: '', // Mailing address
    country: '', // Country of residence
    phone: '', // optional.
    email: '', // Unique and equal to the id.

    // Student membership status
    membershipType: MembershipType.Annual,
    membershipExpires: '',
    memberId: '',
    sifuMemberId: '', // ILC Member Number of the member's Sifu

    // Instructor details
    instructorId: '', // must not be empty is isInstructor is true.
    // Date instructor license expires; string version of Date, YYYY-MM-DD; We
    // use strings not Timestmp because this allows a null value of empty
    // string.
    instructorLicenseExpires: '',
    instructorWebsite: '', // Optional website URL
    instructorSchoolId: '',

    // Level information
    // empty string indicates none graded yet.
    studentLevel: '', // e.g., 'Certified Instructor', 'Student Teacher'
    applicationLevel: '', // e.g., 'Level 1', 'Level 2'
    mastersLevels: '', //

    // School information.
    schoolIdManaged: '', // ILC HQ issued unique school ID

    // Country information
    countryManaged: '', // Associated country, if applicable
  };
}
