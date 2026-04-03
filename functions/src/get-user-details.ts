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
  MembershipType,
  firestoreDocToMember,
  initMember,
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

    let aclDoc = await db.collection('acl').doc(user.email).get();
    if (!aclDoc.exists) {
      // Check if any member document already lists this email.
      const existingMembersQuery = await db.collection('members')
        .where('emails', 'array-contains', user.email)
        .get();

      if (!existingMembersQuery.empty) {
        logger.info('Found existing members for email without ACL, creating ACL', { email: user.email });
        const memberDocIds = existingMembersQuery.docs.map((doc) => doc.id);

        const aclData = {
          memberDocIds: memberDocIds,
          instructorIds: [],
          isAdmin: false,
          notYetLinkedToMember: false,
        };

        await db.collection('acl').doc(user.email).set(aclData);
        aclDoc = await db.collection('acl').doc(user.email).get(); // Refresh to continue normal flow
      } else {
        logger.info('Creating guest profile for user', { email: user.email });

        const memberRef = db.collection('members').doc();
        const memberDocId = memberRef.id;

        const guestMember: Member = {
          ...initMember(),
          docId: memberDocId,
          emails: [user.email],
          membershipType: MembershipType.NotYetAMember,
        };

        const { docId, lastUpdated, ...dbData } = guestMember;
        const memberFirestoreData = {
          ...dbData,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        };

        const aclData = {
          memberDocIds: [memberDocId],
          instructorIds: [],
          isAdmin: false,
          notYetLinkedToMember: true,
        };

        const batch = db.batch();
        batch.set(memberRef, memberFirestoreData);
        batch.set(db.collection('acl').doc(user.email), aclData);
        await batch.commit();

        return {
          userMemberProfiles: [guestMember],
          isAdmin: false,
          schoolsManaged: [],
        };
      }
    }

    const aclData = aclDoc.data() as { memberDocIds: string[] };
    const memberDocIds = aclData.memberDocIds || [];

    const memberRefs = memberDocIds.map((id) => db.collection('members').doc(id));
    const memberDocs =
      memberRefs.length > 0 ? await db.getAll(...memberRefs) : [];

    const userMemberProfiles: Member[] = memberDocs
      .filter((doc) => doc.exists)
      .map(firestoreDocToMember);

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
      .where('ownerInstructorId', '==', primaryMember.instructorId)
      .get();
    const schoolsManagedQuery = db
      .collection('schools')
      .where('managerInstructorIds', 'array-contains', primaryMember.instructorId)
      .get();

    const [schoolsOwnedSnapshot, schoolsManagedSnapshot] = await Promise.all([
      schoolsOwnedQuery,
      schoolsManagedQuery,
    ]);

    const schoolIds = new Set<string>();
    schoolsOwnedSnapshot.forEach((doc) => schoolIds.add(doc.id));
    schoolsManagedSnapshot.forEach((doc) => schoolIds.add(doc.id));

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
