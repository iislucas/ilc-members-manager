/* gradings.ts
 *
 * Grading domain actions for creating, advancing, and recording results
 * on student gradings while maintaining audit actor trails and student levels.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreCollection } from '../data-model/collections';
import {
  Grading,
  GradingStatus,
  PaymentStatus,
  initGrading,
  firestoreDocToGrading,
} from '../data-model/gradings';
import { firestoreDocToMember } from '../data-model/members';
import { firestoreDocToIlcEvent } from '../data-model/events';
import { ActionActor, ActionContext, ActionResult } from './types';

/** Parameters for creating a new grading. */
export interface CreateGradingInput {
  studentMemberDocId: string;
  level: string;
  gradingInstructorId?: string;
  gradingEventDocId?: string;
  gradingEventDate?: string;
  gradingEvent?: string;
  schoolId?: string;
  schoolDocId?: string;
  paymentStatus?: PaymentStatus;
  paymentNote?: string;
  orderId?: string;
  notes?: string;
  studentNotes?: string;
  status?: GradingStatus;
  customDocId?: string;
}

/** Filter criteria for querying gradings. */
export interface GradingFilterOptions {
  studentMemberDocId?: string;
  studentMemberId?: string;
  gradingInstructorId?: string;
  gradingEventDocId?: string;
  status?: GradingStatus;
  level?: string;
  paymentStatus?: PaymentStatus;
  limitCount?: number;
}

/**
 * Retrieves a grading by document ID.
 */
export async function getGrading(
  ctx: ActionContext,
  gradingDocId: string,
): Promise<Grading | null> {
  if (!gradingDocId) return null;
  const docRef = ctx.db.collection(FirestoreCollection.Gradings).doc(gradingDocId);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  return firestoreDocToGrading(snap);
}

/**
 * Lists gradings matching query filters.
 */
export async function listGradings(
  ctx: ActionContext,
  options?: GradingFilterOptions,
): Promise<Grading[]> {
  let q = ctx.db.collection(FirestoreCollection.Gradings).limit(options?.limitCount || 100);

  if (options?.studentMemberDocId) {
    q = q.where('studentMemberDocId', '==', options.studentMemberDocId);
  }
  if (options?.studentMemberId) {
    q = q.where('studentMemberId', '==', options.studentMemberId);
  }
  if (options?.gradingInstructorId) {
    q = q.where('gradingInstructorId', '==', options.gradingInstructorId);
  }
  if (options?.gradingEventDocId) {
    q = q.where('gradingEventDocId', '==', options.gradingEventDocId);
  }
  if (options?.status) {
    q = q.where('status', '==', options.status);
  }
  if (options?.paymentStatus) {
    q = q.where('paymentStatus', '==', options.paymentStatus);
  }

  const snap = await q.get();
  let gradings = snap.docs.map(firestoreDocToGrading);

  if (options?.level) {
    const cleanLevel = options.level.toLowerCase().trim();
    gradings = gradings.filter((g) => g.level.toLowerCase().trim() === cleanLevel);
  }

  return gradings;
}

/**
 * Creates a new grading record with verified student link and denormalized snapshots.
 */
export async function createGrading(
  ctx: ActionContext,
  input: CreateGradingInput,
): Promise<ActionResult<Grading>> {
  if (!input.studentMemberDocId) {
    return { success: false, error: 'studentMemberDocId is required.' };
  }
  if (!input.level?.trim()) {
    return { success: false, error: 'Grading level is required.' };
  }

  // Verify student exists
  const studentDoc = await ctx.db
    .collection(FirestoreCollection.Members)
    .doc(input.studentMemberDocId)
    .get();

  if (!studentDoc.exists) {
    return { success: false, error: `Student member "${input.studentMemberDocId}" not found.` };
  }
  const student = firestoreDocToMember(studentDoc);

  // If event is linked, retrieve event details for denormalization
  let eventText = input.gradingEvent || '';
  let eventDate = input.gradingEventDate || '';
  if (input.gradingEventDocId) {
    const eventDoc = await ctx.db
      .collection(FirestoreCollection.Events)
      .doc(input.gradingEventDocId)
      .get();
    if (eventDoc.exists) {
      const eventData = firestoreDocToIlcEvent(eventDoc);
      eventText = eventText || eventData.title;
      eventDate = eventDate || eventData.start?.substring(0, 10) || '';
    }
  }

  const nowIso = new Date().toISOString();
  const todayDate = nowIso.split('T')[0];
  const defaults = initGrading();

  const newGrading: Grading = {
    ...defaults,
    ...input,
    studentMemberDocId: input.studentMemberDocId,
    studentMemberId: student.memberId,
    studentName: student.name,
    gradingPurchaseDate: input.orderId ? todayDate : defaults.gradingPurchaseDate,
    gradingEvent: eventText,
    gradingEventDate: eventDate,
    paymentStatus: input.paymentStatus || PaymentStatus.PaidOther,
    status: input.status || (input.gradingInstructorId ? GradingStatus.AwaitingAcceptance : GradingStatus.AwaitingRequest),
    lastUpdated: nowIso,
  };

  const colRef = ctx.db.collection(FirestoreCollection.Gradings);
  const docRef = input.customDocId ? colRef.doc(input.customDocId) : colRef.doc();
  newGrading.docId = docRef.id;

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Created grading for ${student.name} at level ${newGrading.level} with docId: ${docRef.id}`);
    return { success: true, data: newGrading, dryRun: true };
  }

  const payload = {
    ...newGrading,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete (payload as { docId?: string }).docId;

  await docRef.set(payload);
  ctx.logger?.(`Created grading for ${student.name} (${newGrading.level}) with docId: ${docRef.id}`);

  return { success: true, data: newGrading };
}

/**
 * Updates a grading document.
 */
export async function updateGrading(
  ctx: ActionContext,
  gradingDocId: string,
  patch: Partial<Grading>,
): Promise<ActionResult<Grading>> {
  if (!gradingDocId) {
    return { success: false, error: 'gradingDocId is required.' };
  }

  const existing = await getGrading(ctx, gradingDocId);
  if (!existing) {
    return { success: false, error: `Grading "${gradingDocId}" not found.` };
  }

  const updated: Grading = {
    ...existing,
    ...patch,
    docId: gradingDocId,
    lastUpdated: new Date().toISOString(),
  };

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Updated grading ${gradingDocId}:`, patch);
    return { success: true, data: updated, dryRun: true };
  }

  const docRef = ctx.db.collection(FirestoreCollection.Gradings).doc(gradingDocId);
  const payload: Record<string, unknown> = {
    ...patch,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete payload['docId'];

  await docRef.set(payload, { merge: true });
  ctx.logger?.(`Updated grading ${gradingDocId}`);

  return { success: true, data: updated };
}

/**
 * Records an instructor acceptance for a grading request.
 */
export async function acceptGrading(
  ctx: ActionContext,
  gradingDocId: string,
  actor?: ActionActor,
): Promise<ActionResult<Grading>> {
  const grading = await getGrading(ctx, gradingDocId);
  if (!grading) {
    return { success: false, error: `Grading "${gradingDocId}" not found.` };
  }

  const act = actor || ctx.actor;
  const today = new Date().toISOString().split('T')[0];

  // Capture student's current levels going into the grading if student doc is accessible
  let studentLevel = grading.studentLevelAtAcceptance;
  let appLevel = grading.applicationLevelAtAcceptance;
  if (grading.studentMemberDocId) {
    const studentDoc = await ctx.db.collection(FirestoreCollection.Members).doc(grading.studentMemberDocId).get();
    if (studentDoc.exists) {
      const s = firestoreDocToMember(studentDoc);
      studentLevel = s.studentLevel || '';
      appLevel = s.applicationLevel || '';
    }
  }

  const patch: Partial<Grading> = {
    status: GradingStatus.AwaitingGrading,
    instructorAcceptedDate: today,
    acceptedByMemberDocId: act?.memberDocId || '',
    acceptedByName: act?.name || act?.email || 'Instructor',
    statusChangedByMemberDocId: act?.memberDocId || '',
    statusChangedByName: act?.name || act?.email || 'Instructor',
    studentLevelAtAcceptance: studentLevel,
    applicationLevelAtAcceptance: appLevel,
  };

  return updateGrading(ctx, gradingDocId, patch);
}

/**
 * Declines a grading request and records reasons.
 */
export async function declineGrading(
  ctx: ActionContext,
  gradingDocId: string,
  declineNotes?: string,
  actor?: ActionActor,
): Promise<ActionResult<Grading>> {
  const grading = await getGrading(ctx, gradingDocId);
  if (!grading) {
    return { success: false, error: `Grading "${gradingDocId}" not found.` };
  }

  const act = actor || ctx.actor;
  const patch: Partial<Grading> = {
    status: GradingStatus.Declined,
    declineNotes: declineNotes || 'Instructor is unavailable for this date/location.',
    acceptedByMemberDocId: '',
    acceptedByName: '',
    statusChangedByMemberDocId: act?.memberDocId || '',
    statusChangedByName: act?.name || act?.email || 'Instructor',
  };

  return updateGrading(ctx, gradingDocId, patch);
}

/**
 * Records the final pass/fail outcome of a grading, updates actor audit,
 * and optionally updates the student's level in /members on passing.
 */
export async function recordGradingResult(
  ctx: ActionContext,
  gradingDocId: string,
  options: {
    pass: boolean;
    resultNotes?: string;
    awardLevel?: boolean;
  },
  actor?: ActionActor,
): Promise<ActionResult<Grading>> {
  const grading = await getGrading(ctx, gradingDocId);
  if (!grading) {
    return { success: false, error: `Grading "${gradingDocId}" not found.` };
  }

  const act = actor || ctx.actor;
  const status = options.pass ? GradingStatus.Passed : GradingStatus.NotPassed;

  const patch: Partial<Grading> = {
    status,
    resultNotes: options.resultNotes || (options.pass ? 'Grading completed successfully.' : 'Did not pass on this attempt.'),
    statusChangedByMemberDocId: act?.memberDocId || '',
    statusChangedByName: act?.name || act?.email || 'Grading Examiner',
  };

  const updateRes = await updateGrading(ctx, gradingDocId, patch);
  if (!updateRes.success || !updateRes.data) {
    return updateRes;
  }

  // If passed and awardLevel is requested (default true), update student's member record
  const shouldAwardLevel = options.pass && options.awardLevel !== false;
  if (shouldAwardLevel && grading.studentMemberDocId && grading.level) {
    if (ctx.dryRun) {
      ctx.logger?.(`[DRY-RUN] Would award level "${grading.level}" to member ${grading.studentMemberDocId}`);
    } else {
      const studentRef = ctx.db.collection(FirestoreCollection.Members).doc(grading.studentMemberDocId);
      const isAppLevel = grading.level.toLowerCase().startsWith('application');
      const memberPatch: Record<string, unknown> = {
        lastUpdated: FieldValue.serverTimestamp(),
      };
      if (isAppLevel) {
        memberPatch['applicationLevel'] = grading.level;
      } else {
        memberPatch['studentLevel'] = grading.level;
      }
      await studentRef.set(memberPatch, { merge: true });
      ctx.logger?.(`Awarded level "${grading.level}" to member ${grading.studentMemberDocId}`);
    }
  }

  return updateRes;
}

/**
 * Links a grading to an IlcEvent.
 */
export async function linkGradingToEvent(
  ctx: ActionContext,
  gradingDocId: string,
  eventDocId: string,
): Promise<ActionResult<Grading>> {
  const eventDoc = await ctx.db.collection(FirestoreCollection.Events).doc(eventDocId).get();
  if (!eventDoc.exists) {
    return { success: false, error: `Event "${eventDocId}" not found.` };
  }
  const event = firestoreDocToIlcEvent(eventDoc);

  const patch: Partial<Grading> = {
    gradingEventDocId: eventDocId,
    gradingEvent: event.title,
    gradingEventDate: event.start?.substring(0, 10) || '',
  };

  return updateGrading(ctx, gradingDocId, patch);
}

/**
 * Unlinks a grading from an event.
 */
export async function unlinkGradingFromEvent(
  ctx: ActionContext,
  gradingDocId: string,
): Promise<ActionResult<Grading>> {
  return updateGrading(ctx, gradingDocId, {
    gradingEventDocId: '',
  });
}

/**
 * Deletes a grading document.
 */
export async function deleteGrading(
  ctx: ActionContext,
  gradingDocId: string,
): Promise<ActionResult<void>> {
  const grading = await getGrading(ctx, gradingDocId);
  if (!grading) {
    return { success: false, error: `Grading "${gradingDocId}" not found.` };
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Deleted grading ${gradingDocId}`);
    return { success: true, dryRun: true };
  }

  await ctx.db.collection(FirestoreCollection.Gradings).doc(gradingDocId).delete();
  ctx.logger?.(`Deleted grading ${gradingDocId}`);

  return { success: true };
}
