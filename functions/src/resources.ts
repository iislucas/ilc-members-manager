/* resources.ts
 *
 * Cloud functions for managing resource files (PDFs, etc.) stored in
 * Firebase Storage under the `resources/` prefix. Provides listing with
 * signed download URLs and deletion. Both operations are admin-only.
 *
 * Follows the same pattern as backup.ts for listing Storage files.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from './common';

export interface ResourceFileInfo {
  name: string;
  fullPath: string;
  contentType: string;
  timeCreated: string;
  size: string;
  downloadUrl: string;
}

// Callable Cloud Function to list available resource files with download URLs.
export const listResources = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('listResources called');
    await assertAdmin(request);

    try {
      const bucket = admin.storage().bucket();
      const [files] = await bucket.getFiles({ prefix: 'resources/' });

      const fileList: ResourceFileInfo[] = await Promise.all(
        files
          // Exclude the directory placeholder itself (if any).
          .filter((f) => f.name !== 'resources/')
          .map(async (file) => {
            const [metadata] = await file.getMetadata();

            // Generate a signed URL that expires in 1 hour.
            const [url] = await file.getSignedUrl({
              version: 'v4',
              action: 'read',
              expires: Date.now() + 60 * 60 * 1000,
            });

            // Strip the `resources/` prefix for display.
            const displayName = file.name.replace(/^resources\//, '');

            return {
              name: displayName,
              fullPath: file.name,
              contentType: (metadata.contentType as string) || 'application/octet-stream',
              timeCreated: (metadata.timeCreated as string) || '',
              size: String(metadata.size || '0'),
              downloadUrl: url,
            };
          })
      );

      // Sort by newest first.
      fileList.sort((a, b) => {
        return new Date(b.timeCreated || 0).getTime() - new Date(a.timeCreated || 0).getTime();
      });

      return { resources: fileList };
    } catch (error) {
      logger.error('Error listing resources:', error);
      throw new HttpsError('internal', 'Failed to list resources.');
    }
  }
);

// Callable Cloud Function to delete a resource file by its full storage path.
export const deleteResource = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('deleteResource called');
    await assertAdmin(request);

    const data = request.data as { fullPath?: string };
    if (!data.fullPath || !data.fullPath.startsWith('resources/')) {
      throw new HttpsError('invalid-argument', 'A valid resource file path is required.');
    }

    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(data.fullPath);

      const [exists] = await file.exists();
      if (!exists) {
        throw new HttpsError('not-found', 'Resource file not found.');
      }

      await file.delete();
      logger.info(`Deleted resource file: ${data.fullPath}`);
      return { success: true };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Error deleting resource:', error);
      throw new HttpsError('internal', 'Failed to delete resource.');
    }
  }
);
