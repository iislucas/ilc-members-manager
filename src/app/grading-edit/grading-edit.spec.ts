import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GradingEditComponent } from './grading-edit';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';
import { initGrading } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';

describe('GradingEditComponent', () => {
  let component: GradingEditComponent;
  let fixture: ComponentFixture<GradingEditComponent>;
  let mockFirebaseStateService: any;
  let mockDataManagerService: any;

  beforeEach(async () => {
    mockFirebaseStateService = {
      user: signal({
        isAdmin: true,
        schoolsManaged: [],
        member: { instructorId: '' },
      }),
    };

    mockDataManagerService = {
      members: new SearchableSet(['name'], 'memberId'),
      instructors: new SearchableSet(['name'], 'instructorId'),
      addGrading: jasmine.createSpy('addGrading'),
      updateGrading: jasmine.createSpy('updateGrading'),
      deleteGrading: jasmine.createSpy('deleteGrading'),
    };

    await TestBed.configureTestingModule({
      imports: [GradingEditComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: DataManagerService, useValue: mockDataManagerService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GradingEditComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('grading', initGrading());
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start collapsed', () => {
    expect(component.collapsed()).toBe(true);
  });

  it('should show edit controls for admin users', () => {
    expect(component.canEdit()).toBe(true);
  });
});
