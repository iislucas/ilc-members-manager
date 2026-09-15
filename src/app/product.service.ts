/* product.service.ts
 *
 * Client data service for managing /products and event registrations.
 * Follows the standalone, signal-friendly pattern with direct Firestore calls.
 */

import { inject, Injectable } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { FIREBASE_APP } from './app.config';
import { EventRegistration, firestoreDocToEventRegistration, firestoreDocToProduct, initProduct, Product } from '../../functions/src/data-model/events';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);

  /** Retrieve a single product by ID. */
  async getProduct(productId: string): Promise<Product | undefined> {
    if (!productId) return undefined;
    try {
      const snap = await getDoc(doc(this.db, 'products', productId));
      if (!snap.exists()) return undefined;
      return firestoreDocToProduct(snap);
    } catch (err) {
      console.error('Error loading product:', err);
      return undefined;
    }
  }

  /** Retrieve product linked to a specific event ID. */
  async getProductByEventId(eventId: string): Promise<Product | undefined> {
    if (!eventId) return undefined;
    try {
      const q = query(collection(this.db, 'products'), where('eventDocId', '==', eventId));
      const snap = await getDocs(q);
      if (snap.empty) return undefined;
      return firestoreDocToProduct(snap.docs[0]);
    } catch (err) {
      console.error('Error loading product by event ID:', err);
      return undefined;
    }
  }

  /** Retrieve all products. */
  async getAllProducts(): Promise<Product[]> {
    try {
      const snap = await getDocs(collection(this.db, 'products'));
      return snap.docs.map((d) => firestoreDocToProduct(d));
    } catch (err) {
      console.error('Error loading products list:', err);
      return [];
    }
  }

  /** Save (create or update) a product. */
  async saveProduct(product: Product): Promise<string> {
    const productsCol = collection(this.db, 'products');
    const targetDoc = product.docId ? doc(productsCol, product.docId) : doc(productsCol);
    const docId = targetDoc.id;

    const dataToSave: Product = {
      ...product,
      docId,
      lastUpdated: new Date().toISOString(),
    };
    if (!dataToSave.createdAt) {
      dataToSave.createdAt = new Date().toISOString();
    }

    // Never store docId inside Firestore payload
    const { docId: _, ...docPayload } = dataToSave;
    await setDoc(targetDoc, docPayload);

    // If linked to an event, sync event with product reference & delivery resources
    if (product.eventDocId) {
      try {
        const updates: Record<string, unknown> = {
          productId: docId,
          lastUpdated: serverTimestamp(),
        };
        if (product.onlineJoiningLink !== undefined) {
          updates['onlineJoiningLink'] = product.onlineJoiningLink;
        }
        if (product.purchaseDetailsMarkdown !== undefined) {
          updates['purchaseDetailsMarkdown'] = product.purchaseDetailsMarkdown;
        }
        if (product.inPersonDetailsMarkdown !== undefined) {
          updates['inPersonDetailsMarkdown'] = product.inPersonDetailsMarkdown;
        }
        if (product.recordedVideoId !== undefined) {
          updates['recordedVideoId'] = product.recordedVideoId;
        }
        if (product.recordedVideoUrl !== undefined) {
          updates['recordedVideoUrl'] = product.recordedVideoUrl;
        }
        await updateDoc(doc(this.db, 'events', product.eventDocId), updates);
      } catch (err) {
        console.warn('Could not sync event doc on product save:', err);
      }
    }

    return docId;
  }

  /** Delete a product. */
  async deleteProduct(productId: string): Promise<void> {
    if (!productId) return;
    await deleteDoc(doc(this.db, 'products', productId));
  }

  /** Fetch all registrations for a given event. */
  async getEventRegistrations(eventId: string): Promise<EventRegistration[]> {
    if (!eventId) return [];
    try {
      const regsCol = collection(this.db, 'events', eventId, 'registrations');
      const snap = await getDocs(regsCol);
      return snap.docs.map((d) => firestoreDocToEventRegistration(d));
    } catch (err) {
      console.error('Error loading event registrations:', err);
      return [];
    }
  }

  /** Check if a given user has registered for an event. */
  async getUserRegistrationForEvent(
    eventId: string,
    memberDocId?: string,
    emailOrEmails?: string | string[],
  ): Promise<EventRegistration | undefined> {
    if (!eventId) return undefined;

    const emails: string[] = Array.from(
      new Set(
        (
          Array.isArray(emailOrEmails)
            ? emailOrEmails
            : emailOrEmails
              ? [emailOrEmails]
              : []
        )
          .filter(Boolean)
          .flatMap((e) => [e.trim(), e.trim().toLowerCase()]),
      ),
    );

    if (!memberDocId && emails.length === 0) return undefined;

    // 1. If memberDocId is available, first check the member's own registrations subcollection
    // (This query is directly authorized by Firestore rules for the logged-in member)
    if (memberDocId) {
      try {
        const memberRegsCol = collection(
          this.db,
          'members',
          memberDocId,
          'registrations',
        );
        const q = query(memberRegsCol, where('eventDocId', '==', eventId));
        const snap = await getDocs(q);
        if (!snap.empty) {
          return firestoreDocToEventRegistration(snap.docs[0]);
        }
      } catch (err) {
        console.warn('Could not query member registrations subcollection:', err);
      }
    }

    const eventRegsCol = collection(this.db, 'events', eventId, 'registrations');

    // 2. Try querying event's registrations subcollection by memberDocId
    if (memberDocId) {
      try {
        const q = query(eventRegsCol, where('memberDocId', '==', memberDocId));
        const snap = await getDocs(q);
        if (!snap.empty) {
          return firestoreDocToEventRegistration(snap.docs[0]);
        }
      } catch (err) {
        console.warn('Could not query event registrations by memberDocId:', err);
      }
    }

    // 3. Try querying event's registrations subcollection by each provided email
    for (const email of emails) {
      try {
        const q = query(eventRegsCol, where('email', '==', email));
        const snap = await getDocs(q);
        if (!snap.empty) {
          return firestoreDocToEventRegistration(snap.docs[0]);
        }
      } catch (err) {
        console.warn(`Could not query event registrations for email ${email}:`, err);
      }
    }

    return undefined;
  }
}
