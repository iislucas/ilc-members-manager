import {
  onCall,
  HttpsError,
  CallableRequest,
} from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins } from './common';
import {
  FetchUserDetailsResult,
  Member,
  MemberFirestoreDoc,
} from './data-model';

export async function getUserDetailsHelper(request: CallableRequest<unknown>) {
  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.',
    );
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  try {
    // TOOD: Get email from uid...
    const user = await admin.auth().getUser(uid);
    if (!user.email) {
      throw new HttpsError(
        'permission-denied',
        'This service only works for users with an email address.',
      );
    }

    const memberDoc = await db.collection('members').doc(user.email).get();
    if (!memberDoc.exists) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to perform this action as you are not a member.',
      );
    }
    const userMemberDocData = memberDoc.data() as MemberFirestoreDoc;
    const userMemberData: Member = {
      ...userMemberDocData,
      lastUpdated: userMemberDocData.lastUpdated.toDate().toISOString(),
    };

    // School manager/owner query
    const schoolsOwnedQuery = db
      .collection('schools')
      .where('owner', '==', userMemberData.memberId)
      .get();
    const schoolsManagedQuery = db
      .collection('schools')
      .where('managers', 'array-contains', userMemberData.memberId)
      .get();

    const [schoolsOwnedSnapshot, schoolsManagedSnapshot] = await Promise.all([
      schoolsOwnedQuery,
      schoolsManagedQuery,
    ]);

    const schoolIds = new Set<string>();
    schoolsOwnedSnapshot.forEach((doc) => schoolIds.add(doc.data().schoolId));
    schoolsManagedSnapshot.forEach((doc) => schoolIds.add(doc.data().schoolId));

    // Admin: Return all members
    if (userMemberData.isAdmin) {
      return {
        userMemberData,
        schoolsManaged: [...schoolIds],
        isAdmin: true,
      };
    } else if (schoolIds.size > 0) {
      return {
        userMemberData,
        schoolsManaged: [...schoolIds],
        isAdmin: false,
      };
    } else {
      // If not admin or manager of others. TODO: consider Sifu's having
      // manager access over their students?
      return { userMemberData, schoolsManaged: [], isAdmin: false };
    }
  } catch (error: unknown) {
    logger.error('Error getting members:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      'internal',
      'An error occurred while getting user details.',
    );
  }
}

export const getUserDetails = onCall<unknown, Promise<FetchUserDetailsResult>>(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('getUserKind called', { auth: request.auth });
    return getUserDetailsHelper(request);
  },
);
