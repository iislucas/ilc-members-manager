/* product-draft.service.ts
 *
 * Hybrid local-first (IndexedDB) + admin-only cloud (/product_drafts) persistence
 * for work-in-progress Event Registration & Payment setups.
 *
 * Keeps unvalidated/partial edits out of publicly-readable /products/{productId}
 * while protecting HQ admins from losing complex pricing rule configurations.
 */

import { inject, Injectable } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { FIREBASE_APP } from './app.config';
import { IdbStorageService } from './idb-storage.service';
import { computeObjectDiff } from './object-diff';
import { FirestoreCollection } from '../../functions/src/data-model/collections';
import { normalizeEmail } from '../../functions/src/data-model/email';
import {
  firestoreDocToProductDraft,
  Product,
  ProductDraft,
  productDraftIdFor,
  syncProductSummaryFlagsFromRules,
} from '../../functions/src/data-model/events';

export const LOCAL_DRAFT_DEBOUNCE_MS = 400;
export const CLOUD_DRAFT_IDLE_MS = 10_000;
export const LOCAL_DRAFT_KEY_PREFIX = 'product_draft:';

export const PRODUCT_TRANSIENT_KEYS: ReadonlyArray<Extract<keyof Product, string>> = [
  'docId',
  'createdAt',
  'lastUpdated',
  'capacityCounts',
  'inPersonRegistrationsCount',
];

export enum ReconciledDraftSource {
  None = 'none',
  Local = 'local',
  Cloud = 'cloud',
}

export type ReconciledProductDraft = {
  draft: ProductDraft | null;
  source: ReconciledDraftSource;
  hasConflictWithLive: boolean;
  needsCloudSync: boolean;
};

export function localDraftKey(uid: string, draftId: string): string {
  return `${LOCAL_DRAFT_KEY_PREFIX}${uid}:${draftId}`;
}

// Deep-clones a Product as pure realm-local JSON (stripping optional undefined keys for
// Firestore compatibility and avoiding cross-realm structuredClone prototype mismatches).
export function cloneProductSnapshot(product: Product): Product {
  return JSON.parse(JSON.stringify(syncProductSummaryFlagsFromRules(product))) as Product;
}

export function computeProductDraftDiff(original: Product, updated: Product) {
  return computeObjectDiff<Product>(cloneProductSnapshot(original), cloneProductSnapshot(updated), {
    ignoreKeys: PRODUCT_TRANSIENT_KEYS,
  });
}

// Compares two Product snapshots ignoring live attendee counters and storage timestamps.
export function areProductsEquivalentForDraft(a: Product, b: Product): boolean {
  return computeProductDraftDiff(a, b).changedKeys.length === 0;
}

// Overlays live attendee registration counts onto a draft or outgoing publish payload
// so saving a multi-day draft never clobbers real-time capacity reservations.
export function mergeLiveCountersIntoProduct(
  draftProduct: Product,
  liveProduct: Product | null | undefined,
): Product {
  if (!liveProduct) {
    return cloneProductSnapshot(draftProduct);
  }
  return cloneProductSnapshot({
    ...draftProduct,
    docId: liveProduct.docId || draftProduct.docId,
    capacityCounts: { ...liveProduct.capacityCounts },
    inPersonRegistrationsCount: liveProduct.inPersonRegistrationsCount,
  });
}

function parseIsoMs(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

@Injectable({ providedIn: 'root' })
export class ProductDraftService {
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  private idb = inject(IdbStorageService);

  // Reads a user-scoped draft from IndexedDB and normalizes it into a domain ProductDraft.
  async getLocalDraft(uid: string, draftId: string): Promise<ProductDraft | undefined> {
    if (!uid || !draftId) return undefined;
    const raw = await this.idb.get<Record<string, unknown>>(localDraftKey(uid, draftId));
    if (!raw || typeof raw !== 'object') return undefined;
    return firestoreDocToProductDraft({
      id: draftId,
      data: () => raw,
    });
  }

  // Persists a work-in-progress ProductDraft to IndexedDB immediately (offline-safe).
  async saveLocalDraft(uid: string, draft: ProductDraft): Promise<ProductDraft> {
    const nowIso = new Date().toISOString();
    const eventDocId = draft.eventDocId || draft.draftProduct.eventDocId || '';
    const productDocId = draft.productDocId || draft.draftProduct.docId || '';
    const docId = draft.docId || productDraftIdFor({ eventDocId, productDocId });
    const normalizedProduct = cloneProductSnapshot({
      ...draft.draftProduct,
      docId: productDocId,
      eventDocId: draft.draftProduct.eventDocId || eventDocId,
    });

    const normalizedDraft: ProductDraft = {
      docId,
      eventDocId,
      productDocId,
      baseProductLastUpdated: draft.baseProductLastUpdated || '',
      draftProduct: normalizedProduct,
      updatedByEmail: normalizeEmail(draft.updatedByEmail),
      updatedByName: draft.updatedByName || '',
      clientSavedAt: draft.clientSavedAt || nowIso,
      createdAt: draft.createdAt || nowIso,
      lastUpdated: draft.lastUpdated || draft.clientSavedAt || nowIso,
    };

    if (uid) {
      const { docId: _, ...storedPayload } = normalizedDraft;
      await this.idb.set(localDraftKey(uid, docId), storedPayload);
    }
    return normalizedDraft;
  }

  // Deletes a single user-scoped local draft from IndexedDB.
  async deleteLocalDraft(uid: string, draftId: string): Promise<void> {
    if (!uid || !draftId) return;
    await this.idb.delete(localDraftKey(uid, draftId));
  }

  // Lists all local drafts belonging to the given user UID.
  async listLocalDraftsForUser(uid: string): Promise<ProductDraft[]> {
    if (!uid) return [];
    const prefix = `${LOCAL_DRAFT_KEY_PREFIX}${uid}:`;
    const keys = await this.idb.keys();
    const drafts: ProductDraft[] = [];
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const draftId = key.slice(prefix.length);
      const draft = await this.getLocalDraft(uid, draftId);
      if (draft) {
        drafts.push(draft);
      }
    }
    return drafts;
  }

  // Purges all local drafts belonging to the given user UID (e.g. on sign-out).
  async clearLocalDraftsForUser(uid: string): Promise<void> {
    if (!uid) return;
    const prefix = `${LOCAL_DRAFT_KEY_PREFIX}${uid}:`;
    const keys = await this.idb.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith(prefix)).map((key) => this.idb.delete(key)),
    );
  }

  // Fetches a single cloud draft from /product_drafts/{draftId}.
  async getCloudDraft(draftId: string): Promise<ProductDraft | undefined> {
    if (!draftId) return undefined;
    const snap = await getDoc(doc(this.db, FirestoreCollection.ProductDrafts, draftId));
    if (!snap.exists()) return undefined;
    return firestoreDocToProductDraft(snap);
  }

  // Fetches all admin drafts from /product_drafts.
  async getAllCloudDrafts(): Promise<ProductDraft[]> {
    try {
      const snap = await getDocs(collection(this.db, FirestoreCollection.ProductDrafts));
      return snap.docs.map((d) => firestoreDocToProductDraft(d));
    } catch (err) {
      console.warn('Could not load cloud product drafts:', err);
      return [];
    }
  }

  // Writes a ProductDraft to /product_drafts/{draftId} with serverTimestamp() on lastUpdated.
  // Rejects on network/permission failure so the caller can surface DraftSyncStatus.Error.
  async saveCloudDraft(draft: ProductDraft): Promise<ProductDraft> {
    const nowIso = new Date().toISOString();
    const eventDocId = draft.eventDocId || draft.draftProduct.eventDocId || '';
    const productDocId = draft.productDocId || draft.draftProduct.docId || '';
    const docId = draft.docId || productDraftIdFor({ eventDocId, productDocId });
    const normalizedProduct = cloneProductSnapshot({
      ...draft.draftProduct,
      docId: productDocId,
      eventDocId: draft.draftProduct.eventDocId || eventDocId,
    });
    const { docId: _prodDocId, ...productPayload } = normalizedProduct;

    const firestorePayload = {
      eventDocId,
      productDocId,
      baseProductLastUpdated: draft.baseProductLastUpdated || '',
      draftProduct: productPayload,
      updatedByEmail: normalizeEmail(draft.updatedByEmail),
      updatedByName: draft.updatedByName || '',
      clientSavedAt: draft.clientSavedAt || nowIso,
      createdAt: draft.createdAt || nowIso,
      lastUpdated: serverTimestamp(),
    };

    await setDoc(doc(this.db, FirestoreCollection.ProductDrafts, docId), firestorePayload);

    return {
      docId,
      eventDocId,
      productDocId,
      baseProductLastUpdated: firestorePayload.baseProductLastUpdated,
      draftProduct: normalizedProduct,
      updatedByEmail: firestorePayload.updatedByEmail,
      updatedByName: firestorePayload.updatedByName,
      clientSavedAt: firestorePayload.clientSavedAt,
      createdAt: firestorePayload.createdAt,
      lastUpdated: nowIso,
    };
  }

  // Deletes a cloud draft from /product_drafts/{draftId}.
  async deleteCloudDraft(draftId: string): Promise<void> {
    if (!draftId) return;
    await deleteDoc(doc(this.db, FirestoreCollection.ProductDrafts, draftId));
  }

  // Deletes both local IndexedDB and cloud Firestore drafts (cleaning up after publish or discard).
  async deleteDraftEverywhere(uid: string | undefined, draftId: string): Promise<void> {
    if (!draftId) return;
    if (uid) {
      await this.deleteLocalDraft(uid, draftId);
    }
    try {
      await this.deleteCloudDraft(draftId);
    } catch (err) {
      console.warn('Could not delete cloud product draft:', err);
    }
  }

  // Resolves the newest draft (local or cloud) for a specific event ID.
  async getDraftForEvent(eventId: string, uid?: string): Promise<ProductDraft | undefined> {
    if (!eventId) return undefined;
    const draftId = productDraftIdFor({ eventDocId: eventId });
    const [localDraft, cloudDraft] = await Promise.all([
      uid ? this.getLocalDraft(uid, draftId) : Promise.resolve(undefined),
      this.getCloudDraft(draftId).catch((err) => {
        console.warn('Could not read cloud draft for event:', err);
        return undefined;
      }),
    ]);
    return this.pickNewerDraft(localDraft, cloudDraft)?.draft;
  }

  // Returns merged cloud + local drafts for admin catalogue views, preferring whichever copy is newer.
  async getAllDraftsForAdmin(uid?: string): Promise<ProductDraft[]> {
    const [localDrafts, cloudDrafts] = await Promise.all([
      uid ? this.listLocalDraftsForUser(uid) : Promise.resolve([]),
      this.getAllCloudDrafts(),
    ]);
    const byId = new Map<string, ProductDraft>();
    for (const cloud of cloudDrafts) {
      byId.set(cloud.docId, cloud);
    }
    for (const local of localDrafts) {
      const existing = byId.get(local.docId);
      if (!existing) {
        byId.set(local.docId, local);
      } else {
        const picked = this.pickNewerDraft(local, existing);
        if (picked) {
          byId.set(local.docId, picked.draft);
        }
      }
    }
    return Array.from(byId.values());
  }

  // Reconciles local IndexedDB, cloud /product_drafts, and live /products state when opening the editor.
  async reconcileDraft(params: {
    draftId: string;
    liveProduct?: Product | null;
    uid?: string;
  }): Promise<ReconciledProductDraft> {
    const { draftId, liveProduct, uid } = params;
    if (!draftId) {
      return {
        draft: null,
        source: ReconciledDraftSource.None,
        hasConflictWithLive: false,
        needsCloudSync: false,
      };
    }

    const [localDraft, cloudDraft] = await Promise.all([
      uid ? this.getLocalDraft(uid, draftId) : Promise.resolve(undefined),
      this.getCloudDraft(draftId).catch((err) => {
        console.warn('Could not fetch cloud product draft during reconciliation:', err);
        return undefined;
      }),
    ]);

    const picked = this.pickNewerDraft(localDraft, cloudDraft);
    if (!picked) {
      return {
        draft: null,
        source: ReconciledDraftSource.None,
        hasConflictWithLive: false,
        needsCloudSync: false,
      };
    }

    const { draft: winningDraft, source, needsCloudSync } = picked;

    // If a live product exists, matched the same baseline version, and has zero effective edits,
    // prune the redundant draft so the editor opens cleanly in Live state.
    if (
      liveProduct &&
      (!winningDraft.baseProductLastUpdated ||
        winningDraft.baseProductLastUpdated === liveProduct.lastUpdated) &&
      areProductsEquivalentForDraft(winningDraft.draftProduct, liveProduct)
    ) {
      await this.deleteDraftEverywhere(uid, draftId);
      return {
        draft: null,
        source: ReconciledDraftSource.None,
        hasConflictWithLive: false,
        needsCloudSync: false,
      };
    }

    const hasConflictWithLive = Boolean(
      liveProduct && winningDraft.baseProductLastUpdated !== liveProduct.lastUpdated,
    );

    const mergedProduct = mergeLiveCountersIntoProduct(winningDraft.draftProduct, liveProduct);
    const reconciledDraft: ProductDraft = {
      ...winningDraft,
      productDocId: liveProduct?.docId || (liveProduct === null ? '' : winningDraft.productDocId),
      draftProduct: mergedProduct,
    };

    // Mirror cloud winner into local IndexedDB so offline reloads remain up to date.
    if (uid && source === ReconciledDraftSource.Cloud) {
      await this.saveLocalDraft(uid, reconciledDraft);
    }

    return {
      draft: reconciledDraft,
      source,
      hasConflictWithLive,
      needsCloudSync,
    };
  }

  private pickNewerDraft(
    localDraft: ProductDraft | undefined,
    cloudDraft: ProductDraft | undefined,
  ): {
    draft: ProductDraft;
    source: ReconciledDraftSource;
    needsCloudSync: boolean;
  } | null {
    if (localDraft && cloudDraft) {
      const localMs = parseIsoMs(localDraft.clientSavedAt || localDraft.lastUpdated);
      const cloudMs = Math.max(
        parseIsoMs(cloudDraft.clientSavedAt),
        parseIsoMs(cloudDraft.lastUpdated),
      );
      if (localMs > cloudMs) {
        return {
          draft: localDraft,
          source: ReconciledDraftSource.Local,
          needsCloudSync: true,
        };
      }
      return {
        draft: cloudDraft,
        source: ReconciledDraftSource.Cloud,
        needsCloudSync: false,
      };
    }
    if (localDraft) {
      return {
        draft: localDraft,
        source: ReconciledDraftSource.Local,
        needsCloudSync: true,
      };
    }
    if (cloudDraft) {
      return {
        draft: cloudDraft,
        source: ReconciledDraftSource.Cloud,
        needsCloudSync: false,
      };
    }
    return null;
  }
}
