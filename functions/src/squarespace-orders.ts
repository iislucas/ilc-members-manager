import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import axios from 'axios';
import { Member, Grading, GradingStatus, initGrading } from './data-model';

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

      if (dryRun) {
        logger.info(`[DRY RUN] Would save order ${orderId} to firestore:`, JSON.stringify(orderData, null, 2));
      } else {
        await db.collection('orders').doc(orderId).set(orderData, { merge: true });
        logger.info(`Saved order ${orderId} to firestore.`);
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
    const gradingItems = lineItems.filter((item) => {
      const title = item.productName || item.title || '';
      return title.toLowerCase().includes('grading');
    });

    for (const gradingItem of gradingItems) {
      await processGradingOrder(orderData, orderId, gradingItem, db);
    }
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

/**
 * Helper function to create Grading documents when a grading is purchased
 */
export async function processGradingOrder(orderData: any, orderId: string, gradingItem: any, db: admin.firestore.Firestore) {
  interface CustomFormField {
    label?: string;
    value?: string;
  }

  const customizations: CustomFormField[] = gradingItem.customizations || [];

  let providedMemberId = '';
  let providedEmail = '';
  let gradingInstructorId = '';
  let notes = '';

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
      notes += `Proposed Event: ${field.value.trim()}\n`;
    } else if (labelLower.includes('evaluating instructor')) {
      notes += `Evaluating Instructor Name: ${field.value.trim()}\n`;
    }
  }

  const email = providedEmail || orderData.customerEmail;

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

  // Idempotency check: see if we already processed this order + level
  const existingGradingsQuery = await db.collection('gradings')
    .where('orderId', '==', orderId)
    .where('level', '==', level)
    .limit(1)
    .get();

  if (!existingGradingsQuery.empty) {
    logger.info(`[Grading] Grading for order ${orderId} and level ${level} already exists. Skipping.`);
    return;
  }

  let memberDocRef: admin.firestore.DocumentReference | null = null;
  let memberData: Partial<Member> | null = null;

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
      logger.warn(`[Grading] Member ID ${providedMemberId} not found in database. Falling back to email.`);
    }
  }

  // Fallback to searching by email if Member ID was not provided or not found
  if (!memberDocRef && email) {
    logger.info(`[Grading] Looking for member with email: ${email} for order ${orderId}`);
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
    logger.error(`[Grading] Could not find a member document for order ${orderId} (Member ID: ${providedMemberId}, Email: ${email}) to create grading doc.`);
    return;
  }

  const purchaseDate = orderData.createdOn ? orderData.createdOn.substring(0, 10) : new Date().toISOString().substring(0, 10);

  const newGrading: Grading = {
    ...initGrading(),
    gradingPurchaseDate: purchaseDate,
    orderId: orderId,
    level: level,
    gradingInstructorId: gradingInstructorId,
    studentMemberId: memberData?.memberId || providedMemberId,
    studentMemberDocId: memberDocRef.id,
    notes: notes.trim(),
  };

  const gradingRef = db.collection('gradings').doc();
  newGrading.id = gradingRef.id;

  logger.info(`[Grading] Creating new grading doc ${gradingRef.id} for member ${memberDocRef.id} based on order ${orderId}.`);

  await gradingRef.set({
    ...newGrading,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });

  // Add the new grading to the member's gradingDocIds array
  await memberDocRef.update({
    gradingDocIds: admin.firestore.FieldValue.arrayUnion(gradingRef.id)
  });
}
