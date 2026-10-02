/**
 * generate-review-catalog.ts
 *
 * Reads `/tmp/wp_parsed_articles.json` (produced by parse-jetpack-sql.py),
 * connects to Firestore to retrieve existing articles from:
 *   - /articles-post
 *   - /members-post
 *   - /instructors-post
 *
 * Matches each parsed article to detect duplicates and categorize:
 *   - ALREADY_IMPORTED: Present in Firestore
 *   - UTILITY_OR_STUB: Cart, checkout, utility pages or stubs (< 50 chars)
 *   - CANDIDATE_FOR_IMPORT: Ready to be imported as draft
 *
 * Generates:
 *   - docs/plans/wiki-articles-review-catalog.md
 *   - /tmp/wp_import_ready_manifest.json
 *
 * Usage:
 *   pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' ../scripts/wordpress-migration/generate-review-catalog.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';

const PARSED_ARTICLES_JSON = '/tmp/wp_parsed_articles.json';
const OUTPUT_CATALOG_MD = path.join(__dirname, '../../docs/plans/wiki-articles-review-catalog.md');
const OUTPUT_MANIFEST_JSON = '/tmp/wp_import_ready_manifest.json';

const UTILITY_SLUGS = new Set([
  'cart',
  'checkout',
  'my-account',
  'shop',
  'refund_returns',
  'student-search',
  'initial-intake-triage-questionaire',
  'reset-password',
  'password-reset-email-sent',
  'new-password-saved',
  'front-page-backup',
  'paypal-page',
  'gradings-old-dnu',
  'home',
  'thank-you',
  'donation-failed',
  'donate',
  'content-restricted',
  'shop-for-i-liq-chuan-products',
  'workshop-photos',
  'connect-with-us',
  'contact',
  'license-confirmation',
]);

interface ParsedArticle {
  id: number;
  post_type: 'yada_wiki' | 'post' | 'page';
  title: string;
  slug: string;
  status: string;
  post_date: string;
  author_id: number;
  author_name: string;
  categories: string[];
  tags: string[];
  thumbnail_url: string;
  media_urls: string[];
  has_video: boolean;
  char_count: number;
  word_count: number;
  excerpt: string;
  content_html: string;
  guid: string;
}

interface ExistingArticle {
  id: string;
  urlId: string;
  title: string;
  collection: string;
  isDraft: boolean;
}

function slugify(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTitle(t: string): string {
  return (t || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function deriveTargetCollection(a: ParsedArticle): { collection: string; targetCategories: string[] } {
  const combined = (a.title + ' ' + a.slug + ' ' + (a.categories || []).join(' ') + ' ' + (a.tags || []).join(' ')).toLowerCase();

  // 1. Instructors Area
  if (
    combined.includes('instructor') ||
    combined.includes('handout') ||
    combined.includes('license') ||
    combined.includes('affiliate') ||
    combined.includes('discipleship')
  ) {
    return {
      collection: 'instructors-post',
      targetCategories: a.categories.length > 0 ? a.categories : ['Instructors'],
    };
  }

  // 2. Members Only Area
  if (
    combined.includes('curriculum') ||
    combined.includes('student training') ||
    combined.includes('grading level') ||
    combined.includes('sash') ||
    combined.includes('chin family updates')
  ) {
    return {
      collection: 'members-post',
      targetCategories: a.categories.length > 0 ? a.categories : ['Curriculum'],
    };
  }

  // 3. Default Public Articles
  let cats = a.categories.length > 0 ? a.categories : ['Wiki & Guides'];
  if (combined.includes('philosophy') || combined.includes('concept') || combined.includes('neutral') || combined.includes('attention')) {
    cats = ['Philosophy'];
  } else if (combined.includes('history') || combined.includes('founder') || combined.includes('chin lik keong') || combined.includes('biography')) {
    cats = ['History'];
  } else if (combined.includes('form') || combined.includes('chin na') || combined.includes('spinning') || combined.includes('sticky')) {
    cats = ['Forms & Training'];
  } else if (combined.includes('sifu says')) {
    cats = ['Sifu Says'];
  }

  return {
    collection: 'articles-post',
    targetCategories: cats,
  };
}

async function main() {
  console.log('[Catalog] Starting review catalog generation...');

  if (!fs.existsSync(PARSED_ARTICLES_JSON)) {
    console.error(`Error: Parsed articles file not found at ${PARSED_ARTICLES_JSON}`);
    process.exit(1);
  }

  const rawArticles: ParsedArticle[] = JSON.parse(fs.readFileSync(PARSED_ARTICLES_JSON, 'utf-8'));
  console.log(`[Catalog] Loaded ${rawArticles.length} parsed articles from JSON.`);

  // Initialize Firebase Admin
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: 'ilc-paris-class-tracker' });
  }
  const db = admin.firestore();

  // Load existing articles from Firestore
  console.log('[Catalog] Fetching existing articles from Firestore collections...');
  const existingArticles: ExistingArticle[] = [];
  const existingBySlug = new Map<string, ExistingArticle>();
  const existingByTitle = new Map<string, ExistingArticle>();
  const existingById = new Map<string, ExistingArticle>();

  const targetCollections = ['articles-post', 'members-post', 'instructors-post'];
  for (const coll of targetCollections) {
    const snap = await db.collection(coll).get();
    console.log(`  • ${coll}: ${snap.size} documents`);
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, any>;
      const item: ExistingArticle = {
        id: doc.id,
        urlId: (data['urlId'] || '').toLowerCase(),
        title: data['title'] || '',
        collection: coll,
        isDraft: !!data['isDraft'],
      };
      existingArticles.push(item);
      existingById.set(doc.id, item);
      if (item.urlId) {
        existingBySlug.set(item.urlId, item);
      }
      const normT = normalizeTitle(item.title);
      if (normT) {
        existingByTitle.set(normT, item);
      }
    }
  }

  console.log(`[Catalog] Total existing articles in Firestore: ${existingArticles.length}`);

  // Categorize parsed articles
  interface EvaluatedArticle extends ParsedArticle {
    auditStatus: 'ALREADY_IMPORTED' | 'UTILITY_OR_STUB' | 'CANDIDATE_FOR_IMPORT';
    matchedExisting?: ExistingArticle;
    targetCollection: string;
    targetCategories: string[];
    suggestedUrlId: string;
  }

  const evaluated: EvaluatedArticle[] = [];
  const candidates: EvaluatedArticle[] = [];
  const alreadyImported: EvaluatedArticle[] = [];
  const utilityOrStubs: EvaluatedArticle[] = [];

  for (const a of rawArticles) {
    let cleanSlug = (a.slug || '').toLowerCase().trim();
    if (!cleanSlug || /^\d+$/.test(cleanSlug)) {
      cleanSlug = slugify(a.title) || `post-${a.id}`;
    }
    const normT = normalizeTitle(a.title);

    // 1. Check if stub or utility
    const isTrailerStub = /from Federation I Liq Chuan on Vimeo/i.test(a.content_html) || /Buy .* on Vimeo/i.test(a.content_html);
    const isVeryShort = a.char_count < 150 && a.media_urls.length < 2 && !a.has_video;
    const isStub = a.char_count < 60 || isTrailerStub || isVeryShort;
    const isUtility = UTILITY_SLUGS.has(cleanSlug);
    const isShortcodeOnly = a.content_html.trim().startsWith('[') && a.content_html.trim().endsWith(']') && a.content_html.length < 100;
    const catsLower = (a.categories || []).map((c) => c.toLowerCase());
    const tagsLower = (a.tags || []).map((t) => t.toLowerCase());
    const isZoomCategoryOrTag = catsLower.some((c) => c.includes('zoom')) || tagsLower.some((t) => t.includes('zoom'));
    const isZoomMeetingInvite = /zoom\.us\/j\//i.test(a.content_html || '') || /inviting you to a scheduled zoom meeting/i.test(a.content_html || '');
    const isClassCancellationOrZoomNotice =
      isZoomCategoryOrTag ||
      isZoomMeetingInvite ||
      /no\s+(members\s+)?(zoom\s+)?class/i.test(a.title) ||
      /no\s+(members\s+)?session/i.test(a.title) ||
      /class\s+cancel/i.test(a.title) ||
      /zoom\s+session.*resumes/i.test(a.title) ||
      /no-class/i.test(cleanSlug) ||
      /no-session/i.test(cleanSlug) ||
      /no-members-session/i.test(cleanSlug) ||
      /zoom-class/i.test(cleanSlug);

    const { collection, targetCategories } = deriveTargetCollection(a);

    // 2. Check duplicate match
    let match: ExistingArticle | undefined;
    const possibleDocIds = [
      `wp-wiki-${a.id}`,
      `wp-post-${a.id}`,
      `wp-page-${a.id}`,
      `wp-${a.id}`,
    ];
    for (const pid of possibleDocIds) {
      if (existingById.has(pid)) {
        match = existingById.get(pid);
        break;
      }
    }
    if (!match && cleanSlug && existingBySlug.has(cleanSlug)) {
      match = existingBySlug.get(cleanSlug);
    }
    if (!match && normT && existingByTitle.has(normT)) {
      match = existingByTitle.get(normT);
    }

    let auditStatus: 'ALREADY_IMPORTED' | 'UTILITY_OR_STUB' | 'CANDIDATE_FOR_IMPORT';

    if (match) {
      auditStatus = 'ALREADY_IMPORTED';
    } else if (isStub || isUtility || isShortcodeOnly || isClassCancellationOrZoomNotice) {
      auditStatus = 'UTILITY_OR_STUB';
    } else {
      auditStatus = 'CANDIDATE_FOR_IMPORT';
    }

    const item: EvaluatedArticle = {
      ...a,
      auditStatus,
      matchedExisting: match,
      targetCollection: collection,
      targetCategories,
      suggestedUrlId: cleanSlug,
    };

    evaluated.push(item);
    if (auditStatus === 'ALREADY_IMPORTED') {
      alreadyImported.push(item);
    } else if (auditStatus === 'UTILITY_OR_STUB') {
      utilityOrStubs.push(item);
    } else {
      candidates.push(item);
    }
  }

  console.log('\n[Catalog] Evaluation Summary:');
  console.log(`  • Already imported (duplicates skipped): ${alreadyImported.length}`);
  console.log(`  • Utility / Stubs / Empty excluded:      ${utilityOrStubs.length}`);
  console.log(`  • Ready for Draft Import:               ${candidates.length}`);

  // Breakdown of Candidates by Post Type
  const candByPostType = { yada_wiki: 0, post: 0, page: 0 };
  for (const c of candidates) {
    candByPostType[c.post_type] = (candByPostType[c.post_type] || 0) + 1;
  }
  console.log(`    - Wiki articles:  ${candByPostType.yada_wiki}`);
  console.log(`    - Standard posts: ${candByPostType.post}`);
  console.log(`    - Standard pages: ${candByPostType.page}`);

  // Breakdown by Target Collection
  const candByColl: Record<string, number> = {};
  for (const c of candidates) {
    candByColl[c.targetCollection] = (candByColl[c.targetCollection] || 0) + 1;
  }
  for (const [coll, count] of Object.entries(candByColl)) {
    console.log(`    - Target [${coll}]: ${count}`);
  }

  // Save machine-readable manifest for Phase 4 & 5
  fs.writeFileSync(OUTPUT_MANIFEST_JSON, JSON.stringify(candidates, null, 2), 'utf-8');
  console.log(`[Catalog] Saved import-ready candidate manifest to ${OUTPUT_MANIFEST_JSON}`);

  // Generate Markdown Catalog
  let md = `# WordPress Historical Articles & Wiki Review Catalog\n\n`;
  md += `> Generated on ${new Date().toISOString().slice(0, 10)} from Jetpack backup SQL extraction.\n\n`;
  md += `## 1. Summary Overview\n\n`;
  md += `| Category | Total | Description |\n`;
  md += `| :--- | :--- | :--- |\n`;
  md += `| **Candidates for Draft Import** | **${candidates.length}** | New articles to import into Firestore as drafts (zero collision with existing docs) |\n`;
  md += `| — *Wiki Articles (\`yada_wiki\`)* | ${candByPostType.yada_wiki} | Core knowledgebase & philosophical essays |\n`;
  md += `| — *Standard Blog Posts (\`post\`)* | ${candByPostType.post} | Historical announcements, event summaries, student blogs |\n`;
  md += `| — *Standard Pages (\`page\`)* | ${candByPostType.page} | Evergreen informational and system pages |\n`;
  md += `| **Already Imported (Skipped)** | **${alreadyImported.length}** | Exact matches already present in Firestore (protected from overwrite) |\n`;
  md += `| **Excluded Utility / Stubs** | **${utilityOrStubs.length}** | Empty stubs, WooCommerce cart/checkout/shop pages, or dead utility forms |\n`;
  md += `| **Total Evaluated** | **${evaluated.length}** | Full database inventory |\n\n`;

  md += `### Target Collection Routing Breakdown for Candidates\n\n`;
  md += `| Collection | Count | Description |\n`;
  md += `| :--- | :--- | :--- |\n`;
  md += `| \`articles-post\` (Public Articles) | ${candByColl['articles-post'] || 0} | Public articles, Sifu Says, philosophy, forms & training, history |\n`;
  md += `| \`members-post\` (Members Only) | ${candByColl['members-post'] || 0} | Curriculum, syllabus updates, training guides |\n`;
  md += `| \`instructors-post\` (Instructors Area) | ${candByColl['instructors-post'] || 0} | Instructor resources, licensing, affiliate guides |\n\n`;

  md += `---\n\n`;
  md += `## 2. Candidates for Draft Import (Wiki Articles: ${candByPostType.yada_wiki})\n\n`;
  md += `These articles represent the previously missing wiki content from \`yada_wiki\`:\n\n`;
  md += `| WP ID | Title | Slug | Target Collection | Categories | Words | Media | Date |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  const wikiCandidates = candidates.filter((c) => c.post_type === 'yada_wiki');
  wikiCandidates.sort((a, b) => b.post_date.localeCompare(a.post_date));

  for (const c of wikiCandidates) {
    const dateStr = c.post_date.slice(0, 10);
    const mediaCount = c.media_urls.length + (c.thumbnail_url ? 1 : 0) + (c.has_video ? 1 : 0);
    const cats = c.targetCategories.join(', ') || 'Articles';
    md += `| \`${c.id}\` | **${escapeMd(c.title)}** | \`${c.suggestedUrlId}\` | \`${c.targetCollection}\` | ${cats} | ${c.word_count} | ${mediaCount} | ${dateStr} |\n`;
  }

  md += `\n---\n\n`;
  md += `## 3. Candidates for Draft Import (Standard Posts & Pages: ${candByPostType.post + candByPostType.page})\n\n`;
  md += `| WP ID | Type | Title | Slug | Target Collection | Categories | Words | Media | Date |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  const otherCandidates = candidates.filter((c) => c.post_type !== 'yada_wiki');
  otherCandidates.sort((a, b) => b.post_date.localeCompare(a.post_date));

  for (const c of otherCandidates) {
    const dateStr = c.post_date.slice(0, 10);
    const mediaCount = c.media_urls.length + (c.thumbnail_url ? 1 : 0) + (c.has_video ? 1 : 0);
    const cats = c.targetCategories.join(', ') || 'Articles';
    md += `| \`${c.id}\` | \`${c.post_type}\` | **${escapeMd(c.title)}** | \`${c.suggestedUrlId}\` | \`${c.targetCollection}\` | ${cats} | ${c.word_count} | ${mediaCount} | ${dateStr} |\n`;
  }

  md += `\n---\n\n`;
  md += `## 4. Already Imported Articles (Skipped / No Overwrite: ${alreadyImported.length})\n\n`;
  md += `| WP ID | Title | Slug | Matched Existing Doc | Existing Collection |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const a of alreadyImported) {
    const matched = a.matchedExisting!;
    md += `| \`${a.id}\` | ${escapeMd(a.title)} | \`${a.slug}\` | \`${matched.id}\` | \`${matched.collection}\` |\n`;
  }

  md += `\n---\n\n`;
  md += `## 5. Excluded Utility Pages & Empty Stubs (${utilityOrStubs.length})\n\n`;
  md += `| WP ID | Type | Title | Slug | Reason |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const u of utilityOrStubs) {
    const reason = UTILITY_SLUGS.has(u.slug.toLowerCase())
      ? 'WooCommerce / Core Utility Page'
      : u.char_count < 60
      ? 'Stub / Under 60 characters of text'
      : 'Shortcode container only';
    md += `| \`${u.id}\` | \`${u.post_type}\` | ${escapeMd(u.title || '(untitled)')} | \`${u.slug}\` | ${reason} |\n`;
  }

  fs.writeFileSync(OUTPUT_CATALOG_MD, md, 'utf-8');
  console.log(`[Catalog] Markdown Review Catalog saved to ${OUTPUT_CATALOG_MD}`);
  console.log('[Catalog] Done!');
}

function escapeMd(str: string): string {
  return (str || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

main().catch((err) => {
  console.error('[Catalog] Error:', err);
  process.exit(1);
});
