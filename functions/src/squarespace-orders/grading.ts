/*
Grading Order Processing (SKU: GRA-*)

Handles parsing and creating Grading documents when a grading is purchased
through Squarespace.
*/

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Member, Grading, GradingStatus, initGrading, SquareSpaceOrder, SquareSpaceLineItem, SquareSpaceCustomization } from '../data-model';
import { canonicalizeGradingLevel, canonicalizeStudentLevel, canonicalizeApplicationLevel } from '../level-utils';
import { GradingResult } from './common';
import { inferMemberIdFromOrder } from './infer-member';

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
    } else if (labelLower.includes('where / when') || labelLower.includes('planning to grade') || labelLower.includes('grading event')) {
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

// Create Grading documents when a grading is purchased.
export async function processGradingOrder(
  orderData: SquareSpaceOrder, orderId: string, gradingItem: SquareSpaceLineItem,
  db: admin.firestore.Firestore
): Promise<GradingResult> {
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
    return { kind: 'error', message: issue };
  }

  let memberDocRef: admin.firestore.DocumentReference | null = null;
  let memberData: Partial<Member> | null = null;
  let effectiveMemberId = gradingInfo.studentMemberId;

  // If the admin manually set ilcAppMemberIdInferred on the line item, it
  // overrides whatever member ID the user may have entered in the form.
  if (gradingItem.ilcAppMemberIdInferred) {
    logger.info(`[Grading] Order ${orderId}: using admin-set ilcAppMemberIdInferred "${gradingItem.ilcAppMemberIdInferred}"` +
      (effectiveMemberId ? ` (overriding form-provided "${effectiveMemberId}")` : ''));
    effectiveMemberId = gradingItem.ilcAppMemberIdInferred;
    gradingInfo.studentMemberId = effectiveMemberId;
  }

  // If still no member ID, try automatic inference.
  if (!effectiveMemberId) {
    const inference = await inferMemberIdFromOrder(
      orderData,
      { memberId: '', email, name: '', dateOfBirth: '', country: '', isNewMember: undefined },
      db,
      gradingItem
    );
    if (inference.memberId) {
      logger.info(`[Grading] Order ${orderId}: inferred member ID "${inference.memberId}" — ${inference.reason}`);
      effectiveMemberId = inference.memberId;
      gradingInfo.studentMemberId = effectiveMemberId;
    }
  }

  // Try finding by Member ID
  if (effectiveMemberId) {
    logger.info(`[Grading] Looking for member with ID: ${effectiveMemberId} for order ${orderId}`);
    const memberIdQuery = await db.collection('members')
      .where('memberId', '==', effectiveMemberId)
      .limit(1)
      .get();
    if (!memberIdQuery.empty) {
      memberDocRef = memberIdQuery.docs[0].ref;
      memberData = memberIdQuery.docs[0].data() as Partial<Member>;
    } else {
      const issue = `[Grading] Member ID ${effectiveMemberId} not found in database.`;
      logger.warn(issue);
      return { kind: 'error', message: issue };
    }
  }

  if (!memberDocRef) {
    const issue = `[Grading] Could not find a member document for order ${orderId} `
      + `(Member ID: ${effectiveMemberId}, Email: ${email}) to create grading doc.` +
      ` Please create and associate a grading with a member manually.`
    logger.warn(issue);
    return { kind: 'error', message: issue };
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

  return { kind: 'success', gradingDocId: gradingRef.id };
}
