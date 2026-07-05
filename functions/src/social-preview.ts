/* social-preview.ts
 *
 * HTTP Cloud Function that serves the public detail pages — events, instructor
 * profiles and school profiles — with per-item Open Graph / Twitter Card meta
 * tags injected into the page <head>, so shared links unfurl with a rich
 * preview (image, title, summary).
 *
 * WHY A FUNCTION: The app is a client-rendered SPA using path-based routing.
 * Social crawlers don't run JavaScript, so they'd only see the static shell's
 * generic tags. Firebase Hosting rewrites the three public detail routes to this
 * function (see firebase.json), which fetches the document, injects the tags,
 * and returns the same SPA shell — humans still get the full app, crawlers get
 * the preview. Everything else is served statically / via the SPA fallback.
 */
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const SITE_NAME = 'I Liq Chuan Members Portal';

export interface Preview {
  title: string;
  description: string;
  image?: string;
}

// Per-instance cache of the SPA index.html shell, refreshed periodically so a
// new deploy's hashed asset filenames are picked up without a cold start.
let cachedIndexHtml: { html: string; fetchedAt: number } | null = null;
const INDEX_CACHE_MS = 5 * 60 * 1000;

async function getIndexHtml(host: string): Promise<string> {
  const now = Date.now();
  if (cachedIndexHtml && now - cachedIndexHtml.fetchedAt < INDEX_CACHE_MS) {
    return cachedIndexHtml.html;
  }
  // index.html is a static asset (not rewritten to this function), so this
  // returns the real SPA shell with no risk of recursion.
  const res = await fetch(`https://${host}/index.html`);
  if (!res.ok) {
    throw new Error(`Failed to fetch index.html: ${res.status}`);
  }
  const html = await res.text();
  cachedIndexHtml = { html, fetchedAt: now };
  return html;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert markdown/HTML/plain text into a truncated single-line summary. */
export function toPlainSummary(text: string, maxLen = 200): string {
  if (!text) return '';
  let s = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>~]/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxLen) {
    s = s.slice(0, maxLen - 1).trimEnd() + '…';
  }
  return s;
}

/** Fetch the first document in `collection` where `field` == `value`. */
async function firstWhere(
  collection: string,
  field: string,
  value: string,
): Promise<admin.firestore.DocumentData | null> {
  const snap = await admin
    .firestore()
    .collection(collection)
    .where(field, '==', value)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].data();
}

/** Resolve a request path to a preview, or null if it's not a known detail page. */
async function loadPreview(path: string): Promise<Preview | null> {
  const parts = path.split('/').filter(Boolean);
  const route = parts[0];
  const id = decodeURIComponent(parts[1] ?? '');
  if (!id) return null;

  if (route === 'events') {
    const db = admin.firestore();
    const byId = await db.collection('events').doc(id).get();
    const data = byId.exists ? byId.data() : await firstWhere('events', 'sourceId', id);
    if (!data) return null;
    return {
      title: data.title ?? 'Event',
      description: toPlainSummary(data.descriptionMarkdown || data.description || ''),
      image: data.heroImageLargeUrl || data.heroImageUrl || undefined,
    };
  }

  if (route === 'instructors') {
    const data = await firstWhere('instructors', 'instructorId', id);
    if (!data) return null;
    const location = [data.publicRegionOrCity, data.country].filter(Boolean).join(', ');
    const bio = toPlainSummary(data.publicBioMarkdown || '');
    return {
      title: `${data.name ?? id} — I Liq Chuan Instructor`,
      description: bio || (location ? `I Liq Chuan instructor in ${location}.` : ''),
      image: data.publicCoverImageUrl || data.publicProfileImageUrl || undefined,
    };
  }

  if (route === 'school-profile') {
    const data = await firstWhere('schools', 'schoolId', id);
    if (!data) return null;
    const location = [data.schoolCity, data.schoolCountry].filter(Boolean).join(', ');
    const bio = toPlainSummary(data.publicBioMarkdown || '');
    return {
      title: `${data.schoolName || id} — I Liq Chuan School`,
      description: bio || (location ? `I Liq Chuan school in ${location}.` : ''),
      image: data.publicCoverImageUrl || data.publicProfileImageUrl || undefined,
    };
  }

  return null;
}

/** Inject <title> + OG/Twitter meta tags for `preview` into the shell HTML. */
export function injectMeta(html: string, preview: Preview, url: string): string {
  const pageTitle = preview.title || SITE_NAME;
  const fullTitle = preview.title ? `${preview.title} | ${SITE_NAME}` : SITE_NAME;
  const description = preview.description;

  const meta = (attr: 'name' | 'property', key: string, content: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;

  const tags = [
    meta('name', 'description', description),
    meta('property', 'og:title', pageTitle),
    meta('property', 'og:description', description),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:url', url),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', pageTitle),
    meta('name', 'twitter:description', description),
  ];
  if (preview.image) {
    tags.push(meta('property', 'og:image', preview.image));
    tags.push(meta('name', 'twitter:image', preview.image));
  }

  let out = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(fullTitle)}</title>`,
  );
  out = out.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`);
  return out;
}

export const socialPreview = onRequest(async (request, response) => {
  const host =
    request.get('x-forwarded-host') ||
    request.get('host') ||
    `${process.env.GCLOUD_PROJECT}.web.app`;
  const path = request.path;
  const canonicalUrl = `https://${host}${path}`;

  let html: string;
  try {
    html = await getIndexHtml(host);
  } catch (error) {
    // If we can't get the shell we can't serve anything useful; let Hosting's
    // normal SPA fallback take over by redirecting to the same path minus the
    // rewrite (a plain redirect to index would drop the deep link, so 500).
    logger.error('socialPreview: failed to load index.html', error);
    response.status(500).send('Unable to load application shell.');
    return;
  }

  try {
    const preview = await loadPreview(path);
    if (preview) {
      html = injectMeta(html, preview, canonicalUrl);
    }
  } catch (error) {
    // On any lookup failure, fall through and serve the unmodified shell so the
    // SPA still loads for humans.
    logger.error('socialPreview: failed to build preview', { path, error });
  }

  response.set('Content-Type', 'text/html; charset=utf-8');
  response.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  response.status(200).send(html);
});
