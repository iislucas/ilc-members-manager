/* grading-progress.spec.ts
 *
 * Tests for the GradingProgressComponent: verifies the 3-step workflow
 * step derivation and role-based visibility logic.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, Component, Input, Output, EventEmitter } from '@angular/core';
import { vi } from 'vitest';
import { GradingProgressComponent } from './grading-progress';
import { GradingEventInputComponent } from '../grading-event-input/grading-event-input';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { initGrading, GradingStatus, initMember } from '../../../functions/src/data-model';

@Component({ selector: 'app-grading-event-input', standalone: true, template: '' })
class MockGradingEventInputComponent {
  @Input() gradingEvent = '';
  @Input() gradingEventDate = '';
  @Input() gradingEventDocId = '';
  @Output() gradingEventChange = new EventEmitter<any>();
}



describe('GradingProgressComponent', () => {
  let component: GradingProgressComponent;
  let fixture: ComponentFixture<GradingProgressComponent>;
  let componentRef: ComponentRef<GradingProgressComponent>;
  let mockDataService: Partial<DataManagerService>;
  let mockFirebaseState: FirebaseStateService;

  beforeEach(async () => {
    mockDataService = {
      members: { entries: () => [], get: () => undefined } as never,
      instructors: { entries: () => [], get: () => undefined } as never,
      getMemberByDocId: () => undefined,
      getMemberByMemberId: () => undefined,
      memberDisplayName: (docId: string, memberId: string) => memberId || docId || '',
    };

    mockFirebaseState = createFirebaseStateServiceMock();

    await TestBed.configureTestingModule({
      imports: [GradingProgressComponent, MockGradingEventInputComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: { hrefForView: vi.fn().mockReturnValue('') } },
      ],
    })
      .overrideComponent(GradingProgressComponent, {
        remove: { imports: [GradingEventInputComponent] },
        add: { imports: [MockGradingEventInputComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GradingProgressComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberId: 'student-1',
      studentMemberDocId: 'doc-student-1',
      level: 'Student 3',
      status: GradingStatus.AwaitingRequest,
    });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });



  it('should not show user as student when not logged in', () => {
    expect(component.userIsStudent()).toBe(false);
  });

  it('should show user as student when logged in as the grading student', () => {
    const mockMember = { ...initMember(), docId: 'doc-student-1', instructorId: '' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    fixture.detectChanges();
    expect(component.userIsStudent()).toBe(true);
  });

  it('should show student view for admin who is also the student in Pending state', () => {
    const mockMember = { ...initMember(), docId: 'doc-student-1', instructorId: '' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: true,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberDocId: 'doc-student-1',
      status: GradingStatus.AwaitingRequest,
    });
    fixture.detectChanges();
    expect(component.userIsStudent()).toBe(true);
    // Even though they are admin, we want them to see student view first.
  });

  it('should show read-only view for school manager who is not student or instructor', () => {
    const mockMember = { ...initMember(), docId: 'doc-manager-1', instructorId: '' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: false,
      schoolsManaged: ['school-1'],
      firebaseUser: {} as never,
    });
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberDocId: 'doc-student-2',
      gradingInstructorId: 'instr-2',
      status: GradingStatus.AwaitingAcceptance,
    });
    fixture.detectChanges();
    expect(component.userIsStudent()).toBe(false);
    expect(component.canAccept()).toBe(false);
    expect(component.canRecordResult()).toBe(false);
  });

  it('should show instructor view for assigned grading instructor', () => {
    const mockMember = { ...initMember(), docId: 'doc-instr-1', instructorId: 'instr-1' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      gradingInstructorId: 'instr-1',
      status: GradingStatus.AwaitingAcceptance,
    });
    fixture.detectChanges();
    expect(component.userIsGradingInstructor()).toBe(true);
    expect(component.canAccept()).toBe(true);
  });




  it('should not show instructor view for instructor when status is AwaitingRequest', () => {
    const mockMember = { ...initMember(), docId: 'doc-instr-1', instructorId: 'instr-1' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      gradingInstructorId: 'instr-1',
      status: GradingStatus.AwaitingRequest,
    });
    fixture.detectChanges();
    expect(component.userIsGradingInstructor()).toBe(true);
    expect(component.canAccept()).toBe(false);
  });

  it('should correctly compute assistantInstructors signal', () => {
    const instructorsMap = new Map<string, any>();
    instructorsMap.set('assistant-1', { name: 'Assistant One', instructorId: 'assistant-1' });
    
    // Mock get on instructors
    (mockDataService.instructors as any).get = (id: string) => instructorsMap.get(id) || null;

    componentRef.setInput('grading', {
      ...initGrading(),
      assistantInstructorIds: ['assistant-1', 'assistant-2'],
    });
    fixture.detectChanges();

    const resolved = component.gradingManagers();
    expect(resolved.length).toBe(2);
    expect(resolved[0]).toEqual({ id: 'assistant-1', data: { name: 'Assistant One', instructorId: 'assistant-1' } });
    expect(resolved[1]).toEqual({ id: 'assistant-2', data: null });
  });
});
