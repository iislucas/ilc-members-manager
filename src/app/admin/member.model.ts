import { Timestamp } from 'firebase/firestore';

export interface Member {
  id: string; // Document ID
  isAdmin: boolean;
  // Internal ILC HQ Information
  internal: {
    lastPaymentDate: Timestamp; // Date of last payment
    lastPaymentAmount: number; // Amount of last payment
    lastPaymentId: number; // Squarespace ID for last patyent
    membershipExpires: Timestamp; // Date membership expires
  };

  // Publicly Listed Information
  public: {
    name: string; // Full name
    email: string; // Contact email
    website?: string; // Optional website URL
    studentLevel: string; // e.g., 'Certified Instructor', 'Student Teacher'
    applicationLevel: string; // e.g., 'Level 1', 'Level 2'
    isSchoolManager: boolean; // Is the member a school manager?
    schoolName?: string; // Associated school name, if applicable
    isCountryManager: boolean; // Is the member a country manager?
    country?: string; // Associated country, if applicable
  };
}
