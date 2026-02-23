import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';

import { OrderList } from './order-list';

describe('OrderList', () => {
  let component: OrderList;
  let fixture: ComponentFixture<OrderList>;
  let mockDataManager: any;
  let mockRoutingService: any;

  beforeEach(async () => {
    mockDataManager = {
      orders: {
        loading: signal(false),
        entries: () => [],
      },
      getRecentOrders: vi.fn().mockResolvedValue([]),
    };

    mockRoutingService = {
      navigateTo: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [OrderList],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager },
        { provide: RoutingService, useValue: mockRoutingService },
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OrderList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
