/* functions/scripts/backfill-video-spritesheets.ts
 *
 * Scans Firestore /videos collection for videos missing `spriteSheetUrl`
 * and reports or updates their sprite configuration for timeline scrubbing.
 *
 * Usage:
 *   # Inspect videos missing sprite sheets (dry-run):
 *   pnpm --prefix functions run backfill-video-spritesheets -- --dry-run
 *
 *   # Target a specific video:
 *   pnpm --prefix functions run backfill-video-spritesheets -- --videoId <videoId>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as admin from 'firebase-admin';
import { firestoreDocToVideoItem, VideoItem } from '../src/data-model/vod';

interface CliOptions {
  dryRun: boolean;
  project: string;
  videoId: string;
  limit: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    project: '',
    videoId: '',
    limit: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--project' && i + 1 < argv.length) {
      options.project = argv[i + 1]!;
      i += 1;
    } else if (arg === '--videoId' && i + 1 < argv.length) {
      options.videoId = argv[i + 1]!;
      i += 1;
    } else if (arg === '--limit' && i + 1 < argv.length) {
      options.limit = parseInt(argv[i + 1]!, 10);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveGcpProjectId(args.project);

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId,
    });
  }

  const db = admin.firestore();
  console.log(`\n=== Scanning /videos for sprite sheet status (dryRun: ${args.dryRun}) ===\n`);

  let query: admin.firestore.Query = db.collection('videos');
  if (args.videoId) {
    query = query.where(admin.firestore.FieldPath.documentId(), '==', args.videoId);
  }
  if (args.limit > 0) {
    query = query.limit(args.limit);
  }

  const snap = await query.get();
  console.log(`Found ${snap.size} total videos in query.`);

  const missingSprites: VideoItem[] = [];
  const withSprites: VideoItem[] = [];

  for (const doc of snap.docs) {
    const video = firestoreDocToVideoItem(doc);
    if (!video.spriteSheetUrl) {
      missingSprites.push(video);
    } else {
      withSprites.push(video);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Videos with sprite sheets:    ${withSprites.length}`);
  console.log(`  Videos missing sprite sheets: ${missingSprites.length}\n`);

  for (const v of missingSprites) {
    console.log(`  - [${v.docId}] "${v.title}"`);
    console.log(`      Duration: ${v.durationSeconds}s | Poster: ${v.thumbnailUrl ? 'Yes' : 'No'}`);
    console.log(`      Manifest: ${v.manifestUrl ? 'Yes' : 'No'}`);
  }

  if (missingSprites.length > 0) {
    console.log(`\n💡 To generate sprite sheets for existing videos:`);
    console.log(`   Upload updated videos via /manage-vod/upload, which automatically`);
    console.log(`   extracts 25-frame composite sprite sheets locally in the browser,`);
    console.log(`   or configure GCP Transcoder API with sprite sheet generation enabled.`);
  }
}

main().catch((err) => {
  console.error('Fatal error during backfill script execution:', err);
  process.exit(1);
});
