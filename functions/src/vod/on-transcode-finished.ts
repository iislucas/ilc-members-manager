/* on-transcode-finished.ts
 *
 * Cloud Function triggered by Google Cloud Pub/Sub topic:
 * `vod-transcode-notifications`.
 *
 * When a GCP Transcoder API job finishes (SUCCEEDED or FAILED),
 * this function updates the Firestore /videos/{videoId} document:
 *   - Sets vodStatus: 'ready' | 'failed'
 *   - Sets manifestUrl to the Cloud Storage / CDN HLS master playlist URL
 *   - Sets spriteSheetUrl to the generated scrub preview sprite sheet
 */

import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { VodStatus, VideoItemFsDoc } from '../data-model';

export const onTranscodeJobFinished = onMessagePublished(
  {
    topic: 'vod-transcode-notifications',
    region: 'us-central1',
  },
  async (event) => {
    try {
      const messageData = event.data.message.json as {
        job?: {
          name?: string;
          state?: 'SUCCEEDED' | 'FAILED' | 'RUNNING';
          outputUri?: string;
          error?: { message?: string; code?: number };
        };
      };

      logger.info('Received Transcoder Pub/Sub event', messageData);

      const job = messageData?.job;
      if (!job || !job.name) {
        logger.warn('No job payload in Pub/Sub message');
        return;
      }

      const db = admin.firestore();
      const jobName = job.name;
      const state = job.state || 'SUCCEEDED';

      // Find the video document in Firestore by vodJobId
      const videoQuery = await db
        .collection('videos')
        .where('vodJobId', '==', jobName)
        .limit(1)
        .get();

      if (videoQuery.empty) {
        logger.warn(`No video found in /videos for vodJobId: ${jobName}`);
        return;
      }

      const videoDoc = videoQuery.docs[0]!;
      const videoId = videoDoc.id;
      const bucketName = admin.storage().bucket().name;

      const nowIso = new Date().toISOString();

      if (state === 'SUCCEEDED') {
        const manifestStoragePath = `vod/${videoId}/manifest.m3u8`;
        const spriteStoragePath = `vod/${videoId}/sprite@0000000000.jpeg`;

        // Retrieve or generate token for manifest
        const manifestFile = admin.storage().bucket().file(manifestStoragePath);
        const [manifestExists] = await manifestFile.exists();

        let manifestUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(manifestStoragePath)}?alt=media`;
        if (manifestExists) {
          const [meta] = await manifestFile.getMetadata();
          const token = meta.metadata?.['firebaseStorageDownloadTokens'];
          if (token) {
            manifestUrl += `&token=${token}`;
          }
        }

        const updatePayload: Partial<VideoItemFsDoc> = {
          vodStatus: VodStatus.Ready,
          manifestUrl,
          spriteSheetUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(spriteStoragePath)}?alt=media`,
          lastUpdated: nowIso as any,
        };

        await videoDoc.ref.set(updatePayload, { merge: true });
        logger.info(`✓ Successfully updated /videos/${videoId} status to 'ready'`, {
          videoId,
          jobName,
          manifestUrl,
        });
      } else {
        const errorMsg = job.error?.message || 'Transcoding job failed.';
        await videoDoc.ref.set(
          {
            vodStatus: VodStatus.Failed,
            vodError: errorMsg,
            lastUpdated: nowIso as any,
          },
          { merge: true },
        );
        logger.error(`✗ Transcoding job failed for /videos/${videoId}`, {
          videoId,
          jobName,
          error: errorMsg,
        });
      }
    } catch (err: any) {
      logger.error('Error handling transcode Pub/Sub notification:', err);
    }
  },
);
