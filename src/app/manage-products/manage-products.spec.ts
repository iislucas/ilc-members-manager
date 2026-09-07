/* manage-products.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageProductsComponent } from './manage-products';
import { ProductService } from '../product.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { initProduct, initEvent } from '../../../functions/src/data-model';
import { signal } from '@angular/core';

describe('ManageProductsComponent', () => {
  let component: ManageProductsComponent;
  let fixture: ComponentFixture<ManageProductsComponent>;

  const mockProduct = {
    ...initProduct(),
    id: 'prod-1',
    title: 'Aikido Seminar Product',
    eventDocId: 'event-1',
  };

  const mockEvent = {
    ...initEvent(),
    docId: 'event-1',
    title: 'Spring Aikido Seminar',
  };

  const mockProductService = {
    getAllProducts: vi.fn().mockResolvedValue([mockProduct]),
  };

  const mockDataManagerService = {
    getEvents: vi.fn().mockResolvedValue([mockEvent]),
  };

  const mockRoutingService = {
    hrefForView: vi.fn().mockReturnValue('/products/prod-1'),
  };

  const mockFirebaseState = {
    user: signal({
      email: 'admin@ilc.com',
      isAdmin: true,
      isFullMember: true,
      isInstructor: true,
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManageProductsComponent],
      providers: [
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageProductsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
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

  it('should return linked event title correctly', () => {
    expect(component.getLinkedEventTitle('event-1')).toBe('Spring Aikido Seminar');
    expect(component.getLinkedEventTitle('')).toBe('None');
    expect(component.getLinkedEventTitle('unknown-id')).toBe('unknown-id');
  });
});
