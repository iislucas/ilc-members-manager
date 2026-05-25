import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GradingListComponent } from './grading-list';
import { FirebaseStateService } from '../firebase-state.service';
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

    await TestBed.configureTestingModule({
      imports: [GradingListComponent, MockGradingEditComponent, MockGradingRowHeaderComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
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
});
