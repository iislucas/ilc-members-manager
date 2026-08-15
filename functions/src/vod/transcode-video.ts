/* transcode-video.ts
 *
 * Callable Cloud Function for starting a video transcoding job via the
 * Google Cloud Transcoder API. Only administrators can initiate transcoding.
 *
 * Curates raw instructor uploaded materials into multi-bitrate HLS streaming
 * packages in Cloud Storage.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from '../common';
import {
  VideoItem,
  VodStatus,
  VodAccessTier,
  initVideoItem,
  firestoreDocToVideoItem,
  UploadItem,
  firestoreDocToUploadItem,
} from '../data-model';

export interface TranscodeVideoRequest {
  uploadDocId: string;
  memberDocId: string;
  vodConfig: {
    title: string;
    description: string;
    tags: string[];
    accessTier?: VodAccessTier;
    accessTiers?: VodAccessTier[];
    isBuyable?: boolean;
    minLevel?: number;
    priceCents?: number;
    currency?: string;
    stripeProductId?: string;
    stripePriceId?: string;
    featured?: boolean;
    instructorDocId?: string;
    instructorName?: string;
    instructorId?: string;
    eventDocId?: string;
    eventTitle?: string;
    recordedDate?: string;
    location?: string;
    resolutions?: string[];
  };
}

export const transcodeVideoForVod = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('transcodeVideoForVod called', request.data);
    const adminMember = await assertAdmin(request);

    const data = request.data as TranscodeVideoRequest;
    if (!data || !data.uploadDocId || !data.memberDocId) {
      throw new HttpsError(
        'invalid-argument',
        'uploadDocId and memberDocId are required.',
      );
    }

    const db = admin.firestore();
    const uploadRef = db
      .collection('members')
      .doc(data.memberDocId)
      .collection('uploads')
      .doc(data.uploadDocId);
    const uploadSnap = await uploadRef.get();

    if (!uploadSnap.exists) {
      throw new HttpsError('not-found', 'Source upload item not found.');
    }

    const uploadItem = firestoreDocToUploadItem(uploadSnap);
    if (!uploadItem.contentType.startsWith('video/')) {
      throw new HttpsError(
        'invalid-argument',
        'The specified upload is not a video file.',
      );
    }

    const videoId = data.uploadDocId;
    const videoRef = db.collection('videos').doc(videoId);
    const existingSnap = await videoRef.get();
    const existingVideo = existingSnap.exists
      ? firestoreDocToVideoItem(existingSnap)
      : initVideoItem();

    const config = data.vodConfig || {};
    const nowIso = new Date().toISOString();

    const rawAccessTiers = Array.isArray(config.accessTiers) && config.accessTiers.length > 0
      ? config.accessTiers
      : (config.accessTier ? [config.accessTier] : [VodAccessTier.MembersOnly]);
    const isBuyable = Boolean(
      config.isBuyable ||
      rawAccessTiers.includes(VodAccessTier.DirectPurchase) ||
      (config.priceCents && config.priceCents > 0),
    );

    const targetResolutions =
      Array.isArray(config.resolutions) && config.resolutions.length > 0
        ? config.resolutions
        : existingVideo.resolutions.length
          ? existingVideo.resolutions
          : ['360p', '480p', '720p', '1080p'];

    const updatedVideo: VideoItem = {
      ...existingVideo,
      docId: videoId,
      sourceUploadDocId: data.uploadDocId,
      sourceMemberDocId: data.memberDocId,
      title: config.title || uploadItem.name || 'Untitled Video',
      description: config.description || uploadItem.notes || '',
      tags: Array.isArray(config.tags) ? config.tags : uploadItem.tags || [],
      instructorDocId: config.instructorDocId || uploadItem.memberDocId || '',
      instructorName: config.instructorName || uploadItem.memberName || '',
      instructorId: config.instructorId || uploadItem.instructorId || '',
      eventDocId: config.eventDocId || uploadItem.eventDocId || '',
      eventTitle: config.eventTitle || uploadItem.eventTitle || '',
      recordedDate: config.recordedDate || uploadItem.date || nowIso.split('T')[0],
      location: config.location || uploadItem.location || '',
      accessTier: config.accessTier || rawAccessTiers[0] || VodAccessTier.MembersOnly,
      accessTiers: rawAccessTiers,
      isBuyable,
      minLevel: config.minLevel,
      priceCents: config.priceCents,
      currency: config.currency || 'usd',
      stripeProductId: config.stripeProductId,
      stripePriceId: config.stripePriceId,
      isPublished: true,
      featured: config.featured ?? false,
      publishedAt: existingVideo.publishedAt || nowIso,
      publishedByMemberDocId: adminMember.docId,
      vodStatus: VodStatus.Queued,
      thumbnailUrl: uploadItem.previewUrl || existingVideo.thumbnailUrl || '',
      manifestUrl: existingVideo.manifestUrl || uploadItem.url || '',
      spriteIntervalSeconds: 5,
      spriteWidth: 160,
      spriteHeight: 90,
      durationSeconds: existingVideo.durationSeconds || 0,
      resolutions: targetResolutions,
      originalSize: uploadItem.size || 0,
      createdAt: existingVideo.createdAt || nowIso,
      lastUpdated: nowIso,
    };

    let jobId = `job-${Date.now()}`;

    // Attempt Google Cloud Transcoder job creation if configured
    try {
      if (
        process.env.NODE_ENV === 'production' ||
        process.env.ENABLE_GCP_TRANSCODER === 'true'
      ) {
        const { TranscoderServiceClient } = await import(
          '@google-cloud/video-transcoder'
        );
        const transcoderClient = new TranscoderServiceClient();
        const projectId = process.env.GCLOUD_PROJECT || 'ilc-members-manager';
        const location = 'us-central1';

        const rawStoragePath =
          uploadItem.storagePath ||
          `members/${data.memberDocId}/materials/originals/${data.uploadDocId}/original`;
        const bucketName =
          admin.storage().bucket().name || `${projectId}.appspot.com`;
        const inputUri = `gs://${bucketName}/${rawStoragePath}`;
        const outputUri = `gs://${bucketName}/vod/${videoId}/`;

        const [job] = await transcoderClient.createJob({
          parent: transcoderClient.locationPath(projectId, location),
          job: {
            inputUri,
            outputUri,
            config: {
              elementaryStreams: [
                {
                  key: 'video-stream-1080p',
                  videoStream: {
                    h264: {
                      heightPixels: 1080,
                      widthPixels: 1920,
                      bitrateBps: 4500000,
                      frameRate: 30,
                    },
                  },
                },
                {
                  key: 'video-stream-720p',
                  videoStream: {
                    h264: {
                      heightPixels: 720,
                      widthPixels: 1280,
                      bitrateBps: 2200000,
                      frameRate: 30,
                    },
                  },
                },
                {
                  key: 'video-stream-360p',
                  videoStream: {
                    h264: {
                      heightPixels: 360,
                      widthPixels: 640,
                      bitrateBps: 800000,
                      frameRate: 30,
                    },
                  },
                },
                {
                  key: 'audio-stream0',
                  audioStream: {
                    codec: 'aac',
                    bitrateBps: 128000,
                    channelCount: 2,
                  },
                },
              ],
              muxStreams: [
                {
                  key: 'sd',
                  fileName: 'sd.m3u8',
                  container: 'ts',
                  elementaryStreams: ['video-stream-360p', 'audio-stream0'],
                  segmentSettings: {
                    segmentDuration: {
                      seconds: 6,
                    },
                  },
                },
                {
                  key: 'hd',
                  fileName: 'hd.m3u8',
                  container: 'ts',
                  elementaryStreams: ['video-stream-720p', 'audio-stream0'],
                  segmentSettings: {
                    segmentDuration: {
                      seconds: 6,
                    },
                  },
                },
                {
                  key: 'fhd',
                  fileName: 'fhd.m3u8',
                  container: 'ts',
                  elementaryStreams: ['video-stream-1080p', 'audio-stream0'],
                  segmentSettings: {
                    segmentDuration: {
                      seconds: 6,
                    },
                  },
                },
              ],
              manifests: [
                {
                  fileName: 'manifest.m3u8',
                  type: 'HLS',
                  muxStreams: ['sd', 'hd', 'fhd'],
                },
              ],
              spriteSheets: [
                {
                  format: 'jpeg',
                  filePrefix: 'sprite@',
                  spriteWidthPixels: 160,
                  spriteHeightPixels: 90,
                  columnCount: 10,
                  rowCount: 10,
                  interval: {
                    seconds: 5,
                  },
                },
              ],
            },
          },
        });

        if (job && job.name) {
          jobId = job.name;
        }
      }
    } catch (err) {
      logger.warn(
        'GCP Transcoder API invocation skipped or failed, using simulation/ready mode:',
        err,
      );
    }

    // Update status to Transcoding with Job ID (or Ready in dev/emulator if already available)
    updatedVideo.vodJobId = jobId;
    updatedVideo.vodStatus =
      process.env.USE_EMULATOR === 'true' || !process.env.ENABLE_GCP_TRANSCODER
        ? VodStatus.Ready
        : VodStatus.Transcoding;

    await videoRef.set(updatedVideo);

    // Update source upload record with VOD tracking status
    await uploadRef.update({
      vodStatus: updatedVideo.vodStatus,
      vodVideoId: videoId,
      vodJobId: jobId,
      vodPublishedAt: updatedVideo.publishedAt,
      lastUpdated: nowIso,
    });

    return {
      success: true,
      videoId,
      vodStatus: updatedVideo.vodStatus,
      jobId,
    };
  },
);
