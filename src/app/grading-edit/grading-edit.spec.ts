import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { GradingEditComponent } from './grading-edit';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';
import { initGrading } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { RoutingService } from '../routing.service';

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
      addGrading: vi.fn(),
      updateGrading: vi.fn(),
      deleteGrading: vi.fn(),
    } as never as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [GradingEditComponent],
      providers: [
        { provide: RoutingService, useValue: { navigateTo: vi.fn(), matchedPatternId: signal(''), signals: {} } },
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: DataManagerService, useValue: mockDataManagerService },
      ],
    }).compileComponents();

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

  it('should start collapsed', () => {
    expect(component.collapsed()).toBe(true);
  });

  it('should show edit controls for admin users', () => {
    expect(component.canEdit()).toBe(true);
  });
});
