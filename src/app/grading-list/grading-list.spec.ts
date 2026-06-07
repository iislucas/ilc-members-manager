import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GradingListComponent } from './grading-list';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { Grading, initGrading } from '../../../functions/src/data-model';
import { signal, Component, Input } from '@angular/core';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { GradingRowHeaderComponent } from '../grading-row-header/grading-row-header';

@Component({
  selector: 'app-grading-edit',
  standalone: true,
  template: '',
})
class MockGradingEditComponent {
  @Input() grading: any;
  @Input() collapse: any;
  @Input() canDelete: any;
}

@Component({
  selector: 'app-grading-row-header',
  standalone: true,
  template: '',
})
class MockGradingRowHeaderComponent {
  @Input() grading: any;
}

describe('GradingListComponent', () => {
  let component: GradingListComponent;
  let fixture: ComponentFixture<GradingListComponent>;
  let mockFirebaseStateService: FirebaseStateService;

  beforeEach(async () => {
    mockFirebaseStateService = {
      user: signal({ isAdmin: true, schoolsManaged: [], member: { instructorId: '' } }),
    } as never as FirebaseStateService;

    const mockDataManagerService = {
      instructors: new SearchableSet(['name'], 'instructorId'),
      memberDisplayName: (_docId: string, memberId: string) => memberId,
      instructorDisplayName: (instructorId: string) => instructorId,
    } as never as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [GradingListComponent, MockGradingEditComponent, MockGradingRowHeaderComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
      ],
    })
      .overrideComponent(GradingListComponent, {
        remove: { imports: [GradingEditComponent, GradingRowHeaderComponent] },
        add: { imports: [MockGradingEditComponent, MockGradingRowHeaderComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GradingListComponent);
    component = fixture.componentInstance;

    // Create a set of gradings
    const gradings: Grading[] = [];
    for (let i = 0; i < 60; i++) {
      const g = initGrading();
      g.docId = `grading-${i}`;
      g.studentMemberId = `student-${i}`;
      gradings.push(g);
    }
    const gradingSet = new SearchableSet<'docId', Grading>(
      ['studentMemberId'],
      'docId',
      gradings,
    );

    fixture.componentRef.setInput('gradingSet', gradingSet);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should limit gradings to 50 initially', () => {
    expect(component.limit()).toBe(50);
    expect(component.gradings().length).toBe(50);
    expect(component.totalGradings()).toBe(60);
  });

  it('should show all gradings when showAll is called', () => {
    component.showAll();
    fixture.detectChanges();
    expect(component.limit()).toBe(Infinity);
    expect(component.gradings().length).toBe(60);
  });

  it('finds gradings by resolved student and instructor name', () => {
    // Names are resolved from docIds, not stored on the grading. Wire the mock
    // lookups to return a name for one specific student/instructor.
    const ds = TestBed.inject(DataManagerService) as any;
    ds.memberDisplayName = (_docId: string, memberId: string) =>
      memberId === 'student-7' ? '(student-7) Alice Wonderland' : memberId;
    ds.instructorDisplayName = (id: string) =>
      id === 'inst-7' ? 'Bob Builder [inst-7]' : id;

    const target = component.gradingSet().get('grading-7')!;
    target.gradingInstructorId = 'inst-7';
    // Re-set entries (fresh array ref) so the sync effect re-enriches with the
    // updated instructor id and name-lookup mocks.
    component.gradingSet().setEntries([...component.gradingSet().entries()]);
    fixture.detectChanges();

    const search = (term: string) => {
      component.onSearch({ target: { value: term } } as never as Event);
      fixture.detectChanges();
      return component.gradings();
    };

    const byStudent = search('Wonderland');
    expect(byStudent.map((g) => g.docId)).toEqual(['grading-7']);

    const byInstructor = search('Builder');
    expect(byInstructor.map((g) => g.docId)).toEqual(['grading-7']);
  });
});
