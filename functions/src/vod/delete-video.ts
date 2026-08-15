/* delete-video.ts
 *
 * Admin-only Callable Cloud Function to remove a video from the catalog.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from '../common';
import { firestoreDocToVideoItem, VodStatus } from '../data-model';

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
    const videoSnap = await videoRef.get();

    if (videoSnap.exists) {
      const video = firestoreDocToVideoItem(videoSnap);
      if (video.sourceMemberDocId && video.sourceUploadDocId) {
        const uploadRef = db
          .collection('members')
          .doc(video.sourceMemberDocId)
          .collection('uploads')
          .doc(video.sourceUploadDocId);
        const uploadSnap = await uploadRef.get();
        if (uploadSnap.exists) {
          await uploadRef.update({
            vodStatus: VodStatus.None,
            vodVideoId: '',
            vodJobId: '',
            lastUpdated: new Date().toISOString(),
          });
        }
      }
    }

    await videoRef.delete();

    return { success: true, videoId: data.videoId };
  },
);
