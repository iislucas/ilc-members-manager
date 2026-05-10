/* grading-progress.spec.ts
 *
 * Tests for the GradingProgressComponent: verifies the 3-step workflow
 * step derivation and role-based visibility logic.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { GradingProgressComponent } from './grading-progress';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { initGrading, GradingStatus, initMember } from '../../../functions/src/data-model';



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
});
