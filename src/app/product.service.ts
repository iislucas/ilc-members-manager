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
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { FIREBASE_APP } from './app.config';
import {
  EventRegistration,
  firestoreDocToEventRegistration,
  firestoreDocToProduct,
  initProduct,
  Product,
} from '../../functions/src/data-model';

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
          lastUpdated: new Date().toISOString(),
        };
        if (product.onlineJoiningLink !== undefined) {
          updates['onlineJoiningLink'] = product.onlineJoiningLink;
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
    email?: string,
  ): Promise<EventRegistration | undefined> {
    if (!eventId || (!memberDocId && !email)) return undefined;
    try {
      const regsCol = collection(this.db, 'events', eventId, 'registrations');
      if (memberDocId) {
        const q = query(regsCol, where('memberDocId', '==', memberDocId));
        const snap = await getDocs(q);
        if (!snap.empty) {
          return firestoreDocToEventRegistration(snap.docs[0]);
        }
      }
      if (email) {
        const q = query(regsCol, where('email', '==', email.toLowerCase().trim()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          return firestoreDocToEventRegistration(snap.docs[0]);
        }
      }
      return undefined;
    } catch (err) {
      console.error('Error checking user registration:', err);
      return undefined;
    }
  }
}
