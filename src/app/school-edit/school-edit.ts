/* school-edit.ts
 *
 * Standalone school edit page, accessible via a dedicated URL like
 * /schools/:schoolId/edit or /my-schools/:schoolId/edit.
 * Loads the school by its schoolId or docId from the data service.
 * Follows the same page-edit pattern as event-edit.
 */

import {
  Component,
  input,
  output,
  effect,
  inject,
  signal,
  computed,
  linkedSignal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  School,
  Member,
  InstructorPublicData,
  initSchool,
  ExpiryStatus,
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
    FormField,
    IconComponent,
    SpinnerComponent,
    AutocompleteComponent,
    IdAssignmentComponent,
  ],
  templateUrl: './school-edit.html',
  styleUrl: './school-edit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolEditComponent {
  membersService = inject(DataManagerService);
  stateService = inject(FirebaseStateService);
  private routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  // The schoolId comes from the route path variable, passed in by app.html.
  schoolId = input.required<string>();
  titleLoaded = output<string>();

  // Constants
  AssignKind = AssignKind;
  ExpiryStatus = ExpiryStatus;

  // Resolve the school from the data service using the URL's schoolId.
  school = computed<School | null>(() => {
    const id = this.schoolId();
    if (!id || id === 'new') return null;
    // Try by schoolId first (e.g. SCH-123), then by docId
    const bySchoolId = this.membersService.schools.get(id);
    if (bySchoolId) return bySchoolId;
    // Search by docId among all schools
    const all = this.membersService.schools.entries();
    return all.find(s => s.docId === id) || null;
  });

  isNewSchool = computed(() => {
    const id = this.schoolId();
    return !id || id === 'new';
  });

  // Emit the title when the school is loaded (for breadcrumbs).
  private _emitTitle = effect(() => {
    const s = this.school();
    if (s) {
      this.titleLoaded.emit(s.schoolName || s.schoolId || 'School');
    } else if (this.isNewSchool()) {
      this.titleLoaded.emit('New School');
    }
  });

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
    if (s) {
      this.schoolFormModel.set(structuredClone(s));
    } else if (this.isNewSchool()) {
      this.schoolFormModel.set(initSchool());
    }
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

    disabled(schema.schoolName, () => !this.userIsAdmin() && !this.userIsSchoolManager());
    disabled(schema.schoolId, () => !this.userIsAdmin());
    disabled(schema.schoolCity, () => !this.userIsAdmin() && !this.userIsSchoolManager());
    disabled(schema.schoolCountry, () => !this.userIsAdmin() && !this.userIsSchoolManager());
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
    disabled(
      schema.schoolClassGoogleCalendarId,
      () => !this.userIsAdmin() && !this.userIsSchoolManager(),
    );
    disabled(schema.ownerInstructorId, () => !this.userIsAdmin());
    disabled(
      schema.managerInstructorIds,
      () => !this.userIsAdmin() && !this.userIsSchoolManager(),
    );
    disabled(schema.schoolLicenseRenewalDate, () => !this.userIsAdmin());
    disabled(schema.schoolLicenseExpires, () => !this.userIsAdmin());
  });

  // Get an editable version of the school for save (it's the same as the model).
  editableSchool = computed<School>(() => this.schoolFormModel());

  todayIsoString = signal(new Date().toISOString().split('T')[0]);

  isSchoolLicenseExpired = computed((): ExpiryStatus => {
    const s = this.school();
    if (!s) return ExpiryStatus.Valid;
    const expires = s.schoolLicenseExpires;
    if (!expires || expires >= this.todayIsoString()) return ExpiryStatus.Valid;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? ExpiryStatus.Recent : ExpiryStatus.Expired;
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

  isOwnerLicenseExpired = computed((): ExpiryStatus => {
    const o = this.owner();
    if (!o) return ExpiryStatus.Valid;
    const expires = o.instructorLicenseExpires;
    if (!expires || o.instructorLicenseType === 'Life' || expires >= this.todayIsoString()) return ExpiryStatus.Valid;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? ExpiryStatus.Recent : ExpiryStatus.Expired;
  });

  isSaving = signal(false);
  isDeleting = signal(false);
  deleteProgress = signal('');
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

  allSchools = computed(() => this.membersService.schools.entries());

  expectedNextSchoolId = computed(() => {
    const counters = this.membersService.counters();
    if (!counters) return '';
    return `SCH-${counters.schoolIdCounter + 1}`;
  });

  initSchoolIdAssignment(): Assignment {
    const s = this.school();
    if (!s || s.schoolId.trim() === '') {
      return {
        kind: AssignKind.AssignNewAutoId,
        curId: '',
      };
    } else {
      return {
        kind: AssignKind.UnchangedExistingId,
        curId: s.schoolId,
      };
    }
  }
  schoolIdAssignment = linkedSignal<Assignment>(() =>
    this.initSchoolIdAssignment(),
  );

  owner = computed(() => {
    const ownerMemId = this.editableSchool().ownerInstructorId;
    const owner = this.membersService.instructors.get(ownerMemId);
    return owner || null;
  });
  managers = computed(() => {
    const managerMemIds = this.editableSchool().managerInstructorIds;
    return managerMemIds.map(
      (memberDocId) =>
        this.membersService.instructors.get(memberDocId) || null,
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

  // Build the back navigation URL based on context.
  backUrl = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MySchoolEdit) {
      return '#/my-schools';
    }
    return '#/schools';
  });

  backLabel = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MySchoolEdit) {
      return 'My Schools';
    }
    return 'Manage Schools';
  });

  constructor() {
    effect(async () => {
      const s = this.school();
      const current = this.editableSchool()?.schoolId;
      const orig = s?.schoolId;
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
    this.navigateBack();
  }

  private navigateBack() {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MySchoolEdit) {
      this.routingService.navigateTo('/my-schools');
    } else {
      this.routingService.navigateTo('/schools');
    }
  }

  gotoMembers() {
    const s = this.school() || this.editableSchool();
    this.routingService.matchedPatternId.set(Views.SchoolMembers);
    const signals = this.routingService.signals[Views.SchoolMembers];
    signals.pathVars.schoolId.set(s.schoolId);
  }

  isDupSchoolId = computed(() => {
    const school = this.editableSchool();
    if (!school) {
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

      const origSchool = this.school();
      const origId = origSchool?.schoolId || '';

      if (this.updateStudentsCheckbox() && this.studentsToUpdateCount() > 0 && origId && school.schoolId && origId !== school.schoolId) {
        await this.membersService.setSchoolAndUpdateMembers(school, origId);
      } else {
        if (origId && school.schoolId && origId !== school.schoolId && school.docId) {
          await this.membersService.clearSchoolMembers(school.docId);
        }
        // For admins, skip the diff optimization (don't pass oldSchool) so that
        // all initSchool() defaults get written to Firestore, backfilling any
        // missing fields. Non-admins (school managers) need the diff to stay
        // within the Firestore rules' affectedKeys().hasOnly(...) constraint.
        const oldSchoolForDiff = this.userIsAdmin() ? undefined : origSchool || undefined;
        await this.membersService.setSchool(school, oldSchoolForDiff);
      }

      this.form().reset();
      this.isSaving.set(false);
      this.navigateBack();
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
          this.navigateBack();
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
