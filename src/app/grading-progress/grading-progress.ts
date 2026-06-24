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
  IlcEvent,
  InstructorPublicData,
  Member,
  nextGradingLevel,
  previousGradingLevel,
  instructorCanAssessLevel,
  gradingManagerIdsOf,
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

  // The event this grading is linked to (if any), loaded live by gradingEventDocId.
  // Used to derive event-organizer/manager grading-manager status.
  private linkedEvent = signal<IlcEvent | undefined>(undefined);
  private _loadLinkedEvent = effect(async () => {
    const docId = this.grading().gradingEventDocId;
    if (!docId) {
      this.linkedEvent.set(undefined);
      return;
    }
    this.linkedEvent.set(await this.dataService.getEventById(docId));
  });

  // True when the current user is the organizer or a manager of the linked
  // event. Such users become managers of the grading (derived live from the
  // link, never cached on the grading).
  userIsEventManager = computed(() => {
    const user = this.firebaseState.user();
    const event = this.linkedEvent();
    if (!user || !event) return false;
    const docId = user.member.docId;
    return event.ownerDocId === docId || (event.managerDocIds || []).includes(docId);
  });

  // Returns true for the primary instructor, for grading managers (stored in
  // `gradingManagerIds`, with legacy fallback to `assistantInstructorIds`), and
  // for the organizer/managers of a linked event. All share the same edit
  // permissions.
  userIsGradingInstructor = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    if (this.userIsEventManager()) return true;
    if (!user.member.instructorId) return false;
    return user.member.instructorId === this.grading().gradingInstructorId ||
      gradingManagerIdsOf(this.grading()).includes(user.member.instructorId);
  });

  // Can the current user record a result?
  canRecordResult = computed(
    () => this.userIsGradingInstructor(),
  );

  // Can the current user accept the request (grading instructor)?
  canAccept = computed(
    () => this.userIsGradingInstructor() && (this.grading().status === GradingStatus.AwaitingAcceptance || this.grading().status === GradingStatus.Declined),
  );

  // The student's member record, looked up by docId. Available to admins/school
  // managers (via `members`) and to the grading instructor for their own
  // students (via `myStudents`). undefined when not loaded.
  private studentMember = computed<Member | undefined>(() => {
    const docId = this.grading().studentMemberDocId;
    if (!docId) return undefined;
    return (
      this.dataService.getMemberByDocId(docId) ??
      this.dataService.getMyStudent(docId)
    );
  });

  // The level the student should grade for next, from the progression. '' when
  // the student's levels aren't known (member record not loaded).
  studentNextGradingLevel = computed(() => {
    const m = this.studentMember();
    if (!m) return '';
    return nextGradingLevel(m.studentLevel, m.applicationLevel);
  });

  // Whether this grading is the student's next grading in the progression. A
  // grading may only be accepted when it is. When the student's levels aren't
  // known we can't verify, so we don't block (returns true).
  isNextGrading = computed(() => {
    const next = this.studentNextGradingLevel();
    if (!next) return true;
    return this.grading().level === next;
  });

  // The level the student holds just before this grading (the preceding entry in
  // the canonical progression). '' when grading for the first progression entry.
  previousLevel = computed(() => previousGradingLevel(this.grading().level));

  // Admin, grading instructor, or any grading manager can edit event/instructor/managers.
  canEditGradingDetails = computed(() => this.userIsAdmin() || this.userIsGradingInstructor());

  // Can the current user edit the student fields?
  canEditStudentFields = computed(
    () => this.userIsStudent(),
  );

  // Name of whoever accepted the grading, for the "Accepted by X" display.
  acceptedByName = computed(() => this.grading().acceptedByName);

  // Name of whoever last changed the status, for the "Moved back by X" display.
  statusActorName = computed(() => this.grading().statusChangedByName);

  // A grading is "accepted" once a grading manager has accepted the request
  // (status moves to AwaitingGrading) or it has progressed beyond that. From
  // this point the linked event becomes the grading managers' responsibility.
  gradingAccepted = computed(() => {
    const status = this.grading().status;
    return (
      status === GradingStatus.AwaitingGrading ||
      status === GradingStatus.Passed ||
      status === GradingStatus.NotPassed ||
      status === GradingStatus.RequiresReview
    );
  });

  // Grading managers/admins can edit the linked event at any time. The student
  // may edit it only until a grading manager has accepted the request; after
  // acceptance they can still see it but the grading manager owns it. This is
  // mirrored in firestore.rules so the restriction is enforced server-side.
  canEditEvent = computed(() => {
    if (this.canEditGradingDetails()) return true;
    return this.userIsStudent() && !this.gradingAccepted();
  });

  // --- Display helpers ---
  // Always render students in the standard "(MemberId) Student Name" form.
  studentName = computed(() => {
    const g = this.grading();
    return this.dataService.memberDisplayName(
      g.studentMemberDocId,
      g.studentMemberId,
      g.studentName,
    );
  });

  gradingInstructor = computed(() => {
    const id = this.grading().gradingInstructorId;
    if (!id) return null;
    return this.dataService.instructors.get(id) ?? null;
  });

  // The instructor the student is currently selecting in the request form, and
  // whether they are unqualified to assess this grading's level. Used to warn
  // the student before they submit. Only flags when the instructor's public
  // data is loaded (otherwise we can't tell, so we don't warn).
  selectedInstructorUnqualified = computed(() => {
    const id = this.editInstructorId();
    if (!id) return false;
    const instr = this.dataService.instructors.get(id);
    if (!instr) return false;
    return !instructorCanAssessLevel(instr.studentLevel, this.grading().level);
  });

  // Display label for the primary grading instructor when their public profile
  // isn't loaded (e.g. non-admin viewers). Falls back to the cached name
  // snapshot on the grading, then the raw instructorId.
  gradingInstructorLabel = computed(() =>
    this.dataService.instructorDisplayName(
      this.grading().gradingInstructorId,
      this.grading().gradingInstructorName,
    ),
  );

  // Grading managers — displayed as "Grading Managers" in the UI. Backed by
  // `gradingManagerIds` (legacy fallback to `assistantInstructorIds`).
  gradingManagers = computed<Array<{ id: string; data: InstructorPublicData | null }>>(() => {
    const ids = gradingManagerIdsOf(this.grading());
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
  // Local edit signal for grading managers (backed by `gradingManagerIds`).
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
    this.editGradingManagerIds.set(gradingManagerIdsOf(g));
    this.editResultNotes.set(g.resultNotes);
    this.editDeclineNotes.set(g.declineNotes || '');
  });

  // The manager-id update written on save: both the canonical `gradingManagerIds`
  // and the legacy `assistantInstructorIds`, kept in sync during the migration
  // window so older clients/rules keep working.
  private managerIdsUpdate(): Partial<Grading> {
    const ids = this.editGradingManagerIds().filter((id) => id !== '');
    return { gradingManagerIds: ids, assistantInstructorIds: ids };
  }

  isDirty = computed(() => {
    const g = this.grading();
    return (
      this.editGradingEvent() !== g.gradingEvent ||
      this.editGradingEventDate() !== g.gradingEventDate ||
      this.editResultNotes() !== g.resultNotes ||
      this.editInstructorId() !== g.gradingInstructorId ||
      JSON.stringify(this.editGradingManagerIds()) !== JSON.stringify(gradingManagerIdsOf(g))
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
        ...this.managerIdsUpdate(),
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
        ...this.managerIdsUpdate(),
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
      ...this.statusActorFields(),
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
      ...this.managerIdsUpdate(),
    });
    this.isEditingManagers.set(false);
  }

  cancelManagerEdit() {
    this.editGradingManagerIds.set(gradingManagerIdsOf(this.grading()));
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
      ...this.statusActorFields(),
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
      // Declining undoes the acceptance, so clear the acceptance milestone.
      instructorAcceptedDate: '',
      acceptedByMemberDocId: '',
      acceptedByName: '',
      ...this.statusActorFields(),
    });
    this.isSaving.set(false);
  }

  // The current logged-in user's member docId + display name.
  private currentActor(): { docId: string; name: string } {
    const member = this.firebaseState.user()?.member;
    return { docId: member?.docId ?? '', name: member?.name ?? '' };
  }

  // The "who last changed the status" fields, stamped with the current user on
  // every workflow status transition so the UI can show "Moved back by X" and
  // co-managers can be told who acted.
  private statusActorFields(): Partial<Grading> {
    const actor = this.currentActor();
    return {
      statusChangedByMemberDocId: actor.docId,
      statusChangedByName: actor.name,
    };
  }

  acceptAndGradeMyself() {
    // A grading can only be accepted when it's the student's next grading in the
    // progression (guarded here as well as in the template).
    if (!this.isNextGrading()) return;
    this.isSaving.set(true);
    const today = new Date().toISOString().split('T')[0];
    const actor = this.currentActor();
    this.gradingUpdated.emit({
      status: GradingStatus.AwaitingGrading,
      instructorAcceptedDate: today,
      // Record both the acceptance milestone and the latest status actor.
      acceptedByMemberDocId: actor.docId,
      acceptedByName: actor.name,
      ...this.statusActorFields(),
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
      ...this.managerIdsUpdate(),
      ...this.statusActorFields(),
    };
    this.gradingUpdated.emit(update);
    this.isSaving.set(false);
  }
}
