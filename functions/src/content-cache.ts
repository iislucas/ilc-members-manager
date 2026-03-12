/* content-cache.ts
 *
 * Firebase Cloud Functions to cache external content in Firestore.
 *
 * This module fetches content from Google Calendar and Squarespace,
 * normalises it into lean documents containing only the fields the
 * frontend UI actually uses, and writes each item as its own Firestore
 * document under flat top-level collections. The frontend subscribes
 * to these collections with onSnapshot for fast, real-time reads — no
 * Cloud Function call needed on the read path.
 *
 * Collections written:
 *   /events/{docId}            — cached calendar events (public)
 *   /members-post/{docId}      — cached members-area blog posts
 *   /instructors-post/{docId}  — cached instructors blog posts
 *   /system/cache-metadata     — refresh timestamps and item counts
 *
 * Triggers:
 *   refreshContentCache  — scheduled every 30 minutes
 *   manualRefreshCache   — callable by admins
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { assertAdmin, allowedOrigins } from './common';
import { GoogleCalendarResponse, GoogleCalendarEventItem } from './calendar.types';
import { CachedCalendarEvent, CachedBlogPost, CacheMetadata } from './data-model';
import { environment } from './environment/environment';

const calendarApiKey = defineSecret('GOOGLE_CALENDAR_API_KEY');

// Squarespace configuration
const SQUARESPACE_BASE_URL = 'https://lute-denim-99n2.squarespace.com';

// Blog paths to cache and the Firestore collection each maps to.
const BLOG_CONFIGS: { path: string; collection: string }[] = [
  { path: '/membersareablog', collection: 'members-post' },
  { path: '/instructorsblog', collection: 'instructors-post' },
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

export function getEventEndDate(end?: { dateTime?: string; date?: string }): string {
  if (!end) return 'N/A';
  if (end.date && !end.dateTime) {
    const endDate = new Date(end.date);
    endDate.setDate(endDate.getDate() - 1);
    return endDate.toISOString().split('T')[0];
  }
  return end.dateTime || end.date || 'N/A';
}

export function mapToCalendarEvent(item: GoogleCalendarEventItem): CachedCalendarEvent {
  const location = item.location || '';
  const googleMapsUrl = location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
    : '';
  return {
    title: item.summary || 'No Title',
    start: item.start?.dateTime || item.start?.date || 'N/A',
    end: getEventEndDate(item.end),
    description: item.description || '',
    location,
    googleMapsUrl,
    googleCalEventLink: item.htmlLink || '',
  };
}

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
// asset/image URLs.
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
  };
}

// Delete all documents in a collection. Works in batches to stay
// within the Firestore 500-op limit per batch.
async function deleteCollection(
  db: admin.firestore.Firestore,
  collectionPath: string,
): Promise<number> {
  const colRef = db.collection(collectionPath);
  const docs = await colRef.listDocuments();
  let deleted = 0;

  // Process in chunks of 400 (leaving room for other ops in the batch).
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + 400);
    for (const docRef of chunk) {
      batch.delete(docRef);
    }
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

// ------------------------------------------------------------------
// Core refresh logic
// ------------------------------------------------------------------

async function refreshEventsCache(db: admin.firestore.Firestore): Promise<number> {
  const calendarId = environment.googleCalendar.calendarId;
  if (!calendarId) {
    logger.warn('EVENTS_CALENDAR_ID is not set; skipping events cache refresh.');
    return 0;
  }

  if (!calendarApiKey.value()) {
    logger.warn('Google Calendar API key not configured; skipping events cache refresh.');
    return 0;
  }

  const params: Record<string, unknown> = {
    key: calendarApiKey.value(),
    singleEvents: true,
    orderBy: 'startTime',
    timeMin: new Date().toISOString(),
    maxResults: 100,
  };

  const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId,
  )}/events`;

  const response = await axios.get<GoogleCalendarResponse>(calendarApiUrl, { params });
  const items = response.data.items || [];

  // Clear existing cached events.
  await deleteCollection(db, 'events');

  // Write new events in batches.
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    const chunk = items.slice(i, i + 400);
    for (let j = 0; j < chunk.length; j++) {
      const event = mapToCalendarEvent(chunk[j]);
      const docRef = db.collection('events').doc(`event-${String(i + j).padStart(4, '0')}`);
      batch.set(docRef, event);
    }
    await batch.commit();
  }

  logger.info(`Events cache refreshed: ${items.length} events written.`);
  return items.length;
}

async function refreshBlogCache(db: admin.firestore.Firestore): Promise<number> {
  let totalPosts = 0;

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

      // Clear existing cached posts for this blog.
      await deleteCollection(db, blogConfig.collection);

      if (data.items && Array.isArray(data.items)) {
        for (let i = 0; i < data.items.length; i += 400) {
          const batch = db.batch();
          const chunk = data.items.slice(i, i + 400);

          for (const item of chunk) {
            const cached = mapToCachedBlogPost(item, baseUrl);
            const docRef = db.collection(blogConfig.collection).doc(item.id || `post-${totalPosts}`);
            batch.set(docRef, cached);
            totalPosts++;
          }

          await batch.commit();
        }
        logger.info(`Cached ${data.items.length} posts from ${blogConfig.path} → ${blogConfig.collection}.`);
      } else {
        logger.warn(`No items found in response for ${blogConfig.path}.`);
      }
    } catch (error) {
      logger.error(`Error fetching blog content from ${blogConfig.path}:`, error);
      // Continue with other blogs even if one fails.
    }
  }

  logger.info(`Blog cache refreshed: ${totalPosts} total posts written.`);
  return totalPosts;
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

// Scheduled: runs every 30 minutes.
export const refreshContentCache = onSchedule(
  { schedule: 'every 30 minutes', secrets: [calendarApiKey] },
  async () => {
    const db = admin.firestore();
    try {
      const [eventCount, postCount] = await Promise.all([
        refreshEventsCache(db),
        refreshBlogCache(db),
      ]);
      await updateCacheMetadata(db, {
        eventsLastRefreshed: new Date().toISOString(),
        eventsItemCount: eventCount,
        blogsLastRefreshed: new Date().toISOString(),
        blogsItemCount: postCount,
      });
      logger.info(
        `Scheduled cache refresh complete: ${eventCount} events, ${postCount} blog posts.`,
      );
    } catch (error) {
      logger.error('Scheduled cache refresh failed:', error);
    }
  },
);

// Admin-callable: allows admins to trigger a manual refresh.
export const manualRefreshCache = onCall(
  { cors: allowedOrigins, secrets: [calendarApiKey] },
  async (request) => {
    logger.info('manualRefreshCache called.');
    await assertAdmin(request);

    const eventsOnly = request.data?.eventsOnly === true;
    const blogsOnly = request.data?.blogsOnly === true;

    const db = admin.firestore();
    let eventCount = 0;
    let postCount = 0;

    if (!blogsOnly) {
      eventCount = await refreshEventsCache(db);
      await updateCacheMetadata(db, {
        eventsLastRefreshed: new Date().toISOString(),
        eventsItemCount: eventCount,
      });
    }
    if (!eventsOnly) {
      postCount = await refreshBlogCache(db);
      await updateCacheMetadata(db, {
        blogsLastRefreshed: new Date().toISOString(),
        blogsItemCount: postCount,
      });
    }

    return {
      success: true,
      eventCount,
      postCount,
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
    const collectionsToDelete = ['events', ...BLOG_CONFIGS.map((c) => c.collection)];

    let totalDeleted = 0;
    for (const collection of collectionsToDelete) {
      const deleted = await deleteCollection(db, collection);
      totalDeleted += deleted;
      logger.info(`Cleared ${deleted} documents from ${collection}.`);
    }

    await updateCacheMetadata(db, {
      eventsLastRefreshed: '',
      eventsItemCount: 0,
      blogsLastRefreshed: '',
      blogsItemCount: 0,
    });

    logger.info(`Cache cleared: ${totalDeleted} total documents deleted.`);
    return { success: true, deletedCount: totalDeleted };
  },
);
