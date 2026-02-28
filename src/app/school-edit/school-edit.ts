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
  opened = output<void>();

  // Constants
  AssignKind = AssignKind;

  // The signal holding the data model for the form.
  // Uses a signal + effect pattern because linkedSignal always re-derives
  // from its source, which would wipe user edits when the parent re-renders
  // with new object references. The effect guards against this by only
  // syncing when the form has no unsaved edits.
  schoolFormModel = signal<School>(initSchool());
  private _syncSchoolToForm = effect(() => {
    const s = this.school();
    if (this.form().dirty()) {
      return;
    }
    this.schoolFormModel.set(structuredClone(s));
  });

  // Use form() to create a FieldTree for validation and state tracking.
  form: FieldTree<School> = form(this.schoolFormModel, (schema) => {
    required(schema.schoolName, { message: 'School Name is required.' });
    required(schema.ownerInstructorId, { message: 'School must have an owner.' });
    required(schema.schoolId, {
      message: 'School ID is required.',
      when: () =>
        this.schoolIdAssignment().kind !== AssignKind.AssignNewAutoId,
    });

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
    disabled(schema.ownerInstructorId, () => !this.userIsAdmin());
    disabled(
      schema.managerInstructorIds,
      () => !this.userIsAdmin() && !this.userIsSchoolManager(),
    );
  });

  // Get an editable version of the school for save (it's the same as the model).
  editableSchool = computed<School>(() => this.schoolFormModel());

  todayIsoString = signal(new Date().toISOString().split('T')[0]);

  isSchoolLicenseExpired = computed(() => {
    const expires = this.school().schoolLicenseExpires;
    if (!expires || expires >= this.todayIsoString()) return null;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? 'recent' : 'expired';
  });

  /** Warn when school license expiration doesn't match renewalDate + 1 year. */
  schoolLicenseDateMismatch = computed(() => {
    const s = this.editableSchool();
    if (!s.schoolLicenseRenewalDate || !s.schoolLicenseExpires) return null;
    const expected = this.addYears(s.schoolLicenseRenewalDate, 1);
    if (s.schoolLicenseExpires === expected) return null;
    return `Expected expiration ${expected} (1 year after renewal ${s.schoolLicenseRenewalDate}), but got ${s.schoolLicenseExpires}.`;
  });

  /** Add N years to a YYYY-MM-DD date string, returning a YYYY-MM-DD string. */
  private addYears(dateStr: string, years: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.toISOString().substring(0, 10);
  }

  isOwnerLicenseExpired = computed(() => {
    const o = this.owner();
    if (!o) return null;
    const expires = o.instructorLicenseExpires;
    if (!expires || o.instructorLicenseType === 'Life' || expires >= this.todayIsoString()) return null;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? 'recent' : 'expired';
  });

  isSaving = signal(false);
  isDeleting = signal(false);
  deleteProgress = signal('');
  collapsed = linkedSignal<boolean>(() => {
    return this.collapse() ?? true;
  });
  isDirty = computed(
    () =>
      this.form().dirty() ||
      this.schoolIdAssignment().kind !== AssignKind.UnchangedExistingId,
  );

  updateStudentsCheckbox = signal<boolean>(true);
  studentsToUpdateCount = signal<number>(0);

  userIsAdmin = computed(() => this.stateService.user()?.isAdmin ?? false);
  userIsSchoolManager = computed(() => {
    const member = this.stateService.user()?.member;
    if (!member) return false;
    const school = this.school();
    if (!school) return false;
    return (
      member.instructorId === school.ownerInstructorId ||
      school.managerInstructorIds.includes(member.instructorId)
    );
  });

  isNewSchool = computed(() => !this.school()?.docId);

  expectedNextSchoolId = computed(() => {
    const counters = this.membersService.counters();
    if (!counters) return '';
    return `SCH-${counters.schoolIdCounter + 1}`;
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
    const ownerMemId = this.editableSchool().ownerInstructorId;
    const owner = this.membersService.instructors.entriesMap().get(ownerMemId);
    return owner || null;
  });
  managers = computed(() => {
    const managerMemIds = this.editableSchool().managerInstructorIds;
    return managerMemIds.map(
      (memberDocId) =>
        this.membersService.instructors.entriesMap().get(memberDocId) || null,
    );
  });

  /** Returns true when a given manager ID is the same as the owner ID. */
  isManagerAlsoOwner(managerId: string): boolean {
    const ownerId = this.editableSchool().ownerInstructorId;
    return ownerId !== '' && managerId !== '' && managerId === ownerId;
  }

  /** Computed: true when any manager in the list is also the owner. */
  hasOwnerAsManager = computed(() => {
    const school = this.editableSchool();
    return school.managerInstructorIds.some((id) => this.isManagerAlsoOwner(id));
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
    effect(async () => {
      const orig = this.school()?.schoolId;
      const current = this.editableSchool()?.schoolId;
      if (orig && current && orig !== current) {
        const count = await this.membersService.countMembersWithSchoolId(orig);
        this.studentsToUpdateCount.set(count);
      } else {
        this.studentsToUpdateCount.set(0);
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
    this.form.managerInstructorIds().value.update((managers: string[]) => {
      const newManagers = [...managers];
      newManagers.splice(index, 1);
      return newManagers;
    });
    this.form.managerInstructorIds().markAsDirty();
  }

  updateManagerId(index: number, memberDocId: string) {
    this.form.managerInstructorIds().value.update((managers: string[]) => {
      const newManagers = [...managers];
      newManagers[index] = memberDocId;
      return newManagers;
    });
    this.form.managerInstructorIds().markAsDirty();
  }

  addManager() {
    this.form.managerInstructorIds().value.update((m) => [...m, '']);
    this.form.managerInstructorIds().markAsDirty();
  }

  updateOwner(memberDocId: string) {
    this.form.ownerInstructorId().value.set(memberDocId);
    this.form.ownerInstructorId().markAsDirty();
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
    if (!this.collapsed()) {
      this.opened.emit();
    }
  }

  isDupSchoolId = computed(() => {
    const school = this.editableSchool();
    if (!this.allSchools || !school) {
      return false;
    }
    return this.allSchools().some(
      (s) =>
        s.schoolId?.toLowerCase() === school.schoolId?.toLowerCase() &&
        s.docId !== school.docId,
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
        school.schoolId = await this.membersService.createNextSchoolId();
      } else if (school.schoolId === '') {
        throw new Error(`School ID cannot be empty.`);
      }

      const origId = this.school().schoolId;

      if (this.updateStudentsCheckbox() && this.studentsToUpdateCount() > 0 && origId && school.schoolId && origId !== school.schoolId) {
        await this.membersService.setSchoolAndUpdateMembers(school, origId);
      } else {
        if (origId && school.schoolId && origId !== school.schoolId && school.docId) {
          await this.membersService.clearSchoolMembers(school.docId);
        }
        await this.membersService.setSchool(school, this.school());
      }

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
      if (this.editableSchool().docId) {
        try {
          this.isDeleting.set(true);
          await this.membersService.deleteSchool(
            this.editableSchool().docId,
            (msg) => this.deleteProgress.set(msg)
          );
        } catch (e: unknown) {
          console.error(e);
          this.asyncError.set(e as Error);
        } finally {
          this.isDeleting.set(false);
          this.deleteProgress.set('');
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
    if (this.form.ownerInstructorId().value().trim() === '') {
      errors.push('School must have an owner.');
    }
    if (
      this.form.schoolId().value().trim() === '' &&
      this.schoolIdAssignment().kind !== AssignKind.AssignNewAutoId
    ) {
      errors.push('School ID cannot be empty for a new school.');
    }
    if (this.hasOwnerAsManager()) {
      errors.push('The owner is already considered a manager — no need to list them as a manager too.');
    }
    const asyncError = this.asyncError();
    if (asyncError) {
      errors.push(asyncError.message);
    }
    return errors;
  });
}
