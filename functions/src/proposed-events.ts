/* proposed-events.ts
 *
 * Firebase Cloud Functions to manage event proposals and sync.
 *
 * Members can submit event proposals which go into /events with
 * status='proposed'. Admins can then approve (set status='listed')
 * via the client-side UI. A Firestore trigger syncs newly-listed
 * events to Google Calendar (if a service account is configured).
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { IlcEvent, EventStatus, EventSourceKind, MembershipType, Member, initEvent } from './data-model';
import { getMemberByEmail, allowedOrigins } from './common';
import axios from 'axios';
import { environment } from './environment/environment';
import { contentChanged } from './content-cache';

export function validateProposal(member: Member, data: Record<string, unknown>): string | null {
  if (!member.memberId || member.memberId.trim() === '') {
    return 'Must have a valid Member ID to propose events.';
  }

  const today = new Date().toISOString().split('T')[0];
  const isLife = member.membershipType === MembershipType.Life;
  const isExpired = !isLife && (!member.currentMembershipExpires || member.currentMembershipExpires < today);

  if (isExpired) {
    return 'Must have an active membership to propose events.';
  }

  if (!data.title || !data.start || !data.end) {
    return 'Title, start, and end dates are required.';
  }

  return null;
}

// Submit a new event proposal — writes directly to /events with status='proposed'.
export const submitProposedEvent = onCall(
  { cors: allowedOrigins },
  async (request: CallableRequest<{ title: string; start: string; end: string; description?: string; location?: string; leadingInstructorId?: string }>) => {
    if (!request.auth || !request.auth.token.email) {
      throw new HttpsError('unauthenticated', 'Must be authenticated to propose events.');
    }

    const db = admin.firestore();
    const member = await getMemberByEmail(request.auth.token.email, db);

    const error = validateProposal(member, request.data as unknown as Record<string, unknown>);
    if (error) {
      throw new HttpsError('permission-denied', error);
    }

    // Check limit of 3 proposed events
    const proposedEventsQuery = await db.collection('events')
      .where('ownerEmails', 'array-contains', request.auth.token.email)
      .where('status', '==', EventStatus.Proposed)
      .get();
    
    if (proposedEventsQuery.size >= 3) {
      throw new HttpsError('permission-denied', 'You have already reached the limit of 3 proposed events.');
    }

    const data = request.data;
    const event: Omit<IlcEvent, 'docId'> = {
      ...initEvent(),
      title: data.title,
      start: data.start,
      end: data.end,
      description: data.description || '',
      location: data.location || '',
      status: EventStatus.Proposed,
      kind: EventSourceKind.FirebaseSourced,
      createdAt: new Date().toISOString(),
      ownerDocId: member.docId,
      ownerEmails: member.emails && member.emails.length > 0 ? member.emails : [request.auth.token.email],
      leadingInstructorId: data.leadingInstructorId || '',
    };

    const docRef = await db.collection('events').add(event);
    logger.info(`Event proposal submitted by ${member.memberId} with docId ${docRef.id}`);
    return { success: true, docId: docRef.id };
  }
);

// Trigger: when an event in /events is updated, sync to Google Calendar
// if it became 'listed' or was updated while 'listed'.
export const onEventUpdated = onDocumentUpdated('/events/{docId}', async (event) => {
  if (!event.data) return;

  const before = event.data.before.data() as IlcEvent;
  const after = event.data.after.data() as IlcEvent;

  if (!before || !after) return;

  // Resolve emails if missing or if owner/managers changed
  const db = admin.firestore();
  
  const ownerDoc = await db.collection('members').doc(after.ownerDocId).get();
  const ownerEmails = ownerDoc.data()?.emails || [];

  const managerEmails: string[] = [];
  for (const id of (after.managerDocIds || [])) {
    const mgrDoc = await db.collection('members').doc(id).get();
    const emails = mgrDoc.data()?.emails || [];
    managerEmails.push(...emails);
  }

  const ownerEmailsChanged = JSON.stringify(ownerEmails) !== JSON.stringify(after.ownerEmails || []);
  const managerEmailsChanged = JSON.stringify(managerEmails) !== JSON.stringify(after.managerEmails || []);

  if (ownerEmailsChanged || managerEmailsChanged) {
    logger.info(`Updating emails for event ${event.params.docId}.`);
    await event.data.after.ref.update({
      ownerEmails,
      managerEmails
    });
    return; // Let the next trigger handle mirroring
  }

  // Mirror to member subcollections for owner and managers
  const previousTargets = new Set([before.ownerDocId, ...(before.managerDocIds || [])].filter(Boolean));
  const currentTargets = new Set([after.ownerDocId, ...(after.managerDocIds || [])].filter(Boolean));

  // Remove from targets no longer associated
  for (const docId of previousTargets) {
    if (!currentTargets.has(docId)) {
      await admin.firestore()
        .collection('members')
        .doc(docId)
        .collection('events')
        .doc(event.params.docId)
        .delete();
      logger.info(`Removed mirrored event ${event.params.docId} from member ${docId} subcollection.`);
    }
  }

  // Update/Add to all current targets
  // Destructuring extracts ownerEmails and managerEmails to ignore them (renaming to _ and __ to avoid
  // collision with variables in scope). The rest operator (...) puts the remaining fields in eventToMirror.
  const { ownerEmails: _, managerEmails: __, ...eventToMirror } = after;

  for (const docId of currentTargets) {
    await admin.firestore()
      .collection('members')
      .doc(docId)
      .collection('events')
      .doc(event.params.docId)
      .set(eventToMirror);
    logger.info(`Updated mirrored event ${event.params.docId} for member ${docId} subcollection.`);
  }
  // Only sync firebase-sourced events (calendar-sourced events are managed by the calendar sync).
  if (after.kind === EventSourceKind.CalendarSourced) return;

  const becameListed = before.status !== EventStatus.Listed && after.status === EventStatus.Listed;
  const contentFieldsChanged = contentChanged(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>
  );
  const wasListedAndChanged = before.status === EventStatus.Listed && after.status === EventStatus.Listed && contentFieldsChanged;

  if (becameListed || wasListedAndChanged) {
    logger.info(`Syncing event ${event.params.docId} to Google Calendar.`);

    const calendarId = environment.googleCalendar.calendarId;
    let googleCalEventId = after.sourceId;

    try {
      const tokenResponse = await admin.credential.applicationDefault().getAccessToken();
      const accessToken = tokenResponse.access_token;

      if (accessToken && calendarId) {
        const calendarApiUrl = googleCalEventId
          ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleCalEventId)}`
          : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

        const gcalEvent = {
          summary: after.title,
          location: after.location,
          description: after.description,
          start: after.start.includes('T') ? { dateTime: after.start } : { date: after.start },
          end: after.end.includes('T') ? { dateTime: after.end } : { date: after.end },
        };

        const response = await (googleCalEventId
          ? axios.put(calendarApiUrl, gcalEvent, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } })
          : axios.post(calendarApiUrl, gcalEvent, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } })
        );

        if (!googleCalEventId) {
          googleCalEventId = response.data.id;
          logger.info(`Created Google Calendar event with ID: ${googleCalEventId}`);
          await event.data.after.ref.update({
            sourceId: googleCalEventId,
            googleCalEventLink: `https://www.google.com/calendar/event?eid=${googleCalEventId}`,
          });
        } else {
          logger.info(`Updated Google Calendar event with ID: ${googleCalEventId}`);
        }
      }
    } catch (err) {
      logger.error('Failed to write to Google Calendar.', err);
    }

    // Update lastUpdated timestamp
    await event.data.after.ref.update({ lastUpdated: new Date().toISOString() });
  }
});

export const onEventCreated = onDocumentCreated('/events/{docId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const eventData = snap.data() as IlcEvent;

  // Resolve emails for owner and managers
  const db = admin.firestore();
  
  const ownerDoc = await db.collection('members').doc(eventData.ownerDocId).get();
  const ownerEmails = ownerDoc.data()?.emails || [];

  const managerEmails: string[] = [];
  for (const id of (eventData.managerDocIds || [])) {
    const mgrDoc = await db.collection('members').doc(id).get();
    const emails = mgrDoc.data()?.emails || [];
    managerEmails.push(...emails);
  }

  logger.info(`Enriching event ${snap.id} with emails.`);
  await snap.ref.update({
    ownerEmails,
    managerEmails
  });
  // Mirroring will be handled by onEventUpdated when it triggers from this update.
});

export const onEventDeleted = onDocumentDeleted('/events/{docId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const eventData = snap.data() as IlcEvent;
  const eventDocId = snap.id;

  const allTargetDocIds = new Set([eventData.ownerDocId, ...(eventData.managerDocIds || [])].filter(Boolean));
  
  for (const docId of allTargetDocIds) {
    const ref = admin.firestore()
      .collection('members')
      .doc(docId)
      .collection('events')
      .doc(eventDocId);
    await ref.delete();
    logger.info(`Removed mirrored event ${eventDocId} from member ${docId} subcollection.`);
  }

  // Also remove from Google Calendar if it was listed
  if (eventData.status === EventStatus.Listed && eventData.sourceId) {
    const calendarId = environment.googleCalendar.calendarId;
    const googleCalEventId = eventData.sourceId;
    try {
      const tokenResponse = await admin.credential.applicationDefault().getAccessToken();
      const accessToken = tokenResponse.access_token;
      if (accessToken && calendarId) {
        const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleCalEventId)}`;
        await axios.delete(calendarApiUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        logger.info(`Deleted Google Calendar event with ID: ${googleCalEventId}`);
      }
    } catch (err) {
      logger.error('Failed to delete from Google Calendar.', err);
    }
  }
});
