import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins } from './common';
import { Member } from './data-model';

export const getMembers = onCall({ cors: allowedOrigins }, async (request) => {
  logger.info('getMembers called', { auth: request.auth });

  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  try {
    const memberDoc = await db.collection('members').doc(uid).get();
    if (!memberDoc.exists) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to perform this action as you are not a member.'
      );
    }
    const memberData = memberDoc.data() as Member;

    // Admin: Return all members
    if (memberData.isAdmin) {
      const membersSnapshot = await db.collection('members').get();
      const members = membersSnapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Member)
      );
      return { members };
    }

    // School manager/owner query
    const schoolsOwnedQuery = db
      .collection('schools')
      .where('owner', '==', uid)
      .get();
    const schoolsManagedQuery = db
      .collection('schools')
      .where('managers', 'array-contains', uid)
      .get();

    const [schoolsOwnedSnapshot, schoolsManagedSnapshot] = await Promise.all([
      schoolsOwnedQuery,
      schoolsManagedQuery,
    ]);

    const schoolIds = new Set<string>();
    schoolsOwnedSnapshot.forEach((doc) => schoolIds.add(doc.id));
    schoolsManagedSnapshot.forEach((doc) => schoolIds.add(doc.id));

    if (schoolIds.size > 0) {
      const membersSnapshot = await db
        .collection('members')
        .where('managingOrgId', 'in', Array.from(schoolIds))
        .get();
      const members = membersSnapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Member)
      );
      return { members };
    }

    // If not admin or manager, return self
    return { members: [{ ...memberData, id: memberDoc.id }] };
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
});
