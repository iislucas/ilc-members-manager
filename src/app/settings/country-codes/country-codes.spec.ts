import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CountryCodes } from './country-codes';

describe('CountryCodes', () => {
  let component: CountryCodes;
  let fixture: ComponentFixture<CountryCodes>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CountryCodes]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CountryCodes);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
