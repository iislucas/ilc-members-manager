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
