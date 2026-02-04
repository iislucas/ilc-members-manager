import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import { serverTimestamp } from 'firebase/firestore';
import type {
  Member,
  School,
  InstructorPublicData,
} from '../functions/src/data-model';

type Firestore = firebase.default.firestore.Firestore;

const PROJECT_ID = 'ilc-members-manager-tests';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function setupSchool(db: Firestore, school: School) {
  await db.collection('schools').doc(school.id).set(school);
}

async function setupMember(db: Firestore, member: Member) {
  await db.collection('members').doc(member.id).set(member);
  // Auto-create ACL
  for (const email of member.emails) {
    await db
      .collection('acl')
      .doc(email)
      .set({
        memberDocIds: [member.id],
        isAdmin: false,
      });
  }
}

async function setupInstructor(
  db: Firestore,
  instructor: InstructorPublicData,
) {
  await db.collection('instructors').doc(instructor.id).set(instructor);
  // 2. Create Member Profile
  await setupMember(db, instructor as Member);
}

async function setupStudentWithSifu(db: Firestore, student: Member) {
  // 1. Create Student Member
  await setupMember(db, student);

  // 2. Cache student data in Instructor's subcollection
  // Note: This matches /instructors/{instructorDocId}/members/{studentDocId}
  await db
    .collection('instructors')
    .doc(student.sifuInstructorId)
    .collection('members')
    .doc(student.id)
    .set(student);
}

async function setupAdmin(db: Firestore, email: string) {
  await db.collection('acl').doc(email).set({
    isAdmin: true,
    memberDocIds: [],
  });
}

describe('Firestore Rules', () => {
  let testEnv: RulesTestEnvironment;

  before(async () => {
    // Load rules from the file
    const rules = fs.readFileSync('firestore.rules', 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: rules,
        host: '127.0.0.1',
        port: 8080, // Default emulator port
      },
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    // Setup basic data for testing permissions
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // Admin Setup
      await setupAdmin(db, 'admin@ilc.com');

      await setupSchool(db, {
        id: 'FirestoreDocID-school1',
        schoolId: 'SCH-001',
        owner: 'MEM-OWNER',
        ownerEmail: 'school_owner@ilc.com',
        managers: ['MEM-MANAGER'],
        managerEmails: ['school_manager@ilc.com'],
      } as School);

      // Member 1 (Regular)
      await setupMember(db, {
        id: 'FirestoreDocID-member1',
        memberId: 'MEM-001',
        emails: ['member1@ilc.com'],
        managingOrgId: 'hq',
      } as Member);

      // Instructor 1 (Public Instructor)
      await setupInstructor(db, {
        id: 'FirestoreDocID-instructor1',
        instructorId: 'INST-001',
        memberId: 'MEM-INST1',
        emails: ['instructor1@ilc.com'],
        name: 'Sifu Jones',
      } as Member);

      // Instructor 2
      await setupInstructor(db, {
        id: 'FirestoreDocID-instructor2',
        instructorId: 'INST-002',
        memberId: 'MEM-INST2',
        emails: ['instructor2@ilc.com'],
        name: 'Sifu Smith',
      } as Member);

      // Member 2 (Student of Instructor 1, Managed by School 1)
      await setupStudentWithSifu(db, {
        id: 'FirestoreDocID-student1',
        memberId: 'MEM-002',
        emails: ['student1@ilc.com'],
        sifuInstructorId: 'INST-001',
        managingOrgId: 'FirestoreDocID-school1',
      } as Member);

      // Member 3 (Student of Instructor 2)
      await setupStudentWithSifu(db, {
        id: 'FirestoreDocID-student2',
        memberId: 'MEM-003',
        emails: ['student2@ilc.com'],
        sifuInstructorId: 'INST-002',
        managingOrgId: 'hq',
      } as Member);
    });
  });

  describe('Instructors Collection', () => {
    it('should allow anyone to read public instructor data', async () => {
      const publicDb = testEnv
        .authenticatedContext('user_id', { email: 'user@test.com' })
        .firestore();
      await assertSucceeds(
        publicDb
          .collection('instructors')
          .doc('FirestoreDocID-instructor1')
          .get(),
      );

      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertSucceeds(
        unauthDb
          .collection('instructors')
          .doc('FirestoreDocID-instructor1')
          .get(),
      );
    });

    it('should deny writes to instructor data from client SDKs (even admins)', async () => {
      const db = testEnv
        .authenticatedContext('admin@ilc.com', { email: 'admin@ilc.com' })
        .firestore(); // Authorized as admin
      // Even admins cannot write via Client SDK to /instructors/ (it's managed by Cloud Functions)
      await assertFails(
        db
          .collection('instructors')
          .doc('FirestoreDocID-instructor1')
          .set({ foo: 'bar' }),
      );
    });

    // Sub-collection /instructors/{id}/members/{studentId}
    it('should allow instructor to read their own cached students', async () => {
      const db = testEnv
        .authenticatedContext('instructor1', { email: 'instructor1@ilc.com' })
        .firestore();
      await assertSucceeds(
        db
          .collection('instructors')
          .doc('FirestoreDocID-instructor1')
          .collection('members')
          .doc('FirestoreDocID-student1')
          .get(),
      );
    });

    it('should deny instructor reading OTHER instructors cached students', async () => {
      const db = testEnv
        .authenticatedContext('instructor1', { email: 'instructor1@ilc.com' })
        .firestore();
      await assertFails(
        db
          .collection('instructors')
          .doc('FirestoreDocID-instructor2')
          .collection('members')
          .doc('FirestoreDocID-student2')
          .get(),
      );
    });
  });

  describe('Members Collection', () => {
    // 1. Owner Access
    it('should allow a member to read their own doc', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore(); // docId vs uid mismatch? Rules don't check uid, they check email match in /acl/email
      await assertSucceeds(
        db.collection('members').doc('FirestoreDocID-member1').get(),
      );
    });

    it('should allow a member to update allowed fields on their own doc', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore();
      await assertSucceeds(
        db.collection('members').doc('FirestoreDocID-member1').update({
          phone: '123456',
          lastUpdated: serverTimestamp(), // isValidEdit requires time check
        }),
      );
    });

    it('should deny a member updating restricted fields (e.g. isAdmin)', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore();
      await assertFails(
        db.collection('members').doc('FirestoreDocID-member1').update({
          isAdmin: true,
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should deny update if lastUpdated is missing or incorrect', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore();
      await assertFails(
        db.collection('members').doc('FirestoreDocID-member1').update({
          phone: '999999',
          // Missing lastUpdated: serverTimestamp()
        }),
      );
    });

    // 2. Cross-Member Access
    it('should deny a member reading someone elses doc', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore();
      await assertFails(
        db.collection('members').doc('FirestoreDocID-student1').get(),
      );
    });

    // 3. Admin Access
    it('should allow admin to read and write any member', async () => {
      const db = testEnv
        .authenticatedContext('admin_user', { email: 'admin@ilc.com' })
        .firestore();
      await assertSucceeds(
        db.collection('members').doc('FirestoreDocID-member1').get(),
      );
      await assertSucceeds(
        db.collection('members').doc('FirestoreDocID-member1').update({
          notes: 'Admin was here',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    // 4. School Manager Access
    it('should allow school manager to read members of their school', async () => {
      const db = testEnv
        .authenticatedContext('owner_user', { email: 'school_owner@ilc.com' })
        .firestore(); // Owner
      await assertSucceeds(
        db.collection('members').doc('FirestoreDocID-student1').get(),
      );

      const db2 = testEnv
        .authenticatedContext('manager_user', {
          email: 'school_manager@ilc.com',
        })
        .firestore(); // Manager
      await assertSucceeds(
        db2.collection('members').doc('FirestoreDocID-student1').get(),
      );
    });

    it('should allow school manager to update restricted fields (e.g. notes) for members of their school', async () => {
      const db = testEnv
        .authenticatedContext('manager_user', {
          email: 'school_manager@ilc.com',
        })
        .firestore();
      // Rule: allow write: if isValidEdit() && (isAdmin() || isManagerOfMemberSchool());
      // This rule doesn't have field restrictions, unlike the owner update rule.
      await assertSucceeds(
        db.collection('members').doc('FirestoreDocID-student1').update({
          notes: 'Manager updated restricted field',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should deny owner updating restricted fields (e.g. notes)', async () => {
      const db = testEnv
        .authenticatedContext('student1', { email: 'student1@ilc.com' })
        .firestore();
      await assertFails(
        db.collection('members').doc('FirestoreDocID-student1').update({
          notes: 'I am trying to change my notes',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should deny school manager to create a member (must be done by admin or function)', async () => {
      const db = testEnv
        .authenticatedContext('manager_user', {
          email: 'school_manager@ilc.com',
        })
        .firestore();
      await assertFails(
        db
          .collection('members')
          .doc('new-student')
          .set({
            memberId: 'MEM-NEW',
            managingOrgId: 'FirestoreDocID-school1',
            emails: ['new@test.com'],
            lastUpdated: serverTimestamp(),
          }),
      );
    });

    it('should deny school manager accessing members NOT in their school', async () => {
      const db = testEnv
        .authenticatedContext('manager_user', {
          email: 'school_manager@ilc.com',
        })
        .firestore();
      await assertFails(
        db.collection('members').doc('FirestoreDocID-member1').get(),
      ); // member1 is in 'hq'
    });

    it('should allow admin to delete a member', async () => {
      const db = testEnv
        .authenticatedContext('admin_user', { email: 'admin@ilc.com' })
        .firestore();
      await assertSucceeds(
        db.collection('members').doc('FirestoreDocID-member1').delete(),
      );
    });

    it('should deny non-admin to delete a member', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore();
      await assertFails(
        db.collection('members').doc('FirestoreDocID-member1').delete(),
      );
    });
  });

  describe('Schools Collection', () => {
    it('should allow anyone to read schools', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertSucceeds(
        db.collection('schools').doc('FirestoreDocID-school1').get(),
      );
    });

    it('should allow school owner to update allowed fields', async () => {
      const db = testEnv
        .authenticatedContext('school_owner', {
          email: 'school_owner@ilc.com',
        })
        .firestore();
      await assertSucceeds(
        db.collection('schools').doc('FirestoreDocID-school1').update({
          schoolWebsite: 'https://new-website.com',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should deny school owner updating restricted fields', async () => {
      const db = testEnv
        .authenticatedContext('school_owner', {
          email: 'school_owner@ilc.com',
        })
        .firestore();
      await assertFails(
        db.collection('schools').doc('FirestoreDocID-school1').update({
          schoolId: 'NEW-ID',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should allow school manager to update allowed fields', async () => {
      const db = testEnv
        .authenticatedContext('school_manager', {
          email: 'school_manager@ilc.com',
        })
        .firestore();
      await assertSucceeds(
        db.collection('schools').doc('FirestoreDocID-school1').update({
          schoolAddress: '123 New St',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should allow admin to write (create) a school', async () => {
      const db = testEnv
        .authenticatedContext('admin', { email: 'admin@ilc.com' })
        .firestore();
      await assertSucceeds(
        db.collection('schools').doc('new-school').set({
          schoolId: 'SCH-NEW',
          schoolName: 'New School',
          ownerEmail: 'owner@new.com',
          managerEmails: [],
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should deny non-admin to write (create) a school', async () => {
      const db = testEnv
        .authenticatedContext('user', { email: 'user@test.com' })
        .firestore();
      await assertFails(
        db.collection('schools').doc('new-school').set({
          schoolId: 'SCH-NEW',
          schoolName: 'New School',
          lastUpdated: serverTimestamp(),
        }),
      );
    });
  });

  describe('ACL Collection', () => {
    it('should allow user to read their own ACL', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore();
      await assertSucceeds(db.collection('acl').doc('member1@ilc.com').get());
    });

    it('should deny user to read someone elses ACL', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore();
      await assertFails(db.collection('acl').doc('instructor1@ilc.com').get());
    });

    it('should allow admin to read and write any ACL', async () => {
      const db = testEnv
        .authenticatedContext('admin', { email: 'admin@ilc.com' })
        .firestore();
      await assertSucceeds(db.collection('acl').doc('member1@ilc.com').get());
      await assertSucceeds(
        db.collection('acl').doc('member1@ilc.com').update({
          isAdmin: true,
        }),
      );
    });

    it('should deny non-admin to write to ACL', async () => {
      const db = testEnv
        .authenticatedContext('member1', { email: 'member1@ilc.com' })
        .firestore();
      await assertFails(
        db.collection('acl').doc('member1@ilc.com').update({
          isAdmin: true,
        }),
      );
    });
  });

  describe('School Members Subcollection', () => {
    beforeEach(async () => {
      // Setup a cached member in a school
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db
          .collection('schools')
          .doc('FirestoreDocID-school1')
          .collection('members')
          .doc('FirestoreDocID-student1')
          .set({
            memberId: 'MEM-002',
          });
      });
    });

    it('should allow school manager to read members in their school subcollection', async () => {
      const db = testEnv
        .authenticatedContext('school_manager', {
          email: 'school_manager@ilc.com',
        })
        .firestore();
      await assertSucceeds(
        db
          .collection('schools')
          .doc('FirestoreDocID-school1')
          .collection('members')
          .doc('FirestoreDocID-student1')
          .get(),
      );
    });

    it('should deny others from reading school members subcollection', async () => {
      const db = testEnv
        .authenticatedContext('other_user', { email: 'other@test.com' })
        .firestore();
      await assertFails(
        db
          .collection('schools')
          .doc('FirestoreDocID-school1')
          .collection('members')
          .doc('FirestoreDocID-student1')
          .get(),
      );
    });
  });
});
