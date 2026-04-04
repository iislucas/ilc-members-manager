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
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
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
      .where('ownerEmail', '==', request.auth.token.email)
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
      ownerEmail: request.auth.token.email,
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
  for (const docId of currentTargets) {
    await admin.firestore()
      .collection('members')
      .doc(docId)
      .collection('events')
      .doc(event.params.docId)
      .set(after);
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
  const eventDocId = snap.id;

  const allTargetDocIds = new Set([eventData.ownerDocId, ...(eventData.managerDocIds || [])].filter(Boolean));
  
  for (const docId of allTargetDocIds) {
    const ref = admin.firestore()
      .collection('members')
      .doc(docId)
      .collection('events')
      .doc(eventDocId);
    await ref.set(eventData);
    logger.info(`Mirrored event ${eventDocId} to member ${docId} subcollection.`);
  }
});
