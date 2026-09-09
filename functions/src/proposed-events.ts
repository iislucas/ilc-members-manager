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
import {
  IlcEvent,
  EventStatus,
  EventDocument,
  EventContact,
  initEvent,
  initEventContact,
  contactFromCreator,
  EventRegistration,
  AttendanceType,
  SubmitProposedEventRequest,
} from './data-model/events';
import { FirestoreCollection, FirestoreSubcollection } from './data-model/collections';
import { Member } from './data-model/members';
import { NotificationKind } from './data-model/notifications';
import { VideoGrant, VideoGrantKind } from './data-model/vod';
import { getMemberByEmail, allowedOrigins, hasActiveMembership, recordTombstone } from './common';
import { createMemberNotification } from './notifications';
import { contentChanged } from './content-cache';

/**
 * Extracts the Cloud Storage file path from a Firebase Storage download URL.
 * URLs are like: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/ENCODED_PATH?alt=media&token=...
 * Returns the decoded path, or null if the URL doesn't match.
 */
function storagePathFromUrl(url: string): string | null {
  try {
    const match = url.match(/\/o\/([^?]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** Delete a list of Storage files by their download URLs. Logs errors but does not throw. */
async function deleteStorageFiles(urls: string[]) {
  if (urls.length === 0) return;
  const bucket = admin.storage().bucket();
  for (const url of urls) {
    const path = storagePathFromUrl(url);
    if (!path) {
      logger.warn(`Could not extract storage path from URL: ${url}`);
      continue;
    }
    try {
      await bucket.file(path).delete();
      logger.info(`Deleted storage file: ${path}`);
    } catch (err) {
      logger.warn(`Failed to delete storage file ${path}:`, err);
    }
  }
}

/**
 * Given a human-readable instructorId, find the member document that carries it
 * and return that member's Firestore doc ID (or undefined if none / empty id).
 */
async function findInstructorMemberDocId(
  db: admin.firestore.Firestore,
  instructorId: string,
): Promise<string | undefined> {
  if (!instructorId) return undefined;
  const snap = await db
    .collection(FirestoreCollection.Members)
    .where('instructorId', '==', instructorId)
    .limit(1)
    .get();
  return snap.empty ? undefined : snap.docs[0].id;
}

/**
 * The de-duplicated set of member doc IDs that make up an event's organising
 * team: the owner, every manager, and the leading instructor (resolved from
 * their human-readable instructorId to their member doc). Used to fan out the
 * "listing request submitted" and "now listed publicly" notifications.
 */
async function eventOrganiserDocIds(
  db: admin.firestore.Firestore,
  ownerDocId: string,
  managerDocIds: string[],
  leadingInstructorId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  if (ownerDocId) ids.add(ownerDocId);
  for (const id of managerDocIds || []) {
    if (id) ids.add(id);
  }
  const instructorDocId = await findInstructorMemberDocId(db, leadingInstructorId);
  if (instructorDocId) ids.add(instructorDocId);
  return [...ids];
}

/**
 * The manager doc IDs to store on a proposed event: the caller-supplied list
 * with empty entries removed and duplicates collapsed, excluding the creator/owner
 * (who automatically has full manager access).
 */
export function buildManagerDocIds(
  providedIds: string[] | undefined,
  ownerDocId?: string,
): string[] {
  const ids = (providedIds || []).filter(Boolean);
  const filtered = ownerDocId ? ids.filter((id) => id !== ownerDocId) : ids;
  return Array.from(new Set(filtered));
}

/** Loads member documents on demand, caching each doc ID's result. */
function memberLoader(db: admin.firestore.Firestore) {
  const cache = new Map<string, Member | undefined>();
  return async (docId: string): Promise<Member | undefined> => {
    if (!docId) return undefined;
    if (!cache.has(docId)) {
      const snap = await db.collection(FirestoreCollection.Members).doc(docId).get();
      cache.set(docId, snap.data() as Member | undefined);
    }
    return cache.get(docId);
  };
}

/**
 * The contacts to store on an event: every entry that still belongs to the
 * organising team (the creator or a manager), de-duplicated and with its cached
 * display fields refreshed from the member document. Membership of the list is
 * the "listed publicly" flag, so the pruning here is what drops a removed
 * manager from the public page. The editor owns the ordering and the opt-in
 * contactEmail/contactUrl, so those are preserved exactly as typed.
 */
export async function resolveEventContacts(
  contacts: EventContact[] | undefined,
  ownerDocId: string,
  managerDocIds: string[],
  loadMember: (docId: string) => Promise<Member | undefined>,
): Promise<EventContact[]> {
  const allowed = new Set([ownerDocId, ...(managerDocIds || [])].filter(Boolean));
  const resolved: EventContact[] = [];
  const seen = new Set<string>();
  for (const contact of contacts || []) {
    const docId = contact?.memberDocId || '';
    if (!docId || !allowed.has(docId) || seen.has(docId)) continue;
    seen.add(docId);
    const member = await loadMember(docId);
    resolved.push({
      ...initEventContact(),
      ...contact,
      // A typed-in display name wins; identifiers always follow the member doc
      // so that e.g. losing an instructorId also drops the instructor link.
      name: contact.name || member?.name || '',
      memberId: member ? member.memberId || '' : contact.memberId || '',
      instructorId: member ? member.instructorId || '' : contact.instructorId || '',
    });
  }
  return resolved;
}

/** Order-sensitive but key-order-independent comparison of two contact lists. */
export function sameContacts(a: EventContact[], b: EventContact[]): boolean {
  const norm = (list: EventContact[]) =>
    JSON.stringify(list.map((c) => {
      const entry = c as unknown as Record<string, unknown>;
      return Object.keys(entry).sort().map((k) => [k, entry[k]]);
    }));
  return norm(a) === norm(b);
}

export function validateProposal(member: Member, data: Record<string, unknown>): string | null {
  if (!member.memberId || member.memberId.trim() === '') {
    return 'Must have a valid Member ID to propose events.';
  }

  if (!hasActiveMembership(member)) {
    return 'Must have an active membership to propose events.';
  }

  if (!data.title || !data.start || !data.end) {
    return 'Title, start, and end dates are required.';
  }

  return null;
}

/**
 * Validates the requested initial status for an event proposal.
 * - Non-admins may only create 'proposed' or 'draft' events.
 * - Only admins can directly create 'unlisted', 'listed', or other statuses.
 */
export function validateProposalStatus(
  requestedStatus: EventStatus | undefined,
  isAdmin: boolean,
): { status: EventStatus; error?: string } {
  if (!requestedStatus || requestedStatus === EventStatus.Proposed) {
    return { status: EventStatus.Proposed };
  }
  if (requestedStatus === EventStatus.Draft) {
    return { status: EventStatus.Draft };
  }
  if (!isAdmin) {
    return {
      status: EventStatus.Proposed,
      error: 'Only admins can create unlisted or listed events directly.',
    };
  }
  if (Object.values(EventStatus).includes(requestedStatus)) {
    return { status: requestedStatus };
  }
  return { status: EventStatus.Proposed };
}

// Submit a new event proposal — writes directly to /events.
export const submitProposedEvent = onCall(
  { cors: allowedOrigins },
  async (request: CallableRequest<SubmitProposedEventRequest>) => {
    if (!request.auth || !request.auth.token.email) {
      throw new HttpsError('unauthenticated', 'Must be authenticated to propose events.');
    }

    const db = admin.firestore();
    const member = await getMemberByEmail(request.auth.token.email, db);

    const error = validateProposal(member, request.data as unknown as Record<string, unknown>);
    if (error) {
      throw new HttpsError('permission-denied', error);
    }

    const data = request.data;
    const statusValidation = validateProposalStatus(data.status, !!member.isAdmin);
    if (statusValidation.error) {
      throw new HttpsError('permission-denied', statusValidation.error);
    }
    const finalStatus = statusValidation.status;

    // Check limit of 3 proposed events only if submitting a proposed event.
    // Counted via managerEmails (the submitter is always a manager) so the limit
    // still applies when the submitter hands ownership of the event to someone else.
    if (finalStatus === EventStatus.Proposed) {
      const proposedEventsQuery = await db.collection(FirestoreCollection.Events)
        .where('managerEmails', 'array-contains', request.auth.token.email)
        .where('status', '==', EventStatus.Proposed)
        .get();

      if (proposedEventsQuery.size >= 3) {
        throw new HttpsError('permission-denied', 'You have already reached the limit of 3 proposed events.');
      }
    }

    // Owner defaults to the submitter. The creator automatically has manager
    // access and does not need to be in managerDocIds.
    // ownerEmails/managerEmails are resolved from these doc IDs by the onEventCreated trigger.
    const ownerDocId = data.ownerDocId || member.docId;
    const managerDocIds = buildManagerDocIds(data.managerDocIds, ownerDocId);

    // Cache the owner's identity + optional inline mini-profile so a non-instructor
    // owner displays without depending on an instructorId. The mini-profile contact
    // fields only apply when the submitter keeps ownership; reassigning to another
    // instructor caches that instructor's identity instead.
    let ownerName = '';
    let ownerMemberId = '';
    let ownerInstructorId = '';
    let ownerContactEmail = '';
    let ownerContactUrl = '';
    if (ownerDocId === member.docId) {
      ownerName = (data.ownerContactName || member.name || '').trim();
      ownerMemberId = member.memberId || '';
      ownerInstructorId = member.instructorId || '';
      ownerContactEmail = (data.ownerContactEmail || '').trim();
      ownerContactUrl = (data.ownerContactUrl || '').trim();
    } else {
      const ownerDoc = await db.collection(FirestoreCollection.Members).doc(ownerDocId).get();
      const ownerMember = ownerDoc.data() as Member | undefined;
      if (ownerMember) {
        ownerName = ownerMember.name || '';
        ownerMemberId = ownerMember.memberId || '';
        ownerInstructorId = ownerMember.instructorId || '';
      }
    }

    // Who is listed publicly as a contact. The creator is a contact by default;
    // the form may also tick managers, whose display fields are resolved from
    // their member documents (no email/link — those are typed in the editor).
    const creatorContact = contactFromCreator({
      ownerDocId, ownerName, ownerMemberId, ownerInstructorId, ownerContactEmail, ownerContactUrl,
    });
    const requestedContactDocIds = (data.contactDocIds || []).filter(Boolean);
    const contacts = await resolveEventContacts(
      requestedContactDocIds.length > 0
        ? requestedContactDocIds.map((memberDocId) =>
          memberDocId === ownerDocId && creatorContact
            ? creatorContact
            : { ...initEventContact(), memberDocId })
        : creatorContact ? [creatorContact] : [],
      ownerDocId,
      managerDocIds,
      memberLoader(db),
    );

    const event: Omit<IlcEvent, 'docId'> = {
      ...initEvent(),
      title: data.title,
      start: data.start,
      end: data.end,
      description: data.description || '',
      location: data.location || '',
      status: finalStatus,
      createdAt: new Date().toISOString(),
      ownerDocId,
      managerDocIds,
      ownerName,
      ownerMemberId,
      ownerInstructorId,
      ownerContactEmail,
      ownerContactUrl,
      contacts,
      leadingInstructorId: data.leadingInstructorId || '',
      productId: data.productId || '',
      onlineJoiningLink: data.onlineJoiningLink || '',
      purchaseDetailsMarkdown: data.purchaseDetailsMarkdown || '',
      inPersonDetailsMarkdown: data.inPersonDetailsMarkdown || '',
      recordedVideoId: data.recordedVideoId || '',
      recordedVideoUrl: data.recordedVideoUrl || '',
    };

    const docRef = await db.collection(FirestoreCollection.Events).add(event);
    logger.info(`Event ${finalStatus} created by ${member.memberId} with docId ${docRef.id}`);

    // If an online registration product was configured, link it to the newly created event
    if (data.productId) {
      try {
        await db.collection(FirestoreCollection.Products).doc(data.productId).update({
          eventDocId: docRef.id,
          lastUpdated: new Date().toISOString(),
        });
      } catch (prodErr) {
        logger.warn(`Failed to link product ${data.productId} to event ${docRef.id}:`, prodErr);
      }
    }

    // Notify the whole organising team (owner + managers + leading instructor)
    // ONLY when a proposal is submitted. Drafts, unlisted, and listed events do
    // NOT create proposal notifications.
    if (finalStatus === EventStatus.Proposed) {
      const submitterName = member.name || member.memberId || 'A member';
      const organiserDocIds = await eventOrganiserDocIds(
        db, ownerDocId, managerDocIds, event.leadingInstructorId,
      );
      for (const docId of organiserDocIds) {
        await createMemberNotification(db, docId, {
          markdown: `${submitterName} has submitted an event listing request for [${event.title}](/my-events/${docRef.id}).`,
          createdAt: new Date().toISOString(),
          dismissed: false,
          kind: NotificationKind.EventProposalSubmitted,
          data: { eventDocId: docRef.id, title: event.title, submitterName },
        });
      }
    }

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

  const db = admin.firestore();

  // Mirror to member subcollections for owner and managers.
  //
  // This MUST run on the same invocation that observes the membership change.
  // Resolving emails below can trigger a follow-up write (to persist
  // ownerEmails/managerEmails) whose before/after no longer reflect the
  // owner/manager change — so deferring the mirror to that follow-up would
  // leave a removed member's stale copy orphaned in their subcollection.
  const previousTargets = new Set([before.ownerDocId, ...(before.managerDocIds || [])].filter(Boolean));
  const currentTargets = new Set([after.ownerDocId, ...(after.managerDocIds || [])].filter(Boolean));

  // Remove from targets no longer associated
  for (const docId of previousTargets) {
    if (!currentTargets.has(docId)) {
      await db
        .collection(FirestoreCollection.Members)
        .doc(docId)
        .collection(FirestoreSubcollection.Events)
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
    await db
      .collection(FirestoreCollection.Members)
      .doc(docId)
      .collection(FirestoreSubcollection.Events)
      .doc(event.params.docId)
      .set(eventToMirror);
    logger.info(`Updated mirrored event ${event.params.docId} for member ${docId} subcollection.`);
  }

  // Resolve emails if missing or if owner/managers changed. Done after
  // mirroring (above) so a membership change is never lost.
  const loadMember = memberLoader(db);
  const ownerEmails = (await loadMember(after.ownerDocId))?.emails || [];

  const managerEmails: string[] = [];
  for (const id of (after.managerDocIds || [])) {
    managerEmails.push(...((await loadMember(id))?.emails || []));
  }

  // Drop contacts who are no longer on the organising team and refresh the
  // display fields cached for the public event page.
  const contacts = await resolveEventContacts(
    after.contacts, after.ownerDocId, after.managerDocIds || [], loadMember,
  );

  // Compare as order-independent multisets: the stored and freshly-derived
  // lists hold the same emails but their order depends on the member email
  // array / managerDocIds ordering, which can change without the set changing.
  // Sorting copies avoids spurious email rewrites (and an extra trigger cycle).
  const sameEmails = (a: string[], b: string[]) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const ownerEmailsChanged = !sameEmails(ownerEmails, after.ownerEmails || []);
  const managerEmailsChanged = !sameEmails(managerEmails, after.managerEmails || []);
  // Contacts are an ordered list, so compare position by position — but with
  // each entry's keys sorted, since the field order Firestore returns need not
  // match the order the objects are built in (a mismatch there would rewrite
  // the document on every trigger, looping forever).
  const contactsChanged = !sameContacts(contacts, after.contacts || []);

  if (ownerEmailsChanged || managerEmailsChanged || contactsChanged) {
    logger.info(`Updating derived owner/manager/contact fields for event ${event.params.docId}.`);
    await event.data.after.ref.update({
      ownerEmails,
      managerEmails,
      contacts
    });
    return; // Let the follow-up trigger handle Google Calendar sync.
  }

  // Clean up Storage files for documents that were removed.
  const beforeDocs: EventDocument[] = before.documents || [];
  const afterDocs: EventDocument[] = after.documents || [];
  const afterUrls = new Set(afterDocs.map(d => d.url));
  const removedUrls = beforeDocs.map(d => d.url).filter(url => !afterUrls.has(url));
  if (removedUrls.length > 0) {
    logger.info(`Cleaning up ${removedUrls.length} removed document(s) for event ${event.params.docId}.`);
    await deleteStorageFiles(removedUrls);
  }
  const becameListed = before.status !== EventStatus.Listed && after.status === EventStatus.Listed;
  const contentFieldsChanged = contentChanged(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>
  );
  const wasListedAndChanged = before.status === EventStatus.Listed && after.status === EventStatus.Listed && contentFieldsChanged;

  // When the event first becomes publicly listed, tell the organising team
  // (owner + managers + leading instructor) it is live, with a shareable URL.
  // Dedups on eventId (NewEventPosted), so a re-trigger won't duplicate it.
  if (becameListed) {
    const title = after.title || 'your event';
    const shareUrl = `https://app.iliqchuan.com/events/${event.params.docId}`;
    const organiserDocIds = await eventOrganiserDocIds(
      db, after.ownerDocId, after.managerDocIds || [], after.leadingInstructorId,
    );
    for (const docId of organiserDocIds) {
      await createMemberNotification(db, docId, {
        markdown: `Event [${title}](/events/${event.params.docId}) is now listed publicly. Share it: ${shareUrl}`,
        createdAt: new Date().toISOString(),
        dismissed: false,
        kind: NotificationKind.NewEventPosted,
        data: { eventId: event.params.docId, title },
      });
    }
  }

  // Check if video recording became available
  const hadVideoBefore = Boolean(before.recordedVideoId || before.recordedVideoUrl);
  const hasVideoNow = Boolean(after.recordedVideoId || after.recordedVideoUrl);

  if (!hadVideoBefore && hasVideoNow) {
    logger.info('Event video recording became available; provisioning grants and notifications', {
      eventId: event.params.docId,
      recordedVideoId: after.recordedVideoId,
      recordedVideoUrl: after.recordedVideoUrl,
    });

    try {
      const regSnap = await db
        .collection(FirestoreCollection.Events)
        .doc(event.params.docId)
        .collection(FirestoreSubcollection.Registrations)
        .where('hasVideoAccess', '==', true)
        .get();

      for (const regDoc of regSnap.docs) {
        const reg = regDoc.data() as EventRegistration;
        const memberDocId = reg.memberDocId;
        if (!memberDocId) continue;

        if (after.recordedVideoId) {
          const grant: VideoGrant = {
            docId: after.recordedVideoId,
            videoId: after.recordedVideoId,
            memberDocId,
            memberEmail: reg.email,
            grantKind: VideoGrantKind.StripePurchase,
            orderDocId: reg.orderDocId,
            stripeSessionId: reg.stripeSessionId,
            amountPaidCents: reg.amountPaidCents,
            grantedAt: new Date().toISOString(),
          };
          await db
            .collection(FirestoreCollection.Members)
            .doc(memberDocId)
            .collection(FirestoreSubcollection.VideoGrants)
            .doc(after.recordedVideoId)
            .set(grant);
          await db
            .collection(FirestoreCollection.VideoGrants)
            .doc(`${memberDocId}_${after.recordedVideoId}`)
            .set(grant);
        }

        const watchLink = after.recordedVideoId
          ? `/videos/${encodeURIComponent(after.recordedVideoId)}`
          : (after.recordedVideoUrl || `/events/${encodeURIComponent(event.params.docId)}`);
        const eventTitle = after.title || 'Event';
        const message = `The video recording for **[${eventTitle}](/events/${event.params.docId})** is now ready! You can [watch it now](${watchLink}).`;

        await createMemberNotification(db, memberDocId, {
          kind: NotificationKind.EventVideoAvailable,
          markdown: message,
          createdAt: new Date().toISOString(),
          dismissed: false,
          data: {
            eventId: event.params.docId,
            videoId: after.recordedVideoId || '',
            videoUrl: after.recordedVideoUrl || '',
          },
        });
      }
    } catch (err) {
      logger.error('Failed to notify attendees of new event video recording', {
        err,
        eventId: event.params.docId,
      });
    }
  }

  // Check if online joining details were newly added
  const joiningDetailsAdded = (!before.purchaseDetailsMarkdown && after.purchaseDetailsMarkdown) ||
    (!before.onlineJoiningLink && after.onlineJoiningLink);
  if (joiningDetailsAdded) {
    logger.info('Online joining details added for event; notifying online attendees', {
      eventId: event.params.docId,
      link: after.onlineJoiningLink,
      hasMarkdown: Boolean(after.purchaseDetailsMarkdown),
    });

    try {
      const onlineRegSnap = await db
        .collection(FirestoreCollection.Events)
        .doc(event.params.docId)
        .collection(FirestoreSubcollection.Registrations)
        .where('attendance', 'in', [AttendanceType.Online, AttendanceType.InPersonAndOnline])
        .get();

      for (const regDoc of onlineRegSnap.docs) {
        const reg = regDoc.data() as EventRegistration;
        const memberDocId = reg.memberDocId;
        if (!memberDocId) continue;
        const eventTitle = after.title || 'Event';
        let message = `Online attendance details for **[${eventTitle}](/events/${event.params.docId})** are now available.`;
        if (after.purchaseDetailsMarkdown) {
          message += `\n\n### Joining Details\n${after.purchaseDetailsMarkdown}\n\nYou can also find these details at any time on the [event page](/events/${event.params.docId}).`;
        } else if (after.onlineJoiningLink) {
          message += ` [Join Zoom Meeting](${after.onlineJoiningLink}).`;
        }
        await createMemberNotification(db, memberDocId, {
          kind: NotificationKind.EventRegistrationConfirmed,
          markdown: message,
          createdAt: new Date().toISOString(),
          dismissed: false,
          data: {
            eventId: event.params.docId,
            onlineJoiningLink: after.onlineJoiningLink || '',
            purchaseDetailsMarkdown: after.purchaseDetailsMarkdown || '',
          },
        });
      }
    } catch (err) {
      logger.error('Failed to notify online attendees of joining details', {
        err,
        eventId: event.params.docId,
      });
    }
  }

  // Check if in-person attendance instructions were newly added
  const inPersonDetailsAdded = !before.inPersonDetailsMarkdown && Boolean(after.inPersonDetailsMarkdown);
  if (inPersonDetailsAdded) {
    logger.info('In-person details added for event; notifying in-person attendees', {
      eventId: event.params.docId,
    });

    try {
      const inPersonRegSnap = await db
        .collection(FirestoreCollection.Events)
        .doc(event.params.docId)
        .collection(FirestoreSubcollection.Registrations)
        .where('attendance', 'in', [AttendanceType.InPerson, AttendanceType.InPersonAndOnline])
        .get();

      for (const regDoc of inPersonRegSnap.docs) {
        const reg = regDoc.data() as EventRegistration;
        const memberDocId = reg.memberDocId;
        if (!memberDocId) continue;
        const eventTitle = after.title || 'Event';
        let message = `In-person attendance instructions for **[${eventTitle}](/events/${event.params.docId})** are now available.`;
        if (after.inPersonDetailsMarkdown) {
          message += `\n\n### In-Person Instructions\n${after.inPersonDetailsMarkdown}\n\nYou can also find these details at any time on the [event page](/events/${event.params.docId}).`;
        }
        await createMemberNotification(db, memberDocId, {
          kind: NotificationKind.EventRegistrationConfirmed,
          markdown: message,
          createdAt: new Date().toISOString(),
          dismissed: false,
          data: {
            eventId: event.params.docId,
            inPersonDetailsMarkdown: after.inPersonDetailsMarkdown || '',
          },
        });
      }
    } catch (err) {
      logger.error('Failed to notify in-person attendees of attendance details', {
        err,
        eventId: event.params.docId,
      });
    }
  }

  if (becameListed || wasListedAndChanged) {
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
  
  const ownerDoc = await db.collection(FirestoreCollection.Members).doc(eventData.ownerDocId).get();
  const ownerEmails = ownerDoc.data()?.emails || [];

  const managerEmails: string[] = [];
  for (const id of (eventData.managerDocIds || [])) {
    const mgrDoc = await db.collection(FirestoreCollection.Members).doc(id).get();
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
      .collection(FirestoreCollection.Members)
      .doc(docId)
      .collection(FirestoreSubcollection.Events)
      .doc(eventDocId);
    await ref.delete();
    logger.info(`Removed mirrored event ${eventDocId} from member ${docId} subcollection.`);
  }

  // Delete all uploaded documents and images from Storage.
  const bucket = admin.storage().bucket();
  try {
    const [files] = await bucket.getFiles({ prefix: `events/${eventDocId}/` });
    if (files.length > 0) {
      await Promise.all(files.map(f => f.delete()));
      logger.info(`Deleted ${files.length} storage file(s) for event ${eventDocId}.`);
    }
  } catch (err) {
    logger.warn(`Failed to clean up storage for event ${eventDocId}:`, err);
  }

  await recordTombstone(admin.firestore(), FirestoreCollection.Events, eventDocId);
});
