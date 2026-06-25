import {
  Component,
  input,
  output,
  inject,
  signal,
  HostBinding,
  ElementRef,
  computed,
  linkedSignal,
  effect,
} from '@angular/core';
import {
  Grading,
  GradingStatus,
  getPrettyGradingStatus,
  StudentLevel,
  ApplicationLevel,
  Member,
  initGrading,
  InstructorPublicData,
  School,
  IlcEvent,
  gradingManagerIdsOf,
  PaymentStatus,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
} from '../../../functions/src/data-model';
import {
  form,
  FormField,
  required,
  disabled,
  FieldTree,
} from '@angular/forms/signals';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { InstructorSelectorComponent } from '../instructor-selector/instructor-selector';
import { MemberSelectorComponent } from '../member-selector/member-selector';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { deepObjEq } from '../utils';
import { GradingEventInputComponent, GradingEventDetails } from '../grading-event-input/grading-event-input';

@Component({
  selector: 'app-grading-edit',
  standalone: true,
  imports: [FormField, IconComponent, SpinnerComponent, InstructorSelectorComponent, MemberSelectorComponent, AutocompleteComponent, GradingEventInputComponent],
  templateUrl: './grading-edit.html',
  styleUrl: './grading-edit.scss',
})
export class GradingEditComponent {
  private elementRef = inject(ElementRef);
  private firebaseState = inject(FirebaseStateService);
  public dataService = inject(DataManagerService);
  // Constants
  GradingStatus = GradingStatus;
  gradingStatuses = Object.values(GradingStatus);
  getPrettyGradingStatus = getPrettyGradingStatus;
  studentLevels = Object.values(StudentLevel);
  applicationLevels = Object.values(ApplicationLevel);
  paymentStatuses = PAYMENT_STATUSES;
  paymentStatusLabel = (s: string) => PAYMENT_STATUS_LABELS[s as PaymentStatus] ?? s;

  // The core object of interest.
  grading = input.required<Grading>();

  // The signal holding the data model for the form.
  gradingFormModel = signal<Grading>(initGrading());

  // Use form() to create a FieldTree for validation and state tracking.
  form: FieldTree<Grading> = form(this.gradingFormModel, (schema) => {
    required(schema.studentMemberId, { message: 'Student Member ID is required.' });
    required(schema.level, { message: 'Level is required.' });

    // Non-admin, non-instructor fields are disabled
    disabled(schema.gradingPurchaseDate, () => !this.userIsAdmin());
    disabled(schema.orderId, () => !this.userIsAdmin());
    disabled(schema.level, () => !this.userIsAdmin());
    disabled(schema.gradingInstructorId, () => !this.userIsAdmin() && !this.userIsStudent() && !this.userIsGradingInstructor());
    // `assistantInstructorIds` maps to "Grading Managers" in the UI.
    disabled(schema.assistantInstructorIds, () => !this.userIsAdmin() && !this.userIsGradingInstructor());
    // Payment is editable by admins and grading managers/instructors (not students).
    disabled(schema.paymentStatus, () => !this.userIsAdmin() && !this.userIsGradingInstructor());
    disabled(schema.paymentNote, () => !this.userIsAdmin() && !this.userIsGradingInstructor());
    disabled(schema.schoolId, () => !this.userIsAdmin());
    disabled(schema.studentMemberId, () => !this.userIsAdmin());
    disabled(schema.studentMemberDocId, () => !this.userIsAdmin());
    disabled(schema.reviewIssue, () => !this.userIsAdmin());

    // Instructor can edit status, gradingEventDate, notes
    disabled(
      schema.status,
      () => !this.userIsAdmin() && !this.userIsGradingInstructor(),
    );
    disabled(
      schema.gradingEventDate,
      () => !this.userIsAdmin() && !this.userIsGradingInstructor(),
    );
    disabled(
      schema.notes,
      () => !this.userIsAdmin() && !this.userIsGradingInstructor(),
    );
    // Instructor or student can edit gradingEvent and gradingEventDocId
    disabled(
      schema.gradingEvent,
      () => !this.userIsAdmin() && !this.userIsGradingInstructor() && !this.userIsStudent(),
    );
    disabled(
      schema.gradingEventDocId,
      () => !this.userIsAdmin() && !this.userIsGradingInstructor() && !this.userIsStudent(),
    );

    // Student can edit their own notes
    disabled(
      schema.studentNotes,
      () => !this.userIsAdmin() && !this.userIsStudent(),
    );

    // Instructor acceptance fields
    disabled(
      schema.instructorAcceptedDate,
      () => !this.userIsAdmin() && !this.userIsGradingInstructor(),
    );

    disabled(
      schema.resultNotes,
      () => !this.userIsAdmin() && !this.userIsGradingInstructor(),
    );
  });

  // Sync input grading to the form model.
  _sync = effect(() => {
    const g = this.grading();
    this.gradingFormModel.set(structuredClone(g));
  });

  // Get an editable version of the grading.
  editableGrading = computed<Grading>(() => this.gradingFormModel());

  // Visual state
  close = output();
  canDelete = input<boolean>(true);

  isDirty = computed(() => {
    const original = this.grading();
    // Read directly from form field values rather than the model signal,
    // because Angular signal forms don't always write back to the model
    // for programmatically-set fields (e.g. autocomplete .value.set()).
    return (
      this.form.gradingPurchaseDate().value() !== original.gradingPurchaseDate ||
      this.form.orderId().value() !== original.orderId ||
      this.form.level().value() !== original.level ||
      this.form.gradingInstructorId().value() !== original.gradingInstructorId ||
      !deepObjEq(this.form.assistantInstructorIds().value(), original.assistantInstructorIds) ||
      this.form.schoolId().value() !== original.schoolId ||
      this.form.studentMemberId().value() !== original.studentMemberId ||
      this.form.studentMemberDocId().value() !== original.studentMemberDocId ||
      this.form.status().value() !== original.status ||
      this.form.gradingEventDate().value() !== original.gradingEventDate ||
      this.form.gradingEvent().value() !== original.gradingEvent ||
      this.form.gradingEventDocId().value() !== original.gradingEventDocId ||
      this.form.notes().value() !== original.notes ||
      this.form.studentNotes().value() !== original.studentNotes ||
      this.form.instructorAcceptedDate().value() !== original.instructorAcceptedDate ||
      this.form.resultNotes().value() !== original.resultNotes ||
      this.form.paymentStatus().value() !== original.paymentStatus ||
      this.form.paymentNote().value() !== original.paymentNote ||
      this.form.reviewIssue().value() !== original.reviewIssue
    );
  });
  isSaving = signal(false);
  asyncError = signal<Error | null>(null);
  protected showStatusGuide = signal(false);

  // Free-text event info that isn't linked to a listed event — the grading must
  // either link an event or be marked "not at a listed event" (date only). The
  // event input shows the warning; the form's Save is disabled while invalid.
  eventInputInvalid = computed(
    () =>
      this.form.gradingEvent().value().trim() !== '' &&
      !this.form.gradingEventDocId().value(),
  );

  // User permissions
  userIsAdmin = computed(() => {
    const user = this.firebaseState.user();
    return user?.isAdmin ?? false;
  });

  // The event the grading is linked to (if any), loaded live by gradingEventDocId.
  private linkedEvent = signal<IlcEvent | undefined>(undefined);
  private _loadLinkedEvent = effect(async () => {
    const docId = this.editableGrading().gradingEventDocId;
    if (!docId) {
      this.linkedEvent.set(undefined);
      return;
    }
    this.linkedEvent.set(await this.dataService.getEventById(docId));
  });

  // True when the current user is the organizer or a manager of the linked event.
  // Such users become managers of the grading (derived live from the link).
  userIsEventManager = computed(() => {
    const user = this.firebaseState.user();
    const event = this.linkedEvent();
    if (!user || !event) return false;
    const docId = user.member.docId;
    return event.ownerDocId === docId || (event.managerDocIds || []).includes(docId);
  });

  // Returns true for the primary instructor, grading managers (stored in
  // `gradingManagerIds`, legacy fallback `assistantInstructorIds`), and the
  // organizer/managers of a linked event. All share the same edit permissions.
  userIsGradingInstructor = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    if (this.userIsEventManager()) return true;
    const grading = this.editableGrading();
    return user.member.instructorId === grading.gradingInstructorId ||
      gradingManagerIdsOf(grading).includes(user.member.instructorId);
  });

  userIsStudent = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    const grading = this.editableGrading();
    return grading.studentMemberDocId === user.member.docId;
  });



  canEdit = computed(
    () =>
      this.userIsAdmin() ||
      this.userIsGradingInstructor() ||
      this.userIsStudent(),
  );

  // Resolve names for display
  schoolDisplayFns = {
    toChipId: (s: School) => s.schoolId,
    toName: (s: School) => s.schoolName,
  };

  formatLevel(lvl: string): string {
    if (!lvl) return '';
    if (lvl.startsWith('Student ') || lvl.startsWith('Application ')) {
      return lvl;
    }
    // Backward compatibility for data originally stored without prefix
    if (lvl === 'Entry' || !isNaN(Number(lvl))) {
      return 'Student ' + lvl;
    }
    return lvl;
  }

  selectedInstructor = computed(() => {
    const id = this.form.gradingInstructorId().value();
    if (!id) return null;
    return this.dataService.instructors
      .entries()
      .find((i) => i.instructorId === id) ?? null;
  });

  instructorAutocompleteSearchTerm = computed(() => {
    const id = this.form.gradingInstructorId().value();
    if (!id) return '';
    const inst = this.dataService.instructors
      .entries()
      .find((i) => i.instructorId === id);
    return inst ? `${inst.name} [${inst.instructorId}]` : id;
  });

  onEventInputChange(details: GradingEventDetails) {
    this.form.gradingEvent().value.set(details.gradingEvent);
    this.form.gradingEvent().markAsDirty();
    this.form.gradingEventDate().value.set(details.gradingEventDate);
    this.form.gradingEventDate().markAsDirty();
    this.form.gradingEventDocId().value.set(details.gradingEventDocId);
    this.form.gradingEventDocId().markAsDirty();
  }

  cancel($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    this.form().reset();
    this.gradingFormModel.set(structuredClone(this.grading()));
    this.close.emit();
  }

  updateStudentMemberId(value: string) {
    const match = value.match(/^\(([^)]+)\)/);
    const rawId = match ? match[1] : value;
    this.form.studentMemberId().value.set(rawId);
    this.form.studentMemberId().markAsDirty();
  }

  updateStudentMember(member: Member | null) {
    this.form.studentMemberDocId().value.set(member ? member.docId : '');
    this.form.studentMemberDocId().markAsDirty();
  }

  updateGradingInstructorId(value: string) {
    // Extract the raw ID from "Name [ID]" if it matches that format
    const match = value.match(/\[([^\]]+)\]$/);
    const rawId = match ? match[1] : value;
    this.form.gradingInstructorId().value.set(rawId);
    this.form.gradingInstructorId().markAsDirty();
  }

  updateSchoolId(value: string) {
    this.form.schoolId().value.set(value);
    this.form.schoolId().markAsDirty();
  }

  resolveAssistantName(instructorId: string): string {
    if (!instructorId) return '';
    const instructor = this.dataService.instructors
      .entries()
      .find((i) => i.instructorId === instructorId);
    return instructor
      ? `${instructor.name} [${instructor.instructorId}]`
      : instructorId;
  }

  resolveAssistant(instructorId: string): InstructorPublicData | null {
    if (!instructorId) return null;
    return this.dataService.instructors.get(instructorId) ?? null;
  }

  updateAssistantInstructorId(index: number, value: string) {
    const match = value.match(/\[([^\]]+)\]$/);
    const rawId = match ? match[1] : value;
    const assistants = [...this.form.assistantInstructorIds().value()];
    assistants[index] = rawId;
    this.form.assistantInstructorIds().value.set(assistants);
    this.form.assistantInstructorIds().markAsDirty();
  }

  removeAssistantInstructor(index: number) {
    const assistants = [...this.form.assistantInstructorIds().value()];
    assistants.splice(index, 1);
    this.form.assistantInstructorIds().value.set(assistants);
    this.form.assistantInstructorIds().markAsDirty();
  }

  addAssistantInstructor() {
    const assistants = [...this.form.assistantInstructorIds().value()];
    this.form.assistantInstructorIds().value.set([...assistants, '']);
    this.form.assistantInstructorIds().markAsDirty();
  }

  async saveGrading(event: Event) {
    event.preventDefault();
    if (this.eventInputInvalid()) {
      this.asyncError.set(
        new Error(
          'The event isn\'t linked to a listed ILC event. Search and select it, ' +
            'or tick "Grading was not at a listed workshop/event".',
        ),
      );
      return;
    }
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      // Build from the original grading, overriding with current form field
      // values. We use the original as the base (not the model signal) to
      // ensure no unexpected transformed fields leak into the diff.
      const grading: Grading = {
        ...this.grading(),
        gradingPurchaseDate: this.form.gradingPurchaseDate().value(),
        orderId: this.form.orderId().value(),
        level: this.form.level().value(),
        gradingInstructorId: this.form.gradingInstructorId().value(),
        // Write both the canonical `gradingManagerIds` and the legacy
        // `assistantInstructorIds` during the migration window.
        gradingManagerIds: this.form.assistantInstructorIds().value(),
        assistantInstructorIds: this.form.assistantInstructorIds().value(),
        schoolId: this.form.schoolId().value(),
        studentMemberId: this.form.studentMemberId().value(),
        studentMemberDocId: this.form.studentMemberDocId().value(),
        status: this.form.status().value(),
        gradingEventDate: this.form.gradingEventDate().value(),
        gradingEvent: this.form.gradingEvent().value(),
        gradingEventDocId: this.form.gradingEventDocId().value(),
        notes: this.form.notes().value(),
        studentNotes: this.form.studentNotes().value(),
        instructorAcceptedDate: this.form.instructorAcceptedDate().value(),
        resultNotes: this.form.resultNotes().value(),
        paymentStatus: this.form.paymentStatus().value(),
        paymentNote: this.form.paymentNote().value(),
        reviewIssue: this.form.reviewIssue().value(),
      };
      if (grading.docId) {
        // Pass original grading for diff-based update so only changed
        // fields are sent. This is critical for non-admin users whose
        // Firestore rules restrict updates to certain fields.
        await this.dataService.updateGrading(grading.docId, grading, this.grading());
      } else {
        await this.dataService.addGrading(grading);
      }
      this.form().reset();
      this.isSaving.set(false);
      this.close.emit();
    } catch (e: unknown) {
      console.error(e);
      this.asyncError.set(e as Error);
      this.isSaving.set(false);
    }
  }

  async deleteGrading($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    const grading = this.editableGrading();
    if (confirm('Are you sure you want to delete this grading?')) {
      this.asyncError.set(null);
      if (grading.docId) {
        try {
          await this.dataService.deleteGrading(grading.docId);
        } catch (e: unknown) {
          console.error(e);
          this.asyncError.set(e as Error);
        }
      }
    }
  }

  closeErrors() {
    this.asyncError.set(null);
  }

  errorMessage = computed(() => {
    const errors: string[] = [];
    if (this.form.studentMemberId().value().trim() === '') {
      errors.push('Student Member ID is required.');
    }
    const asyncError = this.asyncError();
    if (asyncError) {
      errors.push(asyncError.message);
    }
    return errors;
  });

}
