/* product-draft.service.spec.ts
 *
 * Unit tests for ProductDraftService local IndexedDB storage, Firestore /product_drafts sync,
 * local-vs-cloud reconciliation, conflict detection, and live capacity counter preservation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FirebaseApp, initializeApp } from 'firebase/app';
import * as firestore from 'firebase/firestore';
import { FIREBASE_APP } from './app.config';
import { IdbStorageService } from './idb-storage.service';
import {
  areProductsEquivalentForDraft,
  mergeLiveCountersIntoProduct,
  ProductDraftService,
  ReconciledDraftSource,
} from './product-draft.service';
import {
  initEventCapacity,
  initProduct,
  initProductDraft,
} from '../../functions/src/data-model/events';

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn((_db, path: string) => ({ path })),
  doc: vi.fn((_db, col: string, id: string) => ({ path: `${col}/${id}`, id })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__'),
}));

describe('ProductDraftService', () => {
  let service: ProductDraftService;
  let idb: IdbStorageService;
  let app: FirebaseApp;

  beforeEach(() => {
    vi.clearAllMocks();
    app = initializeApp(
      {
        apiKey: 'fake',
        authDomain: 'fake',
        projectId: 'fake',
        storageBucket: 'fake',
        messagingSenderId: 'fake',
        appId: 'fake',
      },
      `draft-test-${Math.random()}`,
    );
    idb = new IdbStorageService();

    TestBed.configureTestingModule({
      providers: [
        ProductDraftService,
        { provide: FIREBASE_APP, useValue: app },
        { provide: IdbStorageService, useValue: idb },
      ],
    });

    service = TestBed.inject(ProductDraftService);
  });

  it('saves, loads, lists, and clears user-scoped local drafts in IndexedDB', async () => {
    const prod = initProduct();
    prod.title = 'Local Workshop Draft';
    const draft = initProductDraft({
      eventDocId: 'ev-1',
      draftProduct: prod,
      updatedByEmail: 'Admin@ILC.com',
      updatedByName: 'Admin One',
      clientSavedAt: '2026-05-01T10:00:00.000Z',
    });

    await service.saveLocalDraft('uid-1', draft);
    const loaded = await service.getLocalDraft('uid-1', 'event_ev-1');
    expect(loaded).toBeDefined();
    expect(loaded?.draftProduct.title).toBe('Local Workshop Draft');
    expect(loaded?.updatedByEmail).toBe('admin@ilc.com');

    // Different user does not see uid-1's local draft
    expect(await service.getLocalDraft('uid-2', 'event_ev-1')).toBeUndefined();

    const list = await service.listLocalDraftsForUser('uid-1');
    expect(list.map((d) => d.docId)).toEqual(['event_ev-1']);

    await service.clearLocalDraftsForUser('uid-1');
    expect(await service.getLocalDraft('uid-1', 'event_ev-1')).toBeUndefined();
  });

  it('writes cloud drafts to /product_drafts with serverTimestamp and normalized email', async () => {
    vi.mocked(firestore.setDoc).mockResolvedValue(undefined);
    const prod = initProduct();
    prod.docId = 'prod-77';
    prod.eventDocId = 'ev-77';
    prod.title = 'Cloud Synced Draft';

    const draft = initProductDraft({
      eventDocId: 'ev-77',
      productDocId: 'prod-77',
      baseProductLastUpdated: '2026-05-01T08:00:00.000Z',
      draftProduct: prod,
      updatedByEmail: '  HQ.Admin@ILC.com ',
      updatedByName: 'HQ Admin',
      clientSavedAt: '2026-05-01T09:00:00.000Z',
    });

    const saved = await service.saveCloudDraft(draft);
    expect(saved.docId).toBe('event_ev-77');
    expect(firestore.doc).toHaveBeenCalledWith(undefined, 'product_drafts', 'event_ev-77');
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(firestore.setDoc).mock.calls[0];
    expect(payload).toMatchObject({
      eventDocId: 'ev-77',
      productDocId: 'prod-77',
      baseProductLastUpdated: '2026-05-01T08:00:00.000Z',
      updatedByEmail: 'hq.admin@ilc.com',
      lastUpdated: '__SERVER_TIMESTAMP__',
    });
    expect((payload as Record<string, unknown>)['docId']).toBeUndefined();
  });

  it('reconcileDraft prefers newer local draft over older cloud draft and flags needsCloudSync', async () => {
    const localProd = initProduct();
    localProd.title = 'Newer Local Title';
    await service.saveLocalDraft(
      'uid-1',
      initProductDraft({
        eventDocId: 'ev-2',
        productDocId: 'prod-2',
        baseProductLastUpdated: '2026-05-01T08:00:00.000Z',
        draftProduct: localProd,
        clientSavedAt: '2026-05-01T10:05:00.000Z',
      }),
    );

    const cloudProd = initProduct();
    cloudProd.title = 'Older Cloud Title';
    vi.mocked(firestore.getDoc).mockResolvedValue({
      id: 'event_ev-2',
      exists: () => true,
      data: () => ({
        eventDocId: 'ev-2',
        productDocId: 'prod-2',
        baseProductLastUpdated: '2026-05-01T08:00:00.000Z',
        draftProduct: cloudProd,
        clientSavedAt: '2026-05-01T10:00:00.000Z',
        lastUpdated: '2026-05-01T10:00:02.000Z',
      }),
    } as never);

    const liveProduct = initProduct();
    liveProduct.docId = 'prod-2';
    liveProduct.eventDocId = 'ev-2';
    liveProduct.title = 'Original Live Title';
    liveProduct.lastUpdated = '2026-05-01T08:00:00.000Z';
    liveProduct.capacityCounts = { hall_a: 14 };
    liveProduct.inPersonRegistrationsCount = 14;

    const res = await service.reconcileDraft({
      draftId: 'event_ev-2',
      liveProduct,
      uid: 'uid-1',
    });

    expect(res.source).toBe(ReconciledDraftSource.Local);
    expect(res.needsCloudSync).toBe(true);
    expect(res.hasConflictWithLive).toBe(false);
    expect(res.draft?.draftProduct.title).toBe('Newer Local Title');
    // Live attendee counts are preserved over the stale draft snapshot
    expect(res.draft?.draftProduct.capacityCounts).toEqual({ hall_a: 14 });
    expect(res.draft?.draftProduct.inPersonRegistrationsCount).toBe(14);
  });

  it('reconcileDraft flags hasConflictWithLive when liveProduct.lastUpdated changed since draft branched', async () => {
    const cloudProd = initProduct();
    cloudProd.title = 'Admin A Draft';
    vi.mocked(firestore.getDoc).mockResolvedValue({
      id: 'event_ev-3',
      exists: () => true,
      data: () => ({
        eventDocId: 'ev-3',
        productDocId: 'prod-3',
        baseProductLastUpdated: '2026-05-01T08:00:00.000Z',
        draftProduct: cloudProd,
        clientSavedAt: '2026-05-01T09:00:00.000Z',
        lastUpdated: '2026-05-01T09:00:01.000Z',
      }),
    } as never);

    const liveProduct = initProduct();
    liveProduct.docId = 'prod-3';
    liveProduct.eventDocId = 'ev-3';
    liveProduct.title = 'Admin B Published Live Update';
    liveProduct.lastUpdated = '2026-05-01T11:30:00.000Z';

    const res = await service.reconcileDraft({
      draftId: 'event_ev-3',
      liveProduct,
      uid: 'uid-1',
    });

    expect(res.source).toBe(ReconciledDraftSource.Cloud);
    expect(res.hasConflictWithLive).toBe(true);
    expect(res.draft?.draftProduct.title).toBe('Admin A Draft');
  });

  it('prunes no-op drafts whose content already matches liveProduct (ignoring live counters and timestamps)', async () => {
    vi.mocked(firestore.deleteDoc).mockResolvedValue(undefined);
    const liveProduct = initProduct();
    liveProduct.docId = 'prod-4';
    liveProduct.eventDocId = 'ev-4';
    liveProduct.title = 'Identical Setup';
    liveProduct.pricingRules.capacities = [
      initEventCapacity({ id: 'venue', label: 'Venue', limit: 30 }),
    ];
    liveProduct.capacityCounts = { venue: 9 };
    liveProduct.inPersonRegistrationsCount = 9;
    liveProduct.lastUpdated = '2026-05-01T08:00:00.000Z';

    const draftCopy = {
      ...liveProduct,
      capacityCounts: { venue: 2 },
      inPersonRegistrationsCount: 2,
      lastUpdated: '2026-05-01T08:05:00.000Z',
    };
    expect(areProductsEquivalentForDraft(draftCopy, liveProduct)).toBe(true);

    await service.saveLocalDraft(
      'uid-1',
      initProductDraft({
        eventDocId: 'ev-4',
        productDocId: 'prod-4',
        baseProductLastUpdated: '2026-05-01T08:00:00.000Z',
        draftProduct: draftCopy,
      }),
    );
    vi.mocked(firestore.getDoc).mockResolvedValue({
      id: 'event_ev-4',
      exists: () => false,
      data: () => undefined,
    } as never);

    const res = await service.reconcileDraft({
      draftId: 'event_ev-4',
      liveProduct,
      uid: 'uid-1',
    });

    expect(res.draft).toBeNull();
    expect(res.source).toBe(ReconciledDraftSource.None);
    expect(await service.getLocalDraft('uid-1', 'event_ev-4')).toBeUndefined();
  });

  it('mergeLiveCountersIntoProduct preserves live capacityCounts and docId', () => {
    const draftProd = initProduct();
    draftProd.title = 'Edited Title';
    draftProd.capacityCounts = { room: 1 };
    draftProd.inPersonRegistrationsCount = 1;

    const liveProd = initProduct();
    liveProd.docId = 'prod-live';
    liveProd.capacityCounts = { room: 18 };
    liveProd.inPersonRegistrationsCount = 18;

    const merged = mergeLiveCountersIntoProduct(draftProd, liveProd);
    expect(merged.docId).toBe('prod-live');
    expect(merged.title).toBe('Edited Title');
    expect(merged.capacityCounts).toEqual({ room: 18 });
    expect(merged.inPersonRegistrationsCount).toBe(18);
  });
});
