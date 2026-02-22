import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import axios from 'axios';
import { Member } from './data-model';

const squarespaceApiKey = defineSecret('SQUARESPACE_API_KEY');

// https://developers.squarespace.com/commerce-apis/orders-api
const SQUARESPACE_ORDERS_API = 'https://api.squarespace.com/1.0/commerce/orders';

// The systemInfo document where we keep track of the last time we synced orders
const SYNC_STATE_DOC = 'systemInfo/squarespaceSync';

/**
 * Scheduled function that polls the Squarespace API for new or updated orders.
 * It merely fetches the orders and stores them raw in the `orders` Firestore collection.
 */
export const syncSquarespaceOrders = onSchedule(
  {
    schedule: 'every 15 minutes',
    secrets: [squarespaceApiKey],
  },
  async (event) => {
    const db = admin.firestore();
    const apiKey = squarespaceApiKey.value();

    if (!apiKey) {
      logger.error('Squarespace API key is not configured.');
      return;
    }

    // 1. Determine the timestamp to query from
    const syncDocRef = db.doc(SYNC_STATE_DOC);
    const syncDoc = await syncDocRef.get();

    let modifiedAfterStr: string;

    if (syncDoc.exists && syncDoc.data()?.lastSyncTimestamp) {
      modifiedAfterStr = syncDoc.data()!.lastSyncTimestamp;
    } else {
      // If we've never synced before, default to 1 day ago
      // We don't want to pull ALL historical orders.
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      modifiedAfterStr = yesterday.toISOString();
      logger.info(`No sync state found. Defaulting to sync orders modified after ${modifiedAfterStr}`);
    }

    try {
      // 2. Fetch trailing orders from the Squarespace Orders API
      const orderResponse = await axios.get(SQUARESPACE_ORDERS_API, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'ILC-Members-Manager/1.0',
        },
        params: {
          modifiedAfter: modifiedAfterStr,
        }
      });

      // The API returns typed objects or any, replacing with unknown/safe types
      const orders = orderResponse.data.result || [];
      logger.info(`Successfully fetched ${orders.length} orders updated after ${modifiedAfterStr} from Squarespace`);

      if (orders.length === 0) {
        return;
      }

      let latestModifiedOn = modifiedAfterStr;

      // 3. Process each order by saving it to Firestore
      for (const orderData of orders) {
        if (orderData.modifiedOn && orderData.modifiedOn > latestModifiedOn) {
          latestModifiedOn = orderData.modifiedOn;
        }

        const orderId = orderData.id || orderData.orderNumber;
        if (!orderId) {
          logger.warn('Order without ID retrieved, skipping over it.');
          continue;
        }

        await db.collection('orders').doc(orderId).set(orderData, { merge: true });
        logger.info(`Saved order ${orderId} to firestore.`);
      }

      // 4. Update the sync state document so we don't process these orders again.
      await syncDocRef.set({
        lastSyncTimestamp: latestModifiedOn,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      logger.info(`Sync complete. State updated to track orders modified after ${latestModifiedOn}.`);

    } catch (error: unknown) {
      logger.error('Error fetching/processing Squarespace orders:', error);
      if (axios.isAxiosError(error) && error.response) {
        logger.error('Squarespace API responded with:', error.response.data);
      }
    }
  }
);

/**
 * Event-triggered function that runs whenever an order document is written
 * (created or updated) in the `orders` collection.
 * This is where domain-specific downstream logic belongs.
 */
export const processSquarespaceOrder = onDocumentWritten(
  'orders/{orderId}',
  async (event) => {
    const orderData = event.data?.after.data();

    // If the document was deleted, do nothing
    if (!orderData) {
      return;
    }

    const orderId = event.params.orderId;
    const db = admin.firestore();

    logger.info(`Processing downstream logic for order ${orderId}`);

    interface LineItem {
      productName?: string;
      title?: string;
    }

    const lineItems: LineItem[] = orderData.lineItems || [];

    // Handle the specific logic for "Online Class Video Library" accesses
    const hasVideoLibrary = lineItems.some((item) => {
      const title = item.productName || item.title || '';
      return title.toLowerCase().includes('online class video library');
    });

    if (hasVideoLibrary) {
      await processVideoLibraryAccess(orderData, orderId, db);
    }

    // --- Placeholders for Future Logics ---
    // Handle specific logic for membership renewals
    // if (someConditionForRenewals) { await processMembershipRenewal(orderData, db); }

    // Handle specific logic for instructor licenses
    // if (someConditionForLicenses) { await processInstructorLicense(orderData, db); }

    // Handle gradings creation etc.
    // if (someConditionForGradings) { await processGradingOrder(orderData, db); }
  }
);

/**
 * Helper function to grant classVideoLibrarySubscription to members
 * based on order custom forms or user email.
 */
async function processVideoLibraryAccess(orderData: any, orderId: string, db: admin.firestore.Firestore) {
  const email = orderData.customerEmail;
  let providedMemberId = '';

  interface CustomFormField {
    label?: string;
    value?: string;
  }

  interface CustomForm {
    fields?: CustomFormField[];
  }

  if (orderData.customForms && Array.isArray(orderData.customForms)) {
    for (const form of orderData.customForms as CustomForm[]) {
      const memberIdField = form.fields?.find((f) =>
        f.label && typeof f.label === 'string' && f.label.toLowerCase().includes('member id')
      );
      if (memberIdField && memberIdField.value) {
        providedMemberId = memberIdField.value.trim();
        break;
      }
    }
  }

  let memberDocRef: admin.firestore.DocumentReference | null = null;
  let memberData: Partial<Member> | null = null;

  // Try finding by Member ID first
  if (providedMemberId) {
    logger.info(`[Video Library] Looking for member with ID: ${providedMemberId} for order ${orderId}`);
    const memberIdQuery = await db.collection('members')
      .where('memberId', '==', providedMemberId)
      .limit(1)
      .get();
    if (!memberIdQuery.empty) {
      memberDocRef = memberIdQuery.docs[0].ref;
      memberData = memberIdQuery.docs[0].data() as Partial<Member>;
    } else {
      logger.warn(`[Video Library] Member ID ${providedMemberId} not found in database. Falling back to email.`);
    }
  }

  // Fallback to searching by email if Member ID was not provided or not found
  if (!memberDocRef && email) {
    logger.info(`[Video Library] Looking for member with email: ${email} for order ${orderId}`);
    const emailQuery = await db.collection('members')
      .where('emails', 'array-contains', email.toLowerCase())
      .limit(1)
      .get();
    if (!emailQuery.empty) {
      memberDocRef = emailQuery.docs[0].ref;
      memberData = emailQuery.docs[0].data() as Partial<Member>;
    } else {
      const publicEmailQuery = await db.collection('members')
        .where('publicEmail', '==', email)
        .limit(1)
        .get();
      if (!publicEmailQuery.empty) {
        memberDocRef = publicEmailQuery.docs[0].ref;
        memberData = publicEmailQuery.docs[0].data() as Partial<Member>;
      }
    }
  }

  if (!memberDocRef) {
    logger.error(`[Video Library] Could not find a member document for order ${orderId} (Member ID: ${providedMemberId}, Email: ${email}) to grant video library access.`);
    return;
  }

  // Ensure idempotency for Video Library Access
  if (memberData && memberData.classVideoLibrarySubscription === true) {
    logger.info(`[Video Library] Member ${memberDocRef.id} already has video library subscription. No action needed.`);
    return;
  }

  logger.info(`[Video Library] Granting video library subscription to member ${memberDocRef.id} based on order ${orderId}.`);
  await memberDocRef.update({
    classVideoLibrarySubscription: true,
  });
}
