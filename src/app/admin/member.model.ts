import { Timestamp } from 'firebase/firestore';

export interface Member {
  id: string; // Document ID, UNIQUE
  isAdmin: boolean;
  // Internal ILC HQ Information
  internal: {
    lastPaymentDate: Timestamp; // Date of last payment
    lastPaymentAmount: number; // Amount of last payment
    lastPaymentId: number; // Squarespace ID for last patyent
    membershipExpires: Timestamp; // Date membership expires
    memberId: string; // ILC Member Id: UNIQUE
    isInstructor?: boolean; // Is the member a certified instructor?
    instructorLicenseExpires?: Timestamp; // Date instructor license expires
    sifuName?: string; // Name of the member's Sifu
    sifuMemberId?: string; // ILC Member Number of the member's Sifu
  };

  // Publicly Listed Information
  public: {
    name: string; // Full name
    email: string; // Contact email, UNIQUE
    website?: string; // Optional website URL
    address?: string; // Mailing address
    phone?: string; // Phone number
    country: string; // Country of residence
    studentLevel: string; // e.g., 'Certified Instructor', 'Student Teacher'
    applicationLevel: string; // e.g., 'Level 1', 'Level 2'
    isSchoolManager: boolean; // Is the member a school manager?
    schoolName?: string; // Associated school name, if applicable
    isCountryManager: boolean; // Is the member a country manager?
    countryManaged?: string; // Associated country, if applicable
  };
}
