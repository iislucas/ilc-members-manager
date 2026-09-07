import { FsTimestamp, GenericFsDoc, normalizeLastUpdated } from './base';

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

  // Public profile page fields. Shown on the school's dedicated public profile
  // page (mirrors the instructor profile page).
  publicProfileImageUrl: string; // Logo / profile picture (large).
  publicProfileImageThumbUrl: string; // Logo / profile picture (thumbnail).
  publicCoverImageUrl: string; // Cover / header image.
  publicBioMarkdown: string; // Markdown description of the school.

  // The `instructorId` (human readable) of the owner of this school; can set the managers, and
  // change anything in the school.
  ownerInstructorId: string;
  // The member docId of the owner of this school.
  ownerMemberDocId: string;
  // The `instructorId`s (human readable) of people allowed to manage people within this school.
  managerInstructorIds: string[];

  // @deprecated — These email arrays were previously used by Firestore
  // security rules to check school ownership/management. Rules now use
  // the ACL document's schoolDocIds field instead. These fields are kept
  // for backward compatibility and will be removed in a future cleanup.
  ownerEmails: string[];
  managerEmails: string[];

  // School License
  schoolLicenseRenewalDate: string; // YYYY-MM-DD
  schoolLicenseExpires: string; // YYYY-MM-DD
};

export type SchoolFsDoc = Omit<School, 'lastUpdated' | 'docId'> & {
  lastUpdated: FsTimestamp;
};

export function initSchool(): School {
  return {
    docId: '',
    lastUpdated: new Date().toISOString(),

    schoolId: '',
    schoolName: '',
    schoolAddress: '',
    schoolCity: '',
    schoolZipCode: '',
    schoolCountyOrState: '',
    schoolCountry: '',
    schoolWebsite: '',
    schoolClassGoogleCalendarId: '',
    publicProfileImageUrl: '',
    publicProfileImageThumbUrl: '',
    publicCoverImageUrl: '',
    publicBioMarkdown: '',
    ownerInstructorId: '',
    ownerMemberDocId: '',
    managerInstructorIds: [],
    ownerEmails: [],
    managerEmails: [],
    schoolLicenseRenewalDate: '',
    schoolLicenseExpires: '',
  };
}

export function firestoreDocToSchool(doc: GenericFsDoc): School {
  const docData = doc.data() as SchoolFsDoc & {
    owner?: string;
    managers?: string[];
    ownerEmail?: string;
  };
  const lastUpdated = normalizeLastUpdated(docData.lastUpdated);

  const ownerInstructorId = docData.ownerInstructorId || docData.owner || '';
  const ownerMemberDocId = docData.ownerMemberDocId || '';
  const managerInstructorIds = docData.managerInstructorIds || docData.managers || [];
  // TODO: legacy: remove once full migration to ownerEmails is complete
  const ownerEmails = docData.ownerEmails && docData.ownerEmails.length > 0 ? docData.ownerEmails : (docData.ownerEmail ? [docData.ownerEmail] : []);

  return { ...initSchool(), ...docData, ownerInstructorId, ownerMemberDocId, managerInstructorIds, ownerEmails, lastUpdated, docId: doc.id };
}
