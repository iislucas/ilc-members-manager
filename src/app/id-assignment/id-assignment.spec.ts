import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IdAssignment } from './id-assignment';

describe('IdAssignment', () => {
  let component: IdAssignment;
  let fixture: ComponentFixture<IdAssignment>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IdAssignment]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IdAssignment);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
