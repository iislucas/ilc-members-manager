/* check-vod-job-status.ts
 *
 * Admin-only Callable Cloud Function to query the GCP Transcoder API
 * (or inspect video document status) and update Firestore in real-time.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from '../common';
import {
  VideoItem,
  VodStatus,
  firestoreDocToVideoItem,
} from '../data-model';

export interface CheckVodJobStatusRequest {
  videoId: string;
}

export const checkVodJobStatus = onCall(
  { cors: allowedOrigins },
  async (request) => {
    await assertAdmin(request);

    const data = request.data as CheckVodJobStatusRequest;
    if (!data || !data.videoId) {
      throw new HttpsError('invalid-argument', 'videoId is required.');
    }

    const db = admin.firestore();
    const videoRef = db.collection('videos').doc(data.videoId);
    const videoSnap = await videoRef.get();

    if (!videoSnap.exists) {
      throw new HttpsError('not-found', 'Video not found.');
    }

    const video = firestoreDocToVideoItem(videoSnap);
    let updatedStatus = video.vodStatus;
    let vodError: string | undefined = video.vodError;
    const nowIso = new Date().toISOString();

    // If job is in progress and has a GCP job ID, check live status via Transcoder API
    if (
      video.vodJobId &&
      video.vodJobId.startsWith('projects/') &&
      (video.vodStatus === VodStatus.Transcoding || video.vodStatus === VodStatus.Queued)
    ) {
      try {
        if (
          process.env.NODE_ENV === 'production' ||
          process.env.ENABLE_GCP_TRANSCODER === 'true'
        ) {
          const { TranscoderServiceClient } = await import(
            '@google-cloud/video-transcoder'
          );
          const transcoderClient = new TranscoderServiceClient();
          const [job] = await transcoderClient.getJob({ name: video.vodJobId });

          if (job && job.state) {
            // GCP States: PROCESSING_STATE_UNSPECIFIED, PENDING, RUNNING, SUCCEEDED, FAILED
            if (job.state === 'SUCCEEDED') {
              updatedStatus = VodStatus.Ready;
            } else if (job.state === 'RUNNING') {
              updatedStatus = VodStatus.Transcoding;
            } else if (job.state === 'PENDING') {
              updatedStatus = VodStatus.Queued;
            } else if (job.state === 'FAILED') {
              updatedStatus = VodStatus.Failed;
              vodError = job.error?.message || 'Transcoding job failed.';
            }
          }
        }
      } catch (err) {
        logger.warn('Error querying GCP Transcoder job status:', err);
      }
    }

    const updatedVideo: Partial<VideoItem> = {
      vodStatus: updatedStatus,
      vodError: vodError || '',
      lastUpdated: nowIso,
    };

    await videoRef.update(updatedVideo);

    // Sync to source upload item if present
    if (video.sourceMemberDocId && video.sourceUploadDocId) {
      const uploadRef = db
        .collection('members')
        .doc(video.sourceMemberDocId)
        .collection('uploads')
        .doc(video.sourceUploadDocId);
      const uploadSnap = await uploadRef.get();
      if (uploadSnap.exists) {
        await uploadRef.update({
          vodStatus: updatedStatus,
          lastUpdated: nowIso,
        });
      }
    }

    return {
      success: true,
      videoId: data.videoId,
      vodStatus: updatedStatus,
      vodJobId: video.vodJobId || '',
      vodError: vodError || '',
    };
  },
);
