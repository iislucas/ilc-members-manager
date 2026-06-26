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
  isGradingPaid,
  PaymentStatus,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
} from '../../../functions/src/data-model';
import { NgTemplateOutlet } from '@angular/common';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { InstructorSelectorComponent } from '../instructor-selector/instructor-selector';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { GradingEventInputComponent, GradingEventDetails } from '../grading-event-input/grading-event-input';
import { MemberProfileLinkService } from '../member-profile-link.service';



@Component({
  selector: 'app-grading-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, IconComponent, InstructorSelectorComponent, GradingEventInputComponent],
  templateUrl: './grading-progress.html',
  styleUrl: './grading-progress.scss',
})
export class GradingProgressComponent {
  private firebaseState = inject(FirebaseStateService);
  public dataService = inject(DataManagerService);
  private routingService = inject(RoutingService<AppPathPatterns>);
  private profileLinks = inject(MemberProfileLinkService);

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

  // Other completed (passed/not-passed) gradings of this student that are not yet
  // paid. While any exist the student may not request a new grading from an
  // instructor — they must settle payment first. Read from the logged-in user's
  // own gradings, so it only applies when the student views their own grading.
  outstandingUnpaidGradings = computed(() => {
    const g = this.grading();
    return this.dataService.myGradings.entries().filter(
      (other) =>
        other.docId !== g.docId &&
        other.studentMemberDocId === g.studentMemberDocId &&
        (other.status === GradingStatus.Passed || other.status === GradingStatus.NotPassed) &&
        !isGradingPaid(other),
    );
  });

  // A non-admin student is blocked from submitting a new request while they have
  // outstanding unpaid completed gradings. Admins are exempt (and the server
  // trigger enforces the same rule, exempting admins).
  requestBlockedByUnpaid = computed(
    () => this.userIsStudent() && !this.userIsAdmin() && this.outstandingUnpaidGradings().length > 0,
  );

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

  // Link to the student's profile, present only for viewers permitted to see it
  // (admins, the student's primary instructor, or a manager of their primary
  // school). Null otherwise — the name then renders as plain text.
  studentProfileLink = computed(() => this.profileLinks.profileLink(this.studentMember()));

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
  // Internal administrative notes (the grading's `notes` field) — visible to
  // grading managers/instructors/admins only, never the student.
  protected editInternalNotes = signal('');
  protected editDeclineNotes = signal('');
  protected editPaymentStatus = signal<PaymentStatus>(PaymentStatus.PaidOther);
  protected editPaymentNote = signal('');
  protected showDeclineForm = signal(false);
  protected isEditingRequest = signal(false);
  protected isSaving = signal(false);

  // Inline edit toggles for detail fields (admin / grading instructor / managers).
  protected isEditingEvent = signal(false);
  protected isEditingInstructor = signal(false);
  protected isEditingManagers = signal(false);
  protected isEditingPayment = signal(false);
  protected isEditingResultNotes = signal(false);
  protected isEditingInternalNotes = signal(false);

  // Payment-status selector options for the template.
  protected PaymentStatus = PaymentStatus;
  protected paymentStatuses = PAYMENT_STATUSES;
  paymentStatusLabel = (s: string) =>
    PAYMENT_STATUS_LABELS[s as PaymentStatus] ?? s;

  // The grading's current payment status label + whether it counts as unpaid.
  currentPaymentLabel = computed(() => this.paymentStatusLabel(this.grading().paymentStatus));
  isUnpaid = computed(() => !isGradingPaid(this.grading()));

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
    this.editInternalNotes.set(g.notes || '');
    this.editDeclineNotes.set(g.declineNotes || '');
    this.editPaymentStatus.set(g.paymentStatus);
    this.editPaymentNote.set(g.paymentNote || '');
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
      this.editInternalNotes() !== (g.notes || '') ||
      this.editInstructorId() !== g.gradingInstructorId ||
      this.editPaymentStatus() !== g.paymentStatus ||
      this.editPaymentNote() !== (g.paymentNote || '') ||
      JSON.stringify(this.editGradingManagerIds()) !== JSON.stringify(gradingManagerIdsOf(g))
    );
  });

  // Free-text event info that isn't linked to a listed event and isn't marked
  // "not at a listed event" — an ambiguous state the grading can't be saved in
  // (mirrors the warning shown by the event input). Ticking the checkbox clears
  // the event text and linking sets the docId, so either resolves it.
  eventInputInvalid = computed(
    () => this.editGradingEvent().trim() !== '' && !this.editGradingEventDocId(),
  );

  // Feedback shown next to the Save button after an explicit save.
  saveStatus = signal<'' | 'saving...' | 'saved'>('');

  // Persist the inline detail edits (event/date/result notes/instructor/managers)
  // explicitly. The component no longer auto-saves — the user must click Save (or
  // Discard) so changes are intentional and clearly visible.
  saveEdits() {
    if (!this.isDirty() || this.eventInputInvalid()) return;
    this.saveStatus.set('saving...');
    this.gradingUpdated.emit({
      gradingEvent: this.editGradingEvent(),
      gradingEventDate: this.editGradingEventDate(),
      gradingEventDocId: this.editGradingEventDocId(),
      resultNotes: this.editResultNotes(),
      notes: this.editInternalNotes(),
      gradingInstructorId: this.editInstructorId(),
      paymentStatus: this.editPaymentStatus(),
      paymentNote: this.editPaymentNote(),
      ...this.managerIdsUpdate(),
    });
    this.saveStatus.set('saved');
    setTimeout(() => {
      if (this.saveStatus() === 'saved') this.saveStatus.set('');
    }, 3000);
  }

  // Revert the inline detail edits back to the saved grading.
  discardEdits() {
    const g = this.grading();
    this.editInstructorId.set(g.gradingInstructorId);
    this.editGradingEvent.set(g.gradingEvent);
    this.editGradingEventDate.set(g.gradingEventDate);
    this.editGradingEventDocId.set(g.gradingEventDocId);
    this.editGradingManagerIds.set(gradingManagerIdsOf(g));
    this.editResultNotes.set(g.resultNotes);
    this.editInternalNotes.set(g.notes || '');
    this.editPaymentStatus.set(g.paymentStatus);
    this.editPaymentNote.set(g.paymentNote || '');
    this.saveStatus.set('');
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
    const instructorId = this.editInstructorId();
    // Block requesting a grading from an instructor while the student has
    // outstanding unpaid completed gradings (non-admins only; mirrored server-side).
    if (instructorId && this.requestBlockedByUnpaid()) return;
    this.isSaving.set(true);
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
    if (this.eventInputInvalid()) return;
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

  savePaymentDetails() {
    this.gradingUpdated.emit({
      paymentStatus: this.editPaymentStatus(),
      paymentNote: this.editPaymentNote(),
    });
    this.isEditingPayment.set(false);
  }

  cancelPaymentEdit() {
    const g = this.grading();
    this.editPaymentStatus.set(g.paymentStatus);
    this.editPaymentNote.set(g.paymentNote || '');
    this.isEditingPayment.set(false);
  }

  saveResultNotes() {
    this.gradingUpdated.emit({ resultNotes: this.editResultNotes() });
    this.isEditingResultNotes.set(false);
  }

  cancelResultNotesEdit() {
    this.editResultNotes.set(this.grading().resultNotes);
    this.isEditingResultNotes.set(false);
  }

  saveInternalNotes() {
    this.gradingUpdated.emit({ notes: this.editInternalNotes() });
    this.isEditingInternalNotes.set(false);
  }

  cancelInternalNotesEdit() {
    this.editInternalNotes.set(this.grading().notes || '');
    this.isEditingInternalNotes.set(false);
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
    // progression (guarded here as well as in the template), and not while the
    // event input is in an invalid (unlinked free-text) state.
    if (!this.isNextGrading() || this.eventInputInvalid()) return;
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
    if (this.eventInputInvalid()) return;
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
