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
import { SearchableSet } from '../searchable-set';

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
      members: new SearchableSet(['memberId'], 'memberId', []) as never,
      instructors: new SearchableSet(['instructorId'], 'instructorId', []) as never,
      getMemberByDocId: () => undefined,
      getMemberByMemberId: () => undefined,
      getMyStudent: () => undefined,
      memberDisplayName: (docId: string, memberId: string) => memberId || docId || '',
      instructorDisplayName: (instructorId: string) => instructorId,
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

  it('lets the student edit the linked event before acceptance but not after', () => {
    const mockMember = { ...initMember(), docId: 'doc-student-1', instructorId: '' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });

    const setStatus = (status: GradingStatus) => {
      componentRef.setInput('grading', {
        ...initGrading(),
        docId: 'g1',
        studentMemberDocId: 'doc-student-1',
        status,
      });
      fixture.detectChanges();
    };

    // Before acceptance: the student owns the event field.
    setStatus(GradingStatus.AwaitingRequest);
    expect(component.gradingAccepted()).toBe(false);
    expect(component.canEditEvent()).toBe(true);

    setStatus(GradingStatus.AwaitingAcceptance);
    expect(component.canEditEvent()).toBe(true);

    setStatus(GradingStatus.Declined);
    expect(component.canEditEvent()).toBe(true);

    // Once accepted (or beyond), the grading manager owns it: read-only for the student.
    setStatus(GradingStatus.AwaitingGrading);
    expect(component.gradingAccepted()).toBe(true);
    expect(component.canEditEvent()).toBe(false);

    setStatus(GradingStatus.Passed);
    expect(component.canEditEvent()).toBe(false);

    setStatus(GradingStatus.NotPassed);
    expect(component.canEditEvent()).toBe(false);
  });

  it('lets a grading manager edit the linked event even after acceptance', () => {
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
      status: GradingStatus.Passed,
    });
    fixture.detectChanges();
    expect(component.gradingAccepted()).toBe(true);
    expect(component.canEditEvent()).toBe(true);
  });

  it('only allows accepting when it is the student\'s next grading', () => {
    const mockMember = { ...initMember(), docId: 'doc-instr-1', instructorId: 'instr-1' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    // Student is currently Student 5 → their next grading is Student 6.
    mockDataService.getMemberByDocId = (() => ({
      ...initMember(),
      studentLevel: '5',
      applicationLevel: '2',
    })) as never;

    // Grading for the correct next level: acceptable.
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberDocId: 'doc-student-1',
      gradingInstructorId: 'instr-1',
      level: 'Student 6',
      status: GradingStatus.AwaitingAcceptance,
    });
    fixture.detectChanges();
    expect(component.studentNextGradingLevel()).toBe('Student 6');
    expect(component.isNextGrading()).toBe(true);
    expect(component.canAccept()).toBe(true);

    // Grading for a later level (skipping ahead): not their next grading.
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberDocId: 'doc-student-1',
      gradingInstructorId: 'instr-1',
      level: 'Student 7',
      status: GradingStatus.AwaitingAcceptance,
    });
    fixture.detectChanges();
    expect(component.isNextGrading()).toBe(false);
  });

  it('does not block accepting when the student levels are unknown', () => {
    const mockMember = { ...initMember(), docId: 'doc-instr-1', instructorId: 'instr-1' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    // getMemberByDocId / getMyStudent both return undefined (default mock).
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberDocId: 'doc-student-1',
      gradingInstructorId: 'instr-1',
      level: 'Student 7',
      status: GradingStatus.AwaitingAcceptance,
    });
    fixture.detectChanges();
    expect(component.studentNextGradingLevel()).toBe('');
    expect(component.isNextGrading()).toBe(true);
  });

  it('flags an instructor not qualified to assess the grading level', () => {
    const instructorsMap = new Map<string, any>();
    // Instructor at Student 4 cannot assess Application 3 (needs Student 5).
    instructorsMap.set('low-instr', { instructorId: 'low-instr', studentLevel: '4' });
    instructorsMap.set('high-instr', { instructorId: 'high-instr', studentLevel: '6' });
    (mockDataService.instructors as any).get = (id: string) => instructorsMap.get(id) || null;

    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberDocId: 'doc-student-1',
      level: 'Application 3',
      status: GradingStatus.AwaitingRequest,
    });
    fixture.detectChanges();

    component['editInstructorId'].set('low-instr');
    expect(component.selectedInstructorUnqualified()).toBe(true);

    component['editInstructorId'].set('high-instr');
    expect(component.selectedInstructorUnqualified()).toBe(false);

    // No special requirement for student-level gradings.
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberDocId: 'doc-student-1',
      level: 'Student 6',
      status: GradingStatus.AwaitingRequest,
    });
    fixture.detectChanges();
    component['editInstructorId'].set('low-instr');
    expect(component.selectedInstructorUnqualified()).toBe(false);
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
