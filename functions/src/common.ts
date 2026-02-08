import { environment } from './environment/environment';
import * as admin from 'firebase-admin';
import { Member, School } from './data-model';
import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';

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
        return { ...memberDoc.data(), id: memberDoc.id } as Member;
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
    return { ...doc.data(), id: doc.id } as Member;
  }

  throw new HttpsError('not-found', 'Member not found');
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
  const member = await getMemberByEmail(request.auth.token.email, db);
  if (!member.isAdmin) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to perform this action.',
    );
  }
  return member;
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
  const member = await getMemberByEmail(request.auth.token.email, db);
  if (member.isAdmin) {
    return member;
  }

  // School manager/owner query
  const schoolsOwnedQuery = db
    .collection('schools')
    .where('owner', '==', member.memberId)
    .get();
  const schoolsManagedQuery = db
    .collection('schools')
    .where('managers', 'array-contains', member.memberId)
    .get();

  const [schoolsOwnedSnapshot, schoolsManagedSnapshot] = await Promise.all([
    schoolsOwnedQuery,
    schoolsManagedQuery,
  ]);

  if (schoolsOwnedSnapshot.empty && schoolsManagedSnapshot.empty) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to perform this action.',
    );
  }

  return member;
}
