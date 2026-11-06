/* manage-products.spec.ts
 *
 * Unit tests for ManageProductsComponent catalogue listing, search filtering,
 * Unpublished Draft badges on live setups, and Draft — Not Live cards for unpublished setups.
 */

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageProductsComponent } from './manage-products';
import { ProductService } from '../product.service';
import { ProductDraftService } from '../product-draft.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import {
  initEvent,
  initProduct,
  initProductDraft,
  Product,
  ProductDraft,
} from '../../../functions/src/data-model/events';

describe('ManageProductsComponent', () => {
  let component: ManageProductsComponent;
  let fixture: ComponentFixture<ManageProductsComponent>;

  let mockProduct: Product;
  let mockProductService: {
    getAllProducts: ReturnType<typeof vi.fn>;
  };
  let mockProductDraftService: {
    getAllDraftsForAdmin: ReturnType<typeof vi.fn>;
    deleteDraftEverywhere: ReturnType<typeof vi.fn>;
  };
  let mockDataManagerService: {
    getEvents: ReturnType<typeof vi.fn>;
  };
  let mockRoutingService: {
    hrefForView: ReturnType<typeof vi.fn>;
  };

  const mockEvent1 = {
    ...initEvent(),
    docId: 'event-1',
    title: 'Spring Aikido Seminar',
  };

  const mockEvent2 = {
    ...initEvent(),
    docId: 'event-2',
    title: 'Winter Mountain Retreat',
  };

  beforeEach(async () => {
    mockProduct = {
      ...initProduct(),
      docId: 'prod-1',
      title: 'Aikido Seminar Product',
      eventDocId: 'event-1',
      lastUpdated: '2026-06-01T10:00:00.000Z',
    };

    mockProductService = {
      getAllProducts: vi.fn().mockResolvedValue([mockProduct]),
    };

    mockProductDraftService = {
      getAllDraftsForAdmin: vi.fn().mockResolvedValue([]),
      deleteDraftEverywhere: vi.fn().mockResolvedValue(undefined),
    };

    mockDataManagerService = {
      getEvents: vi.fn().mockResolvedValue([mockEvent1, mockEvent2]),
    };

    mockRoutingService = {
      hrefForView: vi.fn((view: string, params?: { eventId?: string }) =>
        params?.eventId ? `/${view}/${params.eventId}` : `/${view}`,
      ),
    };

    const mockFirebaseState = {
      user: signal({
        firebaseUser: { uid: 'admin-uid-1', email: 'admin@ilc.com' },
        isAdmin: true,
        isFullMember: true,
        isInstructor: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ManageProductsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProductService, useValue: mockProductService },
        { provide: ProductDraftService, useValue: mockProductDraftService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageProductsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should filter products based on search term', async () => {
    await component.loadData();
    expect(component.products().length).toBe(1);

    component.searchTerm.set('Aikido');
    expect(component.filteredProducts().length).toBe(1);

    component.searchTerm.set('Nonexistent');
    expect(component.filteredProducts().length).toBe(0);
  });

  it('should return linked event title correctly', async () => {
    await component.loadData();
    expect(component.getLinkedEventTitle('event-1')).toBe('Spring Aikido Seminar');
    expect(component.getLinkedEventTitle('')).toBe('None');
    expect(component.getLinkedEventTitle('unknown-id')).toBe('unknown-id');
  });

  it('displays Draft — Not Live cards for unpublished drafts and Unpublished Draft chips on live setups with edits', async () => {
    const editedLiveDraftProduct = {
      ...mockProduct,
      title: 'Aikido Seminar Product — Draft Edits',
    };
    const draftForLive: ProductDraft = initProductDraft({
      docId: 'event_event-1',
      eventDocId: 'event-1',
      productDocId: 'prod-1',
      baseProductLastUpdated: '2026-06-01T10:00:00.000Z',
      draftProduct: editedLiveDraftProduct,
      clientSavedAt: '2026-06-02T11:00:00.000Z',
    });

    const unpublishedProduct = {
      ...initProduct(),
      eventDocId: 'event-2',
      title: 'Winter Retreat Draft Setup',
    };
    const unpublishedDraft: ProductDraft = initProductDraft({
      docId: 'event_event-2',
      eventDocId: 'event-2',
      productDocId: '',
      draftProduct: unpublishedProduct,
      clientSavedAt: '2026-06-03T09:00:00.000Z',
    });

    mockProductDraftService.getAllDraftsForAdmin.mockResolvedValue([
      draftForLive,
      unpublishedDraft,
    ]);

    await component.loadData();
    fixture.detectChanges();

    expect(component.catalogueItems().length).toBe(2);
    expect(component.catalogueItems()[0].isDraftOnly).toBe(true);
    expect(component.catalogueItems()[1].isDraftOnly).toBe(false);
    expect(component.catalogueItems()[1].draft?.docId).toBe('event_event-1');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Winter Retreat Draft Setup');
    expect(text).toContain('Draft — Not Live');
    expect(text).toContain('Unpublished Draft');
    expect(text).toContain('Resume Draft');

    // Search filters across unpublished draft-only setups by linked event title as well
    component.searchTerm.set('Winter Mountain');
    expect(component.filteredItems().length).toBe(1);
    expect(component.filteredItems()[0].product.title).toBe('Winter Retreat Draft Setup');

    // Inline discard removes the draft-only card and calls deleteDraftEverywhere
    component.searchTerm.set('');
    component.requestDiscardDraft('event_event-2');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Confirm Discard');

    await component.confirmDiscardDraft('event_event-2');
    fixture.detectChanges();
    expect(mockProductDraftService.deleteDraftEverywhere).toHaveBeenCalledWith(
      'admin-uid-1',
      'event_event-2',
    );
    expect(component.catalogueItems().length).toBe(1);
  });
});
