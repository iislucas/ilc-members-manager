/* content-cache.ts
 *
 * Firebase Cloud Functions to cache external content in Firestore.
 *
 * This module fetches content from Squarespace, normalises it into
 * lean documents containing only the fields the frontend UI actually
 * uses, and writes each item as its own Firestore document under flat
 * top-level collections. The frontend subscribes to these collections
 * with onSnapshot for fast, real-time reads — no Cloud Function call
 * needed on the read path.
 *
 * Sync strategy:
 *   Each item stores a stable source identifier in a designated field
 *   (`id` for blog posts). On re-sync the engine queries existing
 *   documents by that field to decide whether to create, update, or
 *   delete — Firestore document IDs remain auto-generated. Only items
 *   whose content has actually changed are written, and only items
 *   that no longer exist in the source are deleted. Each document
 *   carries a `lastUpdated` timestamp set only when content
 *   meaningfully changes.
 *
 *   Blog posts carry a `kind` field (BlogPostSourceKind) so that
 *   pruning only removes posts from the same source, allowing other
 *   kinds of posts to coexist safely in the same collection.
 *
 * Collections written:
 *   /members-post/{docId}      — cached members-area blog posts
 *   /instructors-post/{docId}  — cached instructors blog posts
 *   /system/cache-metadata     — refresh timestamps, item counts,
 *                                and per-sync update/removal stats
 *
 * Triggers:
 *   refreshContentCache  — scheduled every 2 hours
 *   manualRefreshCache   — callable by admins
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { assertAdmin, allowedOrigins } from './common';
import {
  BlogPostSourceKind,
  blogPostSourceKind,
  CachedBlogPost,
  CacheMetadata,
} from './data-model';

// Squarespace configuration
const SQUARESPACE_BASE_URL = 'https://lute-denim-99n2.squarespace.com';

// Blog paths to cache and the Firestore collection each maps to.
const BLOG_CONFIGS: { path: string; collection: string }[] = [
  { path: '/membersareablog', collection: 'members-post' },
  { path: '/instructorsblog', collection: 'instructors-post' },
];

// ------------------------------------------------------------------
// Sync types
// ------------------------------------------------------------------

// Result of a single collection sync: how many items were processed
// and what changed.
export type SyncResult = {
  total: number;
  updated: number;
  removed: number;
  unchanged: number;
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

// Process HTML to fix Squarespace-specific issues (protocol-relative
// URLs, lazy-loaded images, video embeds). This is the same logic the
// frontend previously ran, moved server-side so the cached HTML is
// ready to render.
export function processSquarespaceHtml(html: string, baseUrl: string): string {
  if (!html) return '';

  let processed = html.replace(/src="\/\//g, 'src="https://');
  processed = processed.replace(/href="\/\//g, 'href="https://');

  if (baseUrl) {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    processed = processed.replace(/(src|href)="\/([^/])/g, `$1="${base}/$2`);
  }

  processed = processed.replace(/<img([^>]*)>/gi, (match) => {
    let newImg = match;
    if (newImg.includes('data-src=')) {
      const dataSrcMatch = newImg.match(/data-src="([^"]+)"/);
      if (dataSrcMatch) {
        let realSrc = dataSrcMatch[1];
        if (!realSrc.includes('format=')) {
          realSrc += (realSrc.includes('?') ? '&' : '?') + 'format=1000w';
        }
        newImg = newImg.replace(/\s+src="[^"]*"/g, '');
        newImg = newImg.replace(/data-src="[^"]*"/, `src="${realSrc}"`);
      }
    }
    if (newImg.includes('data-srcset=')) {
      newImg = newImg.replace(/\s+srcset="[^"]*"/g, '');
      newImg = newImg.replace(/data-srcset=/g, 'srcset=');
    }
    newImg = newImg.replace(/class="([^"]*)loading([^"]*)"/gi, 'class="$1$2"');
    return newImg;
  });

  processed = processed.replace(
    /<div[^>]*class="[^"]*sqs-video-wrapper[^"]*"[^>]*data-html="([^"]+)"[^>]*>.*?<\/div>/gi,
    (_match, dataHtml) => {
      const unescaped = dataHtml
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
      return `<div class="ilc-video-container">${unescaped}</div>`;
    },
  );

  return processed;
}

export function cleanAssetUrl(assetUrl: string | undefined, baseUrl: string): string {
  let url = assetUrl ? String(assetUrl).trim() : '';
  if (url === 'undefined' || url === 'null' || url.includes('no-image.png') || url.endsWith('/')) {
    url = '';
  }
  if (url && !url.startsWith('http') && !url.startsWith('//')) {
    url = baseUrl + (url.startsWith('/') ? '' : '/') + url;
  }
  return url;
}

// Map a raw Squarespace blog item (from their JSON API) to our lean
// CachedBlogPost format. The `baseUrl` is used to resolve relative
// asset/image URLs. Stamps `kind` with the source that produced it.
// Note: `lastUpdated` is NOT set here — it is managed by the sync logic.
export function mapToCachedBlogPost(
  item: Record<string, unknown>,
  baseUrl: string,
): CachedBlogPost {
  return {
    id: (item.id as string) || '',
    urlId: (item.urlId as string) || '',
    title: (item.title as string) || '',
    excerpt: processSquarespaceHtml((item.excerpt as string) || '', baseUrl),
    body: processSquarespaceHtml(
      (item.body as string) || (item.content as string) || '',
      baseUrl,
    ),
    assetUrl: cleanAssetUrl(item.assetUrl as string | undefined, baseUrl),
    publishOn: (item.publishOn as number) || 0,
    addedOn: (item.addedOn as number) || 0,
    categories: (item.categories as string[]) || [],
    tags: (item.tags as string[]) || [],
    author: ((item.author as Record<string, unknown>)?.displayName as string) || '',
    kind: BlogPostSourceKind.Squarespace,
  };
}

// ------------------------------------------------------------------
// Sync engine
// ------------------------------------------------------------------

// Compare an incoming item's content fields against an existing
// Firestore document to decide whether a write is needed. The
// `lastUpdated` field is excluded from comparison since it is
// metadata managed by the sync engine itself.
export function contentChanged(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'lastUpdated') continue;
    if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
      return true;
    }
  }
  return false;
}

// Whether a stored blog post came from `source`, and is therefore that
// source's to prune or clear. A post from any other source was authored
// elsewhere and must be left alone.
//
// This is the single definition of "disposable" in this module: prune and
// clearContentCache both go through it, so they cannot disagree about what is
// safe to delete. An undefined `source` means the caller opted out entirely.
function isFromSource(
  data: Partial<Record<'kind', unknown>>,
  source: BlogPostSourceKind | undefined,
): boolean {
  if (!source) return true;
  return blogPostSourceKind(data) === source;
}

// Sync a Firestore collection with fresh source data using
// upsert-and-prune. Firestore document IDs remain auto-generated;
// items are matched by a designated source ID field within each
// document (`id` for blog posts, the only content synced today).
//
//   1. Write items that are new or whose content has changed
//      (bumping `lastUpdated` only on actual changes).
//   2. Delete items that no longer exist in the source.
//
// `sourceIdField` — the name of the field in each document that holds
// the stable source identifier used for matching.
//
// If `kindFilter` is provided, only prune documents whose `kind`
// field matches the filter (or have no `kind` at all, treating them
// as legacy entries from the same source). This allows documents
// from other sources to coexist safely in the same collection.

async function syncCollection(
  db: admin.firestore.Firestore,
  collectionPath: string,
  freshItems: Record<string, unknown>[],
  sourceIdField: string,
  options?: { kindFilter?: BlogPostSourceKind },
): Promise<SyncResult> {
  const colRef = db.collection(collectionPath);
  const now = new Date().toISOString();

  // Build a map of fresh items keyed by their source ID.
  const freshMap = new Map<string, Record<string, unknown>>();
  for (const item of freshItems) {
    const sourceId = item[sourceIdField] as string;
    if (sourceId) {
      freshMap.set(sourceId, item);
    }
  }

  // Read all existing documents and index them by the source ID field.
  const existingSnapshot = await colRef.get();
  const existingBySourceId = new Map<string, { docId: string; data: Record<string, unknown> }>();
  // Docs without a source ID are legacy orphans from the old
  // delete-all-then-recreate approach; they'll be pruned below.
  const orphans: { docId: string; data: Record<string, unknown> }[] = [];

  existingSnapshot.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const sourceId = data[sourceIdField] as string;
    if (sourceId) {
      existingBySourceId.set(sourceId, { docId: doc.id, data });
    } else {
      orphans.push({ docId: doc.id, data });
    }
  });

  let updated = 0;
  let unchanged = 0;

  // Phase 1: Upsert — create or update items.
  const freshSourceIds = [...freshMap.keys()];
  for (let i = 0; i < freshSourceIds.length; i += 400) {
    const batch = db.batch();
    let batchHasOps = false;
    const chunk = freshSourceIds.slice(i, i + 400);

    for (const sourceId of chunk) {
      const newData = freshMap.get(sourceId)!;
      const existing = existingBySourceId.get(sourceId);

      if (
        existing &&
        blogPostSourceKind(existing.data) === BlogPostSourceKind.FirebaseSourced
      ) {
        unchanged++;
        continue;
      }

      if (existing && !contentChanged(existing.data, newData)) {
        unchanged++;
        continue;
      }

      // Determine the doc ref: reuse existing Firestore ID or create new.
      const docRef = existing
        ? colRef.doc(existing.docId)
        : colRef.doc(); // auto-generated ID

      batch.set(docRef, { ...newData, lastUpdated: now });
      batchHasOps = true;
      updated++;
    }

    if (batchHasOps) {
      await batch.commit();
    }
  }

  // Phase 2: Prune — delete docs no longer present in the source.
  const staleIds: string[] = [];

  // Docs with a source ID that no longer appears in the fresh set.
  for (const [sourceId, existing] of existingBySourceId) {
    if (freshMap.has(sourceId)) continue;

    // Only prune docs from the same source; anything authored elsewhere is
    // left untouched.
    if (!isFromSource(existing.data, options?.kindFilter)) continue;

    staleIds.push(existing.docId);
  }

  // Legacy orphan docs without a source ID are also pruned (respecting kindFilter).
  for (const orphan of orphans) {
    if (!isFromSource(orphan.data, options?.kindFilter)) continue;
    staleIds.push(orphan.docId);
  }

  let removed = 0;
  for (let i = 0; i < staleIds.length; i += 400) {
    const batch = db.batch();
    const chunk = staleIds.slice(i, i + 400);
    for (const id of chunk) {
      batch.delete(colRef.doc(id));
    }
    await batch.commit();
    removed += chunk.length;
  }

  return { total: freshMap.size, updated, removed, unchanged };
}

// Delete the cached documents in a collection. Used only by the explicit
// "clear cache" admin action, not during normal sync.
//
// `kindFilter` names the source whose content is being cleared. Only documents
// that source owns are deleted — posts authored elsewhere live in the same
// collection and are not cache, so clearing the cache must not destroy them.
// Returns the number deleted and the number left in place.
async function deleteCollection(
  db: admin.firestore.Firestore,
  collectionPath: string,
  kindFilter: BlogPostSourceKind,
): Promise<{ deleted: number; kept: number }> {
  const colRef = db.collection(collectionPath);
  // Read the documents rather than listDocuments(), because deciding what is
  // disposable requires each document's `kind` field.
  const snapshot = await colRef.get();
  const disposable = snapshot.docs.filter((doc) =>
    isFromSource(doc.data(), kindFilter),
  );
  let deleted = 0;

  for (let i = 0; i < disposable.length; i += 400) {
    const batch = db.batch();
    const chunk = disposable.slice(i, i + 400);
    for (const doc of chunk) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += chunk.length;
  }
  return { deleted, kept: snapshot.size - deleted };
}

// ------------------------------------------------------------------
// Core refresh logic
// ------------------------------------------------------------------

async function refreshBlogCache(db: admin.firestore.Firestore): Promise<SyncResult> {
  let totalResult: SyncResult = { total: 0, updated: 0, removed: 0, unchanged: 0 };

  for (const blogConfig of BLOG_CONFIGS) {
    const targetUrl = `${SQUARESPACE_BASE_URL}${blogConfig.path}?format=json`;
    logger.info(`Fetching blog content from: ${targetUrl}`);

    try {
      const response = await axios.get(targetUrl);
      const data = response.data;

      let baseUrl = (data.website?.baseUrl as string) || '';
      if (baseUrl && !baseUrl.startsWith('http')) {
        baseUrl = 'https:' + (baseUrl.startsWith('//') ? '' : '//') + baseUrl;
      }

      // Map to cached format; each item carries `id` (the Squarespace
      // item ID) for matching during sync.
      const freshItems: Record<string, unknown>[] = [];
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const cached = mapToCachedBlogPost(item, baseUrl);
          freshItems.push(cached as unknown as Record<string, unknown>);
        }
      }

      // Sync with kindFilter so only squarespace-sourced posts are pruned.
      const result = await syncCollection(db, blogConfig.collection, freshItems, 'id', {
        kindFilter: BlogPostSourceKind.Squarespace,
      });

      totalResult = {
        total: totalResult.total + result.total,
        updated: totalResult.updated + result.updated,
        removed: totalResult.removed + result.removed,
        unchanged: totalResult.unchanged + result.unchanged,
      };

      logger.info(
        `Blog ${blogConfig.path} → ${blogConfig.collection} synced: ` +
        `${result.total} total, ${result.updated} updated, ` +
        `${result.removed} removed, ${result.unchanged} unchanged.`,
      );
    } catch (error) {
      logger.error(`Error fetching blog content from ${blogConfig.path}:`, error);
      // Continue with other blogs even if one fails.
    }
  }

  logger.info(
    `Blog cache sync complete: ${totalResult.total} total, ` +
    `${totalResult.updated} updated, ${totalResult.removed} removed.`,
  );
  return totalResult;
}

// Update the metadata document at /system/cache-metadata.
async function updateCacheMetadata(
  db: admin.firestore.Firestore,
  update: Partial<CacheMetadata>,
): Promise<void> {
  const metaRef = db.collection('system').doc('cache-metadata');
  await metaRef.set(update, { merge: true });
}

// ------------------------------------------------------------------
// Exported Cloud Functions
// ------------------------------------------------------------------

// Scheduled: runs every 2 hours.
export const refreshContentCache = onSchedule(
  { schedule: 'every 2 hours' },
  async () => {
    const db = admin.firestore();
    try {
      const blogResult = await refreshBlogCache(db);
      await updateCacheMetadata(db, {
        blogsLastRefreshed: new Date().toISOString(),
        blogsItemCount: blogResult.total,
        blogsLastSyncUpdated: blogResult.updated,
        blogsLastSyncRemoved: blogResult.removed,
      });
      logger.info(
        `Scheduled cache sync complete: ${blogResult.total} blog posts ` +
        `(${blogResult.updated} updated).`,
      );
    } catch (error) {
      logger.error('Scheduled cache refresh failed:', error);
    }
  },
);

// Admin-callable: allows admins to trigger a manual refresh.
export const manualRefreshCache = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('manualRefreshCache called.');
    await assertAdmin(request);

    const db = admin.firestore();
    const blogResult = await refreshBlogCache(db);
    await updateCacheMetadata(db, {
      blogsLastRefreshed: new Date().toISOString(),
      blogsItemCount: blogResult.total,
      blogsLastSyncUpdated: blogResult.updated,
      blogsLastSyncRemoved: blogResult.removed,
    });

    return {
      success: true,
      postCount: blogResult.total,
      blogsUpdated: blogResult.updated,
      blogsRemoved: blogResult.removed,
    };
  },
);

// Admin-callable: allows admins to clear all cached content.
export const clearContentCache = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('clearContentCache called.');
    await assertAdmin(request);

    const db = admin.firestore();
    // Only cached blog collections are cleared. `/events` is authored in
    // the app itself, so it is never treated as disposable cache.
    const collectionsToDelete = BLOG_CONFIGS.map((c) => c.collection);

    let totalDeleted = 0;
    let totalKept = 0;
    for (const collection of collectionsToDelete) {
      // Scoped to Squarespace-sourced posts: these collections may also hold
      // posts authored in the app, which are not cache and must survive.
      const { deleted, kept } = await deleteCollection(
        db,
        collection,
        BlogPostSourceKind.Squarespace,
      );
      totalDeleted += deleted;
      totalKept += kept;
      logger.info(
        `Cleared ${deleted} cached documents from ${collection} ` +
          `(kept ${kept} authored).`,
      );
    }

    await updateCacheMetadata(db, {
      blogsLastRefreshed: '',
      blogsItemCount: 0,
      blogsLastSyncUpdated: 0,
      blogsLastSyncRemoved: 0,
    });

    logger.info(
      `Cache cleared: ${totalDeleted} cached documents deleted, ` +
        `${totalKept} authored documents kept.`,
    );
    return { success: true, deletedCount: totalDeleted, keptCount: totalKept };
  },
);
