/* compute-statistics.ts
 *
 * Firebase Cloud Functions to compute and store monthly membership statistics.
 *
 * The scheduled function `computeStatistics` runs on the 1st of each month at
 * midnight. The callable function `manualComputeStatistics` allows admins to
 * trigger a recomputation at any time.
 *
 * Statistics are stored in the Firestore collection `/statistics/{YYYY-MM}`.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { assertAdmin, allowedOrigins } from './common';
import {
  Member,
  School,
  SquareSpaceOrder,
  MembershipType,
  InstructorLicenseType,
  MemberStatisticsFirebaseDoc,
  Histogram,
  HistogramMap,
} from './data-model';

// Returns true if the member has a currently valid (non-expired) membership.
function isActiveMember(member: Member, todayIso: string): boolean {
  const type = member.membershipType;
  if (type === MembershipType.Life) return true;
  if (type !== MembershipType.Annual) return false;
  const expires = member.currentMembershipExpires;
  if (!expires) return false;
  return expires >= todayIso;
}

// Returns true if the member has a valid instructor license.
function isActiveInstructor(member: Member, todayIso: string): boolean {
  if (!member.instructorId) return false;
  if (member.instructorLicenseType === InstructorLicenseType.Life) return true;
  const expires = member.instructorLicenseExpires;
  if (!expires) return false;
  return expires >= todayIso;
}

// Increments a key in a histogram, initialising it to 0 if absent.
function incrementHistogram(histogram: Histogram, key: string): void {
  if (!key) key = '(none)';
  histogram[key] = (histogram[key] || 0) + 1;
}

// Extracts 'YYYY-MM' from a 'YYYY-MM-DD' date string.
// Returns null if the date is empty, invalid, or the sentinel '9999-12-31' (Life).
function toYearMonth(dateStr: string): string | null {
  if (!dateStr || dateStr === '9999-12-31') return null;
  const match = dateStr.match(/^(\d{4}-\d{2})/);
  return match ? match[1] : null;
}

// Maps a Squarespace SKU to a human-readable product category.
// Returns the category name, or the raw SKU if no mapping is found.
function skuToCategory(sku: string): string {
  if (sku.startsWith('MEM-YEAR-')) return 'Membership (Annual)';
  if (sku.startsWith('MEM-LIFE-')) return 'Membership (Life)';
  if (sku === 'VID-LIBRARY') return 'Video Library';
  if (sku === 'LIS-YEAR-GL' || sku === 'LIS-YEAR-INS' || sku === 'LIS-YEAR-LI') return 'Instructor License';
  if (sku === 'LIS-SCH-YRL') return 'School License (Annual)';
  if (sku === 'LIS-SCH-MTH') return 'School License (Monthly)';
  if (sku.startsWith('GRD-')) return 'Grading';
  return sku;
}

// Core computation logic, separated for testability.
export function computeStatisticsFromMembers(
  members: Member[],
  todayIso: string,
  schools: School[] = [],
): Omit<MemberStatisticsFirebaseDoc, 'date'> {
  let activeMembers = 0;
  let activeInstructors = 0;

  const membershipTypeHistogram: Histogram = {};
  const studentLevelHistogram: Histogram = {};
  const applicationLevelHistogram: Histogram = {};
  const instructorLicenseTypeHistogram: Histogram = {};
  const countryHistogram: Histogram = {};
  const mastersLevelHistogram: Histogram = {};
  const membershipExpiryHistogram: Histogram = {};
  const instructorLicenseExpiryHistogram: Histogram = {};
  const videoLibraryExpiryHistogram: Histogram = {};
  let missingMastersLevels = 0;
  let nonArrayMastersLevels = 0;

  for (const member of members) {
    if (isActiveMember(member, todayIso)) activeMembers++;
    if (isActiveInstructor(member, todayIso)) activeInstructors++;

    incrementHistogram(membershipTypeHistogram, member.membershipType);
    incrementHistogram(studentLevelHistogram, member.studentLevel);
    incrementHistogram(applicationLevelHistogram, member.applicationLevel);
    incrementHistogram(instructorLicenseTypeHistogram, member.instructorLicenseType);
    incrementHistogram(countryHistogram, member.country);

    // mastersLevels may be missing, a string (from bad imports), or a proper array.
    const rawLevels = member.mastersLevels;
    if (rawLevels == null) {
      missingMastersLevels++;
    } else if (!Array.isArray(rawLevels)) {
      nonArrayMastersLevels++;
      // Attempt to parse comma-separated string values.
      const asString = String(rawLevels);
      if (asString.trim()) {
        for (const part of asString.split(',')) {
          const trimmed = part.trim();
          if (trimmed) incrementHistogram(mastersLevelHistogram, trimmed);
        }
      }
    } else {
      for (const level of rawLevels) {
        incrementHistogram(mastersLevelHistogram, level);
      }
    }

    // Expiry histograms (keyed by YYYY-MM).
    if (member.membershipType === MembershipType.Annual) {
      const ym = toYearMonth(member.currentMembershipExpires);
      if (ym) incrementHistogram(membershipExpiryHistogram, ym);
    }
    if (member.instructorId && member.instructorLicenseType !== InstructorLicenseType.Life) {
      const ym = toYearMonth(member.instructorLicenseExpires);
      if (ym) incrementHistogram(instructorLicenseExpiryHistogram, ym);
    }
    if (member.classVideoLibraryExpirationDate) {
      const ym = toYearMonth(member.classVideoLibraryExpirationDate);
      if (ym) incrementHistogram(videoLibraryExpiryHistogram, ym);
    }
  }

  // School license expiry histogram.
  const schoolLicenseExpiryHistogram: Histogram = {};
  for (const school of schools) {
    const ym = toYearMonth(school.schoolLicenseExpires);
    if (ym) incrementHistogram(schoolLicenseExpiryHistogram, ym);
  }

  return {
    totalMembers: members.length,
    activeMembers,
    activeInstructors,
    membershipTypeHistogram,
    studentLevelHistogram,
    applicationLevelHistogram,
    instructorLicenseTypeHistogram,
    countryHistogram,
    mastersLevelHistogram,
    membershipExpiryHistogram,
    schoolLicenseExpiryHistogram,
    instructorLicenseExpiryHistogram,
    videoLibraryExpiryHistogram,
    squarespaceOrdersByProductMonthly: {},
    dataQuality: {
      missingMastersLevels,
      nonArrayMastersLevels,
    },
  };
}

// Computes order statistics from Squarespace orders.
// Groups line items by product category (from SKU) and month (from order date).
export function computeOrderStatistics(
  orders: SquareSpaceOrder[],
): HistogramMap {
  const result: HistogramMap = {};
  for (const order of orders) {
    // Use createdOn for the order date.
    const ym = toYearMonth(order.createdOn ? order.createdOn.substring(0, 10) : '');
    if (!ym) continue;

    for (const item of order.lineItems || []) {
      if (!item.sku) continue;
      const category = skuToCategory(item.sku);
      if (!result[category]) result[category] = {};
      const qty = parseInt(item.quantity, 10) || 1;
      result[category][ym] = (result[category][ym] || 0) + qty;
    }
  }
  return result;
}

// Fetches all members and writes the computed statistics to Firestore.
async function performComputeStatistics(): Promise<string> {
  const db = admin.firestore();
  const todayIso = new Date().toISOString().split('T')[0];
  const docId = todayIso.substring(0, 7); // 'YYYY-MM'

  logger.info(`Computing statistics for ${docId}...`);

  const membersSnapshot = await db.collection('members').get();
  const members: Member[] = membersSnapshot.docs.map((doc) => ({
    ...(doc.data() as Member),
    docId: doc.id,
  }));

  const schoolsSnapshot = await db.collection('schools').get();
  const schools: School[] = schoolsSnapshot.docs.map((doc) => ({
    ...(doc.data() as School),
    docId: doc.id,
  }));

  const stats = computeStatisticsFromMembers(members, todayIso, schools);

  // Fetch Squarespace orders from the last 2 years for order-volume histograms.
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const ordersSnapshot = await db.collection('orders')
    .where('ilcAppOrderKind', '==', 'https://api.squarespace.com/1.0/commerce/orders')
    .where('createdOn', '>=', twoYearsAgo.toISOString())
    .get();
  const ssOrders: SquareSpaceOrder[] = ordersSnapshot.docs.map((doc) => ({
    ...(doc.data() as SquareSpaceOrder),
    docId: doc.id,
  }));
  const orderStats = computeOrderStatistics(ssOrders);

  const statsDoc: MemberStatisticsFirebaseDoc = {
    ...stats,
    squarespaceOrdersByProductMonthly: orderStats,
    date: new Date().toISOString(),
  };

  await db.collection('statistics').doc(docId).set(statsDoc);

  logger.info(
    `Statistics for ${docId} written successfully: ` +
    `${stats.totalMembers} total, ${stats.activeMembers} active members, ` +
    `${stats.activeInstructors} active instructors.`,
  );
  return docId;
}

// Scheduled Cloud Function: runs on the 1st of each month at midnight.
export const computeStatistics = onSchedule('0 0 1 * *', async () => {
  try {
    const docId = await performComputeStatistics();
    logger.info(`Scheduled statistics computation finished. Doc: ${docId}`);
  } catch (error) {
    logger.error('Scheduled statistics computation failed:', error);
  }
});

// Callable Cloud Function: allows admins to trigger computation manually.
export const manualComputeStatistics = onCall(
  { cors: allowedOrigins },
  async (request) => {
    logger.info('manualComputeStatistics called.');
    await assertAdmin(request);
    const docId = await performComputeStatistics();
    return { success: true, docId };
  },
);
