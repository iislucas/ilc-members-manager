/* member-docs-for-email.ts
 *
 * The single answer to "which member documents belong to this login email?",
 * shared by the pre-auth checkEmailStatus and the post-auth getUserDetails.
 *
 * Both used to answer the question separately and disagreed: checkEmailStatus
 * trusted any memberDocIds listed in /acl/{email}, while getUserDetails dropped
 * IDs whose member document no longer existed. A stale ACL entry therefore
 * produced "We found your membership record" before sign-in and "We could not
 * find your profile" (followed by a forced sign-out) after it.
 *
 * Resolution order:
 * 1. The member docs listed in /acl/{email}.memberDocIds that still exist.
 * 2. Otherwise, members whose `emails` array contains the address (the
 *    normalised form, then the raw form for legacy un-normalised data).
 */

import * as admin from 'firebase-admin';
import { ACL } from './data-model/system';
import { FirestoreCollection } from './data-model/collections';

export type MemberDocsForEmail = {
  // The /acl/{email} document's data, or null when there is no ACL entry.
  acl: ACL | null;
  // Existing member documents linked to the email (possibly empty).
  memberDocs: admin.firestore.DocumentSnapshot[];
  // True when memberDocs came from the members query rather than the ACL,
  // i.e. the ACL is missing or out of date and should be repaired.
  aclNeedsRepair: boolean;
};

// `email` must already be normalised; `rawEmail` is the address as typed or as
// held by Firebase Auth, tried as a fallback for legacy un-normalised data.
export async function findMemberDocsForEmail(
  db: admin.firestore.Firestore,
  email: string,
  rawEmail?: string,
): Promise<MemberDocsForEmail> {
  const aclSnap = await db.collection(FirestoreCollection.Acl).doc(email).get();
  const acl = aclSnap.exists ? (aclSnap.data() as ACL) : null;

  const listedIds = acl?.memberDocIds ?? [];
  if (listedIds.length > 0) {
    const refs = listedIds.map((id) => db.collection(FirestoreCollection.Members).doc(id));
    const existing = (await db.getAll(...refs)).filter((snap) => snap.exists);
    if (existing.length > 0) {
      return { acl, memberDocs: existing, aclNeedsRepair: false };
    }
  }

  let query = await db
    .collection(FirestoreCollection.Members)
    .where('emails', 'array-contains', email)
    .get();
  const trimmedRaw = rawEmail?.trim();
  if (query.empty && trimmedRaw && trimmedRaw !== email) {
    query = await db
      .collection(FirestoreCollection.Members)
      .where('emails', 'array-contains', trimmedRaw)
      .get();
  }

  return {
    acl,
    memberDocs: query.docs,
    aclNeedsRepair: !query.empty,
  };
}
