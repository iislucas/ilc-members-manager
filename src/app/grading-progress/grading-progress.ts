/* grading-progress.ts
 *
 * Displays the grading workflow as a 3-step progress indicator with
 * role-aware, editable inline forms. Each viewer (student, grading
 * instructor, assigned instructor, admin) sees a contextual message
 * plus the form fields they need to fill in for the current step.
 *
 * Steps:
 *   1. Request — student selects an instructor, adds notes and optionally
 *      picks a grading event/date.
 *   2. Accept — instructor accepts, optionally assigning a delegate and
 *      setting the grading event/date.
 *   3. Grading — grading/assigned instructor records Passed/NotPassed
 *      with result notes and confirms the date.
 */

import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  inject,
  computed,
  signal,
  effect,
  OnDestroy,
} from '@angular/core';
import {
  Grading,
  GradingStatus,
  InstructorPublicData,
  Member,
} from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { InstructorSelectorComponent } from '../instructor-selector/instructor-selector';



@Component({
  selector: 'app-grading-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, InstructorSelectorComponent],
  templateUrl: './grading-progress.html',
  styleUrl: './grading-progress.scss',
})
export class GradingProgressComponent implements OnDestroy {
  private firebaseState = inject(FirebaseStateService);
  public dataService = inject(DataManagerService);

  grading = input.required<Grading>();
  gradingUpdated = output<Partial<Grading>>();

  GradingStatus = GradingStatus;



  // --- User role checks ---
  userIsAdmin = computed(() => this.firebaseState.user()?.isAdmin ?? false);

  userIsStudent = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    return this.grading().studentMemberDocId === user.member.docId;
  });

  userIsGradingInstructor = computed(() => {
    const user = this.firebaseState.user();
    if (!user || !user.member.instructorId) return false;
    return user.member.instructorId === this.grading().gradingInstructorId ||
      (this.grading().assistantInstructorIds || []).includes(user.member.instructorId);
  });

  // Can the current user record a result?
  canRecordResult = computed(
    () => this.userIsGradingInstructor(),
  );

  // Can the current user accept the request (grading instructor)?
  canAccept = computed(
    () => this.userIsGradingInstructor() && (this.grading().status === GradingStatus.AwaitingAcceptance || this.grading().status === GradingStatus.Declined),
  );

  // Can the current user edit the student fields?
  canEditStudentFields = computed(
    () => this.userIsStudent(),
  );

  // --- Display helpers ---
  studentName = computed(() => {
    const docId = this.grading().studentMemberDocId;
    if (!docId) return '';
    const member = this.dataService.members.get(docId);
    return member ? `(${member.memberId}) ${member.name}` : (this.grading().studentMemberId || docId);
  });

  gradingInstructor = computed(() => {
    const id = this.grading().gradingInstructorId;
    if (!id) return null;
    return this.dataService.instructors.get(id) ?? null;
  });

  assistantInstructors = computed<Array<{ id: string; data: InstructorPublicData | null }>>(() => {
    const ids = this.grading().assistantInstructorIds || [];
    return ids.map((id) => ({
      id,
      data: this.dataService.instructors.get(id) ?? null,
    }));
  });

  // --- Editable fields (local signals synced from grading input) ---
  protected editInstructorId = signal('');
  protected editStudentNotes = signal('');
  protected editGradingEvent = signal('');
  protected editGradingEventDate = signal('');
  protected editAssistantIds = signal<string[]>([]);
  protected editResultNotes = signal('');
  protected editDeclineNotes = signal('');
  protected showDeclineForm = signal(false);
  protected isEditingRequest = signal(false);
  protected isSaving = signal(false);

  // Sync local editing signals from grading input whenever it changes.
  private syncEffect = effect(() => {
    const g = this.grading();
    this.editInstructorId.set(g.gradingInstructorId);
    this.editStudentNotes.set(g.studentNotes);
    this.editGradingEvent.set(g.gradingEvent);
    this.editGradingEventDate.set(g.gradingEventDate);
    this.editAssistantIds.set(g.assistantInstructorIds || []);
    this.editResultNotes.set(g.resultNotes);
    this.editDeclineNotes.set(g.declineNotes || '');
  });

  isDirty = computed(() => {
    const g = this.grading();
    return (
      this.editGradingEvent() !== g.gradingEvent ||
      this.editGradingEventDate() !== g.gradingEventDate ||
      this.editResultNotes() !== g.resultNotes ||
      JSON.stringify(this.editAssistantIds()) !== JSON.stringify(g.assistantInstructorIds || [])
    );
  });

  saveStatus = signal<'Unsaved changes' | 'saving...' | 'saved' | ''>('');

  private autoSaveTimer: any = null;

  private autoSaveEffect = effect(() => {
    const dirty = this.isDirty();
    const event = this.editGradingEvent();
    const date = this.editGradingEventDate();
    const notes = this.editResultNotes();
    const assistants = this.editAssistantIds();

    if (!dirty) {
      return;
    }

    this.saveStatus.set('Unsaved changes');

    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = setTimeout(() => {
      this.triggerAutoSave();
    }, 5000);
  });

  async triggerAutoSave() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    if (!this.isDirty()) return;

    this.saveStatus.set('saving...');
    try {
      const update: Partial<Grading> = {
        gradingEvent: this.editGradingEvent(),
        gradingEventDate: this.editGradingEventDate(),
        resultNotes: this.editResultNotes(),
        assistantInstructorIds: this.editAssistantIds().filter(id => id !== ''),
      };
      this.gradingUpdated.emit(update);
      this.saveStatus.set('saved');
      setTimeout(() => {
        if (this.saveStatus() === 'saved') {
          this.saveStatus.set('');
        }
      }, 3000);
    } catch (e) {
      console.error('Auto-save failed:', e);
      this.saveStatus.set('Unsaved changes');
    }
  }

  ngOnDestroy() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    if (this.isDirty()) {
      const update: Partial<Grading> = {
        gradingEvent: this.editGradingEvent(),
        gradingEventDate: this.editGradingEventDate(),
        resultNotes: this.editResultNotes(),
        assistantInstructorIds: this.editAssistantIds().filter(id => id !== ''),
      };
      this.gradingUpdated.emit(update);
    }
  }

  // --- Step 1 dirty check: has the student changed anything? ---
  step1Dirty = computed(() => {
    const g = this.grading();
    return (
      this.editInstructorId() !== g.gradingInstructorId ||
      this.editStudentNotes() !== g.studentNotes ||
      this.editGradingEvent() !== g.gradingEvent ||
      this.editGradingEventDate() !== g.gradingEventDate
    );
  });

  // Step 1: Save student request fields
  saveRequestFields() {
    this.isSaving.set(true);
    const instructorId = this.editInstructorId();
    const update: Partial<Grading> = {
      gradingInstructorId: instructorId,
      studentNotes: this.editStudentNotes(),
      gradingEvent: this.editGradingEvent(),
      gradingEventDate: this.editGradingEventDate(),
      status: instructorId ? GradingStatus.AwaitingAcceptance : GradingStatus.AwaitingRequest,
    };

    if (this.grading().status === GradingStatus.Declined) {
      update.declineNotes = '';
    }

    this.gradingUpdated.emit(update);
    this.isEditingRequest.set(false);
    this.isSaving.set(false);
  }

  cancelRequest() {
    this.isSaving.set(true);
    this.gradingUpdated.emit({
      gradingInstructorId: '',
      studentNotes: '',
      gradingEvent: '',
      gradingEventDate: '',
      status: GradingStatus.AwaitingRequest,
    });
    this.isEditingRequest.set(false);
    this.isSaving.set(false);
  }

  // Step 2: Instructor accepts and will grade themselves

  addAssistantInstructor() {
    this.editAssistantIds.update((ids) => [...ids, '']);
  }

  removeAssistantInstructor(index: number) {
    this.editAssistantIds.update((ids) => ids.filter((_, i) => i !== index));
  }

  updateAssistantInstructorId(index: number, value: string) {
    const assistants = [...this.editAssistantIds()];
    assistants[index] = value;
    this.editAssistantIds.set(assistants);
  }

  declineRequest() {
    this.isSaving.set(true);
    this.gradingUpdated.emit({
      status: GradingStatus.Declined,
      declineNotes: this.editDeclineNotes(),
      instructorAcceptedDate: '',
    });
    this.isSaving.set(false);
  }

  acceptAndGradeMyself() {
    this.isSaving.set(true);
    const today = new Date().toISOString().split('T')[0];
    this.gradingUpdated.emit({
      status: GradingStatus.AwaitingGrading,
      instructorAcceptedDate: today,
      gradingEvent: this.editGradingEvent(),
      gradingEventDate: this.editGradingEventDate(),
    });
    this.showDeclineForm.set(false);
    this.isSaving.set(false);
  }



  // Step 3: Mark result
  markResult(status: GradingStatus.Passed | GradingStatus.NotPassed) {
    this.isSaving.set(true);
    const update: Partial<Grading> = {
      status,
      gradingEventDate: this.editGradingEventDate() || new Date().toISOString().split('T')[0],
      resultNotes: this.editResultNotes(),
      assistantInstructorIds: this.editAssistantIds().filter(id => id !== ''),
    };
    this.gradingUpdated.emit(update);
    this.isSaving.set(false);
  }
}
