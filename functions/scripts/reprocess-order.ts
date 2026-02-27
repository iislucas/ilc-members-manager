/*
Reprocess an order locally for debugging.

Reads the order from the live Firestore database, clears its processing state,
and runs the downstream logic (membership renewal, grading, video library, etc.)
with detailed console output.

Usage:
  cd functions
  pnpm run reprocess-order -- <ORDER_NUMBER_OR_DOC_ID> [--project <PROJECT_ID>] [--dry-run] [--skip-fulfillment] [--clear]

Examples:
  # Reprocess order 61804 with dry-run (skip fulfillment, don't write back status):
  pnpm run reprocess-order -- 61804 --dry-run

  # Reprocess by Firestore doc ID, skipping the Squarespace fulfillment call:
  pnpm run reprocess-order -- 96RjBHRRC720SJsBrfP5 --skip-fulfillment

  # Just clear the processing state (so the onDocumentWritten trigger re-runs it):
  pnpm run reprocess-order -- 61804 --clear

Flags:
  --dry-run            Run the logic locally but don't write any results back to Firestore.
                       Implies --skip-fulfillment.
  --skip-fulfillment   Run all downstream logic but skip the Squarespace fulfillment API call.
  --clear              Only clear the ilcApp processing state fields on the order document
                       (triggering the onDocumentWritten cloud function to re-run it).
  --project <ID>       Firebase project ID. Defaults to GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT env var.

NOTE: GOOGLE_APPLICATION_CREDENTIALS should be set in your environment if not using default credentials.
SQUARESPACE_API_KEY is fetched from Secret Manager (same as the deployed Cloud Functions).
*/
import * as admin from 'firebase-admin';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import axios from 'axios';
import { SquareSpaceOrder } from '../src/data-model';
import { clearOrderProcessingState, executeOrderDownstreamLogic } from '../src/squarespace-orders';

/**
 * Fetch the Squarespace API key from Secret Manager, matching how the
 * deployed Cloud Functions retrieve it via `defineSecret('SQUARESPACE_API_KEY')`.
 */
async function fetchApiKeyFromSecretManager(projectId: string): Promise<string> {
  console.log(`🔑 Fetching SQUARESPACE_API_KEY from Secret Manager (project: ${projectId})...`);
  const client = new SecretManagerServiceClient();
  const name = `projects/${projectId}/secrets/SQUARESPACE_API_KEY/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  const apiKey = version.payload?.data?.toString();
  if (!apiKey) {
    throw new Error('SQUARESPACE_API_KEY secret exists but has no payload data.');
  }
  // Show a masked version so we can confirm it's the expected key
  console.log(`   Key retrieved: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
  return apiKey;
}

/**
 * Validate the API key by making a lightweight GET request to the Squarespace
 * Orders API and checking permissions. This helps distinguish between:
 *   - Key is invalid/expired → 401
 *   - Key lacks write permissions → read-only works but fulfillments would fail
 *   - Key is fully valid → both read and write work
 */
async function validateApiKey(apiKey: string): Promise<void> {
  console.log(`\n🔐 Validating Squarespace API key permissions...`);
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'User-Agent': 'ILC-Members-Manager/1.0',
  };

  // Test: Can we read orders? (basic auth check)
  try {
    const now = new Date();
    const aSecondLater = new Date(now.getTime() + 1000);
    const response = await axios.get('https://api.squarespace.com/1.0/commerce/orders', {
      headers,
      params: {
        modifiedAfter: now.toISOString(),
        modifiedBefore: aSecondLater.toISOString(),
      },
    });
    console.log(`   ✅ READ orders: OK (status ${response.status})`);
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error(`   ❌ READ orders: FAILED (status ${error.response?.status})`);
      if (error.response?.status === 401) {
        console.error(`      → API key is invalid or expired. Generate a new one in Squarespace Admin.`);
      } else if (error.response?.status === 403) {
        console.error(`      → API key does not have permission to read orders.`);
        console.error(`      → Check: Squarespace Admin → Settings → Advanced → Developer API Keys`);
        console.error(`      → Ensure the key has "Orders" permission set to "Read" or "Read and Write".`);
      }
      console.error(`      Response: ${JSON.stringify(error.response?.data)}`);
    }
    throw new Error('API key validation failed on read. Cannot proceed.');
  }

  // Note: We can't test write permission without modifying data (e.g., creating a fulfillment).
  console.log(`   ℹ️  Write permission (for fulfillments) cannot be tested without modifying data.`);
  console.log(`      If fulfillments fail with 403, the key likely needs "Read and Write" permission.`);
  console.log(`      Check: Squarespace Admin → Settings → Advanced → Developer API Keys`);
}

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const isDryRun = args.includes('--dry-run');
  const skipFulfillment = isDryRun || args.includes('--skip-fulfillment');
  const clearOnly = args.includes('--clear');

  const projectIndex = args.indexOf('--project');
  let projectId: string | undefined;
  if (projectIndex !== -1 && args.length > projectIndex + 1) {
    projectId = args[projectIndex + 1];
  } else {
    projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  }

  // The order identifier is the first positional argument (not a flag)
  const flagsWithValues = new Set(['--project']);
  let orderIdentifier: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (flagsWithValues.has(args[i])) i++; // skip the value after the flag
      continue;
    }
    orderIdentifier = args[i];
    break;
  }

  if (!orderIdentifier) {
    console.error('Usage: pnpm run reprocess-order -- <ORDER_NUMBER_OR_DOC_ID> [--project <PROJECT_ID>] [--dry-run] [--skip-fulfillment] [--clear]');
    process.exit(1);
  }

  if (!projectId) {
    console.error('Error: Project ID is required. Use --project or set GCLOUD_PROJECT env var.');
    process.exit(1);
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  // 1. Fetch and validate the API key from Secret Manager
  const apiKey = await fetchApiKeyFromSecretManager(projectId);
  await validateApiKey(apiKey);

  // 2. Find the order - try by orderNumber first, then by doc ID
  console.log(`\n🔍 Looking up order: "${orderIdentifier}"...`);

  let docId: string | undefined;
  let orderData: SquareSpaceOrder | undefined;

  // Try by orderNumber
  const byNumberQuery = await db.collection('orders')
    .where('orderNumber', '==', orderIdentifier)
    .limit(1)
    .get();

  if (!byNumberQuery.empty) {
    docId = byNumberQuery.docs[0].id;
    orderData = byNumberQuery.docs[0].data() as SquareSpaceOrder;
    console.log(`✅ Found order by orderNumber "${orderIdentifier}" → doc ID: ${docId}`);
  } else {
    // Try as a Firestore doc ID
    const docSnap = await db.collection('orders').doc(orderIdentifier).get();
    if (docSnap.exists) {
      docId = docSnap.id;
      orderData = docSnap.data() as SquareSpaceOrder;
      console.log(`✅ Found order by doc ID: ${docId}`);
    }
  }

  if (!docId || !orderData) {
    console.error(`❌ Order "${orderIdentifier}" not found (searched by orderNumber and doc ID).`);
    process.exit(1);
  }

  // 3. Print order summary
  console.log(`\n📋 Order Summary:`);
  console.log(`   Order Number:       ${orderData.orderNumber || '(none)'}`);
  console.log(`   Squarespace ID:     ${orderData.id || '(none)'}`);
  console.log(`   Customer Email:     ${orderData.customerEmail || '(none)'}`);
  console.log(`   Created On:         ${orderData.createdOn || '(none)'}`);
  console.log(`   Fulfillment Status: ${orderData.fulfillmentStatus || '(none)'}`);
  console.log(`   ilcApp Status:      ${orderData.ilcAppOrderStatus || '(none)'}`);
  if (orderData.ilcAppOrderIssues?.length) {
    console.log(`   ilcApp Issues:`);
    for (const issue of orderData.ilcAppOrderIssues) {
      console.log(`     - ${issue}`);
    }
  }
  console.log(`   Line Items (${orderData.lineItems?.length || 0}):`);
  for (const item of orderData.lineItems || []) {
    console.log(`     - SKU: ${item.sku || '(none)'}, Product: ${item.productName || '(none)'}, Status: ${item.ilcAppProcessingStatus || '(none)'}`);
    if (item.ilcAppProcessingIssue) {
      console.log(`       Issue: ${item.ilcAppProcessingIssue}`);
    }
    if (item.customizations?.length) {
      for (const c of item.customizations) {
        console.log(`       [${c.label}]: ${c.value}`);
      }
    }
  }

  // 4. Handle --clear mode
  if (clearOnly) {
    console.log(`\n🧹 Clearing processing state on order ${docId}...`);
    clearOrderProcessingState(orderData);
    await db.collection('orders').doc(docId).update({
      ilcAppOrderStatus: admin.firestore.FieldValue.delete(),
      ilcAppOrderIssues: admin.firestore.FieldValue.delete(),
      lineItems: orderData.lineItems, // With cleared ilcApp fields
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`✅ Processing state cleared. The onDocumentWritten trigger should re-process it in the cloud.`);
    process.exit(0);
  }

  // 5. Clear processing state and re-run
  console.log(`\n🔄 Clearing processing state and reprocessing...`);
  if (isDryRun) console.log(`   *** DRY RUN MODE — no Firestore writes will be made ***`);
  if (skipFulfillment) console.log(`   *** Skipping Squarespace fulfillment API call ***`);

  clearOrderProcessingState(orderData);

  if (isDryRun) {
    // In dry-run mode, intercept Firestore writes and print them instead.
    const originalDocFn = db.collection('orders').doc.bind(db.collection('orders'));
    (db.collection('orders') as any).doc = (id: string) => {
      const ref = originalDocFn(id);
      if (id === docId) {
        ref.update = (async (data: any) => {
          console.log(`\n📝 [DRY RUN] Would write to orders/${id}:`);
          console.log(JSON.stringify(data, null, 2));
        }) as any;
      }
      return ref;
    };

    await executeOrderDownstreamLogic(orderData, docId, db, {
      apiKeyOverride: apiKey,
      skipFulfillment,
    });
  } else {
    await executeOrderDownstreamLogic(orderData, docId, db, {
      apiKeyOverride: apiKey,
      skipFulfillment,
    });
  }

  console.log(`\n✅ Reprocessing complete.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error:', e);
    process.exit(1);
  });
