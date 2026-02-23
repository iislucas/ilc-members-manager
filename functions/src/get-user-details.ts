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

    const aclDoc = await db.collection('acl').doc(user.email).get();
    if (!aclDoc.exists) {
      // If no ACL exists, this user has no member profiles associated with them.
      return { userMemberProfiles: [], isAdmin: false, schoolsManaged: [] };
    }

    const aclData = aclDoc.data() as { memberDocIds: string[] };
    const memberDocIds = aclData.memberDocIds || [];

    const memberRefs = memberDocIds.map((id) => db.collection('members').doc(id));
    const memberDocs =
      memberRefs.length > 0 ? await db.getAll(...memberRefs) : [];

    const userMemberProfiles: Member[] = memberDocs
      .filter((doc) => doc.exists)
      .map((doc) => {
        const data = doc.data() as MemberFirestoreDoc;
        return {
          ...data,
          lastUpdated: data.lastUpdated.toDate().toISOString(),
          id: doc.id,
        } as Member;
      });

    if (userMemberProfiles.length === 0) {
      return { userMemberProfiles: [], isAdmin: false, schoolsManaged: [] };
    }

    // For simplicity, we use the first profile to determine "primary" permissions
    // like isAdmin or schoolsManaged, though in the UI the user can switch.
    // The data-manager.service.ts will handle the switching logic.
    const primaryMember = userMemberProfiles[0];

    // School manager/owner query
    // NOTE: This now checks across ALL profiles? Or just the primary?
    // Let's check across the primary for now as per current app logic.
    const schoolsOwnedQuery = db
      .collection('schools')
      .where('owner', '==', primaryMember.instructorId)
      .get();
    const schoolsManagedQuery = db
      .collection('schools')
      .where('managers', 'array-contains', primaryMember.instructorId)
      .get();

    const [schoolsOwnedSnapshot, schoolsManagedSnapshot] = await Promise.all([
      schoolsOwnedQuery,
      schoolsManagedQuery,
    ]);

    const schoolIds = new Set<string>();
    schoolsOwnedSnapshot.forEach((doc) => schoolIds.add(doc.data().schoolId));
    schoolsManagedSnapshot.forEach((doc) => schoolIds.add(doc.data().schoolId));

    return {
      userMemberProfiles,
      schoolsManaged: [...schoolIds],
      isAdmin: primaryMember.isAdmin,
    };
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
