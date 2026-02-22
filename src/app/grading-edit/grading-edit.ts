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
  StudentLevel,
  ApplicationLevel,
  Member,
  initGrading,
  InstructorPublicData,
  School,
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
import { AutocompleteComponent } from '../autocomplete/autocomplete';

@Component({
  selector: 'app-grading-edit',
  standalone: true,
  imports: [FormField, IconComponent, SpinnerComponent, AutocompleteComponent],
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
  studentLevels = Object.values(StudentLevel);
  applicationLevels = Object.values(ApplicationLevel);

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
    disabled(schema.gradingInstructorId, () => !this.userIsAdmin());
    disabled(schema.assistantInstructorIds, () => !this.userIsAdmin());
    disabled(schema.schoolId, () => !this.userIsAdmin());
    disabled(schema.studentMemberId, () => !this.userIsAdmin());
    disabled(schema.studentMemberDocId, () => !this.userIsAdmin());

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
  });

  // Sync input grading to the form model.
  _sync = effect(() => {
    const g = this.grading();
    this.gradingFormModel.set(structuredClone(g));
  });

  // Get an editable version of the grading.
  editableGrading = computed<Grading>(() => this.gradingFormModel());

  // Visual state
  collapsable = input<boolean>(true);
  collapse = input<boolean | null>(null);
  close = output();
  collapsed = linkedSignal<boolean>(() => {
    return this.collapsable() && (this.collapse() ?? true);
  });

  canDelete = input<boolean>(true);

  isDirty = computed(() => this.form().dirty());
  isSaving = signal(false);
  asyncError = signal<Error | null>(null);

  // User permissions
  userIsAdmin = computed(() => {
    const user = this.firebaseState.user();
    return user?.isAdmin ?? false;
  });

  userIsGradingInstructor = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    const grading = this.editableGrading();
    return user.member.instructorId === grading.gradingInstructorId ||
      (grading.assistantInstructorIds || []).includes(user.member.instructorId);
  });

  canEdit = computed(
    () => this.userIsAdmin() || this.userIsGradingInstructor(),
  );

  // Resolve names for display
  studentName = computed(() => {
    const studentMemberId = this.editableGrading().studentMemberId;
    if (!studentMemberId) return '';
    const member = this.dataService.members
      .entries()
      .find((m) => m.memberId === studentMemberId);
    return member ? `${member.name} (${member.memberId})` : studentMemberId;
  });

  memberDisplayFns = {
    toChipId: (m: Member) => m.memberId,
    toName: (m: Member) => m.name,
  };

  schoolDisplayFns = {
    toChipId: (s: School) => s.schoolId,
    toName: (s: School) => s.schoolName,
  };

  instructorDisplayFns = {
    toChipId: (i: InstructorPublicData) => i.instructorId,
    toName: (i: InstructorPublicData) => i.name,
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

  instructorName = computed(() => {
    const instructorId = this.editableGrading().gradingInstructorId;
    if (!instructorId) return '';
    const instructor = this.dataService.instructors
      .entries()
      .find((i) => i.instructorId === instructorId);
    return instructor
      ? `${instructor.name} (${instructor.instructorId})`
      : instructorId;
  });

  // CSS host
  @HostBinding('class.is-open')
  get isOpen() {
    return !this.collapsed();
  }

  @HostBinding('class.is-dirty')
  get isDirtyClass() {
    return this.isDirty();
  }

  toggleCollapseState($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    if (this.isDirty() && !this.collapsed()) {
      this.elementRef.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
      return;
    }
    this.collapsed.set(!this.collapsed());
  }

  cancel($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    this.form().reset();
    this.gradingFormModel.set(structuredClone(this.grading()));
    this.collapsed.set(this.collapsable());
    if (this.collapsable()) {
      this.close.emit();
    }
  }

  updateStudentMemberId(value: string) {
    this.form.studentMemberId().value.set(value);
    this.form.studentMemberId().markAsDirty();
    // Auto-populate the doc ID behind the scenes
    const member = this.dataService.members
      .entries()
      .find((m) => m.memberId === value);
    if (member) {
      this.form.studentMemberDocId().value.set(member.id);
      this.form.studentMemberDocId().markAsDirty();
    }
  }

  updateGradingInstructorId(value: string) {
    this.form.gradingInstructorId().value.set(value);
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
      ? `${instructor.name} (${instructor.instructorId})`
      : instructorId;
  }

  updateAssistantInstructorId(index: number, value: string) {
    const assistants = [...this.form.assistantInstructorIds().value()];
    assistants[index] = value;
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
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      const grading = this.editableGrading();
      if (grading.id) {
        await this.dataService.updateGrading(grading.id, grading);
      } else {
        await this.dataService.addGrading(grading);
      }
      this.form().reset();
      this.isSaving.set(false);
      this.collapsed.set(this.collapsable());
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
      if (grading.id) {
        try {
          await this.dataService.deleteGrading(grading.id);
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
