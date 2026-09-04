/* scripts/backfill-video-series.ts
 *
 * Backfill script for updating all existing Vimeo VOD videos in Firestore
 * with seriesId, seriesTitle, seriesPartIndex, and seriesPriceCents.
 *
 * Usage:
 *   # Dry run:
 *   ts-node -O '{"module": "commonjs", "esModuleInterop": true}' scripts/backfill-video-series.ts --dry-run
 *
 *   # Commit to Firestore:
 *   ts-node -O '{"module": "commonjs", "esModuleInterop": true}' scripts/backfill-video-series.ts --commit
 *
 *   # Custom project:
 *   ts-node -O '{"module": "commonjs", "esModuleInterop": true}' scripts/backfill-video-series.ts --project=ilc-paris-class-tracker --commit
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';

const ROOT_DIR = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT_DIR, 'tmp');

const DRY_RUN = !process.argv.includes('--commit');
const projectArg = process.argv.find((a) => a.startsWith('--project='));
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : 'ilc-paris-class-tracker';

interface VodPricingEntry {
  vodId: string;
  name: string;
  type: string;
  trailerId?: string;
  trailerName?: string;
  buyPriceUSD?: number;
  rentPriceUSD?: number;
  subscriptionPriceUSD?: number;
  link?: string;
}

interface VimeoInventoryItem {
  id: string;
  name: string;
  durationSeconds: number;
  createdTime: string;
  vodPages?: Array<{ id: string; name: string; link?: string }>;
}

function extractPartIndex(title: string, defaultIndex: number): number {
  const match = title.match(/part\s*(\d+)/i) || title.match(/part\s*([ivx]+)/i) || title.match(/#\s*(\d+)/);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
    const romanMap: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    const lower = match[1].toLowerCase();
    if (romanMap[lower]) return romanMap[lower];
  }
  return defaultIndex;
}

async function main() {
  console.log('====================================================');
  console.log('   Backfill Video Series Metadata into Firestore');
  console.log('====================================================');
  console.log(`Target Project : ${PROJECT_ID}`);
  console.log(`Mode           : ${DRY_RUN ? 'DRY RUN (Use --commit to write)' : 'COMMIT (Live Firestore updates)'}`);
  console.log('====================================================\n');

  const inventoryPath = path.join(TMP_DIR, 'vimeo_inventory.json');
  const pricingPath = path.join(TMP_DIR, 'vimeo_vod_pricing.json');

  if (!fs.existsSync(inventoryPath)) {
    console.error(`Inventory file not found at ${inventoryPath}`);
    process.exit(1);
  }

  const inventory: VimeoInventoryItem[] = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const pricingList: VodPricingEntry[] = fs.existsSync(pricingPath)
    ? JSON.parse(fs.readFileSync(pricingPath, 'utf8'))
    : [];

  const pricingMap = new Map<string, VodPricingEntry>();
  const trailerToPricing = new Map<string, VodPricingEntry>();

  for (const p of pricingList) {
    pricingMap.set(p.vodId, p);
    if (p.trailerId) {
      trailerToPricing.set(p.trailerId, p);
    }
  }

  // Group inventory items by VOD series ID
  const seriesGroups = new Map<string, VimeoInventoryItem[]>();

  for (const item of inventory) {
    if (item.vodPages && item.vodPages.length > 0) {
      for (const vp of item.vodPages) {
        const list = seriesGroups.get(vp.id) || [];
        list.push(item);
        seriesGroups.set(vp.id, list);
      }
    }
  }

  console.log(`Found ${seriesGroups.size} unique VOD series groups across ${inventory.length} total videos.`);

  let db: admin.firestore.Firestore | null = null;
  if (!DRY_RUN) {
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: PROJECT_ID });
    }
    db = admin.firestore();
  }

  let totalUpdated = 0;
  let totalTrailersUpdated = 0;

  for (const [seriesId, items] of seriesGroups) {
    const pricing = pricingMap.get(seriesId);
    const seriesTitle = pricing?.name || items[0]?.vodPages?.find((p) => p.id === seriesId)?.name || `Series ${seriesId}`;
    const priceUSD = pricing?.buyPriceUSD ?? 49.99;
    const priceCents = Math.round(priceUSD * 100);

    // Filter out trailers from the series episode list
    const nonTrailers = items.filter((v) => {
      const isExplicitTrailer = pricing?.trailerId === v.id || v.name.toLowerCase().includes('trailer');
      return !isExplicitTrailer;
    });

    // Sort chronologically or by part number
    nonTrailers.sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''));

    console.log(`\n📺 Series: "${seriesTitle}" (ID: ${seriesId})`);
    console.log(`   Price: $${priceUSD} (${priceCents} cents) | Episodes: ${nonTrailers.length}`);

    for (let i = 0; i < nonTrailers.length; i++) {
      const item = nonTrailers[i];
      const partIndex = extractPartIndex(item.name, i + 1);
      const docId = `vimeo_${item.id}`;

      const patch: Record<string, any> = {
        seriesId,
        seriesTitle,
        seriesPartIndex: partIndex,
        seriesPriceCents: priceCents,
        forVodPageId: seriesId,
        forVodSeriesTitle: seriesTitle,
        isBuyable: true,
        priceCents: priceCents,
        currency: 'usd',
        lastUpdated: new Date().toISOString(),
      };

      if (pricing?.trailerId) {
        patch['trailerVideoId'] = `vimeo_${pricing.trailerId}`;
      }

      console.log(`   -> [Part ${partIndex}] /videos/${docId} : "${item.name}" (${(item.durationSeconds / 60).toFixed(1)}m)`);

      if (!DRY_RUN && db) {
        await db.collection('videos').doc(docId).set(patch, { merge: true });
      }
      totalUpdated++;
    }

    // Update trailer if present
    if (pricing?.trailerId) {
      const trailerDocId = `vimeo_${pricing.trailerId}`;
      const trailerPatch: Record<string, any> = {
        seriesId,
        seriesTitle,
        forVodPageId: seriesId,
        forVodSeriesTitle: seriesTitle,
        isTrailer: true,
        accessTier: 'public',
        accessTiers: ['public'],
        lastUpdated: new Date().toISOString(),
      };

      console.log(`   -> [Trailer] /videos/${trailerDocId} : "${pricing.trailerName || 'Trailer'}"`);

      if (!DRY_RUN && db) {
        await db.collection('videos').doc(trailerDocId).set(trailerPatch, { merge: true });
      }
      totalTrailersUpdated++;
    }
  }

  console.log('\n====================================================');
  console.log(`Summary:`);
  console.log(`  Series Processed : ${seriesGroups.size}`);
  console.log(`  Episodes Updated : ${totalUpdated}`);
  console.log(`  Trailers Updated : ${totalTrailersUpdated}`);
  console.log(`  Dry Run          : ${DRY_RUN}`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});
