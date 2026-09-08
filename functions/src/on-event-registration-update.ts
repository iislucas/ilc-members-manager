/* on-event-registration-update.ts
 *
 * Firestore trigger that fires when a registration in /events/{eventId}/registrations/{registrationId}
 * is created, updated, or deleted. Automatically updates inPersonRegistrationsCount on both the
 * IlcEvent document and any associated Product document.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { AttendanceType, EventRegistrationStatus } from './data-model/events';

export const onEventRegistrationWritten = onDocumentWritten(
  '/events/{eventId}/registrations/{registrationId}',
  async (event) => {
    const eventId = event.params.eventId;
    if (!eventId) return;

    const db = admin.firestore();
    try {
      const regsSnap = await db
        .collection('events')
        .doc(eventId)
        .collection('registrations')
        .get();

      let inPersonCount = 0;
      regsSnap.forEach((doc) => {
        const data = doc.data();
        const status = data['status'];
        const attendance = data['attendance'];

        if (
          status === EventRegistrationStatus.Cancelled ||
          status === EventRegistrationStatus.Refunded
        ) {
          return;
        }

        if (
          attendance === AttendanceType.InPerson ||
          attendance === AttendanceType.InPersonAndOnline
        ) {
          inPersonCount++;
        }
      });

      const eventRef = db.collection('events').doc(eventId);
      const eventDoc = await eventRef.get();
      if (!eventDoc.exists) return;

      const eventData = eventDoc.data() || {};
      const productId = eventData['productId'] as string | undefined;

      const batch = db.batch();
      batch.update(eventRef, {
        inPersonRegistrationsCount: inPersonCount,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (productId) {
        const prodRef = db.collection('products').doc(productId);
        const prodDoc = await prodRef.get();
        if (prodDoc.exists) {
          batch.update(prodRef, {
            inPersonRegistrationsCount: inPersonCount,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      await batch.commit();
      logger.info(`Updated inPersonRegistrationsCount to ${inPersonCount} for event ${eventId}`);
    } catch (err) {
      logger.error(`Error updating inPersonRegistrationsCount for event ${eventId}:`, err);
    }
  },
);
