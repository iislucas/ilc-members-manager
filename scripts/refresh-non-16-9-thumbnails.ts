/* refresh-non-16-9-thumbnails.ts
 *
 * Re-downloads clean, unpadded native aspect-ratio thumbnails for all
 * non-16:9 catalog videos directly from Vimeo CDN to Google Cloud Storage.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const PROJECT_ID = 'ilc-paris-class-tracker';
const BUCKET_NAME = 'ilc-paris-class-tracker.firebasestorage.app';

interface Non16x9Video {
  id: string;
  name: string;
  nativeWidth: number;
  nativeHeight: number;
  aspectRatio: number;
  category: string;
}

async function streamUrlToGcs(
  sourceUrl: string,
  gcsFile: ReturnType<typeof admin.storage.prototype.bucket>['file'],
  token: string,
): Promise<void> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok || !resp.body) {
    throw new Error(`Failed to download image from ${sourceUrl}: HTTP ${resp.status} ${resp.statusText}`);
  }

  const nodeReadable = Readable.fromWeb(resp.body as any);
  const writeStream = gcsFile.createWriteStream({
    resumable: false,
    contentType: 'image/jpeg',
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  await pipeline(nodeReadable, writeStream);
}

async function run() {
  const tokenPath = path.join(__dirname, '../tmp/vimeo_token.txt');
  const jsonPath = path.join(__dirname, '../tmp/non_16_9_videos.json');

  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Vimeo token file not found at ${tokenPath}`);
  }
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Non-16:9 inventory not found at ${jsonPath}`);
  }

  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  const videos: Non16x9Video[] = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  console.log(`\n======================================================`);
  console.log(`Refreshing Native Thumbnails for ${videos.length} Non-16:9 Videos`);
  console.log(`======================================================\n`);

  admin.initializeApp({
    projectId: PROJECT_ID,
    storageBucket: BUCKET_NAME,
  });

  const db = admin.firestore();
  const bucket = admin.storage().bucket(BUCKET_NAME);

  let successCount = 0;
  let errorCount = 0;

  // Process in small batches of 5 to avoid hitting Vimeo API rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch = videos.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (v, indexInBatch) => {
        const itemNum = i + indexInBatch + 1;
        try {
          // 1. Query Vimeo API for pictures info
          const vimeoResp = await fetch(`https://api.vimeo.com/videos/${v.id}`, {
            headers: { Authorization: `bearer ${token}` },
          });

          if (!vimeoResp.ok) {
            throw new Error(`Vimeo API returned HTTP ${vimeoResp.status}`);
          }

          const vimeoData = (await vimeoResp.json()) as any;
          const baseLink = vimeoData.pictures?.base_link?.split('?')[0];

          if (!baseLink) {
            console.warn(`[${itemNum}/${videos.length}] ⚠️ No base_link found for "${v.name}" (${v.id})`);
            return;
          }

          // 2. Request unpadded native resolution frame
          const unpaddedThumbUrl = `${baseLink}_${v.nativeWidth}x${v.nativeHeight}`;

          // 3. Upload to GCS
          const gcsPath = `materials/vimeo/${v.id}/preview.jpg`;
          const gcsFile = bucket.file(gcsPath);

          // Get existing token if any, or generate new
          const [exists] = await gcsFile.exists();
          let downloadToken: string = crypto.randomUUID();
          if (exists) {
            const [meta] = await gcsFile.getMetadata().catch(() => [null]);
            if (meta?.metadata?.['firebaseStorageDownloadTokens']) {
              downloadToken = String(meta.metadata['firebaseStorageDownloadTokens']);
            }
          }

          await streamUrlToGcs(unpaddedThumbUrl, gcsFile, downloadToken);

          const finalDownloadUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(gcsPath)}?alt=media&token=${downloadToken}`;

          // 4. Update Firestore catalog document
          const docId = `vimeo_${v.id}`;
          await db.collection('videos').doc(docId).set(
            {
              thumbnailUrl: finalDownloadUrl,
            },
            { merge: true },
          );

          console.log(`[${itemNum}/${videos.length}] ✓ "${v.name}" (${v.nativeWidth}x${v.nativeHeight}, ${v.aspectRatio.toFixed(2)}:1)`);
          successCount++;
        } catch (err: any) {
          console.error(`[${itemNum}/${videos.length}] ✗ Error on "${v.name}" (${v.id}):`, err.message || err);
          errorCount++;
        }
      }),
    );

    // Brief throttle pause between batches
    if (i + BATCH_SIZE < videos.length) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  console.log(`\n======================================================`);
  console.log(`Thumbnail Refresh Complete!`);
  console.log(`  ✓ Successfully updated: ${successCount}`);
  console.log(`  ✗ Errors: ${errorCount}`);
  console.log(`======================================================\n`);
}

run().catch((err) => {
  console.error('Fatal error during thumbnail refresh:', err);
  process.exit(1);
});
