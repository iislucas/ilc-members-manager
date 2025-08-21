import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FindAnInstructor } from './find-an-instructor';

describe('FindAnInstructor', () => {
  let component: FindAnInstructor;
  let fixture: ComponentFixture<FindAnInstructor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FindAnInstructor]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FindAnInstructor);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
