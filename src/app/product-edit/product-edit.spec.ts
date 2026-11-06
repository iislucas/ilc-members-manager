/* product-edit.spec.ts
 *
 * Unit tests for ProductEditComponent hybrid draft auto-save (400ms local IndexedDB,
 * 10s idle Firestore sync), Milkdown baseline alignment, conflict resolution,
 * inline discard/publish confirmations, and live capacityCounts preservation.
 */

import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Views } from '../app.config';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';
import { NetworkStateService } from '../network-state.service';
import {
  CLOUD_DRAFT_IDLE_MS,
  LOCAL_DRAFT_DEBOUNCE_MS,
  ProductDraftService,
  ReconciledDraftSource,
} from '../product-draft.service';
import { ProductService } from '../product.service';
import { RoutingService } from '../routing.service';
import { SearchableSet } from '../searchable-set';
import { VodPreviewComponent } from '../vod-preview/vod-preview';
import { ProductEditComponent } from './product-edit';
import {
  DraftSyncStatus,
  initEvent,
  initProduct,
  initProductDraft,
  Product,
  ProductDraft,
} from '../../../functions/src/data-model/events';

@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  template: '<div class="stub-md-editor"></div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubMarkdownEditorComponent {
  bordered = input<boolean>(false);
  initialValue = input<string>('');
  initialized = output<string>();
  changed = output<string>();
}

@Component({
  selector: 'app-vod-preview',
  standalone: true,
  template: '<div class="stub-vod-preview"></div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubVodPreviewComponent {
  videoId = input<string>('');
  showUnlink = input<boolean>(false);
  unlink = output<void>();
}

describe('ProductEditComponent', () => {
  let fixture: ComponentFixture<ProductEditComponent>;
  let component: ProductEditComponent;

  let mockRoutingService: {
    matchedPatternId: ReturnType<typeof signal<Views>>;
    signals: Record<string, { pathVars: Record<string, ReturnType<typeof signal<string>>> }>;
    hrefForView: ReturnType<typeof vi.fn>;
    navigateTo: ReturnType<typeof vi.fn>;
  };
  let mockFirebaseState: {
    user: ReturnType<typeof signal>;
  };
  let mockDataService: {
    videos: SearchableSet<'docId', { docId: string; title: string }>;
    getVideoSeriesList: ReturnType<typeof vi.fn>;
    getEvents: ReturnType<typeof vi.fn>;
    getEventById: ReturnType<typeof vi.fn>;
    saveProduct: ReturnType<typeof vi.fn>;
    deleteProduct: ReturnType<typeof vi.fn>;
  };
  let mockProductService: {
    getProduct: ReturnType<typeof vi.fn>;
    getProductByEventId: ReturnType<typeof vi.fn>;
    getEventRegistrations: ReturnType<typeof vi.fn>;
  };
  let mockDraftService: {
    reconcileDraft: ReturnType<typeof vi.fn>;
    saveLocalDraft: ReturnType<typeof vi.fn>;
    saveCloudDraft: ReturnType<typeof vi.fn>;
    deleteDraftEverywhere: ReturnType<typeof vi.fn>;
  };
  let mockNetworkState: {
    isOffline: ReturnType<typeof signal<boolean>>;
    registerOnlineHandler: ReturnType<typeof vi.fn>;
  };

  let liveProduct: Product;

  beforeEach(async () => {
    vi.useFakeTimers();

    liveProduct = initProduct();
    liveProduct.docId = 'prod-live-1';
    liveProduct.eventDocId = 'ev-1';
    liveProduct.title = 'Autumn Retreat';
    liveProduct.descriptionMarkdown = 'Line 1\n\n\nLine 2';
    liveProduct.lastUpdated = '2026-06-01T10:00:00.000Z';
    liveProduct.capacityCounts = { hall: 12 };
    liveProduct.inPersonRegistrationsCount = 12;

    const event1 = {
      ...initEvent(),
      docId: 'ev-1',
      title: 'Autumn Retreat',
      start: '2026-10-10',
      productId: 'prod-live-1',
    };

    mockRoutingService = {
      matchedPatternId: signal(Views.ManageEventRegistration),
      signals: {
        [Views.ManageEventRegistration]: {
          pathVars: { eventId: signal('ev-1') },
        },
        [Views.ManageEventRegistrationsEdit]: {
          pathVars: { eventId: signal('ev-1') },
        },
      },
      hrefForView: vi.fn((view: Views) => `/${view}`),
      navigateTo: vi.fn(),
    };

    mockFirebaseState = {
      user: signal({
        firebaseUser: {
          uid: 'admin-uid-1',
          email: 'Admin@ILC.com',
          displayName: 'HQ Admin',
        },
        member: { name: 'HQ Admin' },
        isAdmin: true,
      }),
    };

    mockDataService = {
      videos: new SearchableSet<'docId', { docId: string; title: string }>(['title'], 'docId'),
      getVideoSeriesList: vi.fn().mockReturnValue([]),
      getEvents: vi.fn().mockResolvedValue([event1]),
      getEventById: vi.fn().mockResolvedValue(event1),
      saveProduct: vi.fn().mockResolvedValue('prod-live-1'),
      deleteProduct: vi.fn().mockResolvedValue(undefined),
    };

    mockProductService = {
      getProduct: vi.fn().mockResolvedValue(liveProduct),
      getProductByEventId: vi.fn().mockResolvedValue(liveProduct),
      getEventRegistrations: vi.fn().mockResolvedValue([]),
    };

    mockDraftService = {
      reconcileDraft: vi.fn().mockResolvedValue({
        draft: null,
        source: ReconciledDraftSource.None,
        hasConflictWithLive: false,
        needsCloudSync: false,
      }),
      saveLocalDraft: vi.fn(async (_uid: string, draft: ProductDraft) => draft),
      saveCloudDraft: vi.fn(async (draft: ProductDraft) => ({
        ...draft,
        lastUpdated: '2026-06-02T12:00:10.000Z',
      })),
      deleteDraftEverywhere: vi.fn().mockResolvedValue(undefined),
    };

    mockNetworkState = {
      isOffline: signal(false),
      registerOnlineHandler: vi.fn().mockReturnValue(() => {}),
    };

    await TestBed.configureTestingModule({
      imports: [ProductEditComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: DataManagerService, useValue: mockDataService },
        { provide: ProductService, useValue: mockProductService },
        { provide: ProductDraftService, useValue: mockDraftService },
        { provide: NetworkStateService, useValue: mockNetworkState },
      ],
    })
      .overrideComponent(ProductEditComponent, {
        remove: { imports: [MarkdownEditor, VodPreviewComponent] },
        add: { imports: [StubMarkdownEditorComponent, StubVodPreviewComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProductEditComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens cleanly and aligns baselineProduct on MarkdownEditor initialized without creating a phantom draft', async () => {
    expect(component.isLoading()).toBe(false);
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.Clean);
    expect(component.isDirty()).toBe(false);

    // Simulate Milkdown canonicalizing initial markdown on mount
    component.onMarkdownFieldInitialized('descriptionMarkdown', 'Line 1\n\n<br />\n\nLine 2');
    await vi.advanceTimersByTimeAsync(CLOUD_DRAFT_IDLE_MS + 1000);

    expect(component.isDirty()).toBe(false);
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.Clean);
    expect(mockDraftService.saveLocalDraft).not.toHaveBeenCalled();
    expect(mockDraftService.saveCloudDraft).not.toHaveBeenCalled();
  });

  it('auto-saves partial/unvalidated edits locally after 400ms and syncs to cloud 10s after the last edit', async () => {
    // Make pricingRules invalid (zero registration options) — drafts still save without validation errors!
    component.onPricingRulesChange({
      ...component.productModel().pricingRules,
      registrationOptions: [],
    });

    expect(component.isDirty()).toBe(true);
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.SavingLocal);
    expect(mockDraftService.saveLocalDraft).not.toHaveBeenCalled();

    // Advance 400ms -> IndexedDB local save fires, cloud has NOT fired yet
    await vi.advanceTimersByTimeAsync(LOCAL_DRAFT_DEBOUNCE_MS);
    expect(mockDraftService.saveLocalDraft).toHaveBeenCalledTimes(1);
    expect(mockDraftService.saveCloudDraft).not.toHaveBeenCalled();
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.SavedLocal);

    // Edit again after 6 seconds -> resets the 10-second cloud idle timer!
    await vi.advanceTimersByTimeAsync(6000);
    component.updateTitle('Autumn Retreat — Draft v2');
    await vi.advanceTimersByTimeAsync(LOCAL_DRAFT_DEBOUNCE_MS);
    expect(mockDraftService.saveLocalDraft).toHaveBeenCalledTimes(2);
    expect(mockDraftService.saveCloudDraft).not.toHaveBeenCalled();

    // Advance 5 more seconds (total 5.4s since last edit) -> still waiting for 10s idle window
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockDraftService.saveCloudDraft).not.toHaveBeenCalled();

    // Advance remaining 5s -> 10s since last edit reached -> cloud sync fires!
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockDraftService.saveCloudDraft).toHaveBeenCalledTimes(1);
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.SavedCloud);
    expect(mockDataService.saveProduct).not.toHaveBeenCalled();
  });

  it('flushes pending 0-400ms local edits immediately when document becomes hidden', async () => {
    component.updateTitle('Quick Edit Before Tab Switch');
    expect(mockDraftService.saveLocalDraft).not.toHaveBeenCalled();

    component.flushPendingLocalDraftSync();
    await Promise.resolve();

    expect(mockDraftService.saveLocalDraft).toHaveBeenCalledTimes(1);
    expect(mockDraftService.saveLocalDraft.mock.calls[0][1].draftProduct.title).toBe(
      'Quick Edit Before Tab Switch',
    );
  });

  it('saveDraftNow flushes immediately to IndexedDB and Firestore without requiring rule validation', async () => {
    component.updateTitle('');
    await component.saveDraftNow();

    expect(mockDraftService.saveLocalDraft).toHaveBeenCalled();
    expect(mockDraftService.saveCloudDraft).toHaveBeenCalledTimes(1);
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.SavedCloud);
    expect(component.errorMessage()).toBeNull();
  });

  it('supports inline Discard Draft confirmation without window.confirm and reverts to baseline', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    component.updateTitle('Temporary WIP Title');
    await vi.advanceTimersByTimeAsync(LOCAL_DRAFT_DEBOUNCE_MS);
    expect(component.productModel().title).toBe('Temporary WIP Title');

    component.requestDiscardDraft();
    expect(component.confirmingDiscardDraft()).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();

    await component.confirmDiscardDraft();
    expect(component.confirmingDiscardDraft()).toBe(false);
    expect(component.productModel().title).toBe('Autumn Retreat');
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.Clean);
    expect(mockDraftService.deleteDraftEverywhere).toHaveBeenCalledWith(
      'admin-uid-1',
      'event_ev-1',
    );
  });

  it('surfaces ConflictWithLive and rebases while preserving live capacityCounts on Keep Editing Draft', async () => {
    const staleDraftProd = initProduct();
    staleDraftProd.docId = 'prod-live-1';
    staleDraftProd.eventDocId = 'ev-1';
    staleDraftProd.title = 'Draft From Yesterday';
    staleDraftProd.capacityCounts = { hall: 3 };
    staleDraftProd.inPersonRegistrationsCount = 3;

    mockDraftService.reconcileDraft.mockResolvedValueOnce({
      draft: initProductDraft({
        eventDocId: 'ev-1',
        productDocId: 'prod-live-1',
        baseProductLastUpdated: '2026-05-30T00:00:00.000Z',
        draftProduct: {
          ...staleDraftProd,
          capacityCounts: { hall: 12 },
          inPersonRegistrationsCount: 12,
        },
      }),
      source: ReconciledDraftSource.Cloud,
      hasConflictWithLive: true,
      needsCloudSync: false,
    });

    await component.loadData();
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.ConflictWithLive);
    expect(component.conflictSummary()).toContain('Title');

    await component.keepDraftOverLiveConflict();
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.SavedCloud);
    expect(component.activeDraft()?.baseProductLastUpdated).toBe('2026-06-01T10:00:00.000Z');
    expect(component.productModel().capacityCounts).toEqual({ hall: 12 });
  });

  it('overlays latest live capacityCounts on Publish and deletes local + cloud drafts', async () => {
    component.updateTitle('Published Autumn Retreat');
    await vi.advanceTimersByTimeAsync(LOCAL_DRAFT_DEBOUNCE_MS);

    // Simulate 5 more attendees registering on the live product while the draft was open!
    mockProductService.getProduct.mockResolvedValueOnce({
      ...liveProduct,
      capacityCounts: { hall: 17 },
      inPersonRegistrationsCount: 17,
    });

    await component.saveProduct();

    expect(mockDataService.saveProduct).toHaveBeenCalledTimes(1);
    const savedPayload = mockDataService.saveProduct.mock.calls[0][0] as Product;
    expect(savedPayload.title).toBe('Published Autumn Retreat');
    expect(savedPayload.capacityCounts).toEqual({ hall: 17 });
    expect(savedPayload.inPersonRegistrationsCount).toBe(17);
    expect(mockDraftService.deleteDraftEverywhere).toHaveBeenCalledWith(
      'admin-uid-1',
      'event_ev-1',
    );
    expect(component.draftSyncStatus()).toBe(DraftSyncStatus.Clean);
  });
});
