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
import { initGrading, GradingStatus, Grading, initMember } from '../../../functions/src/data-model';

describe('gradingStep', () => {
  it('should return "request" for a pending grading without acceptance', () => {
    const g = { ...initGrading(), status: GradingStatus.Pending, instructorAccepted: false };
    expect(gradingStep(g)).toBe('request');
  });

  it('should return "accepted" when instructor has accepted', () => {
    const g = { ...initGrading(), status: GradingStatus.Pending, instructorAccepted: true };
    expect(gradingStep(g)).toBe('accepted');
  });

  it('should return "completed" when status is Passed', () => {
    const g = { ...initGrading(), status: GradingStatus.Passed, instructorAccepted: true };
    expect(gradingStep(g)).toBe('completed');
  });

  it('should return "completed" when status is NotPassed', () => {
    const g = { ...initGrading(), status: GradingStatus.NotPassed, instructorAccepted: true };
    expect(gradingStep(g)).toBe('completed');
  });

  it('should return "request" for RequiresReview without acceptance', () => {
    const g = { ...initGrading(), status: GradingStatus.RequiresReview, instructorAccepted: false };
    expect(gradingStep(g)).toBe('request');
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
    });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should derive step as "request" for a new pending grading', () => {
    expect(component.step()).toBe('request');
  });

  it('should derive step as "accepted" when instructorAccepted is true', () => {
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      status: GradingStatus.Pending,
      instructorAccepted: true,
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
      instructorAccepted: true,
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
});
