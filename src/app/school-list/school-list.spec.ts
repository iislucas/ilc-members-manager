import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SchoolListComponent } from './school-list';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { School, initSchool } from '../../../functions/src/data-model';
import { signal, Component, Input } from '@angular/core';
import { SchoolEditComponent } from '../school-edit/school-edit';

@Component({
  selector: 'app-school-edit',
  standalone: true,
  template: '',
})
class MockSchoolEditComponent {
  @Input() school: any;
  @Input() allSchools: any;
  @Input() collapse: any;
  @Input() canDelete: any;
}

describe('SchoolListComponent', () => {
  let component: SchoolListComponent;
  let fixture: ComponentFixture<SchoolListComponent>;
  let mockFirebaseStateService: any;
  let mockDataManagerService: any;

  beforeEach(async () => {
    mockFirebaseStateService = {
      user: signal({ isAdmin: true, schoolsManaged: [] }),
    };

    // Create a set of 60 schools
    const schools: School[] = [];
    for (let i = 0; i < 60; i++) {
      const s = initSchool();
      s.id = `school-${i}`;
      s.schoolName = `School ${i}`;
      schools.push(s);
    }
    const schoolSet = new SearchableSet<'id', School>(
      ['schoolName'],
      'id',
      schools,
    );

    mockDataManagerService = {
      schools: schoolSet,
    };

    await TestBed.configureTestingModule({
      imports: [SchoolListComponent, MockSchoolEditComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: DataManagerService, useValue: mockDataManagerService },
      ],
    })
      .overrideComponent(SchoolListComponent, {
        remove: { imports: [SchoolEditComponent] },
        add: { imports: [MockSchoolEditComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SchoolListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should limit schools to 50 initially', () => {
    expect(component.limit()).toBe(50);
    expect(component.schools().length).toBe(50);
    expect(component.totalSchools()).toBe(60);
  });

  it('should show all schools when showAll is called', () => {
    component.showAll();
    fixture.detectChanges();
    expect(component.limit()).toBe(Infinity);
    expect(component.schools().length).toBe(60);
  });

  it('should reset limit to 50 when search is performed', () => {
    component.showAll();
    fixture.detectChanges();
    expect(component.limit()).toBe(Infinity);

    const input = document.createElement('input');
    input.value = 'School';
    const event = { target: input } as any;
    component.onSearch(event);

    expect(component.limit()).toBe(50);
  });
});
