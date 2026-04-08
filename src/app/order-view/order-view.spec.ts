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
        { provide: DataManagerService, useValue: { loadingState: signal('loaded') } }
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
});
