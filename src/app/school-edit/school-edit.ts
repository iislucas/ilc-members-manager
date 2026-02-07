import {
  Component,
  input,
  output,
  effect,
  inject,
  signal,
  HostBinding,
  ElementRef,
  computed,
  linkedSignal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  School,
  Member,
  InstructorPublicData,
  initSchool,
} from '../../../functions/src/data-model';
import {
  form,
  FormField,
  required,
  FieldTree,
  disabled,
} from '@angular/forms/signals';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { deepObjEq } from '../utils';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import {
  AssignKind,
  Assignment,
  IdAssignmentComponent,
} from '../id-assignment/id-assignment';
import { FirebaseStateService } from '../firebase-state.service';

@Component({
  selector: 'app-school-edit',
  standalone: true,
  imports: [
    CommonModule,
    FormField,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
    IdAssignmentComponent,
  ],
  templateUrl: './school-edit.html',
  styleUrl: './school-edit.scss',
})
export class SchoolEditComponent {
  private elementRef = inject(ElementRef);
  membersService = inject(DataManagerService);
  stateService = inject(FirebaseStateService);

  school = input.required<School>();
  allSchools = input.required<School[]>();
  canDelete = input<boolean>(true);
  collapse = input<boolean | null>(null);
  close = output();

  // Constants
  AssignKind = AssignKind;

  // The signal holding the data model for the form.
  schoolFormModel = signal<School>(initSchool());

  // Use form() to create a FieldTree for validation and state tracking.
  form: FieldTree<School> = form(this.schoolFormModel, (schema) => {
    required(schema.schoolName, { message: 'School Name is required.' });
    required(schema.owner, { message: 'School must have an owner.' });
    required(schema.schoolId, { message: 'School ID is required.' });

    disabled(schema.schoolName, () => !this.userIsAdmin());
    disabled(schema.schoolId, () => !this.userIsAdmin());
    disabled(schema.schoolCity, () => !this.userIsAdmin());
    disabled(schema.schoolCountry, () => !this.userIsAdmin());
    disabled(
      schema.schoolAddress,
      () => !this.userIsAdmin() && !this.userIsSchoolManager(),
    );
    disabled(
      schema.schoolZipCode,
      () => !this.userIsAdmin() && !this.userIsSchoolManager(),
    );
    disabled(
      schema.schoolCountyOrState,
      () => !this.userIsAdmin() && !this.userIsSchoolManager(),
    );
    disabled(
      schema.schoolWebsite,
      () => !this.userIsAdmin() && !this.userIsSchoolManager(),
    );
    disabled(schema.owner, () => !this.userIsAdmin());
    disabled(
      schema.managers,
      () => !this.userIsAdmin() && !this.userIsSchoolManager(),
    );
  });

  // Sync input school to the form model.
  private _sync = effect(() => {
    const s = this.school();
    // We deep clone to ensure the form model has its own copy.
    const editable = structuredClone(s);
    editable.lastUpdated = s.lastUpdated;
    this.schoolFormModel.set(editable);
  });

  // Get an editable version of the school for save (it's the same as the model).
  editableSchool = computed<School>(() => this.schoolFormModel());

  isSaving = signal(false);
  collapsed = linkedSignal<boolean>(() => {
    return this.collapse() ?? true;
  });
  isDirty = computed(
    () =>
      this.form().dirty() ||
      this.schoolIdAssignment().kind !== AssignKind.UnchangedExistingId,
  );

  userIsAdmin = computed(() => this.stateService.user()?.isAdmin ?? false);
  userIsSchoolManager = computed(() => {
    const member = this.stateService.user()?.member;
    if (!member) return false;
    const school = this.school();
    if (!school) return false;
    return (
      member.instructorId === school.owner ||
      school.managers.includes(member.instructorId)
    );
  });

  isNewSchool = computed(() => !this.school()?.id);

  expectedNextSchoolId = computed(() => {
    const counters = this.membersService.counters();
    if (!counters) return '';
    return (counters.schoolIdCounter + 1).toString();
  });

  initSchoolIdAssignment(): Assignment {
    if (this.school().schoolId.trim() === '') {
      return {
        kind: AssignKind.AssignNewAutoId,
        curId: '',
      };
    } else {
      return {
        kind: AssignKind.UnchangedExistingId,
        curId: this.school().schoolId,
      };
    }
  }
  schoolIdAssignment = linkedSignal<Assignment>(() =>
    this.initSchoolIdAssignment(),
  );

  owner = computed(() => {
    const ownerMemId = this.editableSchool().owner;
    const owner = this.membersService.instructors.entriesMap().get(ownerMemId);
    return owner || null;
  });
  managers = computed(() => {
    const managerMemIds = this.editableSchool().managers;
    return managerMemIds.map(
      (memberDocId) =>
        this.membersService.instructors.entriesMap().get(memberDocId) || null,
    );
  });

  instructorDisplayFns = {
    toChipId: (i: InstructorPublicData) => i.instructorId,
    toName: (i: InstructorPublicData) => i.name,
  };

  @HostBinding('class.is-open')
  get isOpen() {
    return !this.collapsed();
  }

  @HostBinding('class.is-dirty')
  get isDirtyClass() {
    return this.isDirty();
  }

  constructor() {
    effect(() => {
      const collapse = this.collapse();
      if (collapse !== null) {
        this.collapsed.set(collapse);
      }
    });
  }

  updateSchool() {
    // No longer needed with Signal Forms as it's reactive
  }

  handleSchoolIdAssignmentChange(assignment: Assignment) {
    this.schoolIdAssignment.set(assignment);
    if (
      assignment.kind === AssignKind.UnchangedExistingId ||
      assignment.kind === AssignKind.AssignNewAutoId
    ) {
      return;
    }

    if (assignment.kind === AssignKind.AssignNewManualId) {
      this.form.schoolId().value.set(assignment.newId);
    } else if (assignment.kind === AssignKind.RemoveId) {
      this.form.schoolId().value.set('');
    }
  }

  removeManager(index: number) {
    const currentManagers = this.managers();
    const newManagers = [...currentManagers];
    newManagers.splice(index, 1);
    this.form.managers().value.update((managers: string[]) => {
      const newManagers = [...managers];
      newManagers.splice(index, 1);
      return newManagers;
    });
    this.form.managers().markAsDirty();
  }

  updateManagerId(index: number, memberDocId: string) {
    this.form.managers().value.update((managers: string[]) => {
      const newManagers = [...managers];
      newManagers[index] = memberDocId;
      return newManagers;
    });
    this.form.managers().markAsDirty();
  }

  addManager() {
    this.form.managers().value.update((m) => [...m, '']);
    this.form.managers().markAsDirty();
  }

  updateOwner(memberDocId: string) {
    this.form.owner().value.set(memberDocId);
    this.form.owner().markAsDirty();
  }

  cancel($event: Event) {
    this.form().reset();
    this.schoolIdAssignment.set(this.initSchoolIdAssignment());
    $event.preventDefault();
    $event.stopPropagation();
    this.collapsed.set(true);
    this.close.emit();
  }

  toggle($event: Event) {
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

  isDupSchoolId = computed(() => {
    const school = this.editableSchool();
    if (!this.allSchools || !school) {
      return false;
    }
    return this.allSchools().some(
      (s) =>
        s.schoolId?.toLowerCase() === school.schoolId?.toLowerCase() &&
        s.id !== school.id,
    );
  });

  async saveSchool(event: Event) {
    event.preventDefault();
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      const school = this.editableSchool()!;
      const schoolIdAssignment = this.schoolIdAssignment().kind;
      if (schoolIdAssignment === AssignKind.AssignNewAutoId) {
        school.schoolId = (
          await this.membersService.createNextSchoolId()
        ).toString();
      } else if (school.schoolId === '') {
        throw new Error(`School ID cannot be empty.`);
      }

      await this.membersService.setSchool(school);
      this.form().reset();
      this.isSaving.set(false);
      this.collapsed.set(true);
      this.close.emit();
    } catch (e: unknown) {
      console.error(e);
      this.asyncError.set(e as Error);
      this.isSaving.set(false);
    }
  }

  async deleteSchool($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    this.asyncError.set(null);
    if (
      confirm(
        `Are you sure you want to delete ${this.editableSchool().schoolName}?`,
      )
    ) {
      if (this.editableSchool().id) {
        try {
          await this.membersService.deleteSchool(this.editableSchool().id);
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

  private routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);
  gotoMembers() {
    this.routingService.matchedPatternId.set(Views.SchoolMembers);
    const signals = this.routingService.signals[Views.SchoolMembers];
    // TODO: should we do a single asignement for all params, that way we don't
    // miss any? This means a single signal for all path params at once. Path
    // params are not optional. Url Params can keep the same pattern;
    signals.pathVars.schoolId.set(this.school().schoolId);
  }

  asyncError = signal<Error | null>(null);
  errorMessage = computed(() => {
    const errors: string[] = [];
    const school = this.editableSchool();
    if (!school) {
      return [];
    }
    if (this.isDupSchoolId()) {
      errors.push('This school ID is already in use.');
    }
    const schoolNameErrors = this.form.schoolName().errors();
    if (
      schoolNameErrors &&
      schoolNameErrors.length > 0 &&
      schoolNameErrors[0]
    ) {
      errors.push(schoolNameErrors[0].message ?? 'School Name is invalid.');
    }
    if (this.form.owner().value().trim() === '') {
      errors.push('School must have an owner.');
    }
    if (
      this.form.schoolId().value().trim() === '' &&
      this.schoolIdAssignment().kind !== AssignKind.AssignNewAutoId
    ) {
      errors.push('School ID cannot be empty for a new school.');
    }
    const asyncError = this.asyncError();
    if (asyncError) {
      errors.push(asyncError.message);
    }
    return errors;
  });
}
