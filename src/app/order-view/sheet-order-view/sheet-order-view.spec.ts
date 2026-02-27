import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SheetOrderView } from './sheet-order-view';

describe('SheetOrderView', () => {
  let component: SheetOrderView;
  let fixture: ComponentFixture<SheetOrderView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SheetOrderView]
    })
      .compileComponents();

    fixture = TestBed.createComponent(SheetOrderView);
    fixture.componentRef.setInput('order', {
      ilcAppOrderKind: 'ilc-2005-sheets-db-import',
      orderType: '',
      referenceNumber: '',
      externalId: '',
      studentOf: '',
      paidFor: '',
      newRenew: '',
      datePaid: '',
      startDate: '',
      lastName: '',
      firstName: '',
      email: '',
      country: '',
      state: '',
      costUsd: '',
      collected: '',
      split: '',
      notes: ''
    });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
