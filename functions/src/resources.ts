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

// Formats today's date as YYYY-MM-DD for expiry comparison.
function todayStr(): string {
  const now = new Date();
  const y = now.getFullYear().toString();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Checks whether the caller has access to a resource at the given access level.
// Throws a descriptive HttpsError if access is denied, so the frontend can
// display a helpful message (e.g. "Your membership expired on 2025-03-15").
async function assertResourceAccess(
  request: import('firebase-functions/v2/https').CallableRequest<unknown>,
  accessLevel: ResourceAccessLevel,
): Promise<void> {
  // Public resources: no auth required.
  if (accessLevel === ResourceAccessLevel.Public) return;

  // All other levels require authentication.
  if (!request.auth || !request.auth.token.email) {
    throw new HttpsError(
      'unauthenticated',
      'You must be logged in to access this resource.',
    );
  }

  const email = request.auth.token.email;
  const db = admin.firestore();

  // Look up the ACL document for this user.
  const aclDoc = await db.collection('acl').doc(email).get();
  if (!aclDoc.exists) {
    throw new HttpsError(
      'permission-denied',
      'No access record found for your account. Please contact an administrator.',
      { reason: 'no-acl' },
    );
  }
  const acl = aclDoc.data()!;

  // Admins always have access to everything.
  if (acl.isAdmin) return;

  const today = todayStr();

  switch (accessLevel) {
    case ResourceAccessLevel.Members: {
      const expires = acl.membershipExpires as string | undefined;
      if (!expires) {
        throw new HttpsError(
          'permission-denied',
          'This resource is for active members. You do not have an active membership.',
          { reason: 'missing', tier: 'membership' },
        );
      }
      if (expires < today) {
        throw new HttpsError(
          'permission-denied',
          `This resource is for active members. Your membership expired on ${expires}.`,
          { reason: 'expired', tier: 'membership', expiryDate: expires },
        );
      }
      return;
    }
    case ResourceAccessLevel.Instructors: {
      const expires = acl.instructorLicenseExpires as string | undefined;
      if (!expires) {
        throw new HttpsError(
          'permission-denied',
          'This resource is for licensed instructors. You do not have an instructor license.',
          { reason: 'missing', tier: 'instructor' },
        );
      }
      if (expires < today) {
        throw new HttpsError(
          'permission-denied',
          `This resource is for licensed instructors. Your instructor license expired on ${expires}.`,
          { reason: 'expired', tier: 'instructor', expiryDate: expires },
        );
      }
      return;
    }
    case ResourceAccessLevel.SchoolOwners: {
      const expires = acl.schoolLicenseExpires as string | undefined;
      if (!expires) {
        throw new HttpsError(
          'permission-denied',
          'This resource is for school owners/managers. You do not have an active school license.',
          { reason: 'missing', tier: 'school' },
        );
      }
      if (expires < today) {
        throw new HttpsError(
          'permission-denied',
          `This resource is for school owners/managers. Your school license expired on ${expires}.`,
          { reason: 'expired', tier: 'school', expiryDate: expires },
        );
      }
      return;
    }
    case ResourceAccessLevel.Admins: {
      // For non-admins, return not-found to avoid revealing that admin
      // resources exist at this path.
      throw new HttpsError(
        'not-found',
        'This resource was not found.',
        { reason: 'admin-only' },
      );
    }
  }
}

// Callable Cloud Function to generate a signed download URL for a single
// resource file. This is called on-demand when the user clicks "Download",
// avoiding the cost of generating signed URLs for every file on page load.
//
// Access is checked per-tier: public files need no auth, member/instructor/
// school-owner files check the ACL's expiry fields, admin files require
// isAdmin. Returns a structured denial reason so the frontend can show
// helpful messages (e.g. "Your membership expired on 2025-12-31").
export const getResourceDownloadUrl = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('getResourceDownloadUrl called');

    const data = request.data as { fullPath?: string };
    if (!data.fullPath || !data.fullPath.startsWith('resources/')) {
      throw new HttpsError('invalid-argument', 'A valid resource file path is required.');
    }

    const accessLevel = extractAccessLevel(data.fullPath);
    if (accessLevel === undefined) {
      throw new HttpsError('invalid-argument', 'Resource path must be within a valid access-level subdirectory.');
    }

    // Check access based on the resource's tier.
    await assertResourceAccess(request, accessLevel);

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
