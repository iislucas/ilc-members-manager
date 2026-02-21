import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Counters } from './counters';

describe('Counters', () => {
  let component: Counters;
  let fixture: ComponentFixture<Counters>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Counters]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Counters);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
