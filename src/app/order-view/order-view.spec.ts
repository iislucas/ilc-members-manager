import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrderView } from './order-view';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { vi } from 'vitest';

describe('OrderView', () => {
  let component: OrderView;
  let fixture: ComponentFixture<OrderView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderView],
      providers: [
        { provide: RoutingService, useValue: { navigateTo: vi.fn(), hrefWithParams: vi.fn().mockReturnValue('#/orders'), matchedPatternId: signal(''), signals: { [Views.OrderView]: { pathVars: { orderId: signal('123') } } } } },
        { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
        { provide: DataManagerService, useValue: { loadingState: signal('loaded'), getOrderByIdOrRef: vi.fn() } }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OrderView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit "Order Not Found" when order is not found', async () => {
    const dataManagerService = TestBed.inject(DataManagerService);
    (dataManagerService.getOrderByIdOrRef as any).mockResolvedValue(null);
    
    const titleLoadedSpy = vi.spyOn(component.titleLoaded, 'emit');
    
    await component.fetchOrder('123');
    
    expect(titleLoadedSpy).toHaveBeenCalledWith('Order Not Found');
  });

  it('should emit "Error Loading Order" when fetch throws', async () => {
    const dataManagerService = TestBed.inject(DataManagerService);
    (dataManagerService.getOrderByIdOrRef as any).mockRejectedValue(new Error('Network error'));
    
    const titleLoadedSpy = vi.spyOn(component.titleLoaded, 'emit');
    
    await component.fetchOrder('123');
    
    expect(titleLoadedSpy).toHaveBeenCalledWith('Error Loading Order');
  });

  it('should emit computed title when order is found', async () => {
    const dataManagerService = TestBed.inject(DataManagerService);
    const mockOrder = { docId: '123', ilcAppOrderKind: 'ilc-2005-sheets-db-import', referenceNumber: 'REF123', datePaid: '2026-01-01', firstName: 'John', lastName: 'Doe' };
    (dataManagerService.getOrderByIdOrRef as any).mockResolvedValue(mockOrder);
    
    const titleLoadedSpy = vi.spyOn(component.titleLoaded, 'emit');
    
    await component.fetchOrder('123');
    
    expect(titleLoadedSpy).toHaveBeenCalledWith('Order #REF123 - 2026-01-01 - John Doe');
  });
});
