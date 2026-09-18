/* object-diff.ts
 *
 * Generic, type-safe utilities for computing diffs between object states
 * and formatting domain field names for action summaries and audit logging.
 */

import deepObjEq from 'fast-deep-equal';

export interface DiffOptions<T extends object> {
  /**
   * Keys to exclude from the diff computation (e.g. 'docId', 'lastUpdated').
   */
  ignoreKeys?: ReadonlyArray<Extract<keyof T, string>>;
}

export interface ObjectDiff<T extends object> {
  /**
   * Snapshot of values from original for fields that changed.
   */
  changedOldState: Partial<T>;

  /**
   * Snapshot of values from updated for fields that changed.
   */
  changedNewState: Partial<T>;

  /**
   * List of field names that differed between original and updated.
   */
  changedKeys: Array<Extract<keyof T, string>>;
}

/**
 * Computes the delta between an original object and an updated object.
 *
 * Both old and new states in the returned diff are strongly typed as Partial<T>,
 * and changedKeys is an array of typed property keys of T.
 *
 * If original is null or undefined (e.g. creating a new record or no baseline snapshot),
 * all non-ignored properties present on updated are treated as newly changed.
 */
export function computeObjectDiff<T extends object>(
  original: Partial<T> | undefined | null,
  updated: Partial<T>,
  options?: DiffOptions<T>,
): ObjectDiff<T> {
  const changedOldState: Partial<T> = {};
  const changedNewState: Partial<T> = {};
  const changedKeys: Array<Extract<keyof T, string>> = [];
  const ignoreSet = new Set<string>((options?.ignoreKeys as string[] | undefined) ?? []);

  const keysToInspect = Object.keys(updated) as Array<Extract<keyof T, string>>;

  for (const key of keysToInspect) {
    if (ignoreSet.has(key)) continue;

    const newVal = updated[key];
    if (original) {
      const oldVal = original[key];
      if (!deepObjEq(newVal, oldVal)) {
        changedNewState[key] = newVal;
        if (oldVal !== undefined) {
          changedOldState[key] = oldVal;
        }
        changedKeys.push(key);
      }
    } else {
      changedNewState[key] = newVal;
      changedKeys.push(key);
    }
  }

  return {
    changedOldState,
    changedNewState,
    changedKeys,
  };
}

/**
 * Canonical dictionary of human-friendly labels for entity properties
 * across Member, School, Grading, and IlcEvent domains.
 */
export const DOMAIN_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  notes: 'Notes',
  publicBioMarkdown: 'Public Bio',
  name: 'Full Name',
  email: 'Email Address',
  emails: 'Email Addresses',
  phone: 'Phone Number',
  address: 'Address',
  city: 'City',
  postcode: 'Postcode',
  country: 'Country',
  dateOfBirth: 'Date of Birth',
  roles: 'Roles',
  tags: 'Tags',
  schools: 'Schools',
  primarySchoolId: 'Primary School',
  isInstructor: 'Instructor Status',
  instructorId: 'Instructor ID',
  primaryInstructorId: 'Primary Instructor ID',
  status: 'Status',
  title: 'Title',
  description: 'Description',
  schoolName: 'School Name',
  schoolId: 'School ID',
  headInstructorName: 'Head Instructor',
  studentName: 'Student Name',
  studentDocId: 'Student',
  assessedLevel: 'Assessed Level',
  feedback: 'Feedback',
  dateOfGrading: 'Date of Grading',
  gradingInstructorId: 'Grading Instructor',
  startDate: 'Start Date',
  endDate: 'End Date',
  location: 'Location',
  purchaseDetailsMarkdown: 'Purchase Details',
  inPersonDetailsMarkdown: 'In-Person Details',
  onlineJoiningLink: 'Online Joining Link',
  recordedVideoId: 'Recorded Video ID',
  recordedVideoUrl: 'Recorded Video URL',
  managerDocIds: 'Managers',
  contacts: 'Contacts',
  documents: 'Documents',
  productId: 'Product ID',
});

/**
 * Returns a human-friendly label for a domain field key.
 * Can be called with a strongly-typed key: `formatFieldLabel<Member>('name')`.
 */
export function formatFieldLabel<T extends object = Record<string, unknown>>(
  key: Extract<keyof T, string> | string,
): string {
  if (DOMAIN_FIELD_LABELS[key]) {
    return DOMAIN_FIELD_LABELS[key];
  }
  const spaced = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Formats a list of changed keys into a human-readable summary string,
 * e.g. "Updated Phone, Address" or a fallback description if no keys changed.
 */
export function formatFieldSummary<T extends object = Record<string, unknown>>(
  changedKeys: Array<Extract<keyof T, string> | string>,
  fallbackEntityDescription: string,
): string {
  if (changedKeys.length === 0) {
    return `Updated ${fallbackEntityDescription}`;
  }
  return `Updated ${changedKeys.map((k) => formatFieldLabel(k)).join(', ')}`;
}
