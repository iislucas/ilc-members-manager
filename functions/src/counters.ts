import {
  onCall,
  HttpsError,
  CallableRequest,
} from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Counters } from './data-model';
import { allowedOrigins } from './common';

const COUNTERS_DOC_PATH = 'counters/singleton';

async function nextMemberIdHelper(
  request: CallableRequest<{ countryCode: string }>,
) {
  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.',
    );
  }
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
      if (!countersDoc.exists) {
        const initialCounters: Counters = {
          memberIdCounters: { [countryCode.toUpperCase()]: 1 },
          instructorIdCounter: 0,
        };
        transaction.set(countersRef, initialCounters);
        return 1;
      }

      const counters = countersDoc.data() as Counters;
      const currentId =
        counters.memberIdCounters[countryCode.toUpperCase()] || 0;
      const nextId = currentId + 1;
      transaction.update(countersRef, {
        [`memberIdCounters.${countryCode.toUpperCase()}`]: nextId,
      });
      return nextId;
    });
    return { newId: `${countryCode.toUpperCase()}${newId}` };
  } catch (e) {
    console.error('Transaction failure:', e);
    throw new HttpsError('internal', 'Transaction failure');
  }
}

async function nextInstructorIdHelper(request: CallableRequest<unknown>) {
  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.',
    );
  }

  const db = admin.firestore();
  const countersRef = db.doc(COUNTERS_DOC_PATH);

  try {
    const newId = await db.runTransaction(async (transaction) => {
      const countersDoc = await transaction.get(countersRef);
      if (!countersDoc.exists) {
        const initialCounters: Counters = {
          memberIdCounters: {},
          instructorIdCounter: 1,
        };
        transaction.set(countersRef, initialCounters);
        return 1;
      }

      const counters = countersDoc.data() as Counters;
      const currentId = counters.instructorIdCounter || 0;
      const nextId = currentId + 1;
      transaction.update(countersRef, { instructorIdCounter: nextId });
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
