import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import axios from 'axios';
import { Member, MembershipType, InstructorLicenseType, Grading, GradingStatus, initGrading, initMember, SquareSpaceOrder, SquareSpaceLineItem, SquareSpaceCustomization, OrderStatus, Order } from './data-model';
import { canonicalizeGradingLevel, canonicalizeStudentLevel, canonicalizeApplicationLevel } from './level-utils';
import { assertAdmin, allowedOrigins } from './common';
import { assignNextMemberId } from './counters';
import { resolveCountryCode } from './country-codes';

const squarespaceApiKey = defineSecret('SQUARESPACE_API_KEY');

// https://developers.squarespace.com/commerce-apis/orders-api
const SQUARESPACE_ORDERS_API = 'https://api.squarespace.com/1.0/commerce/orders';

// The systemInfo document where we keep track of the last time we synced orders
const SYNC_STATE_DOC = 'system/squarespaceSync';

/**
 * Core logic to fetch from Squarespace API and sync to Firestore.
 * Placed in an exportable function so standalone scripts can call it.
 */
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
    await fetchAndSyncOrders(db, apiKey);
  }
);

/**
 * Callable Cloud Function that allows admins to trigger a sync manually.
 */
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

/**
 * Event-triggered function that runs whenever an order document is written
 * (created or updated) in the `orders` collection.
 * This is where domain-specific downstream logic belongs.
 */
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
/**
 * Clear all ilcApp processing state from an order so it can be re-processed.
 * Removes order-level and line-item-level processing status fields.
 */
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
    } else if (lineItem.sku?.startsWith('MEM-')) {
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
    } else if (lineItem.sku?.startsWith('LIC-')) {
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
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          // 403 on fulfillment usually means the order is already fulfilled on Squarespace
          // but the local fulfillmentStatus field wasn't up to date.
          logger.warn(`Got 403 trying to fulfill order ${orderId}. This likely means the order is already fulfilled on Squarespace. Treating as success.`);
        } else {
          orderStatus = 'error';
          ilcAppOrderIssues.push(`Failed to auto-fulfill order ${orderId} on Squarespace: ${error}`);
          logger.error(`Failed to auto-fulfill order ${orderId} on Squarespace:`, error);
          if (axios.isAxiosError(error) && error.response) {
            logger.error('Squarespace API responded with:', error.response.data);
          }
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
  await db.collection('orders').doc(docId).update(updateData);
}

/**
 * Helper function to grant classVideoLibrarySubscription to members
 * based on order custom forms or user email.
 * 
 * Returns error string or null if no error.
 */
async function processVideoLibraryAccess(orderData: SquareSpaceOrder, orderId: string,
  videoItem: SquareSpaceLineItem, db: admin.firestore.Firestore
): Promise<string | null> {
  let email = orderData.customerEmail;
  let providedMemberId = '';
  let providedEmail = '';

  const customizations: SquareSpaceCustomization[] = videoItem.customizations || [];
  for (const field of customizations) {
    if (!field.label || !field.value) continue;
    const labelLower = field.label.toLowerCase();

    if (labelLower.includes('email')) {
      providedEmail = field.value.trim();
    } else if (labelLower.includes('member id')) {
      providedMemberId = field.value.trim();
    }
  }

  // Use provided email from form if available
  if (providedEmail) {
    email = providedEmail;
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

  if (!memberDocRef) {
    const issue = `[Video Library] Could not find a member document for order ${orderId} (Member ID: ${providedMemberId}, Email: ${email}) to grant video library access.`;
    logger.warn(issue);
    return issue;
  }

  // Compute expiration date: 1 month from order creation date.
  // Video library subscriptions are monthly.
  const purchaseDate = orderData.createdOn
    ? orderData.createdOn.substring(0, 10)
    : new Date().toISOString().substring(0, 10);
  const expirationDateObj = new Date(purchaseDate + 'T00:00:00Z');
  expirationDateObj.setUTCMonth(expirationDateObj.getUTCMonth() + 1);
  const expirationDate = expirationDateObj.toISOString().substring(0, 10);

  // Idempotency: skip if the member already has a subscription expiring at or after
  // this new expiration (indicates a duplicate or already-processed order).
  if (memberData && memberData.classVideoLibrarySubscription === true
    && memberData.classVideoLibraryExpirationDate
    && memberData.classVideoLibraryExpirationDate >= expirationDate) {
    const issue = `[Video Library] Member ${memberDocRef.id} already has video library subscription `
      + `expiring ${memberData.classVideoLibraryExpirationDate}, which is at or after ${expirationDate}. No action needed.`;
    logger.warn(issue);
    return issue;
  }

  logger.info(`[Video Library] Granting video library subscription to member ${memberDocRef.id} based on order ${orderId}, `
    + `expires ${expirationDate}.`);
  await memberDocRef.update({
    classVideoLibrarySubscription: true,
    classVideoLibraryExpirationDate: expirationDate,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return null;
}

export function parseGradingOrderInfo(
  orderData: SquareSpaceOrder,
  gradingItem: SquareSpaceLineItem
): { email: string; currentStudentLevel: string; currentApplicationLevel: string; gradingInfo: Grading } {
  const customizations: SquareSpaceCustomization[] = gradingItem.customizations || [];

  let providedMemberId = '';
  let providedEmail = '';
  let gradingInstructorId = '';
  let notes = '';
  let gradingEvent = '';
  let currentStudentLevel = '';
  let currentApplicationLevel = '';

  for (const field of customizations) {
    if (!field.label || !field.value) continue;
    const labelLower = field.label.toLowerCase();

    if (labelLower.includes('member id')) {
      providedMemberId = field.value.trim();
    } else if (labelLower.includes('email')) {
      providedEmail = field.value.trim();
    } else if (labelLower.includes('instructorid') || labelLower.includes('instructor id')) {
      gradingInstructorId = field.value.trim();
    } else if (labelLower.includes('where / when') || labelLower.includes('planning to grade')) {
      gradingEvent = field.value.trim();
    } else if (labelLower.includes('evaluating instructor')) {
      notes += `Evaluating Instructor Name: ${field.value.trim()}\n`;
    } else if (labelLower.includes('current student level')) {
      currentStudentLevel = field.value.trim();
    } else if (labelLower.includes('current application level')) {
      currentApplicationLevel = field.value.trim();
    }
  }

  const email = providedEmail || orderData.customerEmail || '';

  let level = '';
  const variantOptions = gradingItem.variantOptions || [];
  for (const opt of variantOptions) {
    if (opt.optionName && opt.optionName.toLowerCase() === 'level') {
      level = opt.value || '';
      break;
    }
  }
  if (!level) {
    level = gradingItem.productName || 'Unknown Level';
  }
  level = canonicalizeGradingLevel(level);

  const purchaseDate = orderData.createdOn ? orderData.createdOn.substring(0, 10) : new Date().toISOString().substring(0, 10);

  return {
    email,
    currentStudentLevel: canonicalizeStudentLevel(currentStudentLevel),
    currentApplicationLevel: canonicalizeApplicationLevel(currentApplicationLevel),
    gradingInfo: {
      ...initGrading(),
      status: providedMemberId ? GradingStatus.Pending : GradingStatus.RequiresReview,
      gradingPurchaseDate: purchaseDate,
      orderId: orderData.docId || '',
      level,
      gradingInstructorId,
      studentMemberId: providedMemberId,
      notes: notes.trim(),
      gradingEvent
    }
  };
}

/**
 * Helper function to create Grading documents when a grading is purchased
 * 
 * Returns error string, or null if successful.
 */
export async function processGradingOrder(
  orderData: SquareSpaceOrder, orderId: string, gradingItem: SquareSpaceLineItem,
  db: admin.firestore.Firestore
): Promise<string | null> {
  const { email, currentStudentLevel, currentApplicationLevel, gradingInfo } = parseGradingOrderInfo(orderData, gradingItem);
  const level = gradingInfo.level || '';

  // Idempotency check: see if we already processed this order + level
  const existingGradingsQuery = await db.collection('gradings')
    .where('orderId', '==', orderId)
    .where('level', '==', level)
    .limit(1)
    .get();

  if (!existingGradingsQuery.empty) {
    const issue = `[Grading] Grading for order ${orderId} and level ${level} already exists. Skipping.`;
    logger.warn(issue);
    return issue;
  }

  let memberDocRef: admin.firestore.DocumentReference | null = null;
  let memberData: Partial<Member> | null = null;
  const providedMemberId = gradingInfo.studentMemberId;

  // Try finding by Member ID first
  if (providedMemberId) {
    logger.info(`[Grading] Looking for member with ID: ${providedMemberId} for order ${orderId}`);
    const memberIdQuery = await db.collection('members')
      .where('memberId', '==', providedMemberId)
      .limit(1)
      .get();
    if (!memberIdQuery.empty) {
      memberDocRef = memberIdQuery.docs[0].ref;
      memberData = memberIdQuery.docs[0].data() as Partial<Member>;
    } else {
      const issue = `[Grading] Member ID ${providedMemberId} not found in database.`;
      logger.warn(issue);
      return issue;
    }
  }

  if (!memberDocRef) {
    const issue = `[Grading] Could not find a member document for order ${orderId} `
      + `(Member ID: ${providedMemberId}, Email: ${email}) to create grading doc.` +
      ` Please create and associate a grading with a member manually.`
    logger.warn(issue);
    return issue;
  }

  const newGrading: Grading = {
    ...gradingInfo,
    status: GradingStatus.Pending,
    studentMemberDocId: memberDocRef.id,
  };

  if (memberData) {
    const memberEmails = (memberData.emails || []).map(e => e.toLowerCase());
    const publicEmail = (memberData.publicEmail || '').toLowerCase();
    const providedEmailLower = email.toLowerCase();

    const emailMatches = memberEmails.includes(providedEmailLower) || publicEmail === providedEmailLower;

    // Member levels might be stored as "1" or "Student 1". 
    // canonicalize functions will ensure they are both in the "Student X" or "Application X" format.
    const memberStudentLevel = canonicalizeStudentLevel(memberData.studentLevel || '');
    const memberApplicationLevel = canonicalizeApplicationLevel(memberData.applicationLevel || '');

    const studentLevelMatches = !currentStudentLevel || (memberStudentLevel === currentStudentLevel);
    const applicationLevelMatches = !currentApplicationLevel || (memberApplicationLevel === currentApplicationLevel);

    if (!emailMatches || !studentLevelMatches || !applicationLevelMatches) {
      newGrading.status = GradingStatus.RequiresReview;
      logger.warn(`[Grading] Order ${orderId} required review due to mismatch: emailMatches=${emailMatches}, studentLevelMatches=${studentLevelMatches}, applicationLevelMatches=${applicationLevelMatches}`);
    }
  }

  const gradingRef = db.collection('gradings').doc();
  newGrading.docId = gradingRef.id;

  logger.info(`[Grading] Creating new grading doc ${gradingRef.id} for member based on order ${orderId}.`);

  await gradingRef.set({
    ...newGrading,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  if (memberDocRef) {
    // Add the new grading to the member's gradingDocIds array
    await memberDocRef.update({
      gradingDocIds: admin.firestore.FieldValue.arrayUnion(gradingRef.id)
    });
  }

  return null;
}

// ==================================================================
// Shared date computation for annual renewals
// ==================================================================

/**
 * Compute renewal and expiration dates for annual subscriptions.
 *
 * The new renewal date is the later of the current expiration date or the
 * order date (so that early renewals extend from the current expiration,
 * while late renewals start from the order date).
 *
 * The new expiration date is exactly 1 year after the new renewal date.
 *
 * @param currentExpiration - YYYY-MM-DD of the current expiration, or empty.
 * @param orderDate - YYYY-MM-DD of the order / purchase date.
 * @returns { renewalDate, expirationDate } both in YYYY-MM-DD.
 */
export function computeRenewalAndExpiration(
  currentExpiration: string,
  orderDate: string
): { renewalDate: string; expirationDate: string } {
  // Renewal date is the later of the current expiration or the order date.
  let renewalDate = orderDate;
  if (currentExpiration && currentExpiration > orderDate) {
    renewalDate = currentExpiration;
  }
  // Expiration is exactly 1 year after the renewal date.
  const renewalDateObj = new Date(renewalDate + 'T00:00:00Z');
  renewalDateObj.setUTCFullYear(renewalDateObj.getUTCFullYear() + 1);
  const expirationDate = renewalDateObj.toISOString().substring(0, 10);
  return { renewalDate, expirationDate };
}

// ==================================================================
// Membership Renewal Processing
// ==================================================================

export interface MembershipRenewalInfo {
  memberId: string;
  email: string;
  name: string;
  dateOfBirth: string;
  country: string; // Raw country value from form (name or code)
  isNewMember: boolean;
  renewalDate: string; // YYYY-MM-DD, from order createdOn
  expirationDate: string; // YYYY-MM-DD, renewalDate + 1 year
}

/**
 * Parse membership renewal info from a line item's customization fields.
 * This is a pure function (no side effects) for easy testing.
 */
export function parseMembershipRenewalInfo(
  orderData: SquareSpaceOrder,
  lineItem: SquareSpaceLineItem
): MembershipRenewalInfo {
  const customizations: SquareSpaceCustomization[] = lineItem.customizations || [];

  let memberId = '';
  let email = '';
  let name = '';
  let dateOfBirth = '';
  let country = '';
  let isNewMember = false;

  for (const field of customizations) {
    if (!field.label || !field.value) continue;
    const labelLower = field.label.toLowerCase();

    if (labelLower.includes('member id')) {
      memberId = field.value.trim();
    } else if (labelLower.includes('email')) {
      email = field.value.trim();
    } else if (labelLower.includes('date of birth')) {
      dateOfBirth = field.value.trim();
    } else if (labelLower.includes('country')) {
      country = field.value.trim();
    } else if (labelLower.includes('name')) {
      name = field.value.trim();
    } else if (labelLower.includes('new member')) {
      isNewMember = !field.value.toLowerCase().includes('renew');
    }
  }

  // Fall back to the order's customer email if none provided in form
  if (!email) {
    email = orderData.customerEmail || '';
  }

  // Fall back to billing address country code if no country in customizations
  if (!country && orderData.billingAddress?.country) {
    country = orderData.billingAddress.country;
  }

  // Compute renewal and expiration dates from order creation date.
  // Memberships are annual; expiration is exactly 1 year from the renewal date.
  const renewalDate = orderData.createdOn
    ? orderData.createdOn.substring(0, 10)
    : new Date().toISOString().substring(0, 10);

  const renewalDateObj = new Date(renewalDate + 'T00:00:00Z');
  renewalDateObj.setUTCFullYear(renewalDateObj.getUTCFullYear() + 1);
  const expirationDate = renewalDateObj.toISOString().substring(0, 10);

  return {
    memberId,
    email,
    name,
    dateOfBirth,
    country,
    isNewMember,
    renewalDate,
    expirationDate,
  };
}

/**
 * Process a membership renewal line item: find the member, validate,
 * update lastRenewalDate and currentMembershipExpires.
 *
 * Returns an error string, or null if successful.
 */
export async function processMembershipRenewal(
  orderData: SquareSpaceOrder,
  orderId: string,
  lineItem: SquareSpaceLineItem,
  db: admin.firestore.Firestore
): Promise<string | null> {
  const info = parseMembershipRenewalInfo(orderData, lineItem);

  if (info.isNewMember) {
    return await processNewMemberRegistration(orderData, orderId, info, db);
  }

  if (!info.memberId) {
    const issue = `[Membership] Order ${orderId} is missing a Member ID in the form response. `
      + `Cannot process renewal without a Member ID.`;
    logger.warn(issue);
    return issue;
  }

  // Look up the member by memberId
  logger.info(`[Membership] Looking for member with ID: ${info.memberId} for order ${orderId}`);
  const memberQuery = await db.collection('members')
    .where('memberId', '==', info.memberId)
    .limit(1)
    .get();

  // TODO: set limit to 2 and add a check for multiple members, fail is we find multiple members.

  if (memberQuery.empty) {
    const issue = `[Membership] Member ID ${info.memberId} not found in database for order ${orderId}.`;
    logger.warn(issue);
    return issue;
  }

  const memberDocRef = memberQuery.docs[0].ref;
  const memberData = memberQuery.docs[0].data() as Partial<Member>;

  // Validate that the member matches the order details
  const validationIssues: string[] = [];

  if (info.email) {
    const memberEmails = (memberData.emails || []).map(e => e.toLowerCase());
    const providedEmailLower = info.email.toLowerCase();
    if (!memberEmails.includes(providedEmailLower)) {
      validationIssues.push(
        `Email mismatch: order provided "${info.email}" but member ${info.memberId} has emails [${memberData.emails?.join(', ')}]`
      );
    }
  }

  if (info.name) {
    const memberNameLower = (memberData.name || '').toLowerCase().trim();
    const providedNameLower = info.name.toLowerCase().trim();
    if (memberNameLower !== providedNameLower) {
      validationIssues.push(
        `Name mismatch: order provided "${info.name}" but member ${info.memberId} has name "${memberData.name}"`
      );
    }
  }

  if (validationIssues.length > 0) {
    const issue = `[Membership] Order ${orderId} validation issues for member ${info.memberId}: `
      + validationIssues.join('; ');
    logger.warn(issue);
    return issue;
  }

  // Compute the actual renewal and expiration dates considering the
  // member's current expiration (so early renewals extend from expiry).
  const { renewalDate, expirationDate } = computeRenewalAndExpiration(
    memberData.currentMembershipExpires || '',
    info.renewalDate
  );

  // Check if the member's current expiration is already beyond the new one
  // (would indicate a duplicate / already processed renewal)
  if (memberData.currentMembershipExpires && memberData.currentMembershipExpires >= expirationDate) {
    const issue = `[Membership] Member ${info.memberId} already has membership expiring on `
      + `${memberData.currentMembershipExpires}, which is at or after the new expiration ${expirationDate}. `
      + `This may be a duplicate renewal. No update made.`;
    logger.warn(issue);
    return issue;
  }

  // Update the member's renewal date and expiration
  logger.info(`[Membership] Updating member ${info.memberId} (doc ${memberDocRef.id}): `
    + `lastRenewalDate=${renewalDate}, currentMembershipExpires=${expirationDate}`);

  await memberDocRef.update({
    lastRenewalDate: renewalDate,
    currentMembershipExpires: expirationDate,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return null;
}

/**
 * Create a new member document when a membership order is for a new member.
 * Uses initMember() as the base and populates fields from the order form.
 * Auto-assigns a member ID based on the country code.
 *
 * Returns an error string, or null if successful.
 */
async function processNewMemberRegistration(
  orderData: SquareSpaceOrder,
  orderId: string,
  info: MembershipRenewalInfo,
  db: admin.firestore.Firestore
): Promise<string | null> {
  // Resolve country to a country code
  const countryCode = resolveCountryCode(info.country);
  if (!countryCode) {
    const issue = `[Membership] Order ${orderId} is for a new member but the country `
      + `"${info.country}" could not be resolved to a country code. Please process manually.`;
    logger.warn(issue);
    return issue;
  }

  if (!info.name) {
    const issue = `[Membership] Order ${orderId} is for a new member but no name was provided. `
      + `Please process manually.`;
    logger.warn(issue);
    return issue;
  }

  // Assign the next available member ID for this country
  let newMemberId: string;
  try {
    newMemberId = await assignNextMemberId(countryCode, db);
  } catch (e) {
    const issue = `[Membership] Order ${orderId}: failed to assign a new member ID `
      + `for country ${countryCode}: ${e}`;
    logger.error(issue);
    return issue;
  }

  // Build the new member document, following the same pattern as the
  // frontend member-edit component's saveMember().
  const newMember: Member = {
    ...initMember(),
    memberId: newMemberId,
    name: info.name,
    country: countryCode,
    emails: info.email ? [info.email] : [],
    dateOfBirth: info.dateOfBirth,
    membershipType: MembershipType.Annual,
    firstMembershipStarted: info.renewalDate,
    lastRenewalDate: info.renewalDate,
    currentMembershipExpires: info.expirationDate,
  };

  // Create the member document
  const memberDocRef = db.collection('members').doc();
  newMember.docId = memberDocRef.id;

  logger.info(`[Membership] Creating new member ${newMemberId} (doc ${memberDocRef.id}) `
    + `for order ${orderId}: name=${info.name}, country=${countryCode}, email=${info.email}`);

  await memberDocRef.set({
    ...newMember,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return null;
}

// ==================================================================
// Instructor / Group Leader License Processing
// ==================================================================

export interface InstructorLicenseInfo {
  memberId: string;
  email: string;
  orderDate: string; // YYYY-MM-DD, from order createdOn
}

/**
 * Parse instructor / group leader license info from a line item's
 * customization fields. Pure function for easy testing.
 */
export function parseInstructorLicenseInfo(
  orderData: SquareSpaceOrder,
  lineItem: SquareSpaceLineItem
): InstructorLicenseInfo {
  const customizations: SquareSpaceCustomization[] = lineItem.customizations || [];

  let memberId = '';
  let email = '';

  for (const field of customizations) {
    if (!field.label || !field.value) continue;
    const labelLower = field.label.toLowerCase();

    if (labelLower.includes('member id')) {
      memberId = field.value.trim();
    } else if (labelLower.includes('email')) {
      email = field.value.trim();
    }
  }

  if (!email) {
    email = orderData.customerEmail || '';
  }

  const orderDate = orderData.createdOn
    ? orderData.createdOn.substring(0, 10)
    : new Date().toISOString().substring(0, 10);

  return { memberId, email, orderDate };
}

/**
 * Process an instructor / group leader license renewal line item:
 * find the member by memberId, validate, update instructorLicenseRenewalDate
 * and instructorLicenseExpires.
 *
 * Returns an error string, or null if successful.
 */
export async function processInstructorLicense(
  orderData: SquareSpaceOrder,
  orderId: string,
  lineItem: SquareSpaceLineItem,
  db: admin.firestore.Firestore
): Promise<string | null> {
  const info = parseInstructorLicenseInfo(orderData, lineItem);

  if (!info.memberId) {
    const issue = `[License] Order ${orderId} is missing a Member ID in the form response. `
      + `Cannot process license renewal without a Member ID.`;
    logger.warn(issue);
    return issue;
  }

  // Look up the member by memberId
  logger.info(`[License] Looking for member with ID: ${info.memberId} for order ${orderId}`);
  const memberQuery = await db.collection('members')
    .where('memberId', '==', info.memberId)
    .limit(1)
    .get();

  if (memberQuery.empty) {
    const issue = `[License] Member ID ${info.memberId} not found in database for order ${orderId}.`;
    logger.warn(issue);
    return issue;
  }

  const memberDocRef = memberQuery.docs[0].ref;
  const memberData = memberQuery.docs[0].data() as Partial<Member>;

  // Validate email
  if (info.email) {
    const memberEmails = (memberData.emails || []).map(e => e.toLowerCase());
    const providedEmailLower = info.email.toLowerCase();
    if (!memberEmails.includes(providedEmailLower)) {
      const issue = `[License] Order ${orderId}: email mismatch for member ${info.memberId}: `
        + `order provided "${info.email}" but member has emails [${memberData.emails?.join(', ')}]`;
      logger.warn(issue);
      return issue;
    }
  }

  // Compute the actual renewal and expiration dates
  const { renewalDate, expirationDate } = computeRenewalAndExpiration(
    memberData.instructorLicenseExpires || '',
    info.orderDate
  );

  // Idempotency: check if the member already has a license expiring at or after new expiration
  if (memberData.instructorLicenseExpires && memberData.instructorLicenseExpires >= expirationDate) {
    const issue = `[License] Member ${info.memberId} already has instructor license expiring on `
      + `${memberData.instructorLicenseExpires}, which is at or after the new expiration ${expirationDate}. `
      + `This may be a duplicate renewal. No update made.`;
    logger.warn(issue);
    return issue;
  }

  logger.info(`[License] Updating member ${info.memberId} (doc ${memberDocRef.id}): `
    + `instructorLicenseRenewalDate=${renewalDate}, instructorLicenseExpires=${expirationDate}`);

  await memberDocRef.update({
    instructorLicenseRenewalDate: renewalDate,
    instructorLicenseExpires: expirationDate,
    instructorLicenseType: InstructorLicenseType.Annual,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  return null;
}
