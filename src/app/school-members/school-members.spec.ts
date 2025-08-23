import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SchoolMembers } from './school-members';

describe('SchoolMembers', () => {
  let component: SchoolMembers;
  let fixture: ComponentFixture<SchoolMembers>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchoolMembers]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SchoolMembers);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
