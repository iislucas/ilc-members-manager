/* scripts/vimeo-inventory.ts
 *
 * Phase 1: Read-Only Vimeo Inventory & Order Discovery
 *
 * Scans Vimeo for:
 *   1. Account profile and scopes
 *   2. Vimeo On Demand (VOD) series and attached videos
 *   3. Showcases / Albums (including Showcase 4939978 - Class Video Library)
 *   4. Full video catalog with download URLs, thumbnail images, and metadata
 *   5. VOD orders, purchases, and buyer transactions (via API and optional CSV)
 *
 * Outputs:
 *   - tmp/vimeo_inventory.json
 *   - tmp/vimeo_orders.json
 *
 * Usage:
 *   pnpm --prefix functions exec ts-node -O '{"module": "commonjs", "esModuleInterop": true}' ../scripts/vimeo-inventory.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT_DIR, 'tmp');

function getVimeoToken(): string {
  const envToken = process.env['VIMEO_ACCESS_TOKEN'];
  if (envToken && envToken.trim()) {
    return envToken.trim();
  }

  const tokenPath = path.join(TMP_DIR, 'vimeo_token.txt');
  if (fs.existsSync(tokenPath)) {
    const raw = fs.readFileSync(tokenPath, 'utf8').trim();
    if (raw) return raw;
  }

  const secretPath = path.join(ROOT_DIR, 'secret.keys.txt');
  if (fs.existsSync(secretPath)) {
    const content = fs.readFileSync(secretPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('VIMEO_ACCESS_TOKEN=')) {
        return trimmed.replace('VIMEO_ACCESS_TOKEN=', '').trim();
      }
    }
  }

  throw new Error(
    'No Vimeo access token found. Please set VIMEO_ACCESS_TOKEN or create tmp/vimeo_token.txt.',
  );
}

const VIMEO_API_BASE = 'https://api.vimeo.com';

async function vimeoGet<T = any>(endpoint: string, token: string, params: Record<string, any> = {}): Promise<T> {
  const urlObj = new URL(endpoint.startsWith('http') ? endpoint : `${VIMEO_API_BASE}${endpoint}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      urlObj.searchParams.set(key, String(val));
    }
  }

  const resp = await fetch(urlObj.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
    },
  });

  if (!resp.ok) {
    let errBody: any = null;
    try {
      errBody = await resp.json();
    } catch {
      errBody = await resp.text();
    }
    const err: any = new Error(`Vimeo API HTTP ${resp.status}: ${resp.statusText}`);
    err.status = resp.status;
    err.data = errBody;
    throw err;
  }

  return (await resp.json()) as T;
}

async function fetchAllPages<T = any>(
  initialEndpoint: string,
  token: string,
  extraParams: Record<string, any> = {},
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  let total = 0;

  while (true) {
    try {
      const data: any = await vimeoGet(initialEndpoint, token, {
        per_page: 100,
        page,
        ...extraParams,
      });

      if (!data) break;

      const items = Array.isArray(data.data) ? data.data : [];
      results.push(...items);

      total = data.total || results.length;
      if (results.length >= total || !data.paging?.next || items.length === 0) {
        break;
      }
      page++;
    } catch (err: any) {
      if (err.status === 404) {
        break;
      }
      console.warn(`[Warn] Pagination fetch failed for ${initialEndpoint} (page ${page}):`, err.data?.error || err.message);
      break;
    }
  }

  return results;
}

export interface VimeoVideoItem {
  id: string;
  uri: string;
  name: string;
  description: string;
  durationSeconds: number;
  createdTime: string;
  modifiedTime: string;
  link: string;
  status: string;
  privacy: {
    view: string;
    embed: string;
    download: boolean;
  };
  bestDownloadUrl?: string;
  bestQuality?: string;
  bestSizeEstimateBytes?: number;
  downloadOptions: Array<{
    quality: string;
    type: string;
    width?: number;
    height?: number;
    size?: number;
    link: string;
    expires?: string;
  }>;
  thumbnailUrl: string;
  tags: string[];
  showcases: Array<{ id: string; name: string }>;
  vodPages: Array<{ id: string; name: string; link?: string }>;
}

export interface VimeoOrderItem {
  orderId: string;
  buyerEmail: string;
  buyerName?: string;
  vodPageId?: string;
  vodPageTitle?: string;
  videoId?: string;
  videoTitle?: string;
  transactionType: 'buy' | 'rent' | 'subscription' | 'unknown';
  amountPaid: number;
  currency: string;
  purchasedAt: string;
  source: 'vimeo_api' | 'csv_import';
}

async function main() {
  console.log('====================================================');
  console.log('   Vimeo On Demand & Video Catalog Discovery');
  console.log('====================================================\n');

  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  const token = getVimeoToken();
  console.log('✓ Loaded Vimeo token from local configuration.');

  // 1. Check Authenticated Account
  console.log('\n[1/5] Checking Authenticated Account...');
  let me: any;
  try {
    me = await vimeoGet('/me', token);
    console.log(`✓ Authenticated as: ${me.name} (${me.account} account)`);
    console.log(`  Profile: ${me.link}`);
    if (me.upload_quota?.space) {
      console.log(`  Storage: Used ${(me.upload_quota.space.used / 1e9).toFixed(2)} GB of ${(me.upload_quota.space.max / 1e9).toFixed(2)} GB`);
    }
  } catch (err: any) {
    console.error('✗ Authentication failed:', err.data || err.message);
    process.exit(1);
  }

  // 2. Discover Vimeo On Demand Pages
  console.log('\n[2/5] Scanning Vimeo On Demand (VOD) Pages...');
  let vodPages: any[] = [];
  try {
    vodPages = await fetchAllPages('/me/ondemand/pages', token);
    console.log(`✓ Found ${vodPages.length} VOD Page(s).`);
    for (const vp of vodPages) {
      const vodId = vp.uri ? vp.uri.split('/').pop() : vp.id;
      console.log(`  - [VOD ${vodId}] "${vp.name}" (Type: ${vp.type || 'series'}) -> ${vp.link}`);
    }
  } catch (err: any) {
    console.warn('  Note on VOD query:', err.data?.error || err.message);
  }

  // 3. Discover Showcases / Albums
  console.log('\n[3/5] Scanning Showcases / Albums...');
  let albums: any[] = [];
  try {
    albums = await fetchAllPages('/me/albums', token);
    console.log(`✓ Found ${albums.length} Showcase(s)/Album(s).`);
    for (const alb of albums) {
      const albId = alb.uri ? alb.uri.split('/').pop() : alb.id;
      console.log(`  - [Showcase ${albId}] "${alb.name}" (${alb.metadata?.connections?.videos?.total || 0} videos) -> ${alb.link}`);
    }
  } catch (err: any) {
    console.warn('  Note on Albums query:', err.data?.error || err.message);
  }

  // Map video IDs to showcase/VOD associations
  const videoToShowcases = new Map<string, Array<{ id: string; name: string }>>();
  const videoToVodPages = new Map<string, Array<{ id: string; name: string; link?: string }>>();

  for (const alb of albums) {
    const albId = alb.uri ? alb.uri.split('/').pop() : alb.id;
    try {
      const albumVideos = await fetchAllPages(`/me/albums/${albId}/videos`, token);
      for (const v of albumVideos) {
        const vid = v.uri ? v.uri.split('/').pop() : v.id;
        if (!vid) continue;
        const list = videoToShowcases.get(vid) || [];
        list.push({ id: albId, name: alb.name });
        videoToShowcases.set(vid, list);
      }
    } catch {
      // ignore
    }
  }

  for (const vp of vodPages) {
    const vodId = vp.uri ? vp.uri.split('/').pop() : vp.id;
    try {
      const vodVideos = await fetchAllPages(`/ondemand/pages/${vodId}/videos`, token);
      for (const v of vodVideos) {
        const vid = v.uri ? v.uri.split('/').pop() : v.id;
        if (!vid) continue;
        const list = videoToVodPages.get(vid) || [];
        list.push({ id: vodId, name: vp.name, link: vp.link });
        videoToVodPages.set(vid, list);
      }
    } catch {
      // ignore
    }
  }

  // 4. Fetch All Videos & Download Links
  console.log('\n[4/5] Fetching Full Video Catalog & Media Links...');
  const rawVideos = await fetchAllPages('/me/videos', token, {
    fields: 'uri,name,description,duration,created_time,modified_time,link,status,privacy,download,files,pictures,tags',
  });
  console.log(`✓ Fetched ${rawVideos.length} total video document(s).`);

  const inventory: VimeoVideoItem[] = [];
  let downloadableCount = 0;
  let totalEstimatedBytes = 0;
  let totalDurationSeconds = 0;

  for (const v of rawVideos) {
    const videoId = v.uri ? v.uri.split('/').pop() : '';
    if (!videoId) continue;

    const downloadOptions: VimeoVideoItem['downloadOptions'] = [];

    // Check direct download array
    if (Array.isArray(v.download)) {
      for (const d of v.download) {
        if (d.link) {
          downloadOptions.push({
            quality: d.quality || d.rendition || 'unknown',
            type: d.type || 'video/mp4',
            width: d.width,
            height: d.height,
            size: d.size,
            link: d.link,
            expires: d.expires,
          });
        }
      }
    }

    // Check progressive streaming files array (fallback if download array is empty)
    if (Array.isArray(v.files)) {
      for (const f of v.files) {
        if (f.link && f.type === 'video/mp4') {
          downloadOptions.push({
            quality: f.quality || f.rendition || `${f.height || ''}p`,
            type: f.type,
            width: f.width,
            height: f.height,
            size: f.size,
            link: f.link,
            expires: f.link_expiration_time,
          });
        }
      }
    }

    // Rank quality: source > 4k > 2k > hd / 1080p > 720p > 540p > sd > 480p > 360p > 240p > mobile
    const qualityPriority: Record<string, number> = {
      source: 100,
      '4k': 90,
      '2k': 80,
      hd: 70,
      '1080p': 70,
      '720p': 60,
      '540p': 50,
      sd: 40,
      '480p': 40,
      '360p': 30,
      '240p': 20,
      mobile: 10,
    };

    downloadOptions.sort((a, b) => {
      const pa = qualityPriority[(a.quality || '').toLowerCase()] || (a.height ? a.height / 10 : 0);
      const pb = qualityPriority[(b.quality || '').toLowerCase()] || (b.height ? b.height / 10 : 0);
      return pb - pa;
    });

    const bestOption = downloadOptions[0];
    if (bestOption) {
      downloadableCount++;
      if (bestOption.size) {
        totalEstimatedBytes += bestOption.size;
      }
    }

    totalDurationSeconds += v.duration || 0;

    // Get best thumbnail
    let thumbnailUrl = '';
    if (Array.isArray(v.pictures?.sizes) && v.pictures.sizes.length > 0) {
      const sortedPics = [...v.pictures.sizes].sort((a, b) => (b.width || 0) - (a.width || 0));
      thumbnailUrl = sortedPics[0]?.link || '';
    } else if (v.pictures?.base_link) {
      thumbnailUrl = v.pictures.base_link;
    }

    const tags = Array.isArray(v.tags)
      ? v.tags.map((t: any) => (typeof t === 'string' ? t : t.name || t.tag || ''))
      : [];

    inventory.push({
      id: videoId,
      uri: v.uri,
      name: v.name || 'Untitled Video',
      description: v.description || '',
      durationSeconds: v.duration || 0,
      createdTime: v.created_time || '',
      modifiedTime: v.modified_time || '',
      link: v.link || '',
      status: v.status || 'available',
      privacy: {
        view: v.privacy?.view || '',
        embed: v.privacy?.embed || '',
        download: Boolean(v.privacy?.download),
      },
      bestDownloadUrl: bestOption?.link,
      bestQuality: bestOption?.quality,
      bestSizeEstimateBytes: bestOption?.size,
      downloadOptions,
      thumbnailUrl,
      tags: tags.filter(Boolean),
      showcases: videoToShowcases.get(videoId) || [],
      vodPages: videoToVodPages.get(videoId) || [],
    });
  }

  // 5. Query Orders, Purchases & Transactions
  console.log('\n[5/5] Checking VOD Purchases, Orders & Buyer Transactions...');
  const orders: VimeoOrderItem[] = [];

  for (const vp of vodPages) {
    const vodId = vp.uri ? vp.uri.split('/').pop() : vp.id;
    try {
      console.log(`  Scanning transactions for VOD series "${vp.name}" (ID: ${vodId})...`);
      const vodPurchases = await fetchAllPages(`/ondemand/pages/${vodId}/purchases`, token);
      for (const p of vodPurchases) {
        orders.push({
          orderId: p.uri || p.id || `vod_purchase_${vodId}_${p.user?.uri || orders.length}`,
          buyerEmail: (p.user?.email || p.email || '').toLowerCase(),
          buyerName: p.user?.name || '',
          vodPageId: vodId,
          vodPageTitle: vp.name,
          transactionType: p.type || 'buy',
          amountPaid: p.price?.amount || 0,
          currency: p.price?.currency || 'USD',
          purchasedAt: p.purchase_time || p.created_time || new Date().toISOString(),
          source: 'vimeo_api',
        });
      }
    } catch (err: any) {
      console.log(`  - Purchases API for VOD ${vodId}: ${err.status === 403 ? 'Endpoint not available with this token type (CSV fallback can be used)' : (err.data?.error || err.message)}`);
    }
  }

  // Check for local CSV orders files if present (e.g. exported from Vimeo Analytics dashboard)
  const candidateCsvFiles = [
    path.join(TMP_DIR, 'vimeo_transactions.csv'),
    path.join(TMP_DIR, 'vimeo_orders.csv'),
    path.join(ROOT_DIR, 'vimeo_transactions.csv'),
  ];

  for (const csvPath of candidateCsvFiles) {
    if (fs.existsSync(csvPath)) {
      console.log(`\n✓ Found local CSV export: ${path.relative(ROOT_DIR, csvPath)}`);
      try {
        const csvContent = fs.readFileSync(csvPath, 'utf8');
        const lines = csvContent.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length > 1) {
          const headers = lines[0]!.split(',').map((h) => h.replace(/"/g, '').trim().toLowerCase());
          console.log(`  Parsing CSV with ${lines.length - 1} row(s)...`);
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i]!.split(',').map((c) => c.replace(/"/g, '').trim());
            const row: Record<string, string> = {};
            headers.forEach((h, idx) => {
              row[h] = cols[idx] || '';
            });

            const email = row['email'] || row['buyer email'] || row['customer email'] || row['user email'] || '';
            if (email) {
              orders.push({
                orderId: row['transaction id'] || row['order id'] || `csv_order_${i}`,
                buyerEmail: email.toLowerCase(),
                buyerName: row['name'] || row['buyer name'] || '',
                vodPageTitle: row['product'] || row['title'] || row['video'] || '',
                transactionType: (row['type'] as any) || 'buy',
                amountPaid: parseFloat(row['amount'] || row['price'] || '0') || 0,
                currency: row['currency'] || 'USD',
                purchasedAt: row['date'] || row['created at'] || new Date().toISOString(),
                source: 'csv_import',
              });
            }
          }
        }
      } catch (err: any) {
        console.warn('  Error parsing CSV:', err.message);
      }
    }
  }

  // Write Reports
  const inventoryFile = path.join(TMP_DIR, 'vimeo_inventory.json');
  fs.writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2), 'utf8');

  const ordersFile = path.join(TMP_DIR, 'vimeo_orders.json');
  fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), 'utf8');

  // Summary
  console.log('\n====================================================');
  console.log('   DISCOVERY SUMMARY');
  console.log('====================================================');
  console.log(`• Authenticated User   : ${me.name} (${me.account})`);
  console.log(`• Total Videos Found   : ${inventory.length}`);
  console.log(`• Videos with MP4 URLs : ${downloadableCount} / ${inventory.length}`);
  console.log(`• Total Showcases      : ${albums.length}`);
  console.log(`• Total VOD Series     : ${vodPages.length}`);
  console.log(`• Total Video Duration : ${(totalDurationSeconds / 3600).toFixed(1)} hours`);
  console.log(`• Total Estimated Size : ${(totalEstimatedBytes / 1e9).toFixed(2)} GB`);
  console.log(`• Customer Orders Found: ${orders.length}`);
  console.log(`• Inventory Report     : ${path.relative(ROOT_DIR, inventoryFile)}`);
  console.log(`• Orders Report        : ${path.relative(ROOT_DIR, ordersFile)}`);
  console.log('====================================================\n');

  if (downloadableCount < inventory.length) {
    console.warn(`⚠️ Warning: ${inventory.length - downloadableCount} video(s) did not return direct MP4 download links.`);
    console.warn('   Ensure your Vimeo token has the `video_files` and `private` scopes enabled.\n');
  }
}

main().catch((err) => {
  console.error('Fatal error running Vimeo discovery:', err);
  process.exit(1);
});
