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
import { initGrading, GradingStatus, initMember, Grading, PaymentStatus } from '../../../functions/src/data-model';
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
      myGradings: new SearchableSet(['docId'], 'docId', []) as never,
      getMemberByDocId: () => undefined,
      getMemberByMemberId: () => undefined,
      getMyStudent: () => undefined,
      memberDisplayName: (docId: string, memberId: string) => memberId || docId || '',
      instructorDisplayName: (instructorId: string, cachedName?: string) => cachedName || instructorId || '',
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

  it('measures order against the acceptance snapshot once accepted, not the current level', () => {
    const mockMember = { ...initMember(), docId: 'doc-instr-1', instructorId: 'instr-1' };
    mockFirebaseState.user.set({
      member: mockMember,
      memberProfiles: [mockMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    // The student has since passed and is now Student 6 (next would be Student 7).
    mockDataService.getMemberByDocId = (() => ({
      ...initMember(),
      studentLevel: '6',
      applicationLevel: '2',
    })) as never;

    // A completed grading for Student 6 — in order at acceptance (student held
    // Student 5 then). It must not be flagged out of order despite the student
    // having since levelled up, and the warning must stay hidden.
    componentRef.setInput('grading', {
      ...initGrading(),
      docId: 'g1',
      studentMemberDocId: 'doc-student-1',
      gradingInstructorId: 'instr-1',
      level: 'Student 6',
      status: GradingStatus.Passed,
      studentLevelAtAcceptance: '5',
      applicationLevelAtAcceptance: '2',
    });
    fixture.detectChanges();
    expect(component.studentNextGradingLevel()).toBe('Student 6');
    expect(component.isNextGrading()).toBe(true);
    expect(component.showGradingOutOfOrderWarning()).toBe(false);
  });

  it('shows the current-level out-of-order warning to the requesting student', () => {
    // Student viewing their own out-of-order request (no acceptance snapshot yet)
    // should see the warning, as should the accepting instructor.
    const studentMember = { ...initMember(), docId: 'doc-student-1', instructorId: '' };
    mockFirebaseState.user.set({
      member: studentMember,
      memberProfiles: [studentMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    mockDataService.getMemberByDocId = (() => ({
      ...initMember(),
      studentLevel: '5',
      applicationLevel: '2',
    })) as never;
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
    expect(component.canAccept()).toBe(false);
    expect(component.userIsStudent()).toBe(true);
    expect(component.showGradingOutOfOrderWarning()).toBe(true);
  });

  it('hides the current-level out-of-order warning from unrelated non-accepting viewers', () => {
    // A logged-in member who is neither the student nor the accepting instructor
    // should not see the pre-acceptance warning.
    const otherMember = { ...initMember(), docId: 'doc-other-1', instructorId: '' };
    mockFirebaseState.user.set({
      member: otherMember,
      memberProfiles: [otherMember],
      isAdmin: false,
      schoolsManaged: [],
      firebaseUser: {} as never,
    });
    mockDataService.getMemberByDocId = (() => ({
      ...initMember(),
      studentLevel: '5',
      applicationLevel: '2',
    })) as never;
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
    expect(component.canAccept()).toBe(false);
    expect(component.userIsStudent()).toBe(false);
    expect(component.showGradingOutOfOrderWarning()).toBe(false);
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

  it('should correctly compute the grading managers signal', () => {
    const instructorsMap = new Map<string, any>();
    instructorsMap.set('manager-1', { name: 'Manager One', instructorId: 'manager-1' });

    // Mock get on instructors
    (mockDataService.instructors as any).get = (id: string) => instructorsMap.get(id) || null;

    componentRef.setInput('grading', {
      ...initGrading(),
      gradingManagerIds: ['manager-1', 'manager-2'],
    });
    fixture.detectChanges();

    const resolved = component.gradingManagers();
    expect(resolved.length).toBe(2);
    expect(resolved[0]).toEqual({ id: 'manager-1', data: { name: 'Manager One', instructorId: 'manager-1' } });
    expect(resolved[1]).toEqual({ id: 'manager-2', data: null });
  });

  // Regression: a pre-existing unlinked event (free-text `gradingEvent` with no
  // linked `gradingEventDocId`, e.g. legacy data) must not silently block saving
  // other fields such as grading managers. See grading ccN4T2XAgtxQ2HQQJjOf.
  describe('unlinked-event save guard', () => {
    beforeEach(() => {
      const adminMember = { ...initMember(), docId: 'doc-admin', instructorId: '213' };
      mockFirebaseState.user.set({
        member: adminMember, memberProfiles: [adminMember], isAdmin: true,
        schoolsManaged: [], firebaseUser: {} as never,
      });
      componentRef.setInput('grading', {
        ...initGrading(),
        docId: 'g1',
        studentMemberDocId: 'doc-student-1',
        status: GradingStatus.AwaitingGrading,
        gradingInstructorId: '222',
        gradingManagerIds: ['213', '197'],
        gradingEvent: 'Alberto Benedusi private lesson',
        gradingEventDocId: '',
      });
      fixture.detectChanges();
    });

    it('does not block a save when the unlinked event is left untouched', () => {
      // The event itself is invalid...
      expect(component.eventInputInvalid()).toBe(true);
      // ...but it isn't being changed, so it must not block other edits.
      expect(component.eventBlocksSave()).toBe(false);

      const emitted: Partial<Grading>[] = [];
      component.gradingUpdated.subscribe((u) => emitted.push(u));
      component.removeGradingManager(0); // remove self ('213')
      component.saveEdits();

      expect(emitted.length).toBe(1);
      expect(emitted[0].gradingManagerIds).toEqual(['197']);
    });

    it('blocks the save when the event is edited into an unlinked state', () => {
      component['editGradingEvent'].set('Some new unlinked event');
      component['editGradingEventDocId'].set('');
      expect(component.eventBlocksSave()).toBe(true);
    });
  });

  // A grading always needs a date; the result buttons are gated on it.
  describe('grading date requirement', () => {
    beforeEach(() => {
      const instr = { ...initMember(), docId: 'doc-instr', instructorId: '222' };
      mockFirebaseState.user.set({
        member: instr, memberProfiles: [instr], isAdmin: false,
        schoolsManaged: [], firebaseUser: {} as never,
      });
      componentRef.setInput('grading', {
        ...initGrading(),
        docId: 'g1',
        studentMemberDocId: 'doc-student-1',
        status: GradingStatus.AwaitingGrading,
        gradingInstructorId: '222',
        gradingEvent: '',
        gradingEventDate: '',
        gradingEventDocId: '',
      });
      fixture.detectChanges();
    });

    it('flags a missing date and refuses to record a result', () => {
      expect(component.gradingDateMissing()).toBe(true);
      const emitted: Partial<Grading>[] = [];
      component.gradingUpdated.subscribe((u) => emitted.push(u));
      component.markResult(GradingStatus.Passed);
      expect(emitted.length).toBe(0);
    });

    it('records the result once a date is set', () => {
      component['editGradingEventDate'].set('2026-07-04');
      expect(component.gradingDateMissing()).toBe(false);
      const emitted: Partial<Grading>[] = [];
      component.gradingUpdated.subscribe((u) => emitted.push(u));
      component.markResult(GradingStatus.Passed);
      expect(emitted.length).toBe(1);
      expect(emitted[0].status).toBe(GradingStatus.Passed);
      expect(emitted[0].gradingEventDate).toBe('2026-07-04');
    });
  });

  describe('grading managers editor', () => {
    function setGrading(managerIds: string[]) {
      componentRef.setInput('grading', {
        ...initGrading(),
        docId: 'g1',
        studentMemberDocId: 'doc-student-1',
        status: GradingStatus.Passed,
        gradingManagerIds: managerIds,
      });
      fixture.detectChanges();
    }

    it('opens with one empty row when there are no managers', () => {
      setGrading([]);
      component.openManagersEditor();
      expect(component['isEditingManagers']()).toBe(true);
      expect(component['editGradingManagerIds']()).toEqual(['']);
    });

    it('opens without adding a row when managers already exist', () => {
      setGrading(['213']);
      component.openManagersEditor();
      expect(component['isEditingManagers']()).toBe(true);
      expect(component['editGradingManagerIds']()).toEqual(['213']);
    });

    it('removing the sole added row closes the editor (add mode)', () => {
      setGrading([]);
      component.openManagersEditor();
      component.removeManagerInEditor(0);
      expect(component['isEditingManagers']()).toBe(false);
      expect(component['editGradingManagerIds']()).toEqual([]);
    });

    it('keeps the editor open when clearing pre-existing managers', () => {
      setGrading(['213']);
      component.openManagersEditor();
      component.removeManagerInEditor(0);
      expect(component['isEditingManagers']()).toBe(true);
      expect(component['editGradingManagerIds']()).toEqual([]);
    });
  });

  describe('unpaid grading warning visibility', () => {
    it('shows the payment prompt to the student across all grading workflow statuses', () => {
      const studentMember = { ...initMember(), docId: 'doc-student-1', instructorId: '' };
      mockFirebaseState.user.set({
        member: studentMember,
        memberProfiles: [studentMember],
        isAdmin: false,
        schoolsManaged: [],
        firebaseUser: {} as never,
      });

      const statuses = [
        GradingStatus.AwaitingRequest,
        GradingStatus.AwaitingAcceptance,
        GradingStatus.Declined,
        GradingStatus.AwaitingGrading,
        GradingStatus.Passed,
        GradingStatus.NotPassed,
      ];

      for (const status of statuses) {
        componentRef.setInput('grading', {
          ...initGrading(),
          docId: 'g1',
          studentMemberDocId: 'doc-student-1',
          status,
          paymentStatus: PaymentStatus.NotYetPaid,
        });
        fixture.detectChanges();
        expect(component.isUnpaid()).toBe(true);
        expect(component.userIsStudent()).toBe(true);
        const el = fixture.nativeElement as HTMLElement;
        const prompt = el.querySelector('.payment-prompt');
        expect(prompt, `Expected payment-prompt to be visible for status ${status}`).not.toBeNull();
      }
    });

    it('shows unpaid warning to instructor in AwaitingGrading and Passed states', () => {
      const instrMember = { ...initMember(), docId: 'doc-instr-1', instructorId: 'instr-1' };
      mockFirebaseState.user.set({
        member: instrMember,
        memberProfiles: [instrMember],
        isAdmin: false,
        schoolsManaged: [],
        firebaseUser: {} as never,
      });

      // In AwaitingGrading
      componentRef.setInput('grading', {
        ...initGrading(),
        docId: 'g1',
        studentMemberDocId: 'doc-student-1',
        gradingInstructorId: 'instr-1',
        status: GradingStatus.AwaitingGrading,
        paymentStatus: PaymentStatus.NotYetPaid,
      });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Even if you mark this grading as Passed, the student\'s level will not be updated until they pay');

      // In Passed
      componentRef.setInput('grading', {
        ...initGrading(),
        docId: 'g1',
        studentMemberDocId: 'doc-student-1',
        gradingInstructorId: 'instr-1',
        status: GradingStatus.Passed,
        paymentStatus: PaymentStatus.NotYetPaid,
      });
      fixture.detectChanges();
      expect(el.textContent).toContain('This grading is marked as Passed, but the student\'s level will not be updated until it is paid');
    });
  });

  describe('result confirmation flow', () => {
    beforeEach(() => {
      const instr = { ...initMember(), docId: 'doc-instr', instructorId: '222' };
      mockFirebaseState.user.set({
        member: instr,
        memberProfiles: [instr],
        isAdmin: false,
        schoolsManaged: [],
        firebaseUser: {} as never,
      });
      componentRef.setInput('grading', {
        ...initGrading(),
        docId: 'g1',
        studentMemberDocId: 'doc-student-1',
        status: GradingStatus.AwaitingGrading,
        gradingInstructorId: '222',
        gradingEventDate: '2026-08-15',
        paymentStatus: PaymentStatus.NotYetPaid,
      });
      fixture.detectChanges();
    });

    it('requires confirmation before recording a Passed result', () => {
      expect(component['confirmingResult']()).toBeNull();
      component.initiateMarkResult(GradingStatus.Passed);
      expect(component['confirmingResult']()).toBe(GradingStatus.Passed);

      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.result-confirm-box')).not.toBeNull();
      expect(el.textContent).toContain('Mark this grading as Passed?');
      expect(el.textContent).toContain('notify HQ');
      expect(el.textContent).toContain('Because this grading has not been paid yet');

      // Cancel dismisses the confirmation without emitting
      const emitted: Partial<Grading>[] = [];
      component.gradingUpdated.subscribe((u) => emitted.push(u));
      component.cancelMarkResult();
      expect(component['confirmingResult']()).toBeNull();
      expect(emitted.length).toBe(0);

      // Confirm executes the save
      component.initiateMarkResult(GradingStatus.Passed);
      component.confirmMarkResult();
      expect(component['confirmingResult']()).toBeNull();
      expect(emitted.length).toBe(1);
      expect(emitted[0].status).toBe(GradingStatus.Passed);
    });

    it('requires confirmation before recording a Not Passed result', () => {
      component.initiateMarkResult(GradingStatus.NotPassed);
      expect(component['confirmingResult']()).toBe(GradingStatus.NotPassed);

      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Mark this grading as Not Passed?');

      const emitted: Partial<Grading>[] = [];
      component.gradingUpdated.subscribe((u) => emitted.push(u));
      component.confirmMarkResult();
      expect(emitted.length).toBe(1);
      expect(emitted[0].status).toBe(GradingStatus.NotPassed);
    });
  });

  describe('accepted summary layout in Step 2', () => {
    it('shows Accepted by line first and Your grading instructor line below without tick', () => {
      const studentMember = { ...initMember(), docId: 'doc-student-1', instructorId: '' };
      mockFirebaseState.user.set({
        member: studentMember,
        memberProfiles: [studentMember],
        isAdmin: false,
        schoolsManaged: [],
        firebaseUser: {} as never,
      });

      componentRef.setInput('grading', {
        ...initGrading(),
        docId: 'g1',
        studentMemberDocId: 'doc-student-1',
        gradingInstructorId: 'instr-1',
        gradingInstructorName: 'Master Sam Chin',
        acceptedByName: 'Master Sam Chin',
        status: GradingStatus.AwaitingGrading,
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const acceptedLines = el.querySelectorAll('.accepted-summary .accepted-line');
      expect(acceptedLines.length).toBeGreaterThanOrEqual(2);
      expect(acceptedLines[0].textContent).toContain('Accepted by Master Sam Chin');
      expect(acceptedLines[1].textContent).toContain('Your grading instructor:');
      expect(acceptedLines[1].textContent).toContain('Master Sam Chin');
    });
  });
});
