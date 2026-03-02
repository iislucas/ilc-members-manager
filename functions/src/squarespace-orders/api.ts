/*
Squarespace Order Sync & Dispatch

This module contains all Firebase Cloud Function triggers and the main
order-processing dispatch logic:
  - syncSquarespaceOrders   (scheduled: polls Squarespace API)
  - processSquarespaceOrder (Firestore trigger: routes each line item)
  - manualSquarespaceSync   (callable: admin-triggered sync)
  - reprocessOrder          (callable: re-run processing for one order)

Recognised Squarespace SKU prefixes / values and their handlers:
  VID-LIBRARY     → processVideoLibraryAccess  (monthly video library subscription)
  GRA-*           → processGradingOrder         (student / application grading)
  MEM-*           → processMembershipRenewal    (annual membership renewal or new member)
  MEM-LIFE-*      → processLifeMembership       (life membership)
  LIS-YEAR-GL     → processInstructorLicense    (annual group leader license)
  LIS-YEAR-INS    → processInstructorLicense    (annual instructor license)
  LIS-YEAR-LI     → processInstructorLicense    (annual lead instructor license)
  LIS-SCH-YRL     → processSchoolLicense        (annual school license)
  LIS-SCH-MTH     → processSchoolLicense        (monthly school license, extends by 1 year)
*/

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import axios from 'axios';
import { SquareSpaceOrder, SquareSpaceLineItem, OrderStatus } from '../data-model';
import { assertAdmin, allowedOrigins } from '../common';

import { processVideoLibraryAccess } from './video-library';
import { processGradingOrder } from './grading';
import { processMembershipRenewal } from './membership';
import { processLifeMembership } from './life-membership';
import { processInstructorLicense } from './instructor-license';
import { parseSchoolLicenseInfo, processSchoolLicense } from './school-license';

const squarespaceApiKey = defineSecret('SQUARESPACE_API_KEY');

// https://developers.squarespace.com/commerce-apis/orders-api
const SQUARESPACE_ORDERS_API = 'https://api.squarespace.com/1.0/commerce/orders';

// The systemInfo document where we keep track of the last time we synced orders
const SYNC_STATE_DOC = 'system/squarespaceSync';

// Core logic to fetch from Squarespace API and sync to Firestore.
// Placed in an exportable function so standalone scripts can call it.
export async function fetchAndSyncOrders(
  db: admin.firestore.Firestore,
  apiKey: string,
  options: { dryRun?: boolean; forceTimestamp?: string } = {}
) {
  const { dryRun = false, forceTimestamp } = options;

  if (!apiKey) {
    logger.error('Squarespace API key is not configured.');
    return;
  }

  // 1. Determine the timestamp to query from
  const syncDocRef = db.doc(SYNC_STATE_DOC);
  const syncDoc = await syncDocRef.get();

  let modifiedAfterStr: string;

  if (forceTimestamp) {
    modifiedAfterStr = forceTimestamp;
    logger.info(`Using forced timestamp: ${modifiedAfterStr}`);
  } else if (syncDoc.exists && syncDoc.data()?.lastSyncTimestamp) {
    modifiedAfterStr = syncDoc.data()!.lastSyncTimestamp;
  } else {
    // If we've never synced before, default to 1 day ago
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    modifiedAfterStr = yesterday.toISOString();
    logger.info(`No sync state found. Defaulting to sync orders modified after ${modifiedAfterStr}`);
  }

  try {
    // 2. Fetch trailing orders from the Squarespace Orders API
    const modifiedBeforeStr = new Date().toISOString();
    logger.info(`Fetching orders modified after ${modifiedAfterStr} up to ${modifiedBeforeStr} ${dryRun ? '(DRY RUN)' : ''}`);
    const orderResponse = await axios.get(SQUARESPACE_ORDERS_API, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'ILC-Members-Manager/1.0',
      },
      params: {
        modifiedAfter: modifiedAfterStr,
        modifiedBefore: modifiedBeforeStr,
      }
    });

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

      const orderToSave = {
        ...orderData,
        lastUpdated: admin.firestore.Timestamp.fromDate(new Date(orderData.createdOn || orderData.modifiedOn || new Date())),
        ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders'
      };

      if (dryRun) {
        logger.info(`[DRY RUN] Would save order ${orderId} to firestore:`, JSON.stringify(orderToSave, null, 2));
      } else {
        // Find if order already exists
        const existingOrderQuery = await db.collection('orders')
          .where('orderNumber', '==', orderToSave.orderNumber)
          .limit(1)
          .get();

        let docRef;
        if (!existingOrderQuery.empty) {
          docRef = existingOrderQuery.docs[0].ref;
          await docRef.set(orderToSave, { merge: true });
        } else {
          // Check by orderId if orderNumber failed (idempotency check fallback)
          const fallbackQuery = await db.collection('orders')
            .where('id', '==', orderId)
            .limit(1)
            .get();

          if (!fallbackQuery.empty) {
            docRef = fallbackQuery.docs[0].ref;
            await docRef.set(orderToSave, { merge: true });
          } else {
            docRef = await db.collection('orders').add(orderToSave);
          }
        }

        logger.info(`Saved order ${orderId} to firestore document ${docRef.id}.`);
      }
    }

    // 4. Update the sync state document so we don't process these orders again.
    if (dryRun) {
      logger.info(`[DRY RUN] Would update sync state to track orders modified after ${latestModifiedOn}.`);
    } else {
      await syncDocRef.set({
        lastSyncTimestamp: latestModifiedOn,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      logger.info(`Sync complete. State updated to track orders modified after ${latestModifiedOn}.`);
    }

  } catch (error: unknown) {
    logger.error('Error fetching/processing Squarespace orders:', error);
    if (axios.isAxiosError(error) && error.response) {
      logger.error('Squarespace API responded with:', error.response.data);
    }
  }
}

// Scheduled function that polls the Squarespace API for new or updated orders.
// It merely fetches the orders and stores them raw in the `orders` Firestore collection.
export const syncSquarespaceOrders = onSchedule(
  {
    schedule: 'every 15 minutes',
    secrets: [squarespaceApiKey],
  },
  async (event) => {
    const db = admin.firestore();
    const apiKey = squarespaceApiKey.value();
    await fetchAndSyncOrders(db, apiKey);
  }
);

// Callable Cloud Function that allows admins to trigger a sync manually.
export const manualSquarespaceSync = onCall(
  {
    cors: allowedOrigins,
    secrets: [squarespaceApiKey],
  },
  async (request) => {
    logger.info('manualSquarespaceSync called by user.');

    // Ensure only admins can trigger the sync
    await assertAdmin(request);

    try {
      const db = admin.firestore();
      const apiKey = squarespaceApiKey.value();
      await fetchAndSyncOrders(db, apiKey);
      return { success: true };
    } catch (error) {
      logger.error('manualSquarespaceSync failed:', error);
      throw new HttpsError('internal', 'Manual Squarespace sync failed.');
    }
  }
);

// Event-triggered function that runs whenever an order document is written
// (created or updated) in the `orders` collection.
// This is where domain-specific downstream logic belongs.
export const processSquarespaceOrder = onDocumentWritten(
  {
    document: 'orders/{orderId}',
    secrets: [squarespaceApiKey],
  },
  async (event) => {
    const orderData = event.data?.after.data() as SquareSpaceOrder;

    // If the document was deleted, do nothing
    if (!orderData) {
      return;
    }

    const docId = event.params.orderId;
    const db = admin.firestore();

    await executeOrderDownstreamLogic(orderData, docId, db);
  }
);

export const reprocessOrder = onCall(
  {
    cors: allowedOrigins,
    secrets: [squarespaceApiKey],
  },
  async (request) => {
    logger.info('reprocessOrder called by user.');
    await assertAdmin(request);

    const docId = request.data.docId;
    if (!docId) {
      throw new HttpsError('invalid-argument', 'docId is required');
    }

    const db = admin.firestore();
    const docSnap = await db.collection('orders').doc(docId).get();
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }

    const orderData = docSnap.data() as SquareSpaceOrder;
    clearOrderProcessingState(orderData);

    await executeOrderDownstreamLogic(orderData, docId, db);
    return { success: true };
  }
);

// Clear all ilcApp processing state from an order so it can be re-processed.
// Removes order-level and line-item-level processing status fields.
export function clearOrderProcessingState(orderData: SquareSpaceOrder): void {
  delete orderData.ilcAppOrderStatus;
  delete orderData.ilcAppOrderIssues;
  if (orderData.lineItems) {
    for (const lineItem of orderData.lineItems) {
      delete lineItem.ilcAppProcessingStatus;
      delete lineItem.ilcAppProcessingIssue;
    }
  }
}

export async function executeOrderDownstreamLogic(
  orderData: SquareSpaceOrder, docId: string, db: admin.firestore.Firestore,
  options: { apiKeyOverride?: string; skipFulfillment?: boolean } = {}
) {
  // Human-readable order identifier for logging/issues.
  const orderId = orderData.orderNumber || docId;
  // The Squarespace UUID needed for API endpoint URLs (e.g. fulfillments).
  const squarespaceId = orderData.id;

  // If the order has already been processed, do nothing
  if (orderData.ilcAppOrderStatus) {
    logger.info(`Order ${orderId} has already been processed. Skipping.`);
    return;
  }

  logger.info(`Processing downstream logic for order doc ${docId} (SS ID: ${orderId})`);

  let shouldUpdateFulfillmentStatus = false;

  const lineItems: SquareSpaceLineItem[] = orderData.lineItems || [];
  let orderStatus: OrderStatus = 'processed';
  const ilcAppOrderIssues: string[] = [];

  let allItemsFulfilled = true;

  for (const lineItem of lineItems) {
    if (lineItem.ilcAppProcessingStatus === 'processed') {
      continue;
    }
    if (lineItem.sku === 'VID-LIBRARY') {
      const issue = await processVideoLibraryAccess(orderData, orderId, lineItem, db);
      if (issue) {
        ilcAppOrderIssues.push(issue);
        lineItem.ilcAppProcessingStatus = 'error';
        lineItem.ilcAppProcessingIssue = issue;
        orderStatus = 'error';
        allItemsFulfilled = false;
      } else {
        lineItem.ilcAppProcessingStatus = 'processed';
      }
    } else if (lineItem.sku?.startsWith('GRA-')) {
      const issue = await processGradingOrder(orderData, orderId, lineItem, db);
      if (issue) {
        ilcAppOrderIssues.push(issue);
        lineItem.ilcAppProcessingStatus = 'error';
        lineItem.ilcAppProcessingIssue = issue;
        orderStatus = 'error';
        allItemsFulfilled = false;
      } else {
        lineItem.ilcAppProcessingStatus = 'processed';
      }
    } else if (lineItem.sku?.startsWith('MEM-LIFE-')) {
      const issue = await processLifeMembership(orderData, orderId, lineItem, db);
      if (issue) {
        ilcAppOrderIssues.push(issue);
        lineItem.ilcAppProcessingStatus = 'error';
        lineItem.ilcAppProcessingIssue = issue;
        orderStatus = 'error';
        allItemsFulfilled = false;
      } else {
        lineItem.ilcAppProcessingStatus = 'processed';
      }
    } else if (lineItem.sku?.startsWith('MEM-YEAR-')) {
      const issue = await processMembershipRenewal(orderData, orderId, lineItem, db);
      if (issue) {
        ilcAppOrderIssues.push(issue);
        lineItem.ilcAppProcessingStatus = 'error';
        lineItem.ilcAppProcessingIssue = issue;
        orderStatus = 'error';
        allItemsFulfilled = false;
      } else {
        lineItem.ilcAppProcessingStatus = 'processed';
      }
    } else if (lineItem.sku === 'LIS-SCH-YRL' || lineItem.sku === 'LIS-SCH-MTH') {
      const schoolInfo = parseSchoolLicenseInfo(orderData, lineItem);
      const renewalMonths = lineItem.sku === 'LIS-SCH-MTH' ? 1 : 12;
      const issue = await processSchoolLicense(orderId, schoolInfo, renewalMonths, db);
      if (issue) {
        ilcAppOrderIssues.push(issue);
        lineItem.ilcAppProcessingStatus = 'error';
        lineItem.ilcAppProcessingIssue = issue;
        orderStatus = 'error';
        allItemsFulfilled = false;
      } else {
        lineItem.ilcAppProcessingStatus = 'processed';
      }
    } else if (lineItem.sku === 'LIS-YEAR-GL' || lineItem.sku === 'LIS-YEAR-INS' || lineItem.sku === 'LIS-YEAR-LI') {
      const issue = await processInstructorLicense(orderData, orderId, lineItem, db);
      if (issue) {
        ilcAppOrderIssues.push(issue);
        lineItem.ilcAppProcessingStatus = 'error';
        lineItem.ilcAppProcessingIssue = issue;
        orderStatus = 'error';
        allItemsFulfilled = false;
      } else {
        lineItem.ilcAppProcessingStatus = 'processed';
      }
    } else {
      allItemsFulfilled = false;
    }
  }

  if (allItemsFulfilled) {
    if (options.skipFulfillment) {
      logger.info(`Order ${orderId}: skipFulfillment is set. Skipping Squarespace fulfillment API call.`);
    } else if (orderData.fulfillmentStatus === 'FULFILLED') {
      // Order is already fulfilled on Squarespace (e.g. from a previous processing run).
      // No need to call the fulfillments API again.
      logger.info(`Order ${orderId} is already fulfilled on Squarespace. Skipping fulfillment API call.`);
    } else if (!squarespaceId) {
      orderStatus = 'error';
      ilcAppOrderIssues.push(`Cannot auto-fulfill order ${orderId}: missing Squarespace UUID (id field). The order may need to be re-synced.`);
      logger.error(`Cannot auto-fulfill order ${orderId}: missing Squarespace UUID (id field).`);
    } else {
      try {
        const apiKey = options.apiKeyOverride || squarespaceApiKey.value();
        const url = `https://api.squarespace.com/1.0/commerce/orders/${squarespaceId}/fulfillments`;
        await axios.post(url, {
          shouldSendNotification: false // Typically don't need shipment notification for digital fulfillment
        }, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'ILC-Members-Manager/1.0',
          }
        });
        logger.info(`Auto-fulfilled order ${orderId} on Squarespace.`);
        shouldUpdateFulfillmentStatus = true;
      } catch (error) {
        orderStatus = 'error';
        ilcAppOrderIssues.push(`Failed to auto-fulfill order ${orderId} on Squarespace: ${error}`);
        logger.error(`Failed to auto-fulfill order ${orderId} on Squarespace:`, error);
        if (axios.isAxiosError(error) && error.response) {
          logger.error('Squarespace API responded with:', error.response.data);
        }
      }
    }
  }

  const updateData: Partial<SquareSpaceOrder | { lastUpdated: admin.firestore.FieldValue }> = {
    lineItems,
    ilcAppOrderStatus: orderStatus,
    ilcAppOrderIssues: ilcAppOrderIssues,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  };

  if (shouldUpdateFulfillmentStatus) {
    (updateData as SquareSpaceOrder).fulfillmentStatus = 'FULFILLED';
  }

  await db.collection('orders').doc(docId).update(updateData);
}
