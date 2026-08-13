/* grading-request.ts
 *
 * Callable Cloud Function letting a member request their next grading before
 * paying for it. Creation is guarded here (rather than via a client Firestore
 * write) so we can enforce membership/level/one-open-request rules and populate
 * fields the student cannot set directly. The resulting grading is unpaid
 * (PaymentStatus.NotYetPaid); it flips to "Paid online" automatically when the
 * matching Squarespace grading order is later processed (see
 * squarespace-orders/grading.ts), and only updates the student's level once it
 * is both paid and passed (see on-grading-update.ts).
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import {
  Grading,
  GradingStatus,
  Member,
  PaymentStatus,
  initGrading,
  isGradingPaid,
  nextGradingLevel,
  gradingProgression,
  normalizeGradingLevel,
  achievedGradingLevels,
} from './data-model';
import {
  allowedOrigins,
  getUserMemberDocIds,
  hasActiveMembership,
} from './common';

export const requestGrading = onCall(
  { cors: allowedOrigins },
  async (request: CallableRequest<{ memberDocId: string }>) => {
    if (!request.auth || !request.auth.token.email) {
      throw new HttpsError('unauthenticated', 'Must be authenticated to request a grading.');
    }
    const email = request.auth.token.email;
    const memberDocId = request.data?.memberDocId;
    if (!memberDocId) {
      throw new HttpsError('invalid-argument', 'memberDocId is required.');
    }

    const db = admin.firestore();

    // The caller must own (manage) this member profile.
    const ownedDocIds = await getUserMemberDocIds(email, db);
    if (!ownedDocIds.includes(memberDocId)) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to request a grading for this member.',
      );
    }

    const memberSnap = await db.collection('members').doc(memberDocId).get();
    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Member not found.');
    }
    const member = { ...memberSnap.data(), docId: memberSnap.id } as Member;

    // Must be an active member to grade.
    if (!hasActiveMembership(member)) {
      throw new HttpsError(
        'permission-denied',
        'You must be an active member to request a grading.',
      );
    }

    // Auto-populate the next level the student needs to grade for.
    const level = nextGradingLevel(member.studentLevel, member.applicationLevel);
    if (!level) {
      throw new HttpsError(
        'failed-precondition',
        'There is no further grading level to request.',
      );
    }

    // Only one active (unpaid) grading at a time. A completed-but-failed grading
    // (NotPassed) does not count; everything else unpaid blocks a new request.
    const existing = await db
      .collection('gradings')
      .where('studentMemberDocId', '==', memberDocId)
      .get();
    const hasOpenRequest = existing.docs.some((d) => {
      const g = d.data() as Grading;
      return !isGradingPaid(g) && g.status !== GradingStatus.NotPassed;
    });
    if (hasOpenRequest) {
      throw new HttpsError(
        'failed-precondition',
        'You already have an open grading request. Finish or pay for it before requesting another.',
      );
    }

    const grading: Grading = {
      ...initGrading(),
      studentMemberId: member.memberId,
      studentMemberDocId: memberDocId,
      level,
      status: GradingStatus.AwaitingRequest,
      paymentStatus: PaymentStatus.NotYetPaid,
      orderId: '',
      gradingPurchaseDate: '',
    };

    const gradingRef = db.collection('gradings').doc();
    grading.docId = gradingRef.id;
    await gradingRef.set({
      ...grading,
      lastUpdated: FieldValue.serverTimestamp(),
    });

    logger.info(
      `Member ${member.memberId} (${memberDocId}) requested grading ${gradingRef.id} for ${level}.`,
    );

    return { gradingDocId: gradingRef.id };
  },
);

export const requestGradingRetake = onCall(
  { cors: allowedOrigins },
  async (request: CallableRequest<{ memberDocId: string; level?: string }>) => {
    if (!request.auth || !request.auth.token.email) {
      throw new HttpsError('unauthenticated', 'Must be authenticated to request a grading retake.');
    }
    const email = request.auth.token.email;
    const memberDocId = request.data?.memberDocId;
    if (!memberDocId) {
      throw new HttpsError('invalid-argument', 'memberDocId is required.');
    }

    const db = admin.firestore();

    // The caller must own (manage) this member profile.
    const ownedDocIds = await getUserMemberDocIds(email, db);
    if (!ownedDocIds.includes(memberDocId)) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to request a grading retake for this member.',
      );
    }

    const memberSnap = await db.collection('members').doc(memberDocId).get();
    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Member not found.');
    }
    const member = { ...memberSnap.data(), docId: memberSnap.id } as Member;

    // Must be an active member to grade.
    if (!hasActiveMembership(member)) {
      throw new HttpsError(
        'permission-denied',
        'You must be an active member to request a grading.',
      );
    }

    // Get all member gradings
    const gradingsSnap = await db
      .collection('gradings')
      .where('studentMemberDocId', '==', memberDocId)
      .get();
    const allGradings = gradingsSnap.docs.map(
      (d) => ({ ...d.data(), docId: d.id } as Grading),
    );

    // Determine target retake level
    let targetLevel = request.data?.level ? normalizeGradingLevel(request.data.level) : '';

    if (targetLevel) {
      const hasNotPassed = allGradings.some(
        (g) => normalizeGradingLevel(g.level) === targetLevel && g.status === GradingStatus.NotPassed,
      );
      if (!hasNotPassed) {
        throw new HttpsError(
          'failed-precondition',
          `No previous Not-Passed grading found for level ${targetLevel}. Free retakes are only available for levels you did not pass.`,
        );
      }
    } else {
      // Find the first level in progression that has a NotPassed grading and is neither passed nor open
      const achieved = achievedGradingLevels(member.studentLevel, member.applicationLevel);
      for (const lvl of gradingProgression) {
        if (achieved.has(lvl)) continue;
        const matchingNotPassed = allGradings.some(
          (g) => normalizeGradingLevel(g.level) === lvl && g.status === GradingStatus.NotPassed,
        );
        const hasOpen = allGradings.some(
          (g) =>
            normalizeGradingLevel(g.level) === lvl &&
            g.status !== GradingStatus.Passed &&
            g.status !== GradingStatus.NotPassed,
        );
        if (matchingNotPassed && !hasOpen) {
          targetLevel = lvl;
          break;
        }
      }
      if (!targetLevel) {
        throw new HttpsError(
          'failed-precondition',
          'No eligible Not-Passed level found for a free retake.',
        );
      }
    }

    // Check that there is no existing Passed or Open (unfinalized) grading for targetLevel
    const alreadyPassed = allGradings.some(
      (g) => normalizeGradingLevel(g.level) === targetLevel && g.status === GradingStatus.Passed,
    );
    if (alreadyPassed) {
      throw new HttpsError(
        'failed-precondition',
        `You have already passed ${targetLevel}.`,
      );
    }

    const hasOpenGrading = allGradings.some(
      (g) =>
        normalizeGradingLevel(g.level) === targetLevel &&
        g.status !== GradingStatus.Passed &&
        g.status !== GradingStatus.NotPassed,
    );
    if (hasOpenGrading) {
      throw new HttpsError(
        'failed-precondition',
        `You already have an active grading entry for ${targetLevel}.`,
      );
    }

    const newGrading: Grading = {
      ...initGrading(),
      studentMemberId: member.memberId,
      studentMemberDocId: memberDocId,
      level: targetLevel,
      status: GradingStatus.AwaitingRequest,
      paymentStatus: PaymentStatus.PaidOther,
      paymentNote: 'Free retake after Not-Passed grading',
      orderId: '',
      gradingPurchaseDate: new Date().toISOString(),
    };

    const gradingRef = db.collection('gradings').doc();
    newGrading.docId = gradingRef.id;
    await gradingRef.set({
      ...newGrading,
      lastUpdated: FieldValue.serverTimestamp(),
    });

    logger.info(
      `Member ${member.memberId} (${memberDocId}) created free retake grading ${gradingRef.id} for ${targetLevel}.`,
    );

    return { gradingDocId: gradingRef.id, level: targetLevel };
  },
);
