import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins } from './common';
import { FetchInstructorsResult, Member, initMember } from './data-model';

export const getInstructors = onCall<unknown, Promise<FetchInstructorsResult>>(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('getInstructors called', { auth: request.auth });

    const db = admin.firestore();
    const today = new Date().toISOString().split('T')[0];

    try {
      const instructorsSnapshot = await db
        .collection('members')
        .where('instructorId', '!=', '')
        .where('instructorLicenseExpires', '>=', today)
        .get();

      const instructors = instructorsSnapshot.docs.map(
        (doc) => ({ ...initMember(), ...doc.data(), id: doc.id } as Member)
      );

      return {
        instructors,
      };
    } catch (error: unknown) {
      logger.error('Error getting instructors:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError(
        'internal',
        'An error occurred while fetching instructors.'
      );
    }
  }
);
