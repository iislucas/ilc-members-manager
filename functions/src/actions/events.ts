/* events.ts
 *
 * Event domain actions for creating, scheduling, managing, and listing
 * community events, workshops, and seminars.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreCollection } from '../data-model/collections';
import {
  IlcEvent,
  EventStatus,
  initEvent,
  firestoreDocToIlcEvent,
} from '../data-model/events';
import { firestoreDocToMember } from '../data-model/members';
import { ActionContext, ActionResult } from './types';

/** Parameters for creating a new event. */
export interface CreateEventInput {
  title: string;
  start: string; // ISO string or YYYY-MM-DD
  end?: string;
  location?: string;
  descriptionMarkdown?: string;
  status?: EventStatus;
  ownerDocId?: string;
  leadingInstructorId?: string;
  schoolId?: string;
  schoolDocId?: string;
  managerDocIds?: string[];
  maxInPersonAttendees?: number;
  onlineJoiningLink?: string;
  customDocId?: string;
}

/** Options for filtering/querying events. */
export interface EventListOptions {
  status?: EventStatus;
  startDate?: string;
  endDate?: string;
  ownerDocId?: string;
  leadingInstructorId?: string;
  schoolId?: string;
  searchTerm?: string;
  limitCount?: number;
}

/**
 * Retrieves an event by document ID.
 */
export async function getEvent(
  ctx: ActionContext,
  eventDocId: string,
): Promise<IlcEvent | null> {
  if (!eventDocId) return null;
  const docRef = ctx.db.collection(FirestoreCollection.Events).doc(eventDocId);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  return firestoreDocToIlcEvent(snap);
}

/**
 * Lists events matching query criteria.
 */
export async function listEvents(
  ctx: ActionContext,
  options?: EventListOptions,
): Promise<IlcEvent[]> {
  let q = ctx.db.collection(FirestoreCollection.Events).limit(options?.limitCount || 100);

  if (options?.status) {
    q = q.where('status', '==', options.status);
  }
  if (options?.ownerDocId) {
    q = q.where('ownerDocId', '==', options.ownerDocId);
  }
  if (options?.leadingInstructorId) {
    q = q.where('leadingInstructorId', '==', options.leadingInstructorId);
  }
  if (options?.schoolId) {
    q = q.where('schoolId', '==', options.schoolId);
  }
  if (options?.startDate) {
    q = q.where('start', '>=', options.startDate);
  }

  const snap = await q.get();
  let events = snap.docs.map(firestoreDocToIlcEvent);

  if (options?.endDate) {
    events = events.filter((e) => e.start <= options.endDate!);
  }

  if (options?.searchTerm) {
    const term = options.searchTerm.toLowerCase().trim();
    events = events.filter(
      (e) =>
        e.title.toLowerCase().includes(term) ||
        e.location.toLowerCase().includes(term) ||
        e.ownerName.toLowerCase().includes(term),
    );
  }

  events.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  return events;
}

/**
 * Creates a new event record with initialized defaults and owner resolution.
 */
export async function createEvent(
  ctx: ActionContext,
  input: CreateEventInput,
): Promise<ActionResult<IlcEvent>> {
  if (!input.title?.trim()) {
    return { success: false, error: 'Event title is required.' };
  }
  if (!input.start?.trim()) {
    return { success: false, error: 'Event start date/time is required.' };
  }

  const nowIso = new Date().toISOString();
  const defaults = initEvent();

  let ownerName = '';
  let ownerMemberId = '';
  let ownerInstructorId = '';
  let ownerEmails: string[] = [];

  if (input.ownerDocId) {
    const ownerSnap = await ctx.db.collection(FirestoreCollection.Members).doc(input.ownerDocId).get();
    if (ownerSnap.exists) {
      const owner = firestoreDocToMember(ownerSnap);
      ownerName = owner.name;
      ownerMemberId = owner.memberId;
      ownerInstructorId = String(owner.instructorId || '');
      ownerEmails = owner.emails || [];
    }
  }

  const newEvent: IlcEvent = {
    ...defaults,
    ...input,
    title: input.title.trim(),
    start: input.start.trim(),
    end: input.end?.trim() || input.start.trim(),
    status: input.status || (ctx.actor?.isAdmin ? EventStatus.Listed : EventStatus.Proposed),
    createdAt: nowIso,
    ownerDocId: input.ownerDocId || ctx.actor?.memberDocId || '',
    ownerName: ownerName || ctx.actor?.name || '',
    ownerMemberId: ownerMemberId || ctx.actor?.memberId || '',
    ownerInstructorId,
    ownerEmails,
    updatedByEmail: ctx.actor?.email || '',
    lastUpdated: nowIso,
  };

  const colRef = ctx.db.collection(FirestoreCollection.Events);
  const docRef = input.customDocId ? colRef.doc(input.customDocId) : colRef.doc();
  newEvent.docId = docRef.id;

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Created event "${newEvent.title}" (${newEvent.start}) at /events/${docRef.id}`);
    return { success: true, data: newEvent, dryRun: true };
  }

  const payload = {
    ...newEvent,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete (payload as { docId?: string }).docId;

  await docRef.set(payload);
  ctx.logger?.(`Created event "${newEvent.title}" with docId: ${docRef.id}`);

  return { success: true, data: newEvent };
}

/**
 * Updates an existing event document.
 */
export async function updateEvent(
  ctx: ActionContext,
  eventDocId: string,
  patch: Partial<IlcEvent>,
): Promise<ActionResult<IlcEvent>> {
  if (!eventDocId) {
    return { success: false, error: 'eventDocId is required.' };
  }

  const existing = await getEvent(ctx, eventDocId);
  if (!existing) {
    return { success: false, error: `Event "${eventDocId}" not found.` };
  }

  const updated: IlcEvent = {
    ...existing,
    ...patch,
    docId: eventDocId,
    lastUpdated: new Date().toISOString(),
  };

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Updated event ${eventDocId}:`, patch);
    return { success: true, data: updated, dryRun: true };
  }

  const docRef = ctx.db.collection(FirestoreCollection.Events).doc(eventDocId);
  const payload: Record<string, unknown> = {
    ...patch,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete payload['docId'];

  await docRef.set(payload, { merge: true });
  ctx.logger?.(`Updated event "${existing.title}" (${eventDocId})`);

  return { success: true, data: updated };
}

/**
 * Changes an event's publication or approval status.
 */
export async function setEventStatus(
  ctx: ActionContext,
  eventDocId: string,
  status: EventStatus,
): Promise<ActionResult<IlcEvent>> {
  return updateEvent(ctx, eventDocId, {
    status,
    updatedByEmail: ctx.actor?.email || '',
  });
}

/**
 * Adds a manager to an event.
 */
export async function addEventManager(
  ctx: ActionContext,
  eventDocId: string,
  memberDocId: string,
): Promise<ActionResult<IlcEvent>> {
  const event = await getEvent(ctx, eventDocId);
  if (!event) {
    return { success: false, error: `Event "${eventDocId}" not found.` };
  }

  if (event.managerDocIds.includes(memberDocId)) {
    return { success: true, data: event };
  }

  const updatedManagers = [...event.managerDocIds, memberDocId];
  return updateEvent(ctx, eventDocId, { managerDocIds: updatedManagers });
}

/**
 * Removes a manager from an event.
 */
export async function removeEventManager(
  ctx: ActionContext,
  eventDocId: string,
  memberDocId: string,
): Promise<ActionResult<IlcEvent>> {
  const event = await getEvent(ctx, eventDocId);
  if (!event) {
    return { success: false, error: `Event "${eventDocId}" not found.` };
  }

  const updatedManagers = event.managerDocIds.filter((id) => id !== memberDocId);
  return updateEvent(ctx, eventDocId, { managerDocIds: updatedManagers });
}

/**
 * Deletes an event document.
 */
export async function deleteEvent(
  ctx: ActionContext,
  eventDocId: string,
): Promise<ActionResult<void>> {
  const event = await getEvent(ctx, eventDocId);
  if (!event) {
    return { success: false, error: `Event "${eventDocId}" not found.` };
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Deleted event ${eventDocId} ("${event.title}")`);
    return { success: true, dryRun: true };
  }

  await ctx.db.collection(FirestoreCollection.Events).doc(eventDocId).delete();
  ctx.logger?.(`Deleted event "${event.title}" (${eventDocId})`);

  return { success: true };
}
