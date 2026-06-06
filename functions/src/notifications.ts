/*
Shared helper for writing member notifications.

Member notifications live at /members/{memberDocId}/notifications/{id} and are
streamed to the client by NotificationService. This helper centralises the
"create a notification" logic (including entity-based de-duplication) so it can
be reused by Firestore triggers (e.g. grading updates) and the order-processing
pipeline.
*/

import * as admin from 'firebase-admin';
import { MemberNotification } from './data-model';

// Fields on a notification's `data` that uniquely identify the entity it
// relates to. When a new notification carries one of these, any existing
// notifications (read or unread) for the same member + entity are removed
// first, so a given entity is only ever represented by one notification.
const DEDUP_FIELDS = ['gradingDocId', 'eventId', 'orderId'] as const;

// Creates a notification document in the member's notifications subcollection.
// If the notification's data carries a known entity key (see DEDUP_FIELDS),
// existing notifications for that same entity are deleted first.
export async function createMemberNotification(
  db: admin.firestore.Firestore,
  memberDocId: string,
  notification: Omit<MemberNotification, 'docId'>,
): Promise<void> {
  const notifications = db
    .collection('members')
    .doc(memberDocId)
    .collection('notifications');

  // Generalised de-duplication keyed on the entity the notification is about.
  const data = notification.data as unknown as Record<string, unknown> | undefined;
  if (data) {
    for (const field of DEDUP_FIELDS) {
      const value = data[field];
      if (!value) continue;
      const snap = await notifications.where(`data.${field}`, '==', value).get();
      if (!snap.empty) {
        const batch = db.batch();
        for (const doc of snap.docs) {
          batch.delete(doc.ref);
        }
        await batch.commit();
      }
      break; // a notification relates to a single entity; first match wins
    }
  }

  const ref = notifications.doc(); // auto-generated ID
  await ref.set({ ...notification, docId: ref.id } as MemberNotification);
}
