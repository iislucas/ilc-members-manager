/* get-user-details.ts
 *
 * Callable run right after sign-in: returns the member profiles linked to the
 * caller's verified auth email, plus their admin flag and managed schools.
 *
 * Profiles are resolved with findMemberDocsForEmail, the same lookup the
 * pre-auth checkEmailStatus uses, so the login flow's "we found your
 * membership" never turns into "we could not find your profile" here. For a
 * verified user the profile list is never empty:
 * - members found but /acl/{email} missing or stale -> the ACL is repaired;
 * - no member found (no ACL, an ACL listing only deleted members, or an
 *   admin-only ACL) -> a guest (NotYetAMember) profile is created.
 */

import {
  onCall,
  HttpsError,
  CallableRequest,
} from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins } from './common';
import { Member, MembershipType, firestoreDocToMember, initMember } from './data-model/members';
import { ACL, FetchUserDetailsResult } from './data-model/system';
import { normalizeEmail } from './data-model/email';
import { FirestoreCollection } from './data-model/collections';
import { findMemberDocsForEmail } from './member-docs-for-email';
import { refreshACLAdminStatus } from './on-member-update';

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
    const user = await admin.auth().getUser(uid);
    if (!user.email) {
      throw new HttpsError(
        'permission-denied',
        'This service only works for users with an email address.',
      );
    }
    const email = normalizeEmail(user.email);

    if (!user.emailVerified) {
      logger.info('User email is not verified, blocking profile fetch/linking', { email });
      return {
        userMemberProfiles: [],
        isAdmin: false,
        schoolsManaged: [],
        emailVerified: false,
      };
    }

    const { acl, memberDocs, aclNeedsRepair } = await findMemberDocsForEmail(db, email, user.email);
    const aclRef = db.collection(FirestoreCollection.Acl).doc(email);
    const isAdmin = acl?.isAdmin === true;

    if (memberDocs.length === 0) {
      // No existing member document for this email: the ACL is missing, or
      // lists only deleted members (or none, e.g. an admin-only entry). Give
      // the user a guest profile rather than an empty list, which the client
      // can only answer with "We could not find your profile" and a sign-out.
      logger.info('Creating guest profile for user', { email, hadAcl: !!acl });

      const memberRef = db.collection(FirestoreCollection.Members).doc();
      const memberDocId = memberRef.id;

      const guestMember: Member = {
        ...initMember(),
        docId: memberDocId,
        emails: [email],
        membershipType: MembershipType.NotYetAMember,
      };

      const { docId, lastUpdated, ...dbData } = guestMember;
      const memberFirestoreData = {
        ...dbData,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };

      const batch = db.batch();
      batch.set(memberRef, memberFirestoreData);
      if (acl) {
        // Replace the stale IDs; keep everything else (notably isAdmin).
        const aclUpdate: Partial<ACL> = {
          memberDocIds: [memberDocId],
          notYetLinkedToMember: true,
        };
        batch.update(aclRef, aclUpdate);
      } else {
        const aclData: Partial<ACL> = {
          memberDocIds: [memberDocId],
          instructorIds: [],
          isAdmin: false,
          notYetLinkedToMember: true,
        };
        batch.set(aclRef, aclData);
      }
      await batch.commit();

      return {
        userMemberProfiles: [guestMember],
        isAdmin,
        schoolsManaged: [],
      };
    }

    if (aclNeedsRepair) {
      // Members list this email but the ACL is missing or points elsewhere.
      logger.info('Repairing ACL from members matching email', { email, hadAcl: !!acl });
      const aclUpdate: Partial<ACL> = {
        memberDocIds: memberDocs.map((doc) => doc.id),
      };
      if (!acl) {
        aclUpdate.instructorIds = [];
        aclUpdate.isAdmin = false;
        aclUpdate.notYetLinkedToMember = false;
      }
      await aclRef.set(aclUpdate, { merge: true });
      // Recompute instructorIds, schoolDocIds and expiries for the new links.
      await refreshACLAdminStatus(email);
    }

    const userMemberProfiles: Member[] = memberDocs.map(firestoreDocToMember);

    // School docIds are now cached in the ACL document, so no
    // additional queries are needed.
    const schoolsManaged = aclNeedsRepair
      ? ((await aclRef.get()).data() as ACL | undefined)?.schoolDocIds ?? []
      : acl?.schoolDocIds ?? [];

    return {
      userMemberProfiles,
      schoolsManaged,
      isAdmin,
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
