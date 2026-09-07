import { FsTimestamp, GenericFsDoc, normalizeLastUpdated } from './base';
import { Member } from './members';

// ==================================================================
// # Counters
// ==================================================================
// All counters are stored in a single document for atomic updates.
// Firestore path: /system/counters
export type Counters = {
  // A map from 2-letter country code to the last assigned member ID number.
  memberIdCounters: { [countryCode: string]: number };

  // The last assigned instructor ID number.
  instructorIdCounter: number;
  schoolIdCounter: number;
};

// ==================================================================
// # Tombstones (Deletions tracking for delta sync)
// ==================================================================
export type Tombstone = {
  docId: string;
  collection: string;
  deletedAt: string; // ISO timestamp
};

export type TombstoneFsDoc = Omit<Tombstone, 'deletedAt'> & {
  deletedAt: FsTimestamp;
};

export function firestoreDocToTombstone(doc: GenericFsDoc): Tombstone {
  const docData = doc.data() as TombstoneFsDoc & { collection?: string };
  const deletedAt = normalizeLastUpdated(docData.deletedAt);
  return {
    docId: doc.id,
    collection: docData.collection || '',
    deletedAt,
  };
}

// ==================================================================
// # ACL
// ==================================================================
// Firestore path: /acl/{email}
// Maps an email to the member IDs it is allowed to manage.
// The expiry date fields are computed by the on-member-update and
// on-school-update triggers, and checked by Firebase Storage rules
// for resource access control.
// Values: "life" (never expires), "YYYY-MM-DD" (expiry date), or "" / undefined (no membership).
export type ACL = {
  memberDocIds: string[];
  instructorIds: string[];
  // Firestore document IDs of schools this user owns or manages
  // (resolved via instructorId matching against ownerInstructorId /
  // managerInstructorIds on school documents).
  schoolDocIds: string[];
  isAdmin: boolean;
  // The latest membership expiry date across all linked member profiles.
  // "life" if any profile has Life membership, "YYYY-MM-DD" for the
  // furthest Annual expiry, or "" if no active membership.
  membershipExpires: string;
  // The latest instructor license expiry date across all linked profiles.
  // "life" if any profile has Life license, "YYYY-MM-DD" for the
  // furthest Annual expiry, or "" if not an instructor.
  instructorLicenseExpires: string;
  // The latest school license expiry date across all schools this user
  // owns or manages (matched by instructorId). "YYYY-MM-DD" for the
  // furthest expiry, or "" if not a school owner/manager.
  schoolLicenseExpires: string;
};

export type ACLFsDoc = ACL;

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

export type MemberStatisticsFsDoc = Omit<MemberStatistics, 'docId'>;

export function firestoreDocToStatistics(doc: GenericFsDoc): MemberStatistics {
  const docData = doc.data() as MemberStatisticsFsDoc;
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
  emailVerified?: boolean;
};

// Result from the pre-auth checkEmailStatus function. Guides the login UI
// to show the appropriate step (Google sign-in, password, or account creation).
export type CheckEmailStatusResult = {
  // Whether this email has an ACL entry (is a known member).
  hasMemberRecord: boolean;
  // Whether a Firebase Auth account exists for this email.
  hasAuthAccount: boolean;
  // Whether the email appears to be Google-managed (gmail.com / googlemail.com
  // domain, or the existing auth account has a google.com provider).
  isGoogleManaged: boolean;
  // Whether the existing auth account has a password provider configured.
  hasPasswordProvider?: boolean;
  // Whether the existing auth account has a google.com provider configured.
  hasGoogleProvider?: boolean;
};
