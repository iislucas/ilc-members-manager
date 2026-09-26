/*
 * Emulator-driven e2e tests for Timestamp reading, writing, and preservation.
 *
 * Verifies that:
 * 1. Native Firestore Timestamp instances are correctly written and read back
 *    as real Timestamp instances (not converted to strings or plain objects).
 * 2. FieldValue.serverTimestamp() evaluates to a native Firestore Timestamp.
 * 3. Deletion triggers write native Timestamps for `deletedAt` in both
 *    /system/deletions/{collection}/{id} and /deletion_logs.
 * 4. Document snapshots stored in /deletion_logs retain their native Timestamp
 *    instances (e.g. `lastUpdated`) without serialization degradation.
 * 5. Restoring a deleted document from /deletion_logs writes native Timestamps
 *    back to Firestore, preserving full data model integrity.
 * 6. Callable Cloud Functions (`deleteVideoFromCatalog`) record typed
 *    tombstones and deletion logs with native Timestamps.
 *
 * Run via `pnpm test:e2e`.
 */

process.env['FIRESTORE_EMULATOR_HOST'] ||= '127.0.0.1:8080';
process.env['FIREBASE_AUTH_EMULATOR_HOST'] ||= '127.0.0.1:9099';

import * as admin from 'firebase-admin';
import { describe, expect, it } from 'vitest';
import { db, waitFor, fakeIdToken, callFunction } from './emulator-helpers';
import { initMember, firestoreDocToMember } from '../../functions/src/data-model/members';
import { initSchool, firestoreDocToSchool, type SchoolFsDoc } from '../../functions/src/data-model/schools';
import { initGrading, firestoreDocToGrading, type GradingFsDoc } from '../../functions/src/data-model/gradings';
import { initVideoItem, type VideoItemFsDoc } from '../../functions/src/data-model/vod';
import { firestoreDocToTombstone } from '../../functions/src/data-model/system';
import { sanitizeForFirestore } from '../../functions/src/common';
import { InstructorLicenseType } from '../../functions/src/data-model/curriculum';
import {
  DeletionSource,
  DeletionTriggerKind,
  CascadeCase,
  type DeletionLogEntry,
  type CascadedDeletionTrigger,
} from '../../functions/src/data-model/deletion-logs';

describe('story: timestamps-and-deletions', () => {
  it('writes and reads native Firestore Timestamp instances without corruption', async () => {
    const schoolId = `school-write-${Date.now()}`;
    const testDate = new Date('2026-06-15T10:30:00.000Z');
    const nativeTs = admin.firestore.Timestamp.fromDate(testDate);

    await db.collection('schools').doc(schoolId).set({
      ...initSchool(),
      schoolName: 'Timestamp Test Academy',
      schoolId: 'TSTA-01',
      lastUpdated: nativeTs,
    });

    const snap = await db.collection('schools').doc(schoolId).get();
    expect(snap.exists).toBe(true);

    const rawData = snap.data() as SchoolFsDoc;
    // Must be a real Firestore Timestamp with methods and numeric properties
    expect(rawData.lastUpdated instanceof admin.firestore.Timestamp).toBe(true);
    expect(rawData.lastUpdated.toDate().toISOString()).toBe('2026-06-15T10:30:00.000Z');
    expect(typeof rawData.lastUpdated.seconds).toBe('number');
    expect(typeof rawData.lastUpdated.nanoseconds).toBe('number');

    // Model converter normalizes to standard ISO string for frontend client
    const school = firestoreDocToSchool(snap);
    expect(typeof school.lastUpdated).toBe('string');
    expect(school.lastUpdated).toBe('2026-06-15T10:30:00.000Z');
  });

  it('evaluates FieldValue.serverTimestamp() as a native Timestamp in Firestore', async () => {
    const gradingId = `grading-write-${Date.now()}`;

    await db.collection('gradings').doc(gradingId).set({
      ...initGrading(),
      level: 'Student 1',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    const snap = await db.collection('gradings').doc(gradingId).get();
    expect(snap.exists).toBe(true);

    const rawData = snap.data() as GradingFsDoc;
    expect(rawData.lastUpdated instanceof admin.firestore.Timestamp).toBe(true);

    const writeTime = rawData.lastUpdated.toDate().getTime();
    const diffMs = Math.abs(Date.now() - writeTime);
    expect(diffMs).toBeLessThan(15000);

    const grading = firestoreDocToGrading(snap);
    expect(typeof grading.lastUpdated).toBe('string');
    expect(new Date(grading.lastUpdated).getTime()).toBe(writeTime);
  });

  it('preserves native Timestamps in document snapshot during deletion and writes native Timestamp for deletedAt', async () => {
    const schoolDocId = `school-del-${Date.now()}`;
    const originalDate = new Date('2026-07-04T12:00:00.000Z');
    const originalTs = admin.firestore.Timestamp.fromDate(originalDate);

    // 1. Pre-record tombstone with actor metadata as the client does
    await db.collection('system').doc('deletions').collection('schools').doc(schoolDocId).set({
      docId: schoolDocId,
      collection: 'schools',
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletedBy: 'admin-tester@example.com',
      deletedByName: 'Admin Tester',
      deletedByUid: 'uid-admin-tester',
    });

    // 2. Create the school document with native Timestamp
    await db.collection('schools').doc(schoolDocId).set({
      ...initSchool(),
      schoolName: 'School to be deleted',
      schoolId: 'DEL-01',
      lastUpdated: originalTs,
    });

    // 3. Delete the document, triggering onSchoolDeleted
    await db.collection('schools').doc(schoolDocId).delete();

    // 4. Wait for onSchoolDeleted trigger to record /deletion_logs
    const logSnap = await waitFor(
      async () => {
        const res = await db
          .collection('deletion_logs')
          .where('collectionName', '==', 'schools')
          .where('docId', '==', schoolDocId)
          .limit(1)
          .get();
        return res.empty ? undefined : res.docs[0];
      },
      (doc) => !!doc,
      'school deletion audit log',
    );

    const logData = logSnap.data() as DeletionLogEntry<SchoolFsDoc>;

    // Verify deletedAt is a native Timestamp
    expect(logData.deletedAt instanceof admin.firestore.Timestamp).toBe(true);
    expect(logData.deletedBy).toBe('admin-tester@example.com');
    expect(logData.deletedByName).toBe('Admin Tester');
    expect(logData.deletedByUid).toBe('uid-admin-tester');
    expect(logData.source).toBe(DeletionSource.CloudFunctionTrigger);

    // CRITICAL: Verify that the document snapshot in the audit log preserved the native Timestamp!
    expect(logData.data.lastUpdated instanceof admin.firestore.Timestamp).toBe(true);
    expect(logData.data.lastUpdated.toDate().toISOString()).toBe('2026-07-04T12:00:00.000Z');

    // 5. Verify tombstone in /system/deletions/schools/{schoolDocId}
    const tombstoneSnap = await db
      .collection('system')
      .doc('deletions')
      .collection('schools')
      .doc(schoolDocId)
      .get();

    expect(tombstoneSnap.exists).toBe(true);
    const tombstone = firestoreDocToTombstone(tombstoneSnap);
    expect(tombstone.deletedAt instanceof admin.firestore.Timestamp).toBe(true);
    expect(tombstone.deletedBy).toBe('admin-tester@example.com');
    expect(tombstone.deletedByName).toBe('Admin Tester');
    expect(tombstone.deletedByUid).toBe('uid-admin-tester');

    // 6. Test restoration from the deletion log: writing snapshot back to Firestore
    await db.collection('schools').doc(schoolDocId).set(logData.data);

    const restoredSnap = await db.collection('schools').doc(schoolDocId).get();
    expect(restoredSnap.exists).toBe(true);

    const restoredData = restoredSnap.data() as SchoolFsDoc;
    // Native Timestamp survives the complete cycle: original -> deletion log -> restored document
    expect(restoredData.lastUpdated instanceof admin.firestore.Timestamp).toBe(true);
    expect(restoredData.lastUpdated.toDate().toISOString()).toBe('2026-07-04T12:00:00.000Z');

    const restoredSchool = firestoreDocToSchool(restoredSnap);
    expect(restoredSchool.lastUpdated).toBe('2026-07-04T12:00:00.000Z');
    expect(restoredSchool.schoolName).toBe('School to be deleted');
  });

  it('preserves native Timestamps when deleting video via deleteVideoFromCatalog callable', async () => {
    const adminEmail = `video-admin-${Date.now()}@example.com`;
    const adminUid = `uid-${Date.now()}`;

    // 1. Seed admin ACL and member
    await db.collection('acl').doc(adminEmail).set({
      isAdmin: true,
      memberDocIds: [`mem-${adminUid}`],
      schoolDocIds: [],
    });
    await db.collection('members').doc(`mem-${adminUid}`).set({
      ...initMember(),
      name: 'Video Admin User',
      emails: [adminEmail],
    });

    // 2. Create video document with native Timestamp
    const videoId = `video-ts-${Date.now()}`;
    const videoDate = new Date('2026-08-10T09:15:00.000Z');
    const videoTs = admin.firestore.Timestamp.fromDate(videoDate);

    await db.collection('videos').doc(videoId).set({
      ...initVideoItem(),
      title: 'VOD Timestamp Verification Video',
      lastUpdated: videoTs,
    });

    // 3. Call deleteVideoFromCatalog callable function as the authenticated admin
    const token = fakeIdToken(adminUid, adminEmail);
    const res = await callFunction('deleteVideoFromCatalog', { videoId }, token);

    expect(res.status).toBe(200);
    expect(res.body.result?.success).toBe(true);
    expect(res.body.result?.videoId).toBe(videoId);

    // 4. Verify video doc was deleted
    const deletedVideoSnap = await db.collection('videos').doc(videoId).get();
    expect(deletedVideoSnap.exists).toBe(false);

    // 5. Verify tombstone in /system/deletions/videos/{videoId}
    const tSnap = await db
      .collection('system')
      .doc('deletions')
      .collection('videos')
      .doc(videoId)
      .get();

    expect(tSnap.exists).toBe(true);
    const tombstone = firestoreDocToTombstone(tSnap);
    expect(tombstone.deletedAt instanceof admin.firestore.Timestamp).toBe(true);
    expect(tombstone.deletedBy).toBe(adminEmail);
    expect(tombstone.deletedByName).toBe('Video Admin User');
    expect(tombstone.deletedByUid).toBe(adminUid);

    // 6. Verify deletion log in /deletion_logs
    const vLogSnap = await waitFor(
      async () => {
        const query = await db
          .collection('deletion_logs')
          .where('collectionName', '==', 'videos')
          .where('docId', '==', videoId)
          .limit(1)
          .get();
        return query.empty ? undefined : query.docs[0];
      },
      (doc) => !!doc,
      'video deletion log',
    );

    const vLogData = vLogSnap.data() as DeletionLogEntry<VideoItemFsDoc>;
    expect(vLogData.deletedAt instanceof admin.firestore.Timestamp).toBe(true);
    expect(vLogData.deletedBy).toBe(adminEmail);
    expect(vLogData.deletedByName).toBe('Video Admin User');
    expect(vLogData.deletedByUid).toBe(adminUid);
    expect(vLogData.source).toBe(DeletionSource.ClientAction);

    // Verify snapshot preserved native Timestamp
    expect(vLogData.data.lastUpdated instanceof admin.firestore.Timestamp).toBe(true);
    expect(vLogData.data.lastUpdated.toDate().toISOString()).toBe('2026-08-10T09:15:00.000Z');
  });

  it('sanitizeForFirestore reconstructs serialized {_seconds, _nanoseconds} into native Timestamps', async () => {
    // When objects from external JSON payloads or un-migrated backups contain plain timestamp maps
    const rawPayload = {
      name: 'Reconstructed Timestamp Member',
      lastUpdated: { _seconds: 1774350000, _nanoseconds: 250000000 },
      nested: {
        eventTime: { seconds: 1774350000, nanoseconds: 500000000 },
      },
    };

    const sanitized = sanitizeForFirestore(rawPayload, admin.firestore.Timestamp);

    const testDocId = `reconstruct-ts-${Date.now()}`;
    await db.collection('members').doc(testDocId).set({
      ...initMember(),
      ...sanitized,
    });

    const snap = await db.collection('members').doc(testDocId).get();
    expect(snap.exists).toBe(true);

    const docData = snap.data()!;
    // Top-level field converted to real Firestore Timestamp
    expect(docData['lastUpdated'] instanceof admin.firestore.Timestamp).toBe(true);
    expect(docData['lastUpdated'].seconds).toBe(1774350000);
    expect(docData['lastUpdated'].nanoseconds).toBe(250000000);

    // Nested field converted to real Firestore Timestamp
    expect(docData['nested']['eventTime'] instanceof admin.firestore.Timestamp).toBe(true);
    expect(docData['nested']['eventTime'].seconds).toBe(1774350000);
    expect(docData['nested']['eventTime'].nanoseconds).toBe(500000000);

    // Normalization to ISO string works smoothly
    const member = firestoreDocToMember(snap);
    expect(typeof member.lastUpdated).toBe('string');
  });

  it('records MECE cascaded deletion log and tombstone without requiring email when member deletion triggers cascade', async () => {
    const memId = `mem-cascade-${Date.now()}`;
    const testDate = new Date('2026-09-01T15:00:00.000Z');
    const nativeTs = admin.firestore.Timestamp.fromDate(testDate);

    // 1. Create a member with instructor credentials
    await db.collection('members').doc(memId).set({
      ...initMember(),
      name: 'Cascaded Audit Instructor',
      memberId: 'IT88',
      instructorId: 'I-88',
      instructorLicenseType: InstructorLicenseType.Life,
      emails: [`instructor-${Date.now()}@example.com`],
      lastUpdated: nativeTs,
    });

    // 2. Create the mirrored instructor profile doc
    await db.collection('instructors').doc(memId).set({
      name: 'Cascaded Audit Instructor',
      memberId: 'IT88',
      instructorId: 'I-88',
      instructorLicenseType: InstructorLicenseType.Life,
      lastUpdated: nativeTs,
    });

    // Verify instructor exists before cascade
    const preSnap = await db.collection('instructors').doc(memId).get();
    expect(preSnap.exists).toBe(true);

    // 3. Delete the parent member doc to trigger onMemberDeleted
    await db.collection('members').doc(memId).delete();

    // 4. Wait for the mirrored instructor doc to be deleted by cascade trigger
    await waitFor(
      async () => {
        const instSnap = await db.collection('instructors').doc(memId).get();
        return instSnap.exists ? undefined : true;
      },
      (deleted) => deleted === true,
      'cascaded instructor deletion',
    );

    // 5. Verify cascaded deletion log in /deletion_logs
    const logSnap = await waitFor(
      async () => {
        const res = await db
          .collection('deletion_logs')
          .where('collectionName', '==', 'instructors')
          .where('docId', '==', memId)
          .limit(1)
          .get();
        return res.empty ? undefined : res.docs[0];
      },
      (doc) => !!doc,
      'cascaded instructor deletion log',
    );

    const logData = logSnap.data() as DeletionLogEntry<Record<string, unknown>>;
    expect(logData.deletedAt instanceof admin.firestore.Timestamp).toBe(true);
    expect(logData.source).toBe(DeletionSource.CloudFunctionTrigger);

    // Trigger metadata must be MECE CascadedDeletionTrigger
    expect(logData.trigger).toBeDefined();
    expect(logData.trigger.kind).toBe(DeletionTriggerKind.Cascaded);
    const cascadedTrigger = logData.trigger as CascadedDeletionTrigger;
    expect(cascadedTrigger.cascadeCase).toBe(CascadeCase.MemberDeletedToInstructorProfile);
    expect(cascadedTrigger.sourceCollection).toBe('members');
    expect(cascadedTrigger.sourceDocId).toBe(memId);
    expect(cascadedTrigger.sourceName).toBe('Cascaded Audit Instructor');

    // Backward-compatible summary fields describe the cascade without requiring a user email
    expect(logData.deletedBy).toBe(`cascaded:members/${memId}`);
    expect(logData.deletedByName).toBe(
      `Cascaded from Cascaded Audit Instructor (${CascadeCase.MemberDeletedToInstructorProfile})`,
    );

    // Document snapshot in deletion log must preserve native Timestamp
    expect(logData.data['lastUpdated'] instanceof admin.firestore.Timestamp).toBe(true);
    const lastUpdatedMs = (logData.data['lastUpdated'] as admin.firestore.Timestamp).toDate().getTime();
    expect(Math.abs(Date.now() - lastUpdatedMs)).toBeLessThan(60000);
    expect(logData.data['name']).toBe('Cascaded Audit Instructor');
    expect(logData.data['instructorId']).toBe('I-88');

    // 6. Verify tombstone in /system/deletions/instructors/{memId}
    const tombstoneSnap = await db
      .collection('system')
      .doc('deletions')
      .collection('instructors')
      .doc(memId)
      .get();

    expect(tombstoneSnap.exists).toBe(true);
    const tombstone = firestoreDocToTombstone(tombstoneSnap);
    expect(tombstone.deletedAt instanceof admin.firestore.Timestamp).toBe(true);
    expect(tombstone.triggerKind).toBe(DeletionTriggerKind.Cascaded);
    expect(tombstone.cascadeCase).toBe(CascadeCase.MemberDeletedToInstructorProfile);
    expect(tombstone.sourceCollection).toBe('members');
    expect(tombstone.sourceDocId).toBe(memId);
    expect(tombstone.sourceName).toBe('Cascaded Audit Instructor');
    expect(tombstone.deletedBy).toBe(`cascaded:members/${memId}`);
  });
});
