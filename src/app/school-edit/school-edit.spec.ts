import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SchoolEditComponent } from './school-edit';
import { DataManagerService } from '../data-manager.service';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from '../firebase-state.service';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { initSchool, School } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';

describe('SchoolEditComponent', () => {
  let component: SchoolEditComponent;
  let fixture: ComponentFixture<SchoolEditComponent>;
  let dataManagerServiceMock: jasmine.SpyObj<DataManagerService>;
  let firebaseStateServiceMock: any;

  const mockSchool: School = {
    ...initSchool(),
    id: 'school-id',
    schoolName: 'Test School',
    schoolId: 'S001',
    owner: 'instructor-1',
    managers: [],
  };

  beforeEach(async () => {
    dataManagerServiceMock = jasmine.createSpyObj(
      'DataManagerService',
      ['setSchool', 'createNextSchoolId'],
      {
        members: new SearchableSet<'memberId', any>(['name'], 'memberId', []),
        instructors: new SearchableSet<'instructorId', any>(
          ['name'],
          'instructorId',
          [],
        ),
        schools: new SearchableSet<'schoolId', School>(
          ['schoolName'],
          'schoolId',
          [],
        ),
        counters: signal(null),
      },
    );

    firebaseStateServiceMock = createFirebaseStateServiceMock();
    firebaseStateServiceMock.user.set({
      isAdmin: true,
      member: {} as any,
      schoolsManaged: [],
      firebaseUser: { email: 'admin@example.com' } as any,
    });

    await TestBed.configureTestingModule({
      imports: [SchoolEditComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: dataManagerServiceMock },
        { provide: FirebaseStateService, useValue: firebaseStateServiceMock },
        {
          provide: ROUTING_CONFIG,
          useValue: {
            validPathPatterns: initPathPatterns,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SchoolEditComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('school', mockSchool);
    fixture.componentRef.setInput('allSchools', [mockSchool]);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call preventDefault and setSchool on save', async () => {
    const event = jasmine.createSpyObj('Event', ['preventDefault']);
    dataManagerServiceMock.setSchool.and.returnValue(Promise.resolve());

    await component.saveSchool(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dataManagerServiceMock.setSchool).toHaveBeenCalledWith(
      jasmine.objectContaining({ schoolName: 'Test School' }),
    );
  });
});
