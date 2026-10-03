/**
 * upload-articles-media.ts
 *
 * Uploads media extracted to /tmp/wp_media/wp-content/uploads/ to Firebase Cloud Storage
 * under `resources/public/articles/{filename}`.
 *
 * Generates /tmp/wp_media_url_map.json mapping all original WordPress URLs and thumbnail
 * suffix variants (-1024x768, -300x200, etc.) to the permanent Storage URL.
 *
 * Usage:
 *   # Dry-run (generate URL map without uploading):
 *   pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' ../scripts/wordpress-migration/upload-articles-media.ts --dry-run
 *
 *   # Target local Storage Emulator (port 9199):
 *   pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' ../scripts/wordpress-migration/upload-articles-media.ts --emulator
 *
 *   # Target production Storage:
 *   pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' ../scripts/wordpress-migration/upload-articles-media.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';

const MEDIA_ROOT = '/tmp/wp_media/wp-content/uploads';
const URL_MAP_PATH = '/tmp/wp_media_url_map.json';

const args = process.argv.slice(2);
const isEmulator = args.includes('--emulator');
const dryRun = args.includes('--dry-run');
const projectId = 'ilc-paris-class-tracker';

if (isEmulator) {
  process.env['FIREBASE_STORAGE_EMULATOR_HOST'] = '127.0.0.1:9199';
  process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8080';
}

if (!admin.apps.length) {
  admin.initializeApp({
    projectId,
    storageBucket: isEmulator
      ? `${projectId}.appspot.com`
      : `${projectId}.firebasestorage.app`,
  });
}

const bucket = admin.storage().bucket();

function getStorageUrl(filename: string): string {
  const encodedPath = encodeURIComponent(`resources/public/articles/${filename}`);
  if (isEmulator) {
    return `http://127.0.0.1:9199/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
}

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'mp3':
      return 'audio/mpeg';
    case 'mp4':
      return 'video/mp4';
    case 'zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

function getAllFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath));
    } else if (!file.startsWith('.')) {
      results.push(filePath);
    }
  }
  return results;
}

async function main() {
  console.log(`[Media Upload] Mode: ${dryRun ? 'DRY-RUN' : isEmulator ? 'EMULATOR' : 'PRODUCTION'}`);
  console.log(`[Media Upload] Scanning ${MEDIA_ROOT}...`);

  const files = getAllFiles(MEDIA_ROOT);
  console.log(`[Media Upload] Found ${files.length} extracted media files.`);

  const urlMap: Record<string, string> = {};

  // Build URL mappings for each file
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const relPath = path.relative(MEDIA_ROOT, filePath).replace(/\\/g, '/'); // e.g. 2021/07/ashe.png
    const publicUrl = getStorageUrl(filename);

    // Direct filename
    urlMap[filename] = publicUrl;
    urlMap[filename.toLowerCase()] = publicUrl;

    // Relative uploads path
    urlMap[`wp-content/uploads/${relPath}`] = publicUrl;
    urlMap[`wp-content/uploads/${relPath.toLowerCase()}`] = publicUrl;

    // Full URL variants
    const hostnames = [
      'https://iliqchuan.com',
      'http://iliqchuan.com',
      'https://www.iliqchuan.com',
      'http://www.iliqchuan.com',
      'https://iliqchuanblog.wordpress.com',
      'http://iliqchuanblog.wordpress.com',
      'https://iliqchuanblog.wpcomstaging.com',
      'http://iliqchuanblog.wpcomstaging.com',
      'https://i0.wp.com/iliqchuan.com',
      'https://i1.wp.com/iliqchuan.com',
      'https://i2.wp.com/iliqchuan.com',
    ];

    for (const host of hostnames) {
      urlMap[`${host}/wp-content/uploads/${relPath}`] = publicUrl;
    }

    // Map thumbnail/scaled suffix to the master file if this is a master file
    // e.g. ashe.png maps ashe-300x200.png, ashe-1024x768.png
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    if (!/-\d+x\d+$/.test(nameWithoutExt)) {
      // This is a master unscaled image
      const scaledPattern = new RegExp(`^${nameWithoutExt}-\\d+x\\d+${ext}$`, 'i');
      // Also register generic common dimensions
      for (const dim of ['1024x576', '1024x577', '1024x683', '1024x768', '300x200', '300x169', '300x300', '768x1024']) {
        const scaledName = `${nameWithoutExt}-${dim}${ext}`;
        urlMap[scaledName] = publicUrl;
        for (const host of hostnames) {
          const scaledRel = relPath.replace(filename, scaledName);
          urlMap[`${host}/wp-content/uploads/${scaledRel}`] = publicUrl;
        }
      }
    }
  }

  console.log(`[Media Upload] Generated ${Object.keys(urlMap).length} URL mapping rules.`);
  fs.writeFileSync(URL_MAP_PATH, JSON.stringify(urlMap, null, 2), 'utf-8');
  console.log(`[Media Upload] URL map saved to ${URL_MAP_PATH}`);

  if (dryRun) {
    console.log('[Media Upload] Dry run complete. No files uploaded.');
    return;
  }

  // Upload to Storage
  console.log(`[Media Upload] Uploading ${files.length} files to Firebase Storage (${bucket.name})...`);
  const CONCURRENCY = 15;
  let completed = 0;
  let uploaded = 0;
  let errors = 0;
  let activeIndex = 0;

  async function worker() {
    while (activeIndex < files.length) {
      const idx = activeIndex++;
      const localPath = files[idx];
      const filename = path.basename(localPath);
      const destination = `resources/public/articles/${filename}`;
      const contentType = getContentType(filename);

      try {
        await bucket.upload(localPath, {
          destination,
          metadata: {
            contentType,
            cacheControl: 'public, max-age=31536000',
          },
        });
        uploaded++;
      } catch (err: any) {
        errors++;
        console.warn(`[Media Upload] ⚠️ Failed ${filename}:`, err.message);
      }

      completed++;
      if (completed % 50 === 0 || completed === files.length) {
        console.log(`[Media Upload] Progress: ${completed}/${files.length} (Uploaded: ${uploaded}, Errors: ${errors})`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log('\n[Media Upload] Upload finished!');
  console.log(`  • Uploaded: ${uploaded}`);
  console.log(`  • Errors:   ${errors}`);
}

main().catch((err) => {
  console.error('[Media Upload] Fatal error:', err);
  process.exit(1);
});
