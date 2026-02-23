import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrderView } from './order-view';

describe('OrderView', () => {
  let component: OrderView;
  let fixture: ComponentFixture<OrderView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderView]
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
