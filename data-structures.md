# Data Structures

This document outlines the data structures used in the ILC Members Manager application, stored in Cloud Firestore.

## Members

The `members` collection stores information about each ILC instructor and member.

**Document ID:** Automatically generated unique ID.

### Schema

```typescript
interface Member {
  id: string; // Document ID
  isAdmin: boolean; // Is the member an admin?

  // Internal ILC HQ Information
  internal: {
    lastPaymentDate: Timestamp;      // Date of last payment
    lastPaymentAmount: number;       // Amount of last payment
    lastPaymentId: number;           // Squarespace ID for last patyent
    membershipExpires: Timestamp; // Date membership expires
  };

  // Publicly Listed Information
  public: {
    name: string;                // Full name
    email: string;               // Contact email
    website?: string;            // Optional website URL
    studentLevel: string;        // e.g., 'Certified Instructor', 'Student Teacher'
    applicationLevel: string;    // e.g., 'Level 1', 'Level 2'
    isSchoolManager: boolean;    // Is the member a school manager?
    schoolName?: string;         // Associated school name, if applicable
    isCountryManager: boolean;   // Is the member a country manager?
    country?: string;            // Associated country, if applicable
  };
}