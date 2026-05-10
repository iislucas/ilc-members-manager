/* grading-progress.spec.ts
 *
 * Tests for the GradingProgressComponent: verifies the 3-step workflow
 * step derivation and role-based visibility logic.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { GradingProgressComponent, gradingStep } from './grading-progress';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { initGrading, GradingStatus, initMember } from '../../../functions/src/data-model';

describe('gradingStep', () => {
  it('should return "request" for a pending grading', () => {
    const g = { ...initGrading(), status: GradingStatus.Pending };
    expect(gradingStep(g)).toBe('request');
  });

  it('should return "request" for awaiting acceptance', () => {
    const g = { ...initGrading(), status: GradingStatus.AwaitingAcceptance };
    expect(gradingStep(g)).toBe('request');
  });

  it('should return "accepted" when status is AwaitingGrading', () => {
    const g = { ...initGrading(), status: GradingStatus.AwaitingGrading };
    expect(gradingStep(g)).toBe('accepted');
  });

  it('should return "completed" when status is Passed', () => {
    const g = { ...initGrading(), status: GradingStatus.Passed };
    expect(gradingStep(g)).toBe('completed');
  });

  it('should return "completed" when status is NotPassed', () => {
    const g = { ...initGrading(), status: GradingStatus.NotPassed };
    expect(gradingStep(g)).toBe('completed');
  });
});

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
    };

    mockFirebaseState = createFirebaseStateServiceMock();

    await TestBed.configureTestingModule({
      imports: [GradingProgressComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GradingProgressComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberId: 'student-1',
      studentMemberDocId: 'doc-student-1',
      level: 'Student 3',
      status: GradingStatus.Pending,
    });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should derive step as "request" for a new pending grading', () => {
    expect(component.step()).toBe('request');
  });

  it('should derive step as "accepted" when status is AwaitingGrading', () => {
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      status: GradingStatus.AwaitingGrading,
      gradingInstructorId: 'instr-1',
    });
    fixture.detectChanges();
    expect(component.step()).toBe('accepted');
  });

  it('should derive step as "completed" when status is Passed', () => {
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      status: GradingStatus.Passed,
    });
    fixture.detectChanges();
    expect(component.step()).toBe('completed');
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
      status: GradingStatus.Pending,
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

  it('should show instructor view for assigned delegate in Step 2', () => {
    const mockMember = { ...initMember(), docId: 'doc-instr-2', instructorId: 'instr-2' };
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
      assignedInstructorId: 'instr-2',
      status: GradingStatus.AwaitingGrading,
    });
    fixture.detectChanges();
    expect(component.userIsAssignedInstructor()).toBe(true);
    expect(component.canRecordResult()).toBe(true);
  });
});
