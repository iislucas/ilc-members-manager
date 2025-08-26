import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SchoolMembersComponent } from './school-members';

describe('SchoolMembers', () => {
  let component: SchoolMembersComponent;
  let fixture: ComponentFixture<SchoolMembersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchoolMembersComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SchoolMembersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
