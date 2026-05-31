import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { GradingEditComponent } from './grading-edit';
import { GradingEventInputComponent } from '../grading-event-input/grading-event-input';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';
import { initGrading } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { RoutingService } from '../routing.service';

@Component({ selector: 'app-grading-event-input', standalone: true, template: '' })
class MockGradingEventInputComponent {
  @Input() gradingEvent = '';
  @Input() gradingEventDate = '';
  @Input() gradingEventDocId = '';
  @Output() gradingEventChange = new EventEmitter<any>();
}

describe('GradingEditComponent', () => {
  let component: GradingEditComponent;
  let fixture: ComponentFixture<GradingEditComponent>;
  let mockFirebaseStateService: FirebaseStateService;
  let mockDataManagerService: DataManagerService;

  beforeEach(async () => {
    mockFirebaseStateService = {
      user: signal({
        isAdmin: true,
        schoolsManaged: [],
        member: { instructorId: '' },
      }),
    } as never as FirebaseStateService;

    mockDataManagerService = {
      members: new SearchableSet(['name'], 'memberId'),
      instructors: new SearchableSet(['name'], 'instructorId'),
      schools: new SearchableSet(['schoolName'], 'schoolId'),
      addGrading: vi.fn(),
      updateGrading: vi.fn(),
      deleteGrading: vi.fn(),
      searchEvents: vi.fn().mockResolvedValue([]),
    } as never as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [GradingEditComponent, MockGradingEventInputComponent],
      providers: [
        { provide: RoutingService, useValue: { navigateTo: vi.fn(), matchedPatternId: signal(''), signals: {} } },
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: DataManagerService, useValue: mockDataManagerService },
      ],
    })
      .overrideComponent(GradingEditComponent, {
        remove: { imports: [GradingEventInputComponent] },
        add: { imports: [MockGradingEventInputComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GradingEditComponent);
    component = fixture.componentInstance;
    const g = initGrading();
    g.docId = 'test-grading';
    fixture.componentRef.setInput('grading', g);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have the correct grading input', () => {
    expect(component.grading().docId).toBe('test-grading');
  });

  it('should show edit controls for admin users', () => {
    expect(component.canEdit()).toBe(true);
  });
});
