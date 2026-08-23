import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from './common';
import { BlogPostSourceKind, blogPostSourceKind } from './data-model';

// Top-level collections holding authored (non-derived) data.
//
// Deliberately excluded, because every document is regenerable:
//   'instructors'      — public projection of /members, rebuilt by
//                        updateInstructorPublicProfile on member writes.
//   'mail'             — transient send queue for the Trigger Email extension.
//
// The blog-post collections are partly cached and partly authored; see
// BACKUP_MIXED_COLLECTIONS below.
const BACKUP_COLLECTIONS = [
  'members',
  'schools',
  'gradings',
  'orders',
  'acl',
  'system',
  'events',
  'videos',
  'video_grants',
  'statistics',
];

// Sub-collections holding authored data. A `db.collection(name).get()` returns
// only top-level documents, so these need their own collection-group queries.
// Each group below lives under /members/{memberDocId}/, and the full document
// path is recorded on every record so the parent is recoverable.
//
// Deliberately excluded, because they mirror a top-level collection:
//   members/{id}/orders, members/{id}/events,
//   schools/{id}/members, schools/{id}/gradings,
//   instructors/{id}/members, instructors/{id}/gradings,
//   system/deletions/{collection} (sync tombstones).
const BACKUP_SUBCOLLECTION_GROUPS = [
  'notifications',
  'uploads',
  'videoProgress',
  'videoGrants',
  'pushSubscriptions',
];

// Collections where cached and authored documents coexist. The blog-post
// collections are refilled from Squarespace by the content-cache sync, but
// that sync only prunes posts from its own source, so posts written from
// anywhere else are durable, authored data and must be backed up.
//
// A post is regenerable precisely when it came from the source that syncs the
// collection, since that sync will rewrite it. Reading the kind through
// blogPostSourceKind keeps this decision identical to the sync's own.
const BACKUP_MIXED_COLLECTIONS: {
  name: string;
  cachedFrom: BlogPostSourceKind;
}[] = [
  { name: 'members-post', cachedFrom: BlogPostSourceKind.Squarespace },
  { name: 'instructors-post', cachedFrom: BlogPostSourceKind.Squarespace },
];

/**
 * Common logic to perform the database backup to Cloud Storage.
 */
async function performBackup(): Promise<string> {
  logger.info('Starting database backup...');
  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket(); // Assume default bucket is configured

    type BackupRecord = admin.firestore.DocumentData & { id: string };
    const backupData: Record<string, BackupRecord[]> = {};

    for (const collectionName of BACKUP_COLLECTIONS) {
      logger.info(`Fetching collection: ${collectionName}`);
      const snapshot = await db.collection(collectionName).get();
      const records = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      backupData[collectionName] = records;
      logger.info(`Backed up ${records.length} records for ${collectionName}`);
    }

    for (const groupName of BACKUP_SUBCOLLECTION_GROUPS) {
      logger.info(`Fetching sub-collection group: ${groupName}`);
      const snapshot = await db.collectionGroup(groupName).get();
      const records = snapshot.docs.map((doc) => ({
        id: doc.id,
        // Full Firestore path, e.g. members/{memberDocId}/notifications/{id}.
        path: doc.ref.path,
        ...doc.data(),
      }));
      backupData[groupName] = records;
      logger.info(`Backed up ${records.length} records for ${groupName}`);
    }

    for (const { name, cachedFrom } of BACKUP_MIXED_COLLECTIONS) {
      logger.info(`Fetching authored documents from: ${name}`);
      const snapshot = await db.collection(name).get();
      const records = snapshot.docs
        .filter((doc) => blogPostSourceKind(doc.data()) !== cachedFrom)
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
      backupData[name] = records;
      logger.info(
        `Backed up ${records.length} authored records for ${name} ` +
          `(skipped ${snapshot.size - records.length} cached)`,
      );
    }

    const timestamp = new Date().toISOString();
    const backupWrapper = {
      timestamp,
      data: backupData,
    };

    const fileName = `backups/backup-${timestamp}.json`;
    const file = bucket.file(fileName);

    logger.info(`Saving backup to Cloud Storage: ${fileName}`);
    await file.save(JSON.stringify(backupWrapper, null, 2), {
      contentType: 'application/json',
    });

    logger.info('Database backup completed successfully.');
    return fileName;
  } catch (error) {
    logger.error('Error performing database backup:', error);
    throw new Error('Database backup failed.');
  }
}

/**
 * Scheduled Cloud Function that runs once a month (on the 1st at midnight)
 * to automatically backup the database.
 */
export const scheduledBackup = onSchedule(
  {
    schedule: '0 0 1 * *',
    // The whole database is assembled in memory before being stringified.
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (event) => {
    try {
      const fileName = await performBackup();
      logger.info(`Scheduled backup finished successfully. File: ${fileName}`);
    } catch (error) {
      logger.error('Scheduled backup failed:', error);
    }
  },
);

/**
 * Callable Cloud Function that allows admins to trigger a backup manually.
 */
export const manualBackup = onCall(
  { cors: allowedOrigins, memory: '1GiB', timeoutSeconds: 540 },
  async (request) => {
    logger.info('manualBackup called by user.');

    // Ensure only admins can trigger the backup
    await assertAdmin(request);

    try {
      const fileName = await performBackup();
      return { success: true, fileName };
    } catch (error) {
      throw new HttpsError('internal', 'Manual backup failed.');
    }
  }
);

/**
 * Callable Cloud Function to list available backups with download URLs.
 */
export const listBackups = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('listBackups called');
    await assertAdmin(request);

    try {
      const bucket = admin.storage().bucket();
      const [files] = await bucket.getFiles({ prefix: 'backups/' });

      const fileList = await Promise.all(
        files
          .filter((f) => f.name.endsWith('.json'))
          .map(async (file) => {
            const [metadata] = await file.getMetadata();

            // Generate a signed URL that expires in 1 hour
            const [url] = await file.getSignedUrl({
              version: 'v4',
              action: 'read',
              expires: Date.now() + 60 * 60 * 1000,
            });

            return {
              name: metadata.name,
              timeCreated: metadata.timeCreated || '',
              size: metadata.size,
              downloadUrl: url,
            };
          })
      );

      // Sort by newest first
      fileList.sort((a, b) => {
        return new Date(b.timeCreated || 0).getTime() - new Date(a.timeCreated || 0).getTime();
      });

      return { backups: fileList };
    } catch (error) {
      logger.error('Error listing backups:', error);
      throw new HttpsError('internal', 'Failed to list backups.');
    }
  }
);
