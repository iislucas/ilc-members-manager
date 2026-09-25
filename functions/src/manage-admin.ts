import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins, assertAdmin, recordDeletionLog, recordTombstone } from './common';
import { ACL } from './data-model/system';
import { DeletionSource, DeletionLogActor } from './data-model/deletion-logs';

export interface SetAdminPrivilegeRequest {
  email: string;
  isAdmin: boolean;
}

export interface SetAdminPrivilegeResponse {
  success: boolean;
  email: string;
  isAdmin: boolean;
}

export async function setAdminPrivilegeHelper(
  request: CallableRequest<SetAdminPrivilegeRequest>,
): Promise<SetAdminPrivilegeResponse> {
  await assertAdmin(request);

  const callerEmail = (request.auth?.token?.email || '').toLowerCase().trim();
  const rawEmail = request.data?.email;

  if (!rawEmail || typeof rawEmail !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid email address is required.');
  }

  const targetEmail = rawEmail.toLowerCase().trim();
  if (!targetEmail.includes('@') || targetEmail.length < 5) {
    throw new HttpsError('invalid-argument', 'Invalid email address format.');
  }

  const isAdmin = Boolean(request.data?.isAdmin);
  const db = admin.firestore();

  if (!isAdmin) {
    if (targetEmail === callerEmail) {
      throw new HttpsError(
        'failed-precondition',
        'You cannot revoke your own administrator privileges.',
      );
    }

    const adminQuery = await db.collection('acl').where('isAdmin', '==', true).get();
    if (adminQuery.size <= 1 && adminQuery.docs.some((doc) => doc.id === targetEmail)) {
      throw new HttpsError(
        'failed-precondition',
        'Cannot revoke the last remaining system administrator.',
      );
    }

    const aclRef = db.collection('acl').doc(targetEmail);
    const aclSnap = await aclRef.get();
    if (aclSnap.exists) {
      const aclData = aclSnap.data() as ACL;
      if (!aclData.memberDocIds || aclData.memberDocIds.length === 0) {
        // Detached standalone admin revoked -> clean up doc
        const actor: DeletionLogActor = {
          email: callerEmail,
          uid: request.auth?.uid,
        };
        await recordDeletionLog(
          db,
          'acl',
          targetEmail,
          aclData,
          actor,
          DeletionSource.ClientAction,
        );
        await recordTombstone(db, 'acl', targetEmail, actor);
        await aclRef.delete();
      } else {
        await aclRef.update({ isAdmin: false });
      }
    }

    logger.info('Administrator privilege revoked', {
      caller: callerEmail,
      target: targetEmail,
    });

    return {
      success: true,
      email: targetEmail,
      isAdmin: false,
    };
  }

  // Granting admin
  const aclRef = db.collection('acl').doc(targetEmail);
  const aclSnap = await aclRef.get();

  if (aclSnap.exists) {
    await aclRef.update({ isAdmin: true });
  } else {
    // If no ACL exists yet, find any existing member profiles with this email
    const memberMatches = await db
      .collection('members')
      .where('emails', 'array-contains', targetEmail)
      .get();
    const memberDocIds = memberMatches.docs.map((doc) => doc.id);

    const newAcl: ACL = {
      isAdmin: true,
      memberDocIds,
      instructorIds: [],
      schoolDocIds: [],
      membershipExpires: '',
      instructorLicenseExpires: '',
      schoolLicenseExpires: '',
      notYetLinkedToMember: memberDocIds.length === 0,
    };
    await aclRef.set(newAcl);
  }

  logger.info('Administrator privilege granted', {
    caller: callerEmail,
    target: targetEmail,
  });

  return {
    success: true,
    email: targetEmail,
    isAdmin: true,
  };
}

export const setAdminPrivilege = onCall<SetAdminPrivilegeRequest, Promise<SetAdminPrivilegeResponse>>(
  { cors: allowedOrigins },
  async (request) => {
    return setAdminPrivilegeHelper(request);
  },
);
