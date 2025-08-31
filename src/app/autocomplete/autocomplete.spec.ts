import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Autocomplete } from './autocomplete';

describe('Autocomplete', () => {
  let component: Autocomplete;
  let fixture: ComponentFixture<Autocomplete>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Autocomplete]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Autocomplete);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
