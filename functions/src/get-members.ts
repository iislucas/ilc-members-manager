import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins } from './common';
import { FetchMembersResult, Member } from './data-model';
import { getUserDetailsHelper } from './get-user-details';

export const getMembers = onCall<unknown, Promise<FetchMembersResult>>(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('getMembers called', { auth: request.auth });

    const db = admin.firestore();
    const userDetails = await getUserDetailsHelper(request);

    try {
      // Admin: Return all members
      if (userDetails.isAdmin) {
        const membersSnapshot = await db.collection('members').get();
        const members = membersSnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as Member)
        );
        return {
          members,
        };
      }

      if (userDetails.schoolsManaged.length > 0) {
        const membersSnapshot = await db
          .collection('members')
          .where('managingOrgId', 'in', Array.from(userDetails.schoolsManaged))
          .get();
        const members = membersSnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as Member)
        );
        return {
          members,
        };
      }

      // If not admin or manager of others. TODO: consider Sifu's having manager
      // access over their students?
      return { members: [] };
    } catch (error: unknown) {
      logger.error('Error getting members:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError(
        'internal',
        'An error occurred while fetching members.'
      );
    }
  }
);
