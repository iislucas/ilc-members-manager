/* functions/scripts/sync-video-stripe-products.ts
 *
 * Synchronizes purchasable Video on Demand (VOD) items with Stripe Products & Prices,
 * linking stripeProductId and stripePriceId in the Firestore /videos collection.
 *
 * Idempotent: safe to re-run. If a video already has a linked Stripe product and price,
 * it verifies them in Stripe without creating duplicates.
 *
 * Usage:
 *   # Dry run against current project:
 *   pnpm sync:video-products -- --dry-run
 *
 *   # Sync test mode Stripe products for all purchasable videos:
 *   pnpm sync:video-products
 *
 *   # Target a specific video ID:
 *   pnpm sync:video-products -- --videoId vimeo_1189216257
 *
 *   # Explicit project or secret key:
 *   pnpm sync:video-products -- --project ilc-paris-class-tracker --secret-key sk_test_...
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Stripe from 'stripe';
import * as admin from 'firebase-admin';
import { firestoreDocToVideoItem, VideoItem, VodAccessTier } from '../src/data-model';
import { environment } from '../src/environment/environment';

interface CliOptions {
  dryRun: boolean;
  live: boolean;
  project: string;
  secretKey: string;
  videoId: string;
  limit: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    live: false,
    project: '',
    secretKey: '',
    videoId: '',
    limit: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--':
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--live':
        options.live = true;
        break;
      case '--project':
        if (next) {
          options.project = next;
          i += 1;
        }
        break;
      case '--secret-key':
        if (next) {
          options.secretKey = next;
          i += 1;
        }
        break;
      case '--videoId':
      case '--video-id':
        if (next) {
          options.videoId = next;
          i += 1;
        }
        break;
      case '--limit':
        if (next) {
          options.limit = parseInt(next, 10) || 0;
          i += 1;
        }
        break;
      default:
        if (arg.startsWith('--project=')) {
          options.project = arg.split('=')[1];
        } else if (arg.startsWith('--secret-key=')) {
          options.secretKey = arg.split('=')[1];
        } else if (arg.startsWith('--videoId=') || arg.startsWith('--video-id=')) {
          options.videoId = arg.split('=')[1];
        } else if (arg.startsWith('--limit=')) {
          options.limit = parseInt(arg.split('=')[1], 10) || 0;
        }
        break;
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

  // Try reading .firebaserc from repo root
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

async function getStripeSecretKey(
  projectId: string,
  cliKey?: string,
): Promise<string> {
  if (cliKey) return cliKey;
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;

  try {
    const client = new SecretManagerServiceClient();
    const secretName = `projects/${projectId}/secrets/STRIPE_SECRET_KEY/versions/latest`;
    const [version] = await client.accessSecretVersion({ name: secretName });
    const payload = version.payload?.data?.toString();
    if (payload) return payload.trim();
  } catch (err: any) {
    console.warn(`Could not read secret STRIPE_SECRET_KEY from Secret Manager: ${err.message}`);
  }

  throw new Error(
    'No Stripe secret key found. Pass --secret-key=sk_... or set STRIPE_SECRET_KEY in env.',
  );
}

function initAdmin(projectId: string): void {
  if (admin.apps.length > 0) return;
  admin.initializeApp({
    projectId,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const projectId = resolveGcpProjectId(options.project);

  console.log(`\n======================================================`);
  console.log(`VOD Stripe Product Synchronization Tool`);
  console.log(`======================================================`);
  console.log(`Project:  ${projectId}`);
  console.log(`Dry run:  ${options.dryRun ? 'YES (no writes will be made)' : 'NO'}`);
  console.log(`Live:     ${options.live ? 'YES' : 'NO (test mode)'}`);
  if (options.videoId) {
    console.log(`Target:   Single video "${options.videoId}"`);
  }
  console.log(`======================================================\n`);

  initAdmin(projectId);
  const db = admin.firestore();

  const secretKey = await getStripeSecretKey(projectId, options.secretKey);
  if (secretKey.startsWith('sk_live_') && !options.live && !options.dryRun) {
    console.error(
      'Refusing to run live-mode Stripe key without explicit --live flag. Exiting.',
    );
    process.exit(1);
  }

  type StripeApiVersion = NonNullable<ConstructorParameters<typeof Stripe>[1]>['apiVersion'];
  const stripe = new Stripe(secretKey, {
    apiVersion: (environment.stripe.apiVersion || '2026-04-22.dahlia') as StripeApiVersion,
  });

  // 1. Fetch purchasable videos from Firestore
  console.log('Querying Firestore /videos collection...');
  let query: admin.firestore.Query = db.collection('videos');
  if (options.videoId) {
    query = query.where(admin.firestore.FieldPath.documentId(), '==', options.videoId);
  }

  const snap = await query.get();
  console.log(`Found ${snap.docs.length} total video documents.`);

  const purchasableItems: VideoItem[] = [];
  for (const doc of snap.docs) {
    const item = firestoreDocToVideoItem(doc);
    if (item.isTrailer) continue;
    const isBuyable = Boolean(
      item.isBuyable ||
      (item.priceCents && item.priceCents > 0) ||
      item.accessTier === VodAccessTier.DirectPurchase ||
      (Array.isArray(item.accessTiers) && item.accessTiers.includes(VodAccessTier.DirectPurchase)),
    );
    if (isBuyable) {
      purchasableItems.push(item);
    }
  }

  const targetList = options.limit > 0 ? purchasableItems.slice(0, options.limit) : purchasableItems;
  console.log(`Identified ${targetList.length} purchasable videos needing Stripe product check.\n`);

  let createdCount = 0;
  let updatedCount = 0;
  let verifiedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < targetList.length; i += 1) {
    const video = targetList[i];
    const videoId = video.docId;
    const title = (video.title || `VOD Recording ${videoId}`).trim();
    const description = (video.description || '').slice(0, 500);
    const priceCents = video.priceCents || 4999;
    const currency = (video.currency || 'usd').toLowerCase();
    const imageUrl = video.thumbnailUrl ? [video.thumbnailUrl] : [];

    console.log(`[${i + 1}/${targetList.length}] Video: "${title}" (${videoId}) - $${(priceCents / 100).toFixed(2)}`);

    try {
      let stripeProduct: Stripe.Product | null = null;

      // 3a. Check if existing stripeProductId is valid
      if (video.stripeProductId) {
        try {
          stripeProduct = await stripe.products.retrieve(video.stripeProductId);
          if (!stripeProduct.active) {
            stripeProduct = null;
          }
        } catch {
          stripeProduct = null;
        }
      }

      // 3b. If not found by ID, search by metadata
      if (!stripeProduct) {
        const searchRes = await stripe.products.search({
          query: `metadata['videoId']:'${videoId}' AND active:'true'`,
          limit: 1,
        });
        if (searchRes.data.length > 0) {
          stripeProduct = searchRes.data[0];
        }
      }

      // 3c. Create or Update Product
      let productId = '';
      if (!stripeProduct) {
        console.log(`  -> Creating new Stripe Product...`);
        if (!options.dryRun) {
          stripeProduct = await stripe.products.create({
            name: title,
            description: description || undefined,
            images: imageUrl.length > 0 ? imageUrl : undefined,
            metadata: {
              videoId,
              source: 'vod_catalog',
            },
          });
          productId = stripeProduct.id;
          createdCount += 1;
        } else {
          productId = `prod_mock_${videoId}`;
          createdCount += 1;
        }
      } else {
        productId = stripeProduct.id;
        // Verify product metadata has videoId
        if (stripeProduct.metadata?.['videoId'] !== videoId && !options.dryRun) {
          await stripe.products.update(productId, {
            metadata: {
              ...stripeProduct.metadata,
              videoId,
              source: 'vod_catalog',
            },
          });
        }
      }

      // 3d. Check/Create Price
      let priceId = video.stripePriceId || '';
      let priceValid = false;

      if (priceId && stripeProduct) {
        try {
          const p = await stripe.prices.retrieve(priceId);
          if (
            p.active &&
            p.product === productId &&
            p.unit_amount === priceCents &&
            p.currency === currency &&
            p.type === 'one_time'
          ) {
            priceValid = true;
          }
        } catch {
          priceValid = false;
        }
      }

      if (!priceValid && productId) {
        // Search for existing matching active price on product
        if (!options.dryRun && !productId.startsWith('prod_mock_')) {
          const prices = await stripe.prices.list({
            product: productId,
            active: true,
            type: 'one_time',
            limit: 10,
          });
          const match = prices.data.find(
            (p) => p.unit_amount === priceCents && p.currency === currency,
          );
          if (match) {
            priceId = match.id;
            priceValid = true;
          }
        }

        // If no matching price exists, create one
        if (!priceValid) {
          console.log(`  -> Creating new Stripe Price (${currency.toUpperCase()} ${priceCents / 100})...`);
          if (!options.dryRun) {
            const newPrice = await stripe.prices.create({
              product: productId,
              unit_amount: priceCents,
              currency,
              metadata: {
                videoId,
              },
            });
            priceId = newPrice.id;
          } else {
            priceId = `price_mock_${videoId}`;
          }
        }
      }

      // 3e. Update Firestore doc if IDs changed
      const needsDocUpdate =
        video.stripeProductId !== productId || video.stripePriceId !== priceId;

      if (needsDocUpdate) {
        console.log(`  -> Updating Firestore doc with stripeProductId: ${productId}, stripePriceId: ${priceId}`);
        if (!options.dryRun) {
          await db.collection('videos').doc(videoId).update({
            stripeProductId: productId,
            stripePriceId: priceId,
            updatedAt: new Date().toISOString(),
          });
        }
        updatedCount += 1;
      } else {
        console.log(`  -> OK: Already linked correctly (prod: ${productId}, price: ${priceId})`);
        verifiedCount += 1;
      }
    } catch (err: any) {
      console.error(`  -> ERROR for video ${videoId}:`, err.message);
      errorCount += 1;
    }
  }

  console.log(`\n======================================================`);
  console.log(`Synchronization Summary:`);
  console.log(`======================================================`);
  console.log(`Total purchasable videos processed: ${targetList.length}`);
  console.log(`New Stripe products created:        ${createdCount}`);
  console.log(`Firestore documents updated:        ${updatedCount}`);
  console.log(`Already verified and linked:        ${verifiedCount}`);
  console.log(`Errors encountered:                 ${errorCount}`);
  console.log(`======================================================\n`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error running sync-video-stripe-products:', err);
    process.exit(1);
  });
}
