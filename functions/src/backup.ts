import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from './common';
import { BlogPostSourceKind, blogPostSourceKind, isDraftPost } from './data-model/content-cache';
import { FirestoreCollection, FirestoreSubcollection } from './data-model/collections';

// Top-level collections holding authored and content data.
//
// Deliberately excluded, because every document is regenerable:
//   'instructors'      — public projection of /members, rebuilt by
//                        updateInstructorPublicProfile on member writes.
//   'mail'             — transient send queue for the Trigger Email extension.
//
// All blog-post and article collections (articles-post, members-post, instructors-post,
// news-post) are fully backed up, preserving authored articles, drafts, and
// Squarespace-synced content for complete, self-contained database snapshots.
export const BACKUP_COLLECTIONS: string[] = [
  FirestoreCollection.Members,
  FirestoreCollection.Schools,
  FirestoreCollection.Gradings,
  FirestoreCollection.Orders,
  FirestoreCollection.Acl,
  FirestoreCollection.System,
  FirestoreCollection.Events,
  FirestoreCollection.Products,
  FirestoreCollection.Videos,
  FirestoreCollection.VideoGrants,
  FirestoreCollection.Statistics,
  FirestoreCollection.ArticlesPost,
  FirestoreCollection.MembersPost,
  FirestoreCollection.InstructorsPost,
  FirestoreCollection.NewsPost,
  FirestoreCollection.DeletionLogs,
];

// Sub-collections holding authored data. A `db.collection(name).get()` returns
// only top-level documents, so these need their own collection-group queries.
// Each group below lives under parent documents (e.g. /events/{eventId}/ or
// /members/{memberDocId}/), and the full document path is recorded on every
// record so the parent is recoverable.
//
// Deliberately excluded, because they mirror a top-level collection:
//   members/{id}/orders, members/{id}/events,
//   schools/{id}/members, schools/{id}/gradings,
//   instructors/{id}/members, instructors/{id}/gradings,
//   system/deletions/{collection} (sync tombstones).
export const BACKUP_SUBCOLLECTION_GROUPS: string[] = [
  FirestoreSubcollection.Notifications,
  FirestoreSubcollection.Uploads,
  FirestoreSubcollection.VideoProgress,
  FirestoreSubcollection.VideoGrants,
  FirestoreSubcollection.PushSubscriptions,
  FirestoreSubcollection.Registrations,
  FirestoreSubcollection.VideoTimeRanges,
];

// Collections where cached and authored documents coexist.
// Currently empty because members-post and instructors-post are now backed up
// in full via BACKUP_COLLECTIONS, ensuring all Squarespace posts and drafts
// are preserved in every backup.
export const BACKUP_MIXED_COLLECTIONS: {
  name: string;
  cachedFrom: BlogPostSourceKind;
}[] = [];

/**
 * Common logic to perform the database backup to Cloud Storage.
 */
export async function performBackup(): Promise<string> {
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
        .filter((doc) => {
          const data = doc.data();
          // Always preserve draft articles/posts regardless of source kind;
          // drafts are authored in-progress content and never regenerable from cache.
          if (isDraftPost(data)) {
            return true;
          }
          return blogPostSourceKind(data) !== cachedFrom;
        })
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

    try {
      await cleanupOldBackups(bucket);
    } catch (cleanupError) {
      logger.warn('Failed to cleanup old backups:', cleanupError);
    }

    return fileName;
  } catch (error) {
    logger.error('Error performing database backup:', error);
    throw new Error('Database backup failed.');
  }
}

export const BACKUP_RETENTION_DAYS = 180;

export type StorageBucket = ReturnType<ReturnType<typeof admin.storage>['bucket']>;

/**
 * Deletes backup files from Cloud Storage that are older than maxAgeDays (default: 180 days).
 * Returns the list of deleted file names.
 */
export async function cleanupOldBackups(
  bucket?: StorageBucket,
  maxAgeDays: number = BACKUP_RETENTION_DAYS,
): Promise<string[]> {
  const targetBucket = bucket || admin.storage().bucket();
  const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  logger.info(
    `Cleaning up backups older than ${maxAgeDays} days (cutoff: ${new Date(cutoffTime).toISOString()})...`,
  );

  const [files] = await targetBucket.getFiles({ prefix: 'backups/' });
  const backupFiles = files.filter(
    (f) => f.name.startsWith('backups/backup-') && f.name.endsWith('.json'),
  );

  const deletedFiles: string[] = [];

  for (const file of backupFiles) {
    try {
      const [metadata] = await file.getMetadata();
      let createdTime = metadata.timeCreated
        ? new Date(String(metadata.timeCreated)).getTime()
        : 0;
      if (!createdTime || isNaN(createdTime)) {
        const match = file.name.match(/^backups\/backup-(.+)\.json$/);
        if (match) {
          createdTime = new Date(match[1]).getTime();
        }
      }

      if (createdTime && !isNaN(createdTime) && createdTime < cutoffTime) {
        logger.info(
          `Deleting expired backup file: ${file.name} (created: ${new Date(createdTime).toISOString()})`,
        );
        await file.delete();
        deletedFiles.push(file.name);
      }
    } catch (err) {
      logger.warn(`Failed to inspect or delete backup file ${file.name}:`, err);
    }
  }

  logger.info(`Cleanup completed. Deleted ${deletedFiles.length} expired backup file(s).`);
  return deletedFiles;
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
