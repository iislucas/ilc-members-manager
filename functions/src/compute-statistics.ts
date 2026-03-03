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
  MembershipType,
  InstructorLicenseType,
  MemberStatisticsFirebaseDoc,
  Histogram,
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

// Core computation logic, separated for testability.
export function computeStatisticsFromMembers(
  members: Member[],
  todayIso: string,
): Omit<MemberStatisticsFirebaseDoc, 'date'> {
  let activeMembers = 0;
  let activeInstructors = 0;

  const membershipTypeHistogram: Histogram = {};
  const studentLevelHistogram: Histogram = {};
  const applicationLevelHistogram: Histogram = {};
  const instructorLicenseTypeHistogram: Histogram = {};
  const countryHistogram: Histogram = {};
  const mastersLevelHistogram: Histogram = {};

  for (const member of members) {
    if (isActiveMember(member, todayIso)) activeMembers++;
    if (isActiveInstructor(member, todayIso)) activeInstructors++;

    incrementHistogram(membershipTypeHistogram, member.membershipType);
    incrementHistogram(studentLevelHistogram, member.studentLevel);
    incrementHistogram(applicationLevelHistogram, member.applicationLevel);
    incrementHistogram(instructorLicenseTypeHistogram, member.instructorLicenseType);
    incrementHistogram(countryHistogram, member.country);

    for (const level of member.mastersLevels) {
      incrementHistogram(mastersLevelHistogram, level);
    }
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
  };
}

// Fetches all members and writes the computed statistics to Firestore.
async function performComputeStatistics(): Promise<string> {
  const db = admin.firestore();
  const todayIso = new Date().toISOString().split('T')[0];
  const docId = todayIso.substring(0, 7); // 'YYYY-MM'

  logger.info(`Computing statistics for ${docId}...`);

  const snapshot = await db.collection('members').get();
  const members: Member[] = snapshot.docs.map((doc) => ({
    ...(doc.data() as Member),
    docId: doc.id,
  }));

  const stats = computeStatisticsFromMembers(members, todayIso);

  const statsDoc: MemberStatisticsFirebaseDoc = {
    ...stats,
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
