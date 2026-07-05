/**
 * Import Squarespace product-export CSV into Stripe.
 *
 * Idempotent: safe to re-run. On an unchanged CSV it performs no writes.
 *   - Each Squarespace product   -> one Stripe Product (deterministic id `sqsp_<productId>`).
 *   - Each Squarespace variant   -> one Stripe Price under that product.
 * Squarespace ids/SKUs/options are mirrored into Stripe `metadata` so records
 * can always be traced back to (and reconciled with) the source store.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm import:stripe-products
 *   STRIPE_SECRET_KEY=sk_test_... pnpm import:stripe-products -- --dry-run
 *   STRIPE_SECRET_KEY=sk_test_... pnpm import:stripe-products -- --csv path/to/export.csv
 *
 * A live-mode key (sk_live_) is refused unless --live is passed.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import Papa from 'papaparse';
import Stripe from 'stripe';

const DEFAULT_CSV = path.join(
  __dirname,
  '..',
  'mini-tools',
  'stripe-demo',
  'products_Jul-05_04-08-37PM.csv',
);
const DEFAULT_STRIPE_API_VERSION = '2026-04-22.dahlia';
const METADATA_SOURCE = 'squarespace_import';

type Interval = 'day' | 'week' | 'month' | 'year' | 'one_time';

type Variant = {
  variantId: string;
  sku: string;
  optionName: string;
  optionValue: string;
  currency: string;
  unitAmount: number; // minor units (cents)
  interval: Interval;
};

type Product = {
  squarespaceId: string;
  title: string;
  descriptionHtml: string;
  productPage: string;
  productUrl: string;
  imageUrl: string;
  categories: string;
  tags: string;
  visible: boolean;
  variants: Variant[];
};

type CliOptions = {
  csvPath: string;
  currency: string;
  dryRun: boolean;
  live: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    csvPath: DEFAULT_CSV,
    currency: 'usd',
    dryRun: false,
    live: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--':
        break;
      case '--csv':
        options.csvPath = next ?? options.csvPath;
        i += 1;
        break;
      case '--currency':
        options.currency = (next ?? options.currency).toLowerCase();
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--live':
        options.live = true;
        break;
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }
  return options;
}

/** Squarespace stores rich HTML; Stripe wants short plain text. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Infer the billing interval from the human-readable text. Squarespace does not
 * export a recurring flag, so we derive it and record the result in metadata for
 * auditing. Lifetime memberships and one-off items stay `one_time`.
 */
function inferInterval(text: string): Interval {
  const t = text.toLowerCase();
  // The video library is a recurring subscription (ongoing members-portal access)
  // even though its title carries no cadence keyword.
  if (/video library/.test(t)) return 'month';
  if (/\blife\b|lifetime/.test(t)) return 'one_time';
  if (/month/.test(t)) return 'month';
  if (/year|yearly|annual/.test(t)) return 'year';
  return 'one_time';
}

function toMinorUnits(price: string): number {
  return Math.round(Number.parseFloat(price) * 100);
}

function parseCsv(csvPath: string, defaultCurrency: string): Product[] {
  const raw = readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse errors: ${JSON.stringify(parsed.errors.slice(0, 3))}`);
  }

  const products: Product[] = [];
  let current: Product | undefined;

  for (const row of parsed.data) {
    const productId = (row['Product ID [Non Editable]'] ?? '').trim();
    const variantId = (row['Variant ID [Non Editable]'] ?? '').trim();
    if (!variantId) continue;

    // A non-empty Product ID starts a new product block; subsequent rows with an
    // empty Product ID are additional variants of the preceding product.
    if (productId) {
      current = {
        squarespaceId: productId,
        title: (row['Title'] ?? '').trim(),
        descriptionHtml: (row['Description'] ?? '').trim(),
        productPage: (row['Product Page'] ?? '').trim(),
        productUrl: (row['Product URL'] ?? '').trim(),
        imageUrl: (row['Hosted Image URLs'] ?? '').trim(),
        categories: (row['Categories'] ?? '').trim(),
        tags: (row['Tags'] ?? '').trim(),
        visible: (row['Visible'] ?? '').trim().toLowerCase() === 'yes',
        variants: [],
      };
      products.push(current);
    }
    if (!current) continue;

    const optionName = (row['Option Name 1'] ?? '').trim();
    const optionValue = (row['Option Value 1'] ?? '').trim();
    const onSale = (row['On Sale'] ?? '').trim().toLowerCase() === 'yes';
    const priceField = onSale ? row['Sale Price'] : row['Price'];
    const unitAmount = toMinorUnits(priceField ?? '0');

    current.variants.push({
      variantId,
      sku: (row['SKU'] ?? '').trim(),
      optionName,
      optionValue,
      currency: defaultCurrency,
      unitAmount,
      interval: inferInterval([current.title, optionValue, row['SKU'] ?? ''].join(' ')),
    });
  }

  // Drop untitled placeholder products (no name and nothing purchasable).
  return products.filter((p) => {
    if (!p.title) return false;
    return p.variants.some((v) => v.unitAmount > 0);
  });
}

function productMetadata(product: Product): Stripe.MetadataParam {
  return {
    source: METADATA_SOURCE,
    squarespace_product_id: product.squarespaceId,
    squarespace_page: product.productPage,
    squarespace_url: product.productUrl,
    squarespace_categories: product.categories,
    squarespace_tags: product.tags,
  };
}

function priceMetadata(product: Product, variant: Variant): Stripe.MetadataParam {
  return {
    source: METADATA_SOURCE,
    squarespace_product_id: product.squarespaceId,
    squarespace_variant_id: variant.variantId,
    squarespace_sku: variant.sku,
    squarespace_option: variant.optionName
      ? `${variant.optionName}: ${variant.optionValue}`
      : variant.optionValue,
    billing_interval: variant.interval,
  };
}

function recurringMatches(price: Stripe.Price, interval: Interval): boolean {
  if (interval === 'one_time') return price.recurring === null;
  return price.recurring?.interval === interval && price.recurring?.interval_count === 1;
}

async function ensureProduct(
  stripe: Stripe,
  product: Product,
  dryRun: boolean,
): Promise<string> {
  const id = `sqsp_${product.squarespaceId}`;
  const desiredName = product.title;
  const desiredDescription = htmlToPlainText(product.descriptionHtml) || undefined;
  const images = product.imageUrl ? [product.imageUrl] : [];

  if (dryRun) {
    console.log(`  · product ${id} "${desiredName}" (${product.variants.length} price(s))`);
    return id;
  }

  let existing: Stripe.Product | null = null;
  try {
    existing = await stripe.products.retrieve(id);
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeError) || err.statusCode !== 404) throw err;
  }

  if (!existing) {
    console.log(`  + create product ${id} "${desiredName}"`);
    if (!dryRun) {
      await stripe.products.create({
        id,
        name: desiredName,
        description: desiredDescription,
        active: product.visible,
        images,
        metadata: productMetadata(product),
      });
    }
    return id;
  }

  // Reconcile only when something actually differs (keeps re-runs write-free).
  const update: Stripe.ProductUpdateParams = {};
  if (existing.name !== desiredName) update.name = desiredName;
  if ((existing.description ?? undefined) !== desiredDescription)
    update.description = desiredDescription ?? '';
  if (existing.active !== product.visible) update.active = product.visible;
  if (Object.keys(update).length > 0) {
    console.log(`  ~ update product ${id} (${Object.keys(update).join(', ')})`);
    if (!dryRun) await stripe.products.update(id, update);
  } else {
    console.log(`  = product ${id} up to date`);
  }
  return id;
}

async function listVariantPrices(stripe: Stripe, productId: string, variantId: string) {
  const prices: Stripe.Price[] = [];
  for await (const price of stripe.prices.list({ product: productId, limit: 100 })) {
    if (price.metadata['squarespace_variant_id'] === variantId) prices.push(price);
  }
  return prices;
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  product: Product,
  variant: Variant,
  dryRun: boolean,
): Promise<string | null> {
  const label = variant.sku || variant.variantId;
  const existingForVariant = dryRun
    ? []
    : await listVariantPrices(stripe, productId, variant.variantId);

  const match = existingForVariant.find(
    (p) =>
      p.active &&
      p.unit_amount === variant.unitAmount &&
      p.currency === variant.currency &&
      recurringMatches(p, variant.interval),
  );
  if (match) {
    console.log(`    = price ${label} up to date (${match.id})`);
    return match.id;
  }

  // Prices are immutable: archive any stale active price for this variant, then
  // create the corrected one.
  for (const stale of existingForVariant.filter((p) => p.active)) {
    console.log(`    ~ archive stale price ${label} (${stale.id})`);
    if (!dryRun) await stripe.prices.update(stale.id, { active: false });
  }

  const params: Stripe.PriceCreateParams = {
    product: productId,
    currency: variant.currency,
    unit_amount: variant.unitAmount,
    metadata: priceMetadata(product, variant),
    nickname: variant.optionValue || variant.sku || undefined,
  };
  if (variant.interval !== 'one_time') {
    params.recurring = { interval: variant.interval, interval_count: 1 };
  }
  console.log(
    `    + create price ${label} ${(variant.unitAmount / 100).toFixed(2)} ${variant.currency}` +
      ` [${variant.interval}]`,
  );
  if (dryRun) return null;
  const created = await stripe.prices.create(params);
  return created.id;
}

async function ensureDefaultPrice(
  stripe: Stripe,
  productId: string,
  primaryPriceId: string | null,
  dryRun: boolean,
): Promise<void> {
  if (!primaryPriceId || dryRun) return;
  const product = await stripe.products.retrieve(productId);
  const current =
    typeof product.default_price === 'string'
      ? product.default_price
      : product.default_price?.id;
  if (current === primaryPriceId) return;
  console.log(`    ~ set default price for ${productId} -> ${primaryPriceId}`);
  await stripe.products.update(productId, { default_price: primaryPriceId });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const secretKey = process.env['STRIPE_SECRET_KEY'];
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required');
  if (secretKey.startsWith('sk_live_') && !options.live) {
    throw new Error('Refusing to use a live-mode key unless --live is passed');
  }

  const products = parseCsv(options.csvPath, options.currency);
  console.log(
    `Parsed ${products.length} product(s), ${products.reduce(
      (n, p) => n + p.variants.length,
      0,
    )} variant(s) from ${path.basename(options.csvPath)}`,
  );
  if (options.dryRun) console.log('DRY RUN — no writes will be made.\n');

  type StripeApiVersion = NonNullable<ConstructorParameters<typeof Stripe>[1]>['apiVersion'];
  const stripe = new Stripe(secretKey, {
    apiVersion: (process.env['STRIPE_API_VERSION'] ??
      DEFAULT_STRIPE_API_VERSION) as StripeApiVersion,
  });
  // Validate the key / connectivity before doing any writes.
  if (!options.dryRun) await stripe.balance.retrieve();

  for (const product of products) {
    console.log(`\n${product.title} (${product.squarespaceId})`);
    const productId = await ensureProduct(stripe, product, options.dryRun);
    let primaryPriceId: string | null = null;
    for (const [index, variant] of product.variants.entries()) {
      const priceId = await ensurePrice(stripe, productId, product, variant, options.dryRun);
      if (index === 0) primaryPriceId = priceId;
    }
    await ensureDefaultPrice(stripe, productId, primaryPriceId, options.dryRun);
  }

  console.log('\nDone.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
