import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SquarespaceOrderView } from './squarespace-order-view';

describe('SquarespaceOrderView', () => {
  let component: SquarespaceOrderView;
  let fixture: ComponentFixture<SquarespaceOrderView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SquarespaceOrderView]
    })
      .compileComponents();

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
