import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from './common';

const BACKUP_COLLECTIONS = [
  'members',
  'schools',
  'gradings',
  'orders',
  'acl',
  'counters',
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
export const scheduledBackup = onSchedule('0 0 1 * *', async (event) => {
  try {
    const fileName = await performBackup();
    logger.info(`Scheduled backup finished successfully. File: ${fileName}`);
  } catch (error) {
    logger.error('Scheduled backup failed:', error);
  }
});

/**
 * Callable Cloud Function that allows admins to trigger a backup manually.
 */
export const manualBackup = onCall(
  { cors: allowedOrigins },
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
