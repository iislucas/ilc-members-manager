/*
List Squarespace Subscribers Script

Reads the `orders` and `members` collections from Firestore, identifies all customers
who have purchased recurring or potentially recurring subscription products on Squarespace:
  - Class Video Library (Monthly)
  - School Licenses (Monthly & Annual)
  - Instructor Licenses (Annual)
  - Memberships (Annual)

Generates direct Squarespace Customer Profile links for verifying and cancelling subscriptions.

Usage:
  cd functions
  pnpm exec ts-node scripts/list-squarespace-subscribers.ts [options]

Options:
  --project <PROJECT_ID>    Firebase Project ID (default: ilc-paris-class-tracker)
  --output <FILE_PATH>      Export full Markdown report to file (e.g. subscribers.md)
  --category <CATEGORY>     Filter by category: 'all' (default), 'video', 'schools', 'instructors', 'memberships'

Examples:
  # Print all potential subscription customers to console:
  pnpm exec ts-node scripts/list-squarespace-subscribers.ts --project ilc-paris-class-tracker

  # Export markdown report:
  pnpm exec ts-node scripts/list-squarespace-subscribers.ts --project ilc-paris-class-tracker --output subscribers-report.md
*/

import * as admin from 'firebase-admin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    default: 'ilc-paris-class-tracker',
  })
  .option('output', {
    type: 'string',
    description: 'Optional file path to write markdown report',
  })
  .option('category', {
    type: 'string',
    choices: ['all', 'video', 'schools', 'instructors', 'memberships'] as const,
    default: 'all',
    description: 'Filter by subscription category',
  })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'ilc-paris-class-tracker';

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}
const db = admin.firestore();

const SQUARESPACE_BASE_URL = 'https://lute-denim-99n2.squarespace.com';

interface CustomerSubscriptionRecord {
  customerEmail: string;
  customerName: string;
  customerId: string;
  memberId: string;
  memberDocId: string;
  category: string;
  products: string[];
  skus: string[];
  orderNumbers: string[];
  latestOrderDate: string;
  latestOrderNumber: string;
  totalOrdersCount: number;
  dbExpiryDate?: string;
  squarespaceProfileUrl: string;
}

const CATEGORY_MATCHERS: {
  id: string;
  name: string;
  type: 'monthly_recurring' | 'annual_recurring_or_fixed';
  match: (sku: string, name: string) => boolean;
}[] = [
  {
    id: 'video',
    name: 'Class Video Library (Monthly)',
    type: 'monthly_recurring',
    match: (sku, name) => sku === 'VID-LIBRARY' || name.toLowerCase().includes('video library'),
  },
  {
    id: 'schools',
    name: 'School Licenses (Monthly & Annual)',
    type: 'annual_recurring_or_fixed',
    match: (sku, name) =>
      sku === 'LIS-SCH-MTH' ||
      sku === 'LIS-SCH-YRL' ||
      sku === 'LIS-YEAR-SCH' ||
      name.toLowerCase().includes('license : school'),
  },
  {
    id: 'instructors',
    name: 'Instructor Licenses (Annual)',
    type: 'annual_recurring_or_fixed',
    match: (sku, name) =>
      sku.startsWith('LIS-YEAR-GL') ||
      sku.startsWith('LIS-YEAR-INS') ||
      sku.startsWith('LIS-YEAR-LI') ||
      name.toLowerCase().includes('instructor + group leader'),
  },
  {
    id: 'memberships',
    name: 'Memberships (Annual)',
    type: 'annual_recurring_or_fixed',
    match: (sku, name) =>
      sku.startsWith('MEM-YEAR-') ||
      name.toLowerCase().includes('membership : annual'),
  },
];

async function main() {
  console.log(`🔍 Fetching orders and members from Firestore (project: ${projectId})...\n`);

  const [ordersSnap, membersSnap] = await Promise.all([
    db.collection('orders').get(),
    db.collection('members').get(),
  ]);

  console.log(`Loaded ${ordersSnap.size} total orders and ${membersSnap.size} members.`);

  // Build member lookup maps
  const membersByEmail = new Map<string, { id: string; data: Record<string, unknown> }>();
  const membersById = new Map<string, { id: string; data: Record<string, unknown> }>();

  for (const mDoc of membersSnap.docs) {
    const data = mDoc.data();
    if (data.memberId) membersById.set(String(data.memberId).toUpperCase(), { id: mDoc.id, data });
    for (const email of (data.emails || [])) {
      if (email) membersByEmail.set(String(email).trim().toLowerCase(), { id: mDoc.id, data });
    }
  }

  const categoryResults = new Map<string, Map<string, {
    customerEmail: string;
    customerName: string;
    customerId: string;
    memberId: string;
    memberDocId: string;
    category: string;
    products: Set<string>;
    skus: Set<string>;
    orderNumbers: string[];
    latestOrderDate: string;
    latestOrderNumber: string;
    totalOrdersCount: number;
    dbExpiryDate?: string;
  }>>();

  for (const cat of CATEGORY_MATCHERS) {
    categoryResults.set(cat.id, new Map());
  }

  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    const lineItems = data.lineItems || [];
    const customerEmail = (data.customerEmail || data.billingAddress?.email || '').trim().toLowerCase();
    const customerId = data.customerId || '';
    const firstName = data.billingAddress?.firstName || '';
    const lastName = data.billingAddress?.lastName || '';
    const customerName = `${firstName} ${lastName}`.trim();
    const orderNumber = data.orderNumber || '';
    const orderDate = (data.createdOn || data.modifiedOn || '').substring(0, 10);

    for (const item of lineItems) {
      const sku = (item.sku || '').trim().toUpperCase();
      const prodName = (item.productName || '').trim();

      for (const cat of CATEGORY_MATCHERS) {
        if (cat.match(sku, prodName)) {
          const catMap = categoryResults.get(cat.id)!;
          const key = customerEmail || customerId || customerName;

          let entry = catMap.get(key);
          if (!entry) {
            entry = {
              customerEmail,
              customerName,
              customerId,
              memberId: item.ilcAppMemberIdInferred || '',
              memberDocId: '',
              category: cat.name,
              products: new Set(),
              skus: new Set(),
              orderNumbers: [],
              latestOrderDate: '',
              latestOrderNumber: '',
              totalOrdersCount: 0,
            };
            catMap.set(key, entry);
          }

          if (sku) entry.skus.add(sku);
          if (prodName) entry.products.add(prodName);
          if (orderNumber) entry.orderNumbers.push(orderNumber);
          if (item.ilcAppMemberIdInferred && !entry.memberId) entry.memberId = item.ilcAppMemberIdInferred;
          if (customerId && !entry.customerId) entry.customerId = customerId;
          if (customerName && !entry.customerName) entry.customerName = customerName;

          if (!entry.latestOrderDate || orderDate > entry.latestOrderDate) {
            entry.latestOrderDate = orderDate;
            entry.latestOrderNumber = orderNumber;
          }
          entry.totalOrdersCount++;
        }
      }
    }
  }

  // Cross-reference with members for details and expiry
  for (const [catId, catMap] of categoryResults.entries()) {
    for (const entry of catMap.values()) {
      let memberMatch = entry.customerEmail ? membersByEmail.get(entry.customerEmail) : undefined;
      if (!memberMatch && entry.memberId) {
        memberMatch = membersById.get(entry.memberId.toUpperCase());
      }
      if (memberMatch) {
        entry.memberDocId = memberMatch.id;
        if (!entry.memberId && memberMatch.data.memberId) {
          entry.memberId = String(memberMatch.data.memberId);
        }
        if (!entry.customerName && memberMatch.data.name) {
          entry.customerName = String(memberMatch.data.name);
        }

        if (catId === 'video') {
          entry.dbExpiryDate = memberMatch.data.classVideoLibraryExpirationDate as string;
        } else if (catId === 'instructors') {
          entry.dbExpiryDate = memberMatch.data.instructorLicenseExpires as string;
        } else if (catId === 'memberships') {
          entry.dbExpiryDate = memberMatch.data.currentMembershipExpires as string;
        }
      }
    }
  }

  const selectedCategories = argv.category === 'all'
    ? CATEGORY_MATCHERS
    : CATEGORY_MATCHERS.filter(c => c.id === argv.category);

  const mdReportSections: string[] = [
    `# Squarespace Subscription Products & Customers Audit`,
    `Audit Date: ${new Date().toISOString().substring(0, 10)}`,
    '',
    `*Note on Cancellation Status:* Squarespace's public API does not return active/canceled flags for subscriptions. Click any **[Open Profile]** link below to view that customer's **Recurring / Subscriptions** tab in the Squarespace Admin UI, which shows the live status (Active vs Canceled) and provides the one-click "Cancel Subscription" button.`,
    '',
  ];

  for (const cat of selectedCategories) {
    const catMap = categoryResults.get(cat.id)!;
    const records: CustomerSubscriptionRecord[] = Array.from(catMap.values())
      .map(e => ({
        customerEmail: e.customerEmail,
        customerName: e.customerName,
        customerId: e.customerId,
        memberId: e.memberId,
        memberDocId: e.memberDocId,
        category: cat.name,
        products: Array.from(e.products),
        skus: Array.from(e.skus),
        orderNumbers: e.orderNumbers,
        latestOrderDate: e.latestOrderDate,
        latestOrderNumber: e.latestOrderNumber,
        totalOrdersCount: e.totalOrdersCount,
        dbExpiryDate: e.dbExpiryDate,
        squarespaceProfileUrl: e.customerId
          ? `${SQUARESPACE_BASE_URL}/config/profiles/customers/${e.customerId}`
          : '',
      }))
      .sort((a, b) => b.latestOrderDate.localeCompare(a.latestOrderDate));

    console.log('\n' + '='.repeat(80));
    console.log(`📦 ${cat.name} — ${records.length} unique customers`);
    console.log('='.repeat(80));

    mdReportSections.push(`## ${cat.name} (${records.length} customers)`);
    mdReportSections.push('');
    mdReportSections.push('| # | Customer Name | Member ID | Email | SKUs / Details | Latest Order | Total Orders | Database Expiry | Squarespace Direct Link |');
    mdReportSections.push('|---|---------------|-----------|-------|----------------|--------------|--------------|-----------------|-------------------------|');

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const urlMd = r.squarespaceProfileUrl
        ? `[Open Profile](${r.squarespaceProfileUrl})`
        : 'N/A';
      const memberText = r.memberId || '-';
      const expiryText = r.dbExpiryDate || '-';

      console.log(`${String(i + 1).padStart(2, ' ')}. ${r.customerName || 'Unknown'} <${r.customerEmail}> (${r.memberId ? `Member ${r.memberId}` : 'No Member ID'})`);
      console.log(`    SKUs:          ${r.skus.join(', ')}`);
      console.log(`    Latest Order:  #${r.latestOrderNumber} on ${r.latestOrderDate} (${r.totalOrdersCount} total orders)`);
      if (r.dbExpiryDate) console.log(`    DB Expiry:     ${r.dbExpiryDate}`);
      console.log(`    Direct URL:    ${r.squarespaceProfileUrl || 'N/A'}`);
      console.log('');

      mdReportSections.push(
        `| ${i + 1} | **${r.customerName || 'N/A'}** | ${memberText} | \`${r.customerEmail}\` | ${r.skus.join(', ')} | #${r.latestOrderNumber} (${r.latestOrderDate}) | ${r.totalOrdersCount} | ${expiryText} | ${urlMd} |`
      );
    }
    mdReportSections.push('');
  }

  if (argv.output) {
    const outPath = path.resolve(process.cwd(), argv.output);
    fs.writeFileSync(outPath, mdReportSections.join('\n'), 'utf8');
    console.log(`\n📄 Markdown report saved to: ${outPath}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  });
