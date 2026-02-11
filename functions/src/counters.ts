import {
  onCall,
  HttpsError,
  CallableRequest,
} from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Counters, Member } from './data-model';
import {
  allowedOrigins,
  assertAdmin,
  assertAdminOrSchoolManager,
  getMemberByEmail,
} from './common';
import { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';

const COUNTERS_DOC_PATH = 'counters/singleton';
const COUNTERS_MIN_DEFAULT = 100;

function initialCounters(): Counters {
  return {
    memberIdCounters: {},
    instructorIdCounter: 0,
    schoolIdCounter: 0,
  };
}

function initDataFromCountersDoc(
  doc: DocumentSnapshot<DocumentData, DocumentData>,
): Counters {
  if (!doc.exists) {
    return initialCounters();
  }
  const data = doc.data();
  if (!data) {
    return initialCounters();
  }
  return data as Counters;
}

async function nextMemberIdHelper(
  request: CallableRequest<{ countryCode: string }>,
) {
  await assertAdminOrSchoolManager(request);
  const countryCode = request.data.countryCode;
  if (!countryCode || countryCode.length !== 2) {
    throw new HttpsError(
      'invalid-argument',
      'A 2-letter country code must be provided.',
    );
  }

  const db = admin.firestore();
  const countersRef = db.doc(COUNTERS_DOC_PATH);

  try {
    const newId = await db.runTransaction(async (transaction) => {
      const countersDoc = await transaction.get(countersRef);
      const counters = initDataFromCountersDoc(countersDoc);
      const nextId =
        (counters.memberIdCounters[countryCode.toUpperCase()] || 0) + 1;
      counters.memberIdCounters[countryCode.toUpperCase()] = nextId;
      transaction.set(countersRef, counters);
      return nextId;
    });
    return { newId: `${countryCode.toUpperCase()}${newId}` };
  } catch (e) {
    console.error('Transaction failure:', e);
    throw new HttpsError('internal', 'Transaction failure');
  }
}

async function nextInstructorIdHelper(request: CallableRequest<unknown>) {
  await assertAdmin(request);
  const db = admin.firestore();
  const countersRef = db.doc(COUNTERS_DOC_PATH);

  try {
    const newId = await db.runTransaction(async (transaction) => {
      const countersDoc = await transaction.get(countersRef);
      const counters = initDataFromCountersDoc(countersDoc);
      const nextId = (counters.instructorIdCounter || 0) + 1;
      counters.instructorIdCounter = nextId;
      transaction.set(countersRef, counters);
      return nextId;
    });
    return { newId };
  } catch (e) {
    console.error('Transaction failure:', e);
    throw new HttpsError('internal', 'Transaction failure');
  }
}

async function nextSchoolIdHelper(request: CallableRequest<unknown>) {
  await assertAdmin(request);
  const db = admin.firestore();
  const countersRef = db.doc(COUNTERS_DOC_PATH);

  try {
    const newId = await db.runTransaction(async (transaction) => {
      const countersDoc = await transaction.get(countersRef);
      const counters = initDataFromCountersDoc(countersDoc);
      const nextId = (counters.schoolIdCounter || 0) + 1;
      counters.schoolIdCounter = nextId;
      transaction.set(countersRef, counters);
      return nextId;
    });
    return { newId };
  } catch (e) {
    console.error('Transaction failure:', e);
    throw new HttpsError('internal', 'Transaction failure');
  }
}

export const nextMemberId = onCall<
  { countryCode: string },
  Promise<{ newId: string }>
>({ cors: allowedOrigins }, async (request) => {
  return nextMemberIdHelper(request);
});

export const nextInstructorId = onCall<unknown, Promise<{ newId: number }>>(
  { cors: allowedOrigins },
  async (request) => {
    return nextInstructorIdHelper(request);
  },
);

export const nextSchoolId = onCall<unknown, Promise<{ newId: number }>>(
  { cors: allowedOrigins },
  async (request) => {
    return nextSchoolIdHelper(request);
  },
);

export function extractCountersFromMember(member: Member): {
  memberIdCountryCode?: string;
  memberIdNumber?: number;
  instructorIdNumber?: number;
} {
  // Parse Member ID
  let memberIdCountryCode: string | undefined;
  let memberIdNumber: number | undefined;

  // Expected format: 2 letters followed by numbers, e.g. "US101"
  const memberIdMatch = member.memberId?.match(/^([A-Za-z]{2})(\d+)$/);
  if (memberIdMatch) {
    memberIdCountryCode = memberIdMatch[1].toUpperCase();
    memberIdNumber = parseInt(memberIdMatch[2], 10);
  }

  // Parse Instructor ID
  // Expected format: number string "101"
  let instructorIdNumber: number | undefined;
  if (member.instructorId) {
    const instructorIdMatch = member.instructorId?.match(/^(\d+)$/);
    if (instructorIdMatch) {
      instructorIdNumber = parseInt(instructorIdMatch[1], 10);
    }
  }

  return { memberIdCountryCode, memberIdNumber, instructorIdNumber };
}

/**
 * Calculates the next counter value based on a last seen ID.
 * It ensures the counter is at least one more than the last seen ID,
 * and also at least the minimum allowed value.
 */
export function calculateNextCounterValue(
  lastSeenId: number,
  currentCounter: number,
  minVal: number = COUNTERS_MIN_DEFAULT,
): number {
  return Math.max(currentCounter, lastSeenId + 1, minVal);
}

/**
 * Checks if the member's ID or instructor ID is higher than the current
 * counter values, and if so, updates the counters.
 */
export async function ensureCountersAreAtLeast(member: Member) {
  const { memberIdCountryCode, memberIdNumber, instructorIdNumber } =
    extractCountersFromMember(member);

  if (!memberIdNumber && !instructorIdNumber) {
    return;
  }

  const db = admin.firestore();
  const countersRef = db.doc(COUNTERS_DOC_PATH);

  try {
    await db.runTransaction(async (transaction) => {
      const countersDoc = await transaction.get(countersRef);
      const counters = initDataFromCountersDoc(countersDoc);
      let changed = false;

      if (memberIdCountryCode && memberIdNumber) {
        const currentRef =
          counters.memberIdCounters[memberIdCountryCode] || COUNTERS_MIN_DEFAULT;
        const nextVal = calculateNextCounterValue(memberIdNumber, currentRef);
        if (nextVal > currentRef) {
          counters.memberIdCounters[memberIdCountryCode] = nextVal;
          changed = true;
        }
      }

      if (instructorIdNumber) {
        const currentRef = counters.instructorIdCounter || COUNTERS_MIN_DEFAULT;
        const nextVal = calculateNextCounterValue(instructorIdNumber, currentRef);
        if (nextVal > currentRef) {
          counters.instructorIdCounter = nextVal;
          changed = true;
        }
      }

      if (changed) {
        transaction.set(countersRef, counters);
      }
    });
  } catch (e) {
    console.error('Failed to update counters from member:', e);
    // We do NOT re-throw here because this is a background side-effect
    // and we don't want to fail the main member update if this fails,
    // though arguably it might be important.
    // For now, just log error.
  }
}
