import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { SquarespaceOrderView } from './squarespace-order-view';
import { DataManagerService } from '../../data-manager.service';

describe('SquarespaceOrderView', () => {
  let component: SquarespaceOrderView;
  let fixture: ComponentFixture<SquarespaceOrderView>;

  beforeEach(async () => {
    const dataManagerServiceMock = {
      members: { entries: signal([]) },
      lookupMembersByEmail: () => [],
      setOrderLineItemInferredMemberId: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [SquarespaceOrderView],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: dataManagerServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SquarespaceOrderView);
    fixture.componentRef.setInput('order', {
      ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
      id: 'abc',
      orderNumber: '1',
      createdOn: '',
      modifiedOn: '',
      customerEmail: 'test@example.com',
      fulfillmentStatus: 'PENDING',
      lineItems: []
    });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
