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
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { GradingEventInputComponent, GradingEventDetails } from '../grading-event-input/grading-event-input';



@Component({
  selector: 'app-grading-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, InstructorSelectorComponent, GradingEventInputComponent],
  templateUrl: './grading-progress.html',
  styleUrl: './grading-progress.scss',
})
export class GradingProgressComponent implements OnDestroy {
  private firebaseState = inject(FirebaseStateService);
  public dataService = inject(DataManagerService);
  private routingService = inject(RoutingService<AppPathPatterns>);

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

  // Returns true for the primary instructor AND for grading managers (stored in
  // `assistantInstructorIds` — TODO: rename field to `gradingManagerIds` after data migration).
  // Both roles share the same edit permissions.
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

  // Admin, grading instructor, or any grading manager can edit event/instructor/managers.
  canEditGradingDetails = computed(() => this.userIsAdmin() || this.userIsGradingInstructor());

  // Can the current user edit the student fields?
  canEditStudentFields = computed(
    () => this.userIsStudent(),
  );

  // --- Display helpers ---
  // Always render students in the standard "(MemberId) Student Name" form.
  // Some gradings have an empty or stale studentMemberDocId, so fall back to
  // resolving the member by their human-readable memberId before giving up.
  studentName = computed(() => {
    const g = this.grading();
    const member =
      (g.studentMemberDocId
        ? this.dataService.getMemberByDocId(g.studentMemberDocId)
        : undefined) ??
      (g.studentMemberId
        ? this.dataService.getMemberByMemberId(g.studentMemberId)
        : undefined);
    if (member) {
      return `(${member.memberId}) ${member.name}`;
    }
    return g.studentMemberId || g.studentMemberDocId || '';
  });

  gradingInstructor = computed(() => {
    const id = this.grading().gradingInstructorId;
    if (!id) return null;
    return this.dataService.instructors.get(id) ?? null;
  });

  // Grading managers — displayed as "Grading Managers" in the UI.
  // Backed by the legacy Firestore field `assistantInstructorIds`.
  gradingManagers = computed<Array<{ id: string; data: InstructorPublicData | null }>>(() => {
    const ids = this.grading().assistantInstructorIds || [];
    return ids.map((id) => ({
      id,
      data: this.dataService.instructors.get(id) ?? null,
    }));
  });

  eventLink = computed(() => {
    const docId = this.grading().gradingEventDocId;
    if (!docId) return '';
    return this.routingService.hrefForView(Views.EventView, { eventId: docId });
  });

  // Label for the connected-event link. When a date is known we show
  // "YYYY-MM-DD — Event" so the grading date travels with the event, matching
  // how linked events are displayed in the grading event input.
  eventLinkLabel = computed(() => {
    const g = this.grading();
    return g.gradingEventDate
      ? `${g.gradingEventDate} — ${g.gradingEvent}`
      : g.gradingEvent;
  });

  // --- Editable fields (local signals synced from grading input) ---
  protected editInstructorId = signal('');
  protected editStudentNotes = signal('');
  protected editGradingEvent = signal('');
  protected editGradingEventDate = signal('');
  protected editGradingEventDocId = signal('');
  // Local edit signal for grading managers (backed by `assistantInstructorIds`).
  protected editGradingManagerIds = signal<string[]>([]);
  protected editResultNotes = signal('');
  protected editDeclineNotes = signal('');
  protected showDeclineForm = signal(false);
  protected isEditingRequest = signal(false);
  protected isSaving = signal(false);

  // Inline edit toggles for detail fields (admin / grading instructor / managers).
  protected isEditingEvent = signal(false);
  protected isEditingInstructor = signal(false);
  protected isEditingManagers = signal(false);

  // Sync local editing signals from grading input whenever it changes.
  private syncEffect = effect(() => {
    const g = this.grading();
    this.editInstructorId.set(g.gradingInstructorId);
    this.editStudentNotes.set(g.studentNotes);
    this.editGradingEvent.set(g.gradingEvent);
    this.editGradingEventDate.set(g.gradingEventDate);
    this.editGradingEventDocId.set(g.gradingEventDocId);
    this.editGradingManagerIds.set(g.assistantInstructorIds || []);
    this.editResultNotes.set(g.resultNotes);
    this.editDeclineNotes.set(g.declineNotes || '');
  });

  isDirty = computed(() => {
    const g = this.grading();
    return (
      this.editGradingEvent() !== g.gradingEvent ||
      this.editGradingEventDate() !== g.gradingEventDate ||
      this.editResultNotes() !== g.resultNotes ||
      this.editInstructorId() !== g.gradingInstructorId ||
      JSON.stringify(this.editGradingManagerIds()) !== JSON.stringify(g.assistantInstructorIds || [])
    );
  });

  saveStatus = signal<'Unsaved changes' | 'saving...' | 'saved' | ''>('');

  private autoSaveTimer: any = null;

  private autoSaveEffect = effect(() => {
    const dirty = this.isDirty();
    const event = this.editGradingEvent();
    const date = this.editGradingEventDate();
    const notes = this.editResultNotes();
    const assistants = this.editGradingManagerIds();
    const instructor = this.editInstructorId();

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
        gradingInstructorId: this.editInstructorId(),
        assistantInstructorIds: this.editGradingManagerIds().filter(id => id !== ''),
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
        gradingInstructorId: this.editInstructorId(),
        assistantInstructorIds: this.editGradingManagerIds().filter(id => id !== ''),
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

  onEventInputChange(details: GradingEventDetails) {
    this.editGradingEvent.set(details.gradingEvent);
    this.editGradingEventDate.set(details.gradingEventDate);
    this.editGradingEventDocId.set(details.gradingEventDocId);
  }

  saveEventDetails() {
    this.gradingUpdated.emit({
      gradingEvent: this.editGradingEvent(),
      gradingEventDate: this.editGradingEventDate(),
      gradingEventDocId: this.editGradingEventDocId(),
    });
    this.isEditingEvent.set(false);
  }

  cancelEventEdit() {
    const g = this.grading();
    this.editGradingEvent.set(g.gradingEvent);
    this.editGradingEventDate.set(g.gradingEventDate);
    this.editGradingEventDocId.set(g.gradingEventDocId);
    this.isEditingEvent.set(false);
  }

  saveGradingInstructor() {
    this.gradingUpdated.emit({ gradingInstructorId: this.editInstructorId() });
    this.isEditingInstructor.set(false);
  }

  saveManagers() {
    this.gradingUpdated.emit({
      assistantInstructorIds: this.editGradingManagerIds().filter(id => id !== ''),
    });
    this.isEditingManagers.set(false);
  }

  cancelManagerEdit() {
    this.editGradingManagerIds.set(this.grading().assistantInstructorIds || []);
    this.isEditingManagers.set(false);
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

  addGradingManager() {
    this.editGradingManagerIds.update((ids) => [...ids, '']);
  }

  removeGradingManager(index: number) {
    this.editGradingManagerIds.update((ids) => ids.filter((_, i) => i !== index));
  }

  updateGradingManagerId(index: number, value: string) {
    const managers = [...this.editGradingManagerIds()];
    managers[index] = value;
    this.editGradingManagerIds.set(managers);
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
      gradingInstructorId: this.editInstructorId(),
      assistantInstructorIds: this.editGradingManagerIds().filter(id => id !== ''),
    };
    this.gradingUpdated.emit(update);
    this.isSaving.set(false);
  }
}
