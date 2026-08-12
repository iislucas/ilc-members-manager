/* delete-video.ts
 *
 * Admin-only Callable Cloud Function to remove a video from the catalog.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from '../common';

export interface DeleteVideoRequest {
  videoId: string;
}

export const deleteVideoFromCatalog = onCall(
  { cors: allowedOrigins },
  async (request) => {
    await assertAdmin(request);

    const data = request.data as DeleteVideoRequest;
    if (!data || !data.videoId) {
      throw new HttpsError('invalid-argument', 'videoId is required.');
    }

    const db = admin.firestore();
    const videoRef = db.collection('videos').doc(data.videoId);
    await videoRef.delete();

    return { success: true, videoId: data.videoId };
  },
);
