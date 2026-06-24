import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GradingListComponent } from './grading-list';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { Grading, initGrading } from '../../../functions/src/data-model';
import { signal, Component, Input } from '@angular/core';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { ROUTING_CONFIG, initPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
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

  it('interleaves standalone gradings with event blocks on the date timeline', () => {
    const mk = (docId: string, eventDocId: string, eventDate: string, eventName: string): Grading => {
      const g = initGrading();
      g.docId = docId;
      g.gradingEventDocId = eventDocId;
      g.gradingEventDate = eventDate;
      g.gradingEvent = eventName;
      return g;
    };
    // Event B spans two days (ends 2026-05-02); standalone gradings sit before,
    // concurrent with, and after it. Event A is earlier.
    component.gradingSet().setEntries([
      mk('s1', '', '2026-06-01', ''), // after event B → above it
      mk('b1', 'event-B', '2026-05-01', 'Event B'),
      mk('b2', 'event-B', '2026-05-02', 'Event B'),
      mk('s2', '', '2026-05-02', ''), // concurrent with event B's last day → below it
      mk('s3', '', '2026-04-01', ''), // before event B → below it
      mk('a1', 'event-A', '2026-03-01', 'Event A'),
    ]);
    fixture.detectChanges();

    expect(component.groupByEvent()).toBe(true);
    const items = component.listItems();
    // Default order is newest-first; an event is anchored at its last day and
    // sits above same-day standalone gradings.
    expect(items.map((i) => i.key)).toEqual([
      'grading:s1',
      'event:event-B',
      'grading:s2',
      'grading:s3',
      'event:event-A',
    ]);

    const eventB = items[1];
    expect(eventB.kind).toBe('event');
    if (eventB.kind === 'event') {
      expect(eventB.group.total).toBe(2);
      expect(eventB.group.title).toBe('Event B');
      expect(eventB.group.date).toBe('2026-05-01'); // earliest day shown in heading
      expect(eventB.group.endDate).toBe('2026-05-02'); // last day anchors the timeline

      // Clicking the event heading filters the list down to that event.
      component.onEventGroupClick(eventB.group);
      fixture.detectChanges();
      expect(component.filterEventDocId()).toBe('event-B');
      expect(component.listItems().map((i) => i.key)).toEqual(['event:event-B']);
    }
  });

  it('mirrors the event filter through the URL `event` param so it is shareable', () => {
    const routing = TestBed.inject(RoutingService) as never as RoutingService<typeof initPathPatterns>;
    const eventParam = routing.signals[Views.ManageGradings].urlParams.event;

    // Clicking an event heading writes the filter to the URL param.
    component.onEventGroupClick({
      eventDocId: 'event-Z',
      title: 'Event Z',
      date: '2026-01-01',
      endDate: '2026-01-01',
      gradings: [],
      total: 0,
    });
    expect(eventParam()).toBe('event-Z');
    expect(component.filterEventDocId()).toBe('event-Z');

    // Conversely, the URL param drives the component's filter (deep-link case).
    eventParam.set('event-Y');
    expect(component.filterEventDocId()).toBe('event-Y');

    // Clearing the filter removes it from the URL.
    component.clearEventFilter();
    expect(eventParam()).toBe('');
  });

  it('does not group in the member view', () => {
    fixture.componentRef.setInput('viewMode', 'member');
    fixture.detectChanges();
    expect(component.groupByEvent()).toBe(false);
    expect(component.listItems()).toEqual([]);
  });
});
