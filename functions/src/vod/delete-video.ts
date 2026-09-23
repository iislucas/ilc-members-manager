/* delete-video.ts
 *
 * Admin-only Callable Cloud Function to remove a video from the catalog.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins, recordTombstone, recordDeletionLog } from '../common';
import { DeletionSource, DeletionLogActor } from '../data-model/deletion-logs';
import { firestoreDocToVideoItem, VideoItemFsDoc, VodStatus } from '../data-model/vod';

export interface DeleteVideoRequest {
  videoId: string;
}

export const deleteVideoFromCatalog = onCall(
  { cors: allowedOrigins },
  async (request) => {
    const adminMember = await assertAdmin(request);
    const actor: DeletionLogActor = {
      email: request.auth!.token.email!,
      name: adminMember.name,
      uid: request.auth!.uid,
    };

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

    if (videoSnap.exists) {
      const videoData = videoSnap.data() as VideoItemFsDoc;
      await recordDeletionLog(
        db,
        'videos',
        data.videoId,
        videoData,
        actor,
        DeletionSource.ClientAction,
      );
    }

    await videoRef.delete();
    await recordTombstone(db, 'videos', data.videoId, actor);

    return { success: true, videoId: data.videoId };
  },
);
