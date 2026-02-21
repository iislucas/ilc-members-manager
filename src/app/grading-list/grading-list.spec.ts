import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GradingListComponent } from './grading-list';
import { FirebaseStateService } from '../firebase-state.service';
import { SearchableSet } from '../searchable-set';
import { Grading, initGrading } from '../../../functions/src/data-model';
import { signal, Component, Input } from '@angular/core';
import { GradingEditComponent } from '../grading-edit/grading-edit';

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

describe('GradingListComponent', () => {
  let component: GradingListComponent;
  let fixture: ComponentFixture<GradingListComponent>;
  let mockFirebaseStateService: any;

  beforeEach(async () => {
    mockFirebaseStateService = {
      user: signal({ isAdmin: true, schoolsManaged: [], member: { instructorId: '' } }),
    };

    await TestBed.configureTestingModule({
      imports: [GradingListComponent, MockGradingEditComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
      ],
    })
      .overrideComponent(GradingListComponent, {
        remove: { imports: [GradingEditComponent] },
        add: { imports: [MockGradingEditComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GradingListComponent);
    component = fixture.componentInstance;

    // Create a set of gradings
    const gradings: Grading[] = [];
    for (let i = 0; i < 60; i++) {
      const g = initGrading();
      g.id = `grading-${i}`;
      g.studentId = `student-${i}`;
      gradings.push(g);
    }
    const gradingSet = new SearchableSet<'id', Grading>(
      ['studentId'],
      'id',
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
});
