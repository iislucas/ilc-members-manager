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
  resource,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Member,
  MembershipType,
  MasterLevel,
  School,
  InstructorPublicData,
  initMember,
} from '../../../functions/src/data-model';
import {
  form,
  FormField,
  required,
  email,
  debounce,
  FieldTree,
  disabled,
} from '@angular/forms/signals';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { deepObjEq } from '../utils';
import {
  AssignKind,
  Assignment,
  IdAssignmentComponent,
} from '../id-assignment/id-assignment';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { CountryCode } from '../country-codes';
import { Timestamp } from 'firebase/firestore';

@Component({
  selector: 'app-member-edit',
  standalone: true,
  imports: [
    FormField,
    IconComponent,
    SpinnerComponent,
    IdAssignmentComponent,
    AutocompleteComponent,
  ],
  templateUrl: './member-edit.html',
  styleUrl: './member-edit.scss',
})
export class MemberEditComponent {
  private elementRef = inject(ElementRef);
  private firebaseState = inject(FirebaseStateService);
  public membersService = inject(DataManagerService);
  // all values from the member service, used for dup-checking...
  // Maybe we can use membersService.members? and not need this...?
  allMembers = input.required<Member[]>();

  // Constants
  AssignKind = AssignKind;
  MembershipType = MembershipType;
  membershipTypes = Object.values(MembershipType);
  masterLevels = Object.values(MasterLevel).sort();

  // The core object of interest.
  member = input.required<Member>();

  // The signal holding the data model for the form.
  memberFormModel = signal<Member>(initMember());

  // Use form() to create a FieldTree for validation and state tracking.
  form: FieldTree<Member> = form(this.memberFormModel, (schema) => {
    required(schema.name, { message: 'Name is required.' });
    required(schema.emails as any, { message: 'An email must be provided.' });
    // TODO: email validation for array...
    required(schema.membershipType, { message: 'Membership type is required.' });

    disabled(schema.name, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.emails as any, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.address, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.city, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.zipCode, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.countyOrState, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.country, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.phone, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.gender, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.dateOfBirth, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.sifuInstructorId, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.managingOrgId, () => !this.userIsMemberOrAdmin());
    disabled(schema.membershipType, () => !this.userIsSchoolManagerOrAdmin());
    disabled(schema.firstMembershipStarted, () => !this.userIsSchoolManagerOrAdmin());
    disabled(schema.lastRenewalDate, () => !this.userIsSchoolManagerOrAdmin());
    disabled(schema.currentMembershipExpires, () => !this.userIsSchoolManagerOrAdmin());
    disabled(schema.studentLevel, () => !this.userIsSchoolManagerOrAdmin());
    disabled(schema.applicationLevel, () => !this.userIsSchoolManagerOrAdmin());
    disabled(schema.instructorLicenseExpires, () => !this.userIsSchoolManagerOrAdmin());
    disabled(schema.instructorWebsite, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.publicEmail, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.publicPhone, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.publicRegionOrCity, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.publicCountyOrState, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.isAdmin, () => !this.userIsAdmin());
    disabled(schema.notes, () => !this.userIsAdmin());
  });

  // Sync input member to the form model.
  _sync = effect(() => {
    const m = this.member();
    // We deep clone to ensure the form model has its own copy.
    this.memberFormModel.set(structuredClone(m));
  });

  // Get an editable version of the member for save (it's the same as the model).
  editableMember = computed<Member>(() => this.memberFormModel());

  // Visual state
  collapsable = input<boolean>(true);
  collapse = input<boolean | null>(null);
  close = output();
  collapsed = linkedSignal<boolean>(() => {
    return this.collapsable() && (this.collapse() ?? true);
  });
  showInstructorNotes = signal(false);
  showSchoolNotes = signal(false);

  isDirty = computed(
    () =>
      this.form().dirty() ||
      this.memberIdAssignment().kind !== AssignKind.UnchangedExistingId ||
      this.instructorIdAssignment().kind !== AssignKind.UnchangedExistingId,
  );
  isSaving = signal(false);
  saveComplete = computed(() => {
    return this.isSaving() && !this.isDirty();
  });
  countryWithCode = computed<CountryCode | null>(() => {
    const countryName = this.editableMember().country;
    return (
      this.membersService.countries
        .entries()
        .find((c) => c.name === countryName) || null
    );
  });
  // TODO: add error checking, expectedNextMemberId should not be empty!
  expectedNextMemberId = computed(() => {
    const counters = this.membersService.counters();
    if (!counters) return '...loading...';
    const code = this.countryWithCode()?.id;
    if (!code) return 'specified once valid country is selected above';
    const nextId = (counters.memberIdCounters[code] || 0) + 1;
    return `${code}${nextId}`;
  });
  // TODO: add error checking, expectedNextMemberId should not be empty if
  // this.assignInstructorIdOnSave() is true.
  expectedNextInstructorId = computed(() => {
    const counters = this.membersService.counters();
    if (!counters) return '';
    return (counters.instructorIdCounter + 1).toString();
  });

  // For auto-completes, how we show stuff
  countryDisplayFns = {
    toChipId: (c: { id: string; name: string }) => c.id,
    toName: (c: { id: string; name: string }) => c.name,
  };
  schoolDisplayFns = {
    toChipId: (s: School) => s.schoolId,
    toName: (s: School) => s.schoolName,
  };
  instructorDisplayFns = {
    toChipId: (i: InstructorPublicData) => i.instructorId,
    toName: (i: InstructorPublicData) => i.name,
  };

  // Local state, for assigning new instructors...
  initInstructorIdAssignment(): Assignment {
    return {
      kind: AssignKind.UnchangedExistingId,
      curId: this.member().instructorId,
    };
  }
  initMemberIdAssignment(): Assignment {
    if (this.member().memberId.trim() === '') {
      return {
        kind: AssignKind.AssignNewAutoId,
        curId: '',
      };
    } else {
      return {
        kind: AssignKind.UnchangedExistingId,
        curId: this.member().memberId,
      };
    }
  }
  instructorIdAssignment = linkedSignal<Assignment>(() =>
    this.initInstructorIdAssignment(),
  );
  memberIdAssignment = linkedSignal<Assignment>(() =>
    this.initMemberIdAssignment(),
  );

  // User permissions state, for what can be shown.
  canDelete = input<boolean>(true);
  userIsSchoolManagerOrAdmin = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    if (user.isAdmin) return true;
    const member = this.member();
    return user.schoolsManaged.includes(member.managingOrgId);
  });
  userIsAdmin = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    return user.isAdmin;
  });
  userIsMemberOrAdmin = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    const emails = this.member().emails || [];
    return user.isAdmin || emails.includes(user.firebaseUser.email || '');
  });
  userIsMemberSchoolManagerOrAdmin = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    const emails = this.member().emails || [];
    return (
      user.isAdmin ||
      emails.includes(user.firebaseUser.email || '') ||
      user.schoolsManaged.includes(this.member().managingOrgId)
    );
  });

  // Erro handling.
  asyncError = signal<Error | null>(null);

  // CSS host handyness.
  @HostBinding('class.is-open')
  get isOpen() {
    return !this.collapsed();
  }

  @HostBinding('class.is-dirty')
  get isDirtyClass() {
    return this.isDirty();
  }

  addEmail() {
    this.form.emails().value.update((emails) => [...emails, '']);
  }

  removeEmail(index: number) {
    this.form
      .emails()
      .value.update((emails) => emails.filter((_, i) => i !== index));
  }

  updateEmail(index: number, val: string) {
    this.form.emails().value.update((emails) => {
      const newEmails = [...emails];
      newEmails[index] = val;
      return newEmails;
    });
  }

  constructor() {}

  updateMember() {
    // No longer needed with signalGroup as it's reactive
  }

  handleInstructorIdAssignmentChange(assignment: Assignment) {
    console.log('handleInstructorIdAssignmentChange', assignment);
    this.instructorIdAssignment.set(assignment);
    if (
      assignment.kind === AssignKind.UnchangedExistingId ||
      assignment.kind === AssignKind.AssignNewAutoId
    ) {
      return;
    }

    if (assignment.kind === AssignKind.AssignNewManualId) {
      this.form.instructorId().value.set(assignment.newId);
    } else if (assignment.kind === AssignKind.RemoveId) {
      this.form.instructorId().value.set('');
    }
  }

  handleMemberIdAssignmentChange(assignment: Assignment) {
    console.log('handleMemberIdAssignmentChange', assignment);
    this.memberIdAssignment.set(assignment);
    if (
      assignment.kind === AssignKind.UnchangedExistingId ||
      assignment.kind === AssignKind.AssignNewAutoId
    ) {
      return;
    }

    if (assignment.kind === AssignKind.AssignNewManualId) {
      this.form.memberId().value.set(assignment.newId);
    } else if (assignment.kind === AssignKind.RemoveId) {
      this.form.memberId().value.set('');
    }
  }

  cancel($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    const m = this.member();
    this.form().reset();
    this.instructorIdAssignment.set(this.initInstructorIdAssignment());
    this.memberIdAssignment.set(this.initMemberIdAssignment());
    this.collapsed.set(this.collapsable());
    this.close.emit();
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

  isDupEmail = computed(() => {
    const member = this.editableMember();
    if (!this.allMembers || !member) {
      return false;
    }
    const currentEmails = (member.emails || []).map((e) => e.toLowerCase());
    return this.allMembers().some((m) => {
      if (m.id === member.id) return false;
      const otherEmails = (m.emails || []).map((e) => e.toLowerCase());
      return currentEmails.some((e) => otherEmails.includes(e));
    });
  });

  isDupMemberId = computed(() => {
    const member = this.editableMember();
    if (!this.allMembers || !member) {
      return false;
    }
    return this.allMembers().some(
      (m) =>
        m.memberId.toLowerCase() === member.memberId.toLowerCase() &&
        m.id !== member.id,
    );
  });

  async saveMember(event: Event) {
    event.preventDefault();
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      const member = this.editableMember();
      const memberIdAssignment = this.memberIdAssignment().kind;
      if (memberIdAssignment === AssignKind.AssignNewAutoId) {
        const countryCode = this.countryWithCode()?.id;
        if (countryCode) {
          member.memberId =
            await this.membersService.createNextMemberId(countryCode);
        } else {
          throw new Error(
            `Invalid country code: ${countryCode}, please make sure the code exists before you save, otherwise we don't know how to assign an member ID (member IDs are of the form CCNNN where CC is the two character country code)`,
          );
        }
      } else if (member.memberId === '') {
        throw new Error(`Member ID cannot be empty.`);
      }

      const instructorIdAssignment = this.instructorIdAssignment().kind;
      if (instructorIdAssignment === AssignKind.AssignNewAutoId) {
        member.instructorId = (
          await this.membersService.createNextInstructorId()
        ).toString();
      }

      if (member.id) {
        await this.membersService.updateMember(member.id, member);
      } else {
        await this.membersService.addMember(member);
      }

      this.form().reset();
      // Shortcut so we don't need to wait for Firebase/firestore sync loop to
      // update the original member that will... also, now we use get-members, we don't directly

      // Object.assign(this.member(), member);
      // this.editableMember.set({ ...member });

      // Now we can update the isSaving state and close the being edited member.
      this.isSaving.set(false);
      this.collapsed.set(this.collapsable());
      this.close.emit();
    } catch (e: unknown) {
      console.error(e);
      this.asyncError.set(e as Error);
      this.isSaving.set(false);
    }
  }

  async deleteMember($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    const member = this.editableMember();
    if (confirm(`Are you sure you want to delete ${member.name}?`)) {
      this.asyncError.set(null);
      if (member.id) {
        try {
          await this.membersService.deleteMember(member.id);
        } catch (e: unknown) {
          console.error(e);
          this.asyncError.set(e as Error);
        }
      }
    }
  }

  onMasterLevelChange(level: MasterLevel, isChecked: boolean) {
    const current = this.form.mastersLevels().value();
    if (isChecked) {
      this.form.mastersLevels().value.set([...current, level]);
    } else {
      this.form.mastersLevels().value.set(
        current.filter((l: MasterLevel) => l !== level),
      );
    }
  }

  closeErrors() {
    this.asyncError.set(null);
  }

  errorMessage = computed(() => {
    const errors: string[] = [];
    const member = this.editableMember();
    if (this.isDupEmail()) {
      errors.push('This email address is already in use.');
    }
    if (this.form.emails && (this.form.emails() as any).value().length === 0) {
      errors.push('An email must be provided.');
    }
    if (this.isDupMemberId()) {
      errors.push('This member ID is already in use.');
    }
    if (this.form.name().value().trim() === '') {
      errors.push('Name cannot be empty.');
    }
    if (
      this.memberIdAssignment().kind !== AssignKind.AssignNewAutoId &&
      member.memberId.trim() === ''
    ) {
      errors.push('Member ID cannot be empty for a new member.');
    }
    const asyncError = this.asyncError();
    if (asyncError) {
      errors.push(asyncError.message);
    }
    return errors;
  });
}
