/* resources.ts
 *
 * Cloud functions for managing resource files (PDFs, etc.) stored in
 * Firebase Storage under the `resources/` prefix. Files are organised
 * into subdirectories by access level:
 *   resources/public/     — readable by anyone
 *   resources/members/    — readable by authenticated users
 *   resources/instructors/ — readable by instructors and admins
 *   resources/school-owners/ — readable by school owners/managers and admins
 *   resources/admins/     — readable by admins only
 *
 * Provides listing with signed download URLs and deletion. Both
 * operations are admin-only.
 *
 * Follows the same pattern as backup.ts for listing Storage files.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from './common';
import { ResourceAccessLevel, RESOURCE_ACCESS_LEVELS } from './data-model';

export interface ResourceFileInfo {
  name: string;
  fullPath: string;
  contentType: string;
  timeCreated: string;
  size: string;
  accessLevel: ResourceAccessLevel;
}

// Extracts the access level from a storage path like `resources/members/file.pdf`.
// Returns undefined if the path doesn't match an expected access level.
function extractAccessLevel(filePath: string): ResourceAccessLevel | undefined {
  const parts = filePath.split('/');
  if (parts.length < 3 || parts[0] !== 'resources') return undefined;
  const level = parts[1] as ResourceAccessLevel;
  if (RESOURCE_ACCESS_LEVELS.includes(level)) return level;
  return undefined;
}

// Strips the `resources/{accessLevel}/` prefix for display.
function displayName(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length >= 3 && parts[0] === 'resources') {
    return parts.slice(2).join('/');
  }
  // Legacy fallback: strip just `resources/`.
  return filePath.replace(/^resources\//, '');
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
          // Exclude directory placeholders (paths ending with `/`).
          .filter((f) => !f.name.endsWith('/'))
          // Only include files in known access-level subdirectories.
          .filter((f) => extractAccessLevel(f.name) !== undefined)
          .map(async (file) => {
            const [metadata] = await file.getMetadata();
            return {
              name: displayName(file.name),
              fullPath: file.name,
              contentType: (metadata.contentType as string) || 'application/octet-stream',
              timeCreated: (metadata.timeCreated as string) || '',
              size: String(metadata.size || '0'),
              accessLevel: extractAccessLevel(file.name)!,
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

// Callable Cloud Function to generate a signed download URL for a single
// resource file. This is called on-demand when the user clicks "Download",
// avoiding the cost of generating signed URLs for every file on page load.
export const getResourceDownloadUrl = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('getResourceDownloadUrl called');
    await assertAdmin(request);

    const data = request.data as { fullPath?: string };
    if (!data.fullPath || !data.fullPath.startsWith('resources/')) {
      throw new HttpsError('invalid-argument', 'A valid resource file path is required.');
    }

    if (extractAccessLevel(data.fullPath) === undefined) {
      throw new HttpsError('invalid-argument', 'Resource path must be within a valid access-level subdirectory.');
    }

    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(data.fullPath);

      const [exists] = await file.exists();
      if (!exists) {
        throw new HttpsError('not-found', 'Resource file not found.');
      }

      // Generate a signed URL that expires in 1 hour.
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
      });

      return { downloadUrl: url };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Error generating download URL:', error);
      throw new HttpsError('internal', 'Failed to generate download URL.');
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

    // Validate that the path is within a known access-level subdirectory.
    if (extractAccessLevel(data.fullPath) === undefined) {
      throw new HttpsError('invalid-argument', 'Resource path must be within a valid access-level subdirectory.');
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
