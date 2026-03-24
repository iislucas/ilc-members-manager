import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import { serverTimestamp } from 'firebase/firestore';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

/**
 * These tests reproduce the member-edit permissions scenario for two real users:
 *
 *   1. brett.drinkwater@iliqchuan.com — non-admin, no school, is owner of own member doc
 *   2. moilucasdixon@gmail.com        — non-admin, has school (not manager/owner), is owner of own member doc
 *
 * Both should be able to update a specific subset of allowed fields on their own
 * member document (the owner-update rule). The data below is a snapshot pulled
 * from the live database on 2026-02-26 via download-user-test-data.ts.
 *
 * To run:
 *   pnpm test:rules
 */

type Firestore = firebase.default.firestore.Firestore;

const PROJECT_ID = 'ilc-user-edit-permissions';

// ============================================================================
// Inline fixture data — snapshots from the live database (2026-02-26)
// ============================================================================

const BRETT = {
  email: 'brett.drinkwater@iliqchuan.com',
  acl: {
    memberDocIds: ['mSUDPNATSQa8uB55Oaq6'],
    isAdmin: false,
    instructorIds: ['263'],
  },
  member: {
    docId: 'mSUDPNATSQa8uB55Oaq6',
    data: {
      isAdmin: false,
      name: 'Brett Drinkwater',
      address: '3 Brockham Close, London',
      city: '',
      zipCode: 'SW19 7EQ',
      countyOrState: '',
      country: 'United Kingdom',
      phone: '',
      gender: 'male',
      dateOfBirth: '',
      memberId: 'UK28',
      membershipType: 'Life',
      currentMembershipExpires: '',
      mastersLevels: [],
      notes: '',
      id: 'mSUDPNATSQa8uB55Oaq6', // legacy field — NOT in Member type
      lastRenewalDate: '2019-02-21',
      instructorLicenseType: 'Annual',
      instructorLicenseExpires: '2026-11-12',
      instructorLicenseRenewalDate: '2025-08-25',
      firstMembershipStarted: '2019-02-21',
      studentLevel: '4',
      gradingDocIds: [],
      classVideoLibraryExpirationDate: '',
      applicationLevel: '2',
      classVideoLibrarySubscription: false,
      tags: [],
      instructorWebsite: 'www.facebook.com/martialartofawarenessuk',
      publicPhone: '(770) 629-5107',
      publicCountyOrState: 'Surrey',
      publicRegionOrCity: 'Tongham',
      publicEmail: 'brett@tian-yi.co.uk',
      instructorId: '263',
      primarySchoolDocId: '',
      primaryInstructorId: '105',
      primarySchoolId: '',
      emails: ['awakenedmonki0@gmail.com', 'brett.drinkwater@iliqchuan.com'],
      lastUpdated: '2026-02-25T08:28:48.508Z',
      docId: 'mSUDPNATSQa8uB55Oaq6',
    },
  },
};

const MOI = {
  email: 'moilucasdixon@gmail.com',
  acl: {
    isAdmin: false,
    memberDocIds: ['hUr2Qv3Q9hpx8KjlvkHy'],
    instructorIds: ['foo-1'],
  },
  member: {
    docId: 'hUr2Qv3Q9hpx8KjlvkHy',
    data: {
      isAdmin: false,
      memberId: 'FR102',
      membershipType: 'Annual',
      firstMembershipStarted: '',
      lastRenewalDate: '',
      currentMembershipExpires: '',
      instructorLicenseExpires: '',
      instructorLicenseRenewalDate: '',
      studentLevel: '',
      applicationLevel: '',
      mastersLevels: [],
      id: 'hUr2Qv3Q9hpx8KjlvkHy', // legacy field — NOT in Member type
      instructorLicenseType: 'Life',
      tags: [],
      notes: 'a change.',
      gradingDocIds: [],
      classVideoLibraryExpirationDate: '',
      docId: 'hUr2Qv3Q9hpx8KjlvkHy',
      classVideoLibrarySubscription: true,
      instructorId: 'foo-1',
      phone: '+33 648136124',
      emails: ['moilucasdixon+test@gmail.com', 'moilucasdixon@gmail.com'],
      country: 'United States',
      zipCode: '93500',
      gender: 'male',
      city: 'Pantin',
      countyOrState: 'Ile de France',
      name: 'moi ld',
      dateOfBirth: '2026-01-24',
      primaryInstructorId: '2',
      publicEmail: 'moilucasdixon+test@gmail.com',
      publicPhone: '+33 (0) 648136124',
      publicRegionOrCity: 'Pantin',
      publicCountyOrState: '',
      instructorWebsite: 'https://www.zxd.fr',
      address: 'new personal adresssss',
      lastUpdated: '2026-02-26T22:13:52.340Z',
      primarySchoolDocId: '8JbQZ3KbNDQPfI5QpbC2',
      primarySchoolId: 'SCH-101',
    },
  },
  school: {
    docId: '8JbQZ3KbNDQPfI5QpbC2',
    data: {
      schoolLicenseExpires: '',
      schoolCity: 'PANTIN',
      ownerInstructorId: '197',
      managerInstructorIds: [],
      schoolLicenseRenewalDate: '',
      managerEmails: [],
      schoolCountry: 'France',
      schoolAddress: '8 Rue Eugène et Marie-Louise Cornet\nApt 4',
      schoolWebsite: 'www.zxd.fr',
      schoolCountyOrState: 'Ile de France',
      schoolZipCode: '93500',
      schoolName: 'Zhong Xin Dao Paris',
      ownerEmail: 'lucas.dixon@gmail.com',
      docId: '8JbQZ3KbNDQPfI5QpbC2',
      lastUpdated: '2026-02-25T00:48:46.732Z',
      schoolId: 'SCH-101',
    },
  },
};

// Owner-allowed fields from firestore.rules:
// ['lastUpdated', 'name', 'instructorWebsite', 'publicRegionOrCity', 'publicCountyOrState',
//  'publicEmail', 'publicPhone', 'address', 'city', 'countyOrState', 'zipCode', 'country', 'phone',
//  'emails', 'gender', 'dateOfBirth', 'primaryInstructorId', 'primarySchoolId', 'primarySchoolDocId']

describe('User Edit Permissions (Live Data Fixtures)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    const rules = fs.readFileSync('firestore.rules', 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    // Seed the database with the inline fixture data
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // --- Brett ---
      await db.collection('acl').doc(BRETT.email).set(BRETT.acl);
      for (const alt of BRETT.member.data.emails) {
        if (alt !== BRETT.email) {
          await db.collection('acl').doc(alt).set({
            memberDocIds: [BRETT.member.docId],
            isAdmin: false,
            instructorIds: [],
          });
        }
      }
      await db.collection('members').doc(BRETT.member.docId).set(BRETT.member.data);

      // --- Moi ---
      await db.collection('acl').doc(MOI.email).set(MOI.acl);
      for (const alt of MOI.member.data.emails) {
        if (alt !== MOI.email) {
          await db.collection('acl').doc(alt).set({
            memberDocIds: [MOI.member.docId],
            isAdmin: false,
            instructorIds: [],
          });
        }
      }
      await db.collection('members').doc(MOI.member.docId).set(MOI.member.data);
      await db.collection('schools').doc(MOI.school.docId).set(MOI.school.data);
    });
  });

  // =====================================================================
  // Brett Drinkwater Tests
  // =====================================================================
  describe('brett.drinkwater@iliqchuan.com (owner, non-admin, no school)', () => {
    const email = 'brett.drinkwater@iliqchuan.com';
    const memberDocId = 'mSUDPNATSQa8uB55Oaq6';

    function getDb() {
      return testEnv
        .authenticatedContext('brett_uid', { email })
        .firestore();
    }

    it('should be able to read own member doc', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).get(),
      );
    });

    it('should be able to update allowed fields (name)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          name: 'Brett D.',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update allowed fields (phone, address)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          phone: '+44 7777 123456',
          address: 'New Address',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update allowed fields (publicEmail, publicPhone, publicRegionOrCity, publicCountyOrState)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          publicEmail: 'new-public@example.com',
          publicPhone: '+44 123',
          publicRegionOrCity: 'London',
          publicCountyOrState: 'Greater London',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update allowed fields (emails array)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          emails: ['awakenedmonki0@gmail.com', 'brett.drinkwater@iliqchuan.com', 'new@email.com'],
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update allowed fields (instructorWebsite)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          instructorWebsite: 'https://new-website.com',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update allowed fields (city, countyOrState, zipCode, country)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          city: 'London',
          countyOrState: 'Greater London',
          zipCode: 'SW1A 1AA',
          country: 'United Kingdom',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update allowed fields (gender, dateOfBirth)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          gender: 'male',
          dateOfBirth: '1990-01-01',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update allowed fields (primaryInstructorId, primarySchoolId, primarySchoolDocId)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          primaryInstructorId: '999',
          primarySchoolId: 'SCH-NEW',
          primarySchoolDocId: 'newSchoolDocId',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY updating restricted fields (isAdmin)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          isAdmin: true,
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY updating restricted fields (notes)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          notes: 'I am hacking my notes',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY updating restricted fields (memberId)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          memberId: 'HACKED',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY updating restricted fields (instructorId)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          instructorId: 'HACKED',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY updating restricted fields (studentLevel)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          studentLevel: '10',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY updating restricted fields (membershipType)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          membershipType: 'Annual',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY update without lastUpdated = serverTimestamp()', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          name: 'Brett new',
        }),
      );
    });

    it('should succeed when updating ONLY allowed fields (simulating what the app actually sends)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          name: 'Brett Drinkwater Updated',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should FAIL if the update includes the legacy "id" field', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          name: 'Brett Drinkwater Updated',
          id: 'CHANGED',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should FAIL if the update includes old field names (managingOrgId, sifuInstructorId)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          name: 'Brett Drinkwater Updated',
          managingOrgId: 'something',
          lastUpdated: serverTimestamp(),
        }),
      );
    });
  });

  // =====================================================================
  // moilucasdixon@gmail.com Tests
  // =====================================================================
  describe('moilucasdixon@gmail.com (owner, non-admin, has school but not manager)', () => {
    const email = 'moilucasdixon@gmail.com';
    const memberDocId = 'hUr2Qv3Q9hpx8KjlvkHy';

    function getDb() {
      return testEnv
        .authenticatedContext('moi_uid', { email })
        .firestore();
    }

    it('should be able to read own member doc', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).get(),
      );
    });

    it('should be able to update allowed fields (name)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          name: 'Moi LD Updated',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update allowed fields (address)', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          address: 'Newer address',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should be able to update multiple allowed fields at once', async () => {
      const db = getDb();
      await assertSucceeds(
        db.collection('members').doc(memberDocId).update({
          name: 'Updated Name',
          phone: '+33 999',
          address: 'New Place',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY updating restricted fields (notes)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          notes: 'hacked notes',
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should DENY updating restricted fields (isAdmin)', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          isAdmin: true,
          lastUpdated: serverTimestamp(),
        }),
      );
    });

    it('should FAIL if the update includes the legacy "id" field', async () => {
      const db = getDb();
      await assertFails(
        db.collection('members').doc(memberDocId).update({
          name: 'Moi Updated',
          id: 'CHANGED',
          lastUpdated: serverTimestamp(),
        }),
      );
    });
  });

  // =====================================================================
  // Cross-user access tests
  // =====================================================================
  describe('Cross-user access', () => {
    it('brett should NOT be able to read moi member doc', async () => {
      const db = testEnv
        .authenticatedContext('brett_uid', { email: 'brett.drinkwater@iliqchuan.com' })
        .firestore();
      await assertFails(
        db.collection('members').doc('hUr2Qv3Q9hpx8KjlvkHy').get(),
      );
    });

    it('moi should NOT be able to read brett member doc', async () => {
      const db = testEnv
        .authenticatedContext('moi_uid', { email: 'moilucasdixon@gmail.com' })
        .firestore();
      await assertFails(
        db.collection('members').doc('mSUDPNATSQa8uB55Oaq6').get(),
      );
    });

    it('brett should NOT be able to update moi member doc', async () => {
      const db = testEnv
        .authenticatedContext('brett_uid', { email: 'brett.drinkwater@iliqchuan.com' })
        .firestore();
      await assertFails(
        db.collection('members').doc('hUr2Qv3Q9hpx8KjlvkHy').update({
          name: 'Hacked',
          lastUpdated: serverTimestamp(),
        }),
      );
    });
  });
});
