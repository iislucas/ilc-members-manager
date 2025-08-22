// 'annual' | 'life' | 'senior' | 'student' | 'deceased' | 'inactive'
export enum MembershipType {
  Annual = 'Annual',
  Life = 'Life', // includes from spouse of a Life member.
  Senior = 'Senior',
  Student = 'Student',
  Deceased = 'Deceased',
  Inactive = 'Inactive',
}

export enum StudentLevel {
  None = 'None',
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
  None = 'None',
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

export interface School {
  id: string; // Document ID, UNIQUE, firebase managed.

  schoolId: ''; // ILC HQ issued School Id
  schoolName: ''; // School name
  schoolAddress: ''; // Address line of the school
  schoolCity: ''; // City address line of the school
  schoolZipCode: ''; // Zip or postcode of the school
  schoolCountry: ''; // Country the School is in
  schoolWebsite: ''; // Optional website URL

  // The name of the owner of this school; can set the managers, and change
  // anything in the school.
  owner: '';
  // The emails of people allowed to manage people within this school.
  managers: [];
}

// This is used to represent a country that has delegated management.
export interface CountryManagement {
  id: string; // Document ID, UNIQUE, firebase managed.

  countryName: ''; // The name of the country.

  // The name of the owner for this country; they can set the managers, and
  // change anything in the country.
  owner: '';
  // The emails of people allowed to manage members within this country.
  managers: [];
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
  instructorWebsite: string; // Optional website URL

  // Notes only for ILC HQ.
  notes: string;
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
    instructorLicenseExpires: '', // YYYY-MM-DD, or empty if none.
    instructorWebsite: '', // Optional website URL

    // Level information
    // empty string indicates none graded yet.
    studentLevel: StudentLevel.None, // e.g., 'Certified Instructor', 'Student Teacher'
    applicationLevel: ApplicationLevel.None, // e.g., 'Level 1', 'Level 2'
    mastersLevels: [], // a set of masters levels the person has.

    // Notes - information only for ILC HQ management.
    notes: '',
  };
}
