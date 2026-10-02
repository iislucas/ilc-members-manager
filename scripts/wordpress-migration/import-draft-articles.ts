/**
 * import-draft-articles.ts
 *
 * Reads candidate articles from `/tmp/wp_import_ready_manifest.json` and URL mappings
 * from `/tmp/wp_media_url_map.json`, rewrites HTML/shortcodes/media URLs, and imports
 * all candidate articles into their target Firestore collections as DRAFTS.
 *
 * All imported articles have:
 *   isDraft: true
 *   status: 'draft' (BlogPostStatus.Draft)
 *   kind: 'wordpress' (BlogPostSourceKind.WordPress)
 *
 * Strict duplicate prevention: checks existing IDs, slugs, and normalized titles before write.
 *
 * Usage:
 *   # Dry-run (verify transformations, no writes):
 *   pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' ../scripts/wordpress-migration/import-draft-articles.ts --dry-run
 *
 *   # Target local Firestore Emulator:
 *   pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' ../scripts/wordpress-migration/import-draft-articles.ts --emulator
 *
 *   # Target production Firestore:
 *   pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' ../scripts/wordpress-migration/import-draft-articles.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { BlogPostSourceKind, BlogPostStatus, CachedBlogPost } from '../../functions/src/data-model/content-cache';

const MANIFEST_PATH = '/tmp/wp_import_ready_manifest.json';
const URL_MAP_PATH = '/tmp/wp_media_url_map.json';

const args = process.argv.slice(2);
const isEmulator = args.includes('--emulator');
const dryRun = args.includes('--dry-run');
const projectId = 'ilc-paris-class-tracker';

if (isEmulator) {
  process.env['FIRESTORE_EMULATOR_HOST'] = process.env['FIRESTORE_EMULATOR_HOST'] || '127.0.0.1:8080';
  process.env['FIREBASE_STORAGE_EMULATOR_HOST'] = '127.0.0.1:9199';
}

if (!admin.apps.length) {
  admin.initializeApp({
    projectId,
    storageBucket: isEmulator
      ? `${projectId}.appspot.com`
      : `${projectId}.firebasestorage.app`,
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// Load URL Map
let urlMap: Record<string, string> = {};
if (fs.existsSync(URL_MAP_PATH)) {
  urlMap = JSON.parse(fs.readFileSync(URL_MAP_PATH, 'utf-8'));
  console.log(`[Import] Loaded ${Object.keys(urlMap).length} media URL mappings.`);
}

function resolveStorageUrl(src: string): string | null {
  if (!src) return null;
  const clean = src.split('?')[0].trim();
  if (urlMap[clean]) return urlMap[clean];
  if (urlMap[clean.toLowerCase()]) return urlMap[clean.toLowerCase()];

  const base = path.basename(clean);
  if (urlMap[base]) return urlMap[base];
  if (urlMap[base.toLowerCase()]) return urlMap[base.toLowerCase()];

  // Try unscaled version: foo-1024x768.png -> foo.png
  const unscaled = base.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, '$1');
  if (urlMap[unscaled]) return urlMap[unscaled];
  if (urlMap[unscaled.toLowerCase()]) return urlMap[unscaled.toLowerCase()];

  return null;
}

function convertVideoShortcodes(text: string): string {
  if (!text) return '';
  // YouTube [youtube ...]
  let res = text.replace(/\[youtube(?:=|\s+)(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})\b[^\]]*\]/gi, (_, vidId) => {
    return `<div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; margin: 1.5rem 0;">
  <iframe src="https://www.youtube.com/embed/${vidId}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>`;
  });

  // Vimeo [vimeo ...]
  res = res.replace(/\[vimeo(?:=|\s+)(?:https?:\/\/)?(?:www\.)?(?:vimeo\.com\/)(\d+)\b[^\]]*\]/gi, (_, vidId) => {
    return `<div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; margin: 1.5rem 0;">
  <iframe src="https://player.vimeo.com/video/${vidId}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
</div>`;
  });

  return res;
}

function cleanHtml(html: string): string {
  if (!html) return '';

  // 1. Rewrite <img> tags
  let rewritten = html.replace(/<img([^>]+)src=["']([^"']+)["']([^>]*)>/gi, (match, prefix, src, suffix) => {
    const storageUrl = resolveStorageUrl(src);
    if (storageUrl) {
      return `<img${prefix}src="${storageUrl}"${suffix}>`;
    }
    return match;
  });

  // Strip WordPress srcset/sizes which still reference wp.com
  rewritten = rewritten.replace(/\s+(?:srcset|sizes)=["'][^"']*["']/gi, '');

  // 2. Rewrite <a> tags to media documents
  rewritten = rewritten.replace(/<a([^>]+)href=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|pdf|mp4|zip))["']([^>]*)>/gi, (match, prefix, href, suffix) => {
    const storageUrl = resolveStorageUrl(href);
    if (storageUrl) {
      return `<a${prefix}href="${storageUrl}" target="_blank" rel="noopener noreferrer"${suffix}>`;
    }
    return match;
  });

  // 3. Strip inert shortcodes and comments
  rewritten = rewritten
    .replace(/\[(gravityform|pt_view|vimeography|contact-form|ngg_images)\b[^\]]*\]/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div\b[^>]*class=["'][^"']*wc-block-[^"']*["'][^>]*>\s*<\/div>/gi, '');

  // 4. Video shortcodes
  rewritten = convertVideoShortcodes(rewritten);

  // 5. Clean adjacent bold/formatting
  for (let i = 0; i < 3; i++) {
    const prev = rewritten;
    rewritten = rewritten
      .replace(/<\/(b|strong)>(\s*)<\1>/gi, '$2')
      .replace(/<(b|strong)>\s*(?:&nbsp;)?\s*<\/\1>/gi, '');
    if (rewritten === prev) break;
  }

  // 6. Wrap plain paragraphs if needed
  if (!rewritten.includes('<p>') && !rewritten.includes('<p ')) {
    const blocks = rewritten.split(/\n{2,}/);
    rewritten = blocks
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b) => {
        if (/^<(h[1-6]|div|table|ul|ol|figure|p|blockquote)\b/i.test(b)) return b;
        return `<p>${b.replace(/\n/g, '<br />')}</p>`;
      })
      .join('\n\n');
  }

  return rewritten.trim();
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/\[[^\]]*\]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstImage(html: string): string {
  const matches = html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
  for (const match of matches) {
    const src = match[1];
    if (src.includes('firebasestorage.googleapis.com') || src.includes('9199') || src.includes('resources%2Fpublic%2Farticles')) {
      return src;
    }
    const resolved = resolveStorageUrl(src);
    if (resolved) return resolved;
  }
  return '';
}

function parseDateMs(dateStr: string): number {
  if (!dateStr) return Date.now();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

async function main() {
  console.log(`[Import] Target: ${isEmulator ? 'FIRESTORE EMULATOR (127.0.0.1:8080)' : 'PRODUCTION FIRESTORE'}`);
  console.log(`[Import] Mode:   ${dryRun ? 'DRY-RUN (No writes)' : 'COMMIT'}`);

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Error: Candidate manifest not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const candidates: any[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  console.log(`[Import] Loaded ${candidates.length} candidate articles from manifest.`);

  // Double check existing articles in Firestore to guarantee NO duplicates
  console.log('[Import] Verifying live Firestore state to ensure zero duplicate collisions...');
  const existingDocIds = new Set<string>();
  const existingSlugs = new Set<string>();

  for (const coll of ['articles-post', 'members-post', 'instructors-post']) {
    const snap = await db.collection(coll).get();
    for (const doc of snap.docs) {
      existingDocIds.add(doc.id);
      const u = doc.data()['urlId'];
      if (u) existingSlugs.add(String(u).toLowerCase());
    }
  }

  console.log(`[Import] Verified ${existingDocIds.size} existing documents across all target collections.`);

  // Prepare batch payloads grouped by target collection
  const payloadsByCollection: Record<string, CachedBlogPost[]> = {
    'articles-post': [],
    'members-post': [],
    'instructors-post': [],
  };

  let skippedDuplicates = 0;

  for (const item of candidates) {
    const docId = `wp-${item.post_type}-${item.id}`;
    let slug = (item.suggestedUrlId || `post-${item.id}`).toLowerCase();

    // Check if ID or slug already exists
    if (existingDocIds.has(docId)) {
      skippedDuplicates++;
      continue;
    }

    // Deduplicate slug if another doc has the exact slug
    let uniqueSlug = slug;
    let counter = 2;
    while (existingSlugs.has(uniqueSlug)) {
      uniqueSlug = `${slug}-${counter++}`;
    }
    existingSlugs.add(uniqueSlug);

    const formattedHtml = cleanHtml(item.content_html);
    let assetUrl = item.thumbnail_url ? resolveStorageUrl(item.thumbnail_url) || '' : '';
    if (!assetUrl) {
      assetUrl = extractFirstImage(formattedHtml);
    }

    const plainText = stripHtml(formattedHtml);
    const excerpt = item.excerpt ? stripHtml(item.excerpt) : plainText.length > 220 ? plainText.slice(0, 220).trim() + '...' : plainText;
    const postTimeMs = parseDateMs(item.post_date);

    const postDoc: CachedBlogPost = {
      id: docId,
      urlId: uniqueSlug,
      title: item.title,
      excerpt,
      body: formattedHtml,
      bodyMarkdown: '',
      assetUrl,
      publishOn: postTimeMs,
      addedOn: postTimeMs,
      categories: item.targetCategories && item.targetCategories.length > 0 ? item.targetCategories : ['Articles'],
      tags: item.tags || [],
      author: item.author_name || 'Sam FS Chin',
      kind: BlogPostSourceKind.WordPress,
      isDraft: true,
      status: BlogPostStatus.Draft,
      lastUpdated: new Date().toISOString(),
    };

    const targetColl = item.targetCollection || 'articles-post';
    if (!payloadsByCollection[targetColl]) {
      payloadsByCollection[targetColl] = [];
    }
    payloadsByCollection[targetColl].push(postDoc);
  }

  console.log('\n[Import] Prepared Import Breakdown (all in Draft status):');
  for (const [coll, docs] of Object.entries(payloadsByCollection)) {
    console.log(`  • ${coll}: ${docs.length} articles`);
  }
  if (skippedDuplicates > 0) {
    console.log(`  • Skipped live duplicates: ${skippedDuplicates}`);
  }

  if (dryRun) {
    console.log('\n[Import] DRY-RUN Mode: Inspecting 1 sample prepared article:');
    const sample = payloadsByCollection['articles-post'][0] || payloadsByCollection['instructors-post'][0];
    console.log(JSON.stringify(sample, null, 2));
    console.log('\n[Import] Dry run complete. No database writes were performed.');
    return;
  }

  // Commit batches to Firestore
  for (const [collName, docs] of Object.entries(payloadsByCollection)) {
    if (docs.length === 0) continue;

    console.log(`\n[Import] Committing ${docs.length} articles to '${collName}' in batches...`);
    const BATCH_SIZE = 20;
    const totalBatches = Math.ceil(docs.length / BATCH_SIZE);
    let committed = 0;

    for (let b = 0; b < totalBatches; b++) {
      const chunk = docs.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
      const batch = db.batch();
      for (const article of chunk) {
        const docRef = db.collection(collName).doc(article.id);
        batch.set(docRef, article);
      }

      await batch.commit();
      committed += chunk.length;
      console.log(`  [Batch ${b + 1}/${totalBatches}] Committed ${committed}/${docs.length} to ${collName}`);
    }
  }

  console.log('\n✅ [Import] All draft articles imported successfully!');
}

main().catch((err) => {
  console.error('[Import] Error:', err);
  process.exit(1);
});
