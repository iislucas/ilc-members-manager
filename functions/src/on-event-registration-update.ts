/* on-event-registration-update.ts
 *
 * Firestore trigger that fires when a registration in /events/{eventId}/registrations/{registrationId}
 * is created, updated, or deleted. Reconciles both inPersonRegistrationsCount and named capacityCounts
 * on the IlcEvent document and any associated Product document.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import {
  AttendanceType,
  computeEffectiveCapacityUsage,
  EventCapacity,
  EventRegistration,
  EventRegistrationStatus,
  firestoreDocToIlcEvent,
  firestoreDocToEventRegistration,
  firestoreDocToProduct,
  normalizeCapacityMap,
} from './data-model/events';
import { FirestoreCollection, FirestoreSubcollection } from './data-model/collections';

function capacityMapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const normA = normalizeCapacityMap(a);
  const normB = normalizeCapacityMap(b);
  const keysA = Object.keys(normA);
  const keysB = Object.keys(normB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => normA[k] === normB[k]);
}

export const onEventRegistrationWritten = onDocumentWritten(
  '/events/{eventId}/registrations/{registrationId}',
  async (event) => {
    const eventId = event.params.eventId;
    if (!eventId) return;

    const db = admin.firestore();
    try {
      const eventRef = db.collection(FirestoreCollection.Events).doc(eventId);
      const eventDoc = await eventRef.get();
      if (!eventDoc.exists) return;

      const ilcEvent = firestoreDocToIlcEvent(eventDoc);
      const productId = ilcEvent.productId;

      let prodRef: FirebaseFirestore.DocumentReference | null = null;
      let prodExists = false;
      let prodCapacities: EventCapacity[] = [];
      let prodCurrentInPerson = 0;
      let prodCurrentCapacityCounts: Record<string, number> = {};

      if (productId) {
        prodRef = db.collection(FirestoreCollection.Products).doc(productId);
        const prodDoc = await prodRef.get();
        if (prodDoc.exists) {
          prodExists = true;
          const prod = firestoreDocToProduct(prodDoc);
          prodCapacities = prod.pricingRules.capacities;
          prodCurrentInPerson = prod.inPersonRegistrationsCount;
          prodCurrentCapacityCounts = prod.capacityCounts;
        }
      }

      const effectiveCapacities =
        ilcEvent.capacities.length > 0 ? ilcEvent.capacities : prodCapacities;

      const regsSnap = await db
        .collection(FirestoreCollection.Events)
        .doc(eventId)
        .collection(FirestoreSubcollection.Registrations)
        .get();

      let inPersonCount = 0;
      const talliedCapacityCounts: Record<string, number> = {};

      regsSnap.forEach((doc) => {
        const reg: EventRegistration = firestoreDocToEventRegistration(doc);

        if (
          reg.status === EventRegistrationStatus.Cancelled ||
          reg.status === EventRegistrationStatus.Refunded
        ) {
          return;
        }

        if (
          reg.attendance === AttendanceType.InPerson ||
          reg.attendance === AttendanceType.InPersonAndOnline
        ) {
          inPersonCount++;
        }

        const usage = computeEffectiveCapacityUsage(reg, effectiveCapacities);
        for (const [capId, units] of Object.entries(usage)) {
          if (units > 0) {
            talliedCapacityCounts[capId] = (talliedCapacityCounts[capId] || 0) + units;
          }
        }
      });

      const eventNeedsUpdate =
        ilcEvent.inPersonRegistrationsCount !== inPersonCount ||
        !capacityMapsEqual(ilcEvent.capacityCounts, talliedCapacityCounts);

      const prodNeedsUpdate =
        prodExists &&
        prodRef !== null &&
        (prodCurrentInPerson !== inPersonCount ||
          !capacityMapsEqual(prodCurrentCapacityCounts, talliedCapacityCounts));

      if (!eventNeedsUpdate && !prodNeedsUpdate) {
        return;
      }

      const batch = db.batch();
      if (eventNeedsUpdate) {
        batch.update(eventRef, {
          inPersonRegistrationsCount: inPersonCount,
          capacityCounts: talliedCapacityCounts,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      if (prodNeedsUpdate && prodRef) {
        batch.update(prodRef, {
          inPersonRegistrationsCount: inPersonCount,
          capacityCounts: talliedCapacityCounts,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();
      logger.info(`Reconciled registration counts for event ${eventId}`, {
        inPersonCount,
        capacityCounts: talliedCapacityCounts,
      });
    } catch (err) {
      logger.error(`Error reconciling registration counts for event ${eventId}:`, err);
    }
  },
);
