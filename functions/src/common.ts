import { environment } from './environment/environment';
import * as admin from 'firebase-admin';
import {
  Member,
  MembershipType,
  hasActiveMembership as hasActiveMembershipModel,
  hasActiveInstructorLicense,
} from './data-model/members';
import { School } from './data-model/schools';
import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreCollection } from './data-model/collections';
import { DeletionLogEntry } from './data-model/deletion-logs';

export const allowedOrigins = environment.domains;
if (process.env.GCLOUD_PROJECT) {
  allowedOrigins.push(`https://${process.env.GCLOUD_PROJECT}.web.app`);
}

// Transforms a type to allow its properties to be the original type,
// or a Firestore FieldValue. This also makes all properties optional,
// which is standard for an update operation.
export type FirestoreUpdate<T> = {
  [P in keyof T]?: T[P] | FieldValue;
};

export async function getMemberByEmail(
  email: string,
  db: admin.firestore.Firestore,
): Promise<Member> {
  // First, check the ACL collection which maps emails to member IDs
  const aclRef = db.collection('acl').doc(email);
  const aclDoc = await aclRef.get();

  if (aclDoc.exists) {
    const acl = aclDoc.data() as { memberDocIds: string[] };
    if (acl.memberDocIds && acl.memberDocIds.length > 0) {
      // For now, we utilize the first member profile associated with the email
      // This logic might need to be expanded if we need to support specific profile selection affecting permissions here
      const memberDocId = acl.memberDocIds[0];
      const memberRef = db.collection('members').doc(memberDocId);
      const memberDoc = await memberRef.get();
      if (memberDoc.exists) {
        return { ...memberDoc.data(), docId: memberDoc.id } as Member;
      }
    }
  }

  // Fallback: Query the members collection directly
  // This is useful if the ACL hasn't been synced or for legacy support
  const membersQuery = db
    .collection('members')
    .where('emails', 'array-contains', email)
    .limit(1);
  const membersSnapshot = await membersQuery.get();

  if (!membersSnapshot.empty) {
    const doc = membersSnapshot.docs[0];
    return { ...doc.data(), docId: doc.id } as Member;
  }

  throw new HttpsError('not-found', 'Member not found');
}

export { hasActiveInstructorLicense };

// Whether a member has an active (non-expired) membership today. Life
// memberships are always active; Annual memberships are active while
// currentMembershipExpires is today or later. Mirrors the expiry check used
// for event proposals and the client-side member-tags logic.
export function hasActiveMembership(member: Member): boolean {
  return hasActiveMembershipModel(member);
}

// The Firestore member doc IDs a login email is allowed to manage, read from
// the ACL document. Mirrors the `getUserMemberDocIds()` notion used by the
// Firestore security rules. Returns [] when the email has no ACL entry.
export async function getUserMemberDocIds(
  email: string,
  db: admin.firestore.Firestore,
): Promise<string[]> {
  const aclDoc = await db.collection('acl').doc(email).get();
  if (!aclDoc.exists) return [];
  const acl = aclDoc.data() as { memberDocIds?: string[] };
  return acl.memberDocIds ?? [];
}

export async function getSchool(
  schoolId: string,
  db: admin.firestore.Firestore,
): Promise<School> {
  const schoolRef = db.collection('schools').doc(schoolId);
  const schoolDoc = await schoolRef.get();
  if (!schoolDoc.exists) {
    throw new HttpsError('not-found', 'School not found');
  }
  return schoolDoc.data() as School;
}

export async function assertAdmin(
  request: CallableRequest<unknown>,
): Promise<Member> {
  if (!request.auth || !request.auth.token.email) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.',
    );
  }
  const db = admin.firestore();
  const email = request.auth.token.email.toLowerCase().trim();

  // Canonical authorization check against /acl/{email}
  const aclSnap = await db.collection('acl').doc(email).get();
  const isAdmin = aclSnap.exists && aclSnap.data()?.isAdmin === true;

  if (!isAdmin) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to perform this action.',
    );
  }

  const member = await getMemberByEmail(email, db);
  return { ...member, isAdmin: true };
}

export async function assertAdminOrSchoolManager(
  request: CallableRequest<unknown>,
): Promise<Member> {
  if (!request.auth || !request.auth.token.email) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.',
    );
  }
  const db = admin.firestore();
  const email = request.auth.token.email.toLowerCase().trim();

  // Check the ACL for admin or cached schoolDocIds
  const aclDoc = await db.collection('acl').doc(email).get();
  const aclData = aclDoc.exists ? (aclDoc.data() as { isAdmin?: boolean; schoolDocIds?: string[] }) : undefined;
  const isAdmin = aclData?.isAdmin === true;
  const isSchoolManager = !!(aclData?.schoolDocIds && aclData.schoolDocIds.length > 0);

  if (!isAdmin && !isSchoolManager) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to perform this action.',
    );
  }

  const member = await getMemberByEmail(email, db);
  return { ...member, isAdmin };
}

/**
 * Records a tombstone document when a record is deleted so incremental
 * delta sync on clients can detect and prune deletions from local storage.
 * Records the username/email of the actor if provided.
 */
export async function recordTombstone(
  db: admin.firestore.Firestore,
  collectionName: string,
  docId: string,
  actor?: { email?: string; name?: string; uid?: string } | string,
): Promise<void> {
  try {
    const tombstoneRef = db
      .collection('system')
      .doc('deletions')
      .collection(collectionName)
      .doc(docId);

    const tombstoneData: Record<string, unknown> = {
      docId,
      collection: collectionName,
      deletedAt: FieldValue.serverTimestamp(),
    };

    if (typeof actor === 'string' && actor) {
      tombstoneData.deletedBy = actor;
    } else if (actor && typeof actor === 'object') {
      if (actor.email) tombstoneData.deletedBy = actor.email;
      else if (actor.name) tombstoneData.deletedBy = actor.name;
      if (actor.name) tombstoneData.deletedByName = actor.name;
      if (actor.uid) tombstoneData.deletedByUid = actor.uid;
    }

    await tombstoneRef.set(tombstoneData, { merge: true });
  } catch (error) {
    console.error(`Failed to record tombstone for ${collectionName}/${docId}:`, error);
  }
}

/**
 * Saves a complete audit log entry of a deleted document into /deletion_logs
 * with its pre-deletion data snapshot, collection name, docId, and actor metadata.
 */
export async function recordDeletionLog(
  db: admin.firestore.Firestore,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  actor?: { email?: string; name?: string; uid?: string } | string,
  source: 'cloud_function_trigger' | 'client_action' | 'admin_script' = 'cloud_function_trigger',
): Promise<string | undefined> {
  try {
    const timestamp = new Date().toISOString();
    const logId = `${collectionName}_${docId}_${Date.now()}`;
    const logRef = db.collection(FirestoreCollection.DeletionLogs).doc(logId);

    let deletedBy = 'unknown';
    let deletedByName = '';
    let deletedByUid = '';

    if (typeof actor === 'string' && actor) {
      deletedBy = actor;
    } else if (actor && typeof actor === 'object') {
      deletedBy = actor.email || actor.name || actor.uid || 'unknown';
      deletedByName = actor.name || '';
      deletedByUid = actor.uid || '';
    }

    // Clean up undefined fields in data snapshot so Firestore doesn't reject them
    const sanitizedData = JSON.parse(JSON.stringify(data));

    const logEntry: DeletionLogEntry<Record<string, unknown>> = {
      id: logId,
      collectionName,
      docId,
      deletedAt: timestamp,
      deletedBy,
      deletedByName,
      deletedByUid,
      source,
      data: sanitizedData,
    };

    await logRef.set({
      ...logEntry,
      loggedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `[Audit] Deletion log recorded in ${FirestoreCollection.DeletionLogs}/${logId} for ${collectionName}/${docId} by ${deletedBy}`,
    );
    return logId;
  } catch (error) {
    console.error(`Failed to record deletion log for ${collectionName}/${docId}:`, error);
    return undefined;
  }
}

