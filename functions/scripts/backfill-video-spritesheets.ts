/* functions/scripts/backfill-video-spritesheets.ts
 *
 * Scans Firestore /videos collection for videos missing `spriteSheetUrl`,
 * extracts 25 timeline scrubbing frames using ffmpeg over HTTP byte-ranges,
 * composes them into a 5x5 composite sprite sheet (800x450 px),
 * uploads to Cloud Storage at vod/${videoId}/spritesheet.jpg,
 * and updates the Firestore document with sprite metadata.
 *
 * Usage:
 *   # Inspect videos missing sprite sheets (dry-run):
 *   pnpm --prefix functions run backfill-video-spritesheets -- --dry-run
 *
 *   # Generate sprite sheet for a specific video:
 *   pnpm --prefix functions run backfill-video-spritesheets -- --videoId n8m5KByUHQPNyUuiF6wW
 *
 *   # Process multiple videos with limit:
 *   pnpm --prefix functions run backfill-video-spritesheets -- --limit 5
 *
 *   # Force regenerate even if spriteSheetUrl already exists:
 *   pnpm --prefix functions run backfill-video-spritesheets -- --videoId <id> --force
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile as execFileCb, execSync } from 'node:child_process';
import * as admin from 'firebase-admin';
import { firestoreDocToVideoItem, VideoItem } from '../src/data-model/vod';

const execFile = promisify(execFileCb);

interface CliOptions {
  dryRun: boolean;
  project: string;
  videoId: string;
  limit: number;
  force: boolean;
  concurrency: number;
  videoConcurrency: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    project: '',
    videoId: '',
    limit: 0,
    force: false,
    concurrency: 4,
    videoConcurrency: 3,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--project' && i + 1 < argv.length) {
      options.project = argv[i + 1]!;
      i += 1;
    } else if (arg === '--videoId' && i + 1 < argv.length) {
      options.videoId = argv[i + 1]!;
      i += 1;
    } else if (arg === '--limit' && i + 1 < argv.length) {
      options.limit = parseInt(argv[i + 1]!, 10);
      i += 1;
    } else if (arg === '--concurrency' && i + 1 < argv.length) {
      options.concurrency = parseInt(argv[i + 1]!, 10);
      i += 1;
    } else if (arg === '--videoConcurrency' && i + 1 < argv.length) {
      options.videoConcurrency = parseInt(argv[i + 1]!, 10);
      i += 1;
    }
  }

  return options;
}

function resolveGcpProjectId(explicitProject?: string): string {
  if (explicitProject) return explicitProject;
  if (process.env.GCP_PROJECT) return process.env.GCP_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.FIREBASE_CONFIG) {
    try {
      const cfg = JSON.parse(process.env.FIREBASE_CONFIG);
      if (cfg.projectId) return cfg.projectId;
    } catch {
      // ignore
    }
  }

  const firebasercPath = path.resolve(__dirname, '../../.firebaserc');
  if (fs.existsSync(firebasercPath)) {
    try {
      const rc = JSON.parse(fs.readFileSync(firebasercPath, 'utf8'));
      const active = rc?.projects?.default;
      if (active) return active;
    } catch {
      // ignore
    }
  }

  return 'ilc-paris-class-tracker';
}

function findBinary(name: string): string {
  try {
    const stdout = execSync(`which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (stdout && fs.existsSync(stdout)) return stdout;
  } catch {
    // fallback to common paths
  }
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return name;
}

async function probeDurationSeconds(ffprobeBin: string, videoUrl: string): Promise<number> {
  try {
    const { stdout } = await execFile(ffprobeBin, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoUrl,
    ], { timeout: 30000 });
    const dur = parseFloat(stdout.trim());
    return Number.isFinite(dur) && dur > 0 ? dur : 0;
  } catch (err) {
    return 0;
  }
}

async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  return results;
}

type StorageBucket = ReturnType<ReturnType<typeof admin.storage>['bucket']>;

async function processVideo(
  video: VideoItem,
  docRef: admin.firestore.DocumentReference,
  bucket: StorageBucket,
  ffmpegBin: string,
  ffprobeBin: string,
  options: CliOptions,
): Promise<boolean> {
  console.log(`\n--------------------------------------------------`);
  console.log(`Processing: [${video.docId}] "${video.title}"`);

  const videoUrl = video.manifestUrl;
  if (!videoUrl) {
    console.warn(`⚠️  Video ${video.docId} has no manifestUrl. Skipping.`);
    return false;
  }

  // Resolve duration
  let duration = video.durationSeconds || 0;
  if (duration <= 0) {
    console.log(`Probing duration with ffprobe...`);
    duration = await probeDurationSeconds(ffprobeBin, videoUrl);
  }

  if (duration <= 0) {
    console.warn(`⚠️  Could not determine valid duration for ${video.docId}. Skipping.`);
    return false;
  }

  console.log(`Duration: ${Math.round(duration)}s (${(duration / 60).toFixed(1)} mins)`);

  if (options.dryRun) {
    console.log(`[Dry Run] Would generate 5x5 sprite sheet and upload to vod/${video.docId}/spritesheet.jpg`);
    return true;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sprites-${video.docId}-`));

  try {
    const totalFrames = 25;
    const intervalSeconds = duration / totalFrames;
    const timestamps: number[] = [];

    for (let i = 0; i < totalFrames; i++) {
      const t = Math.min(
        Math.max(0, (i + 0.5) * intervalSeconds),
        Math.max(0, duration - 0.5),
      );
      timestamps.push(t);
    }

    console.log(`Extracting ${totalFrames} frames with concurrency ${options.concurrency}...`);
    const startTime = Date.now();

    await asyncPool(options.concurrency, timestamps, async (targetSec, index) => {
      const framePath = path.join(tmpDir, `frame_${String(index).padStart(2, '0')}.jpg`);
      try {
        await execFile(ffmpegBin, [
          '-ss', String(targetSec),
          '-i', videoUrl,
          '-vframes', '1',
          '-s', '160x90',
          '-y', framePath,
          '-v', 'error',
        ], { timeout: 25000 });
      } catch (err) {
        // Fallback retry slightly earlier
        try {
          await execFile(ffmpegBin, [
            '-ss', String(Math.max(0, targetSec - 2)),
            '-i', videoUrl,
            '-vframes', '1',
            '-s', '160x90',
            '-y', framePath,
            '-v', 'error',
          ], { timeout: 25000 });
        } catch {
          // Will be repaired below by neighbor copying
        }
      }
    });

    // Ensure all 25 frames exist, fill any gaps with nearest neighbor
    for (let i = 0; i < totalFrames; i++) {
      const framePath = path.join(tmpDir, `frame_${String(i).padStart(2, '0')}.jpg`);
      if (!fs.existsSync(framePath) || fs.statSync(framePath).size === 0) {
        console.warn(`Frame ${i} missing, duplicating adjacent frame.`);
        let neighbor = '';
        for (let j = i - 1; j >= 0; j--) {
          const check = path.join(tmpDir, `frame_${String(j).padStart(2, '0')}.jpg`);
          if (fs.existsSync(check) && fs.statSync(check).size > 0) {
            neighbor = check;
            break;
          }
        }
        if (!neighbor) {
          for (let j = i + 1; j < totalFrames; j++) {
            const check = path.join(tmpDir, `frame_${String(j).padStart(2, '0')}.jpg`);
            if (fs.existsSync(check) && fs.statSync(check).size > 0) {
              neighbor = check;
              break;
            }
          }
        }
        if (neighbor) {
          fs.copyFileSync(neighbor, framePath);
        } else {
          throw new Error('Failed to extract any frames from video.');
        }
      }
    }

    const elapsedExtract = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ All 25 frames extracted in ${elapsedExtract}s. Tiling into 5x5 composite sheet...`);

    const spriteSheetPath = path.join(tmpDir, 'spritesheet.jpg');
    await execFile(ffmpegBin, [
      '-framerate', '25',
      '-i', path.join(tmpDir, 'frame_%02d.jpg'),
      '-filter_complex', 'tile=5x5',
      '-y', spriteSheetPath,
      '-v', 'error',
    ], { timeout: 20000 });

    if (!fs.existsSync(spriteSheetPath) || fs.statSync(spriteSheetPath).size === 0) {
      throw new Error('Tile operation failed to produce spritesheet.jpg');
    }

    const sheetSizeKb = (fs.statSync(spriteSheetPath).size / 1024).toFixed(1);
    console.log(`✓ Composite sprite sheet generated (${sheetSizeKb} KB). Uploading to Storage...`);

    const destination = `vod/${video.docId}/spritesheet.jpg`;
    const token = randomUUID();

    await bucket.upload(spriteSheetPath, {
      destination,
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000',
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const spriteSheetUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destination)}?alt=media&token=${token}`;
    console.log(`✓ Uploaded sprite sheet: ${spriteSheetUrl}`);

    // Update Firestore
    const updateData: Record<string, any> = {
      spriteSheetUrl,
      spriteColumnCount: 5,
      spriteRowCount: 5,
      spriteFrameCount: 25,
      spriteIntervalSeconds: Math.round(intervalSeconds * 100) / 100,
      spriteWidth: 160,
      spriteHeight: 90,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!video.durationSeconds && duration > 0) {
      updateData['durationSeconds'] = Math.round(duration);
    }

    await docRef.set(updateData, { merge: true });
    console.log(`✓ Updated Firestore document /videos/${video.docId}`);

    return true;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveGcpProjectId(args.project);
  const bucketName = `${projectId}.firebasestorage.app`;

  console.log(`\n=== Backfill Video Sprite Sheets ===`);
  console.log(`Project:   ${projectId}`);
  console.log(`Bucket:    ${bucketName}`);
  console.log(`Dry run:   ${args.dryRun}`);
  console.log(`Force:     ${args.force}`);
  if (args.videoId) {
    console.log(`Target ID: ${args.videoId}`);
  }

  const ffmpegBin = findBinary('ffmpeg');
  const ffprobeBin = findBinary('ffprobe');
  console.log(`FFmpeg:    ${ffmpegBin}`);
  console.log(`FFprobe:   ${ffprobeBin}`);

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId,
      storageBucket: bucketName,
    });
  }

  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  let query: admin.firestore.Query = db.collection('videos');
  if (args.videoId) {
    query = query.where(admin.firestore.FieldPath.documentId(), '==', args.videoId);
  }

  const snap = await query.get();
  console.log(`Found ${snap.size} total video documents in query.`);

  const targets: { docRef: admin.firestore.DocumentReference; video: VideoItem }[] = [];

  for (const doc of snap.docs) {
    const video = firestoreDocToVideoItem(doc);
    if (args.force || !video.spriteSheetUrl) {
      targets.push({ docRef: doc.ref, video });
    }
  }

  console.log(`Target videos to process: ${targets.length}\n`);

  if (args.limit > 0 && targets.length > args.limit) {
    targets.splice(args.limit);
    console.log(`Limited to first ${args.limit} videos.`);
  }

  let successCount = 0;
  let failCount = 0;
  let completedCount = 0;

  console.log(`Processing ${targets.length} videos with video concurrency ${args.videoConcurrency} and frame concurrency ${args.concurrency}...\n`);

  await asyncPool(args.videoConcurrency, targets, async ({ docRef, video }) => {
    try {
      const ok = await processVideo(video, docRef, bucket, ffmpegBin, ffprobeBin, args);
      if (ok) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.error(`❌ Failed to process video ${video.docId}:`, err);
      failCount++;
    } finally {
      completedCount++;
      const pct = ((completedCount / targets.length) * 100).toFixed(1);
      console.log(`\n>> Progress: [${completedCount}/${targets.length}] (${pct}%) — Succeeded: ${successCount}, Failed: ${failCount}`);
    }
  });

  console.log(`\n==================================================`);
  console.log(`Backfill Complete!`);
  console.log(`  Succeeded: ${successCount}`);
  console.log(`  Failed:    ${failCount}`);
  console.log(`==================================================\n`);
}

main().catch((err) => {
  console.error('Fatal error during backfill script execution:', err);
  process.exit(1);
});
