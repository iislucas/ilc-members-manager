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
  InstructorLicenseType,
  AgeCategory,
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
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { MemberRowHeaderComponent } from '../member-row-header/member-row-header';

@Component({
  selector: 'app-member-details',
  standalone: true,
  imports: [
    FormField,
    IconComponent,
    SpinnerComponent,
    IdAssignmentComponent,
    AutocompleteComponent,
    MemberRowHeaderComponent,
  ],
  templateUrl: './member-details.html',
  styleUrl: './member-details.scss',
})
export class MemberDetailsComponent {
  private firebaseState = inject(FirebaseStateService);
  public membersService = inject(DataManagerService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  // all values from the member service, used for dup-checking...
  // Maybe we can use membersService.members? and not need this...?
  allMembers = input.required<Member[]>();
  close = output();

  // Constants
  AssignKind = AssignKind;
  MembershipType = MembershipType;
  membershipTypes = Object.values(MembershipType);
  InstructorLicenseType = InstructorLicenseType;
  instructorLicenseTypes = Object.values(InstructorLicenseType);
  masterLevels = Object.values(MasterLevel).sort();

  // The core object of interest.
  member = input.required<Member>();

  // The signal holding the data model for the form.
  memberFormModel = signal<Member>(initMember());

  // Use form() to create a FieldTree for validation and state tracking.
  form: FieldTree<Member> = form(this.memberFormModel, (schema) => {
    required(schema.name, { message: 'Name is required.' });
    // Email no longer required
    // TODO: email validation for array...
    required(schema.membershipType, {
      message: 'Membership type is required.',
    });

    disabled(schema.name, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.emails, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.address, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.city, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.zipCode, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(
      schema.countyOrState,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(schema.country, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.phone, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(schema.gender, () => !this.userIsMemberSchoolManagerOrAdmin());
    disabled(
      schema.dateOfBirth,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(
      schema.primaryInstructorId,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(schema.primarySchoolId, () => !this.userIsMemberOrAdmin());
    disabled(schema.membershipType, () => !this.userIsSchoolManagerOrAdmin());
    disabled(
      schema.firstMembershipStarted,
      () => !this.userIsSchoolManagerOrAdmin(),
    );
    disabled(schema.lastRenewalDate, () => !this.userIsSchoolManagerOrAdmin());
    disabled(
      schema.currentMembershipExpires,
      () => !this.userIsSchoolManagerOrAdmin(),
    );
    disabled(schema.studentLevel, () => !this.userIsSchoolManagerOrAdmin());
    disabled(schema.applicationLevel, () => !this.userIsSchoolManagerOrAdmin());
    disabled(
      schema.instructorLicenseExpires,
      () => !this.userIsSchoolManagerOrAdmin(),
    );
    disabled(
      schema.instructorLicenseRenewalDate,
      () => !this.userIsSchoolManagerOrAdmin(),
    );
    disabled(
      schema.instructorLicenseType,
      () => !this.userIsSchoolManagerOrAdmin(),
    );
    disabled(
      schema.instructorWebsite,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(
      schema.publicClassGoogleCalendarId,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(
      schema.publicEmail,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(
      schema.publicPhone,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(
      schema.publicRegionOrCity,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(
      schema.publicCountyOrState,
      () => !this.userIsMemberSchoolManagerOrAdmin(),
    );
    disabled(schema.classVideoLibrarySubscription, () => !this.userIsAdmin());
    disabled(schema.classVideoLibraryExpirationDate, () => !this.userIsAdmin());
    disabled(schema.isAdmin, () => !this.userIsAdmin());
    disabled(schema.notes, () => !this.userIsAdmin());
    disabled(schema.tags, () => !this.userIsAdmin());
  });

  // Sync input member to the form model.
  _sync = effect(() => {
    const m = this.member();
    // We deep clone to ensure the form model has its own copy.
    this.memberFormModel.set(structuredClone(m));
  });

  // Get an editable version of the member for save (it's the same as the model).
  editableMember = computed<Member>(() => this.memberFormModel());

  // --- Date-mismatch warnings (informational, do not block save) ---

  /** Warn when annual membership expiration doesn't match lastRenewalDate + 1 year. */
  membershipDateMismatch = computed(() => {
    const m = this.editableMember();
    if (m.membershipType !== MembershipType.Annual) return null;
    if (!m.lastRenewalDate || !m.currentMembershipExpires) return null;
    const expected = this.addYears(m.lastRenewalDate, 1);
    if (m.currentMembershipExpires === expected) return null;
    return `Expected expiration ${expected} (1 year after renewal ${m.lastRenewalDate}), but got ${m.currentMembershipExpires}.`;
  });

  /** Warn when annual instructor license expiration doesn't match renewal + 1 year. */
  instructorLicenseDateMismatch = computed(() => {
    const m = this.editableMember();
    if (m.instructorLicenseType !== InstructorLicenseType.Annual) return null;
    if (!m.instructorLicenseRenewalDate || !m.instructorLicenseExpires) return null;
    const expected = this.addYears(m.instructorLicenseRenewalDate, 1);
    if (m.instructorLicenseExpires === expected) return null;
    return `Expected expiration ${expected} (1 year after renewal ${m.instructorLicenseRenewalDate}), but got ${m.instructorLicenseExpires}.`;
  });

  /** Add N years to a YYYY-MM-DD date string, returning a YYYY-MM-DD string. */
  private addYears(dateStr: string, years: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.toISOString().substring(0, 10);
  }

  showInstructorNotes = signal(false);
  showSchoolNotes = signal(false);

  /** Infer membership age category from date of birth. */
  membershipAgeCategory = computed((): AgeCategory => {
    const dob = this.editableMember().dateOfBirth;
    if (!dob) return AgeCategory.None;
    const birthDate = new Date(dob + 'T00:00:00Z');
    if (isNaN(birthDate.getTime())) return AgeCategory.None;
    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - birthDate.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birthDate.getUTCDate())) {
      age--;
    }
    if (age < 21) return AgeCategory.Under21;
    if (age >= 65) return AgeCategory.Senior;
    return AgeCategory.None;
  });

  // Check if emails have actually changed from the original
  emailsChanged = computed(() => {
    const currentEmails = this.form.emails().value();
    const originalEmails = this.member().emails || [];

    return (
      currentEmails.length !== originalEmails.length ||
      currentEmails.some((email, index) => email !== originalEmails[index])
    );
  });

  isDirty = computed(
    () =>
      // For emails or tags, check if they've actually changed, not just if the field is dirty
      this.emailsChanged() ||
      this.tagsChanged() ||
      // For other fields, use the standard dirty check but exclude emails/tags
      (this.form().dirty() && this.hasNonArrayChanges()) ||
      this.memberIdAssignment().kind !== AssignKind.UnchangedExistingId ||
      this.instructorIdAssignment().kind !== AssignKind.UnchangedExistingId,
  );

  // Check if tags have actually changed from the original
  tagsChanged = computed(() => {
    const currentTags = this.form.tags().value();
    const originalTags = this.member().tags || [];

    if (currentTags.length !== originalTags.length) return true;
    // Check if contents are different (assuming order matters or mostly consistent)
    // If order doesn't matter, we should sort, but for now strict order is fine/better for UI.
    return currentTags.some((tag, index) => tag !== originalTags[index]);
  });

  // Helper to check if there are dirty fields other than emails/tags
  private hasNonArrayChanges(): boolean {
    // Simplified: if form is dirty and we're checking, assume non-array changes
    return true;
  }

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
    const nextId = Math.max((counters.memberIdCounters[code] || 0) + 1, 100);
    return `${code}${nextId}`;
  });

  // TODO: add error checking, expectedNextMemberId should not be empty if
  // this.assignInstructorIdOnSave() is true.
  expectedNextInstructorId = computed(() => {
    const counters = this.membersService.counters();
    if (!counters) return '';
    return Math.max((counters.instructorIdCounter || 0) + 1, 100).toString();
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

  updateStudentsCheckbox = signal<boolean>(true);
  studentsToUpdateCount = signal<number>(0);

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
    return user.schoolsManaged.includes(member.primarySchoolId);
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
      user.schoolsManaged.includes(this.member().primarySchoolId)
    );
  });

  // Erro handling.
  asyncError = signal<Error | null>(null);



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

  updateEmail(index: number, event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.form.emails().value.update((emails) => {
      const newEmails = [...emails];
      newEmails[index] = val;
      return newEmails;
    });
  }

  addTag() {
    this.form.tags().value.update((tags) => [...tags, '']);
  }

  updateTag(index: number, event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.form.tags().value.update((tags) => {
      const newTags = [...tags];
      newTags[index] = val;
      return newTags;
    });
  }

  removeTag(index: number) {
    this.form.tags().value.update((tags) => tags.filter((_, i) => i !== index));
  }

  updateCountry(value: string) {
    this.form.country().value.set(value);
    this.form.country().markAsDirty();
  }

  updatePrimaryInstructorId(value: string) {
    this.form.primaryInstructorId().value.set(value);
    this.form.primaryInstructorId().markAsDirty();
  }

  updatePrimarySchoolId(value: string) {
    this.form.primarySchoolId().value.set(value);
    this.form.primarySchoolId().markAsDirty();

    const school = this.membersService.schools.entriesMap().get(value);
    const docId = school ? school.docId : '';
    this.form.primarySchoolDocId().value.set(docId);
    this.form.primarySchoolDocId().markAsDirty();
  }

  gotoStudents() {
    this.routingService.matchedPatternId.set(Views.InstructorStudents);
    const signals = this.routingService.signals[Views.InstructorStudents];
    signals.pathVars.instructorId.set(this.member().instructorId);
  }

  constructor() {
    effect(async () => {
      const orig = this.member()?.instructorId;
      const current = this.editableMember()?.instructorId;
      if (orig && current && orig !== current) {
        const count = await this.membersService.countMembersWithInstructorId(orig);
        this.studentsToUpdateCount.set(count);
      } else {
        this.studentsToUpdateCount.set(0);
      }
    });
  }

  handleInstructorIdAssignmentChange(assignment: Assignment) {
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
    // If dirty, we show "undo changes"
    if (this.isDirty()) {
    // Reset the form model to a fresh clone of the original member
    // This will trigger the effect to sync all fields including emails and autocomplete values
      this.form().reset();
      this.memberFormModel.set(structuredClone(this.member()));
      this.instructorIdAssignment.set(this.initInstructorIdAssignment());
      this.memberIdAssignment.set(this.initMemberIdAssignment());
    } else {
      // if not dirty, we show "close"
      this.close.emit();
    }
  }

  duplicateMembersForEmail = computed(() => {
    const member = this.editableMember();
    if (!this.allMembers || !member) {
      return [];
    }
    const currentEmails = (member.emails || []).map((e) => e.toLowerCase());
    if (currentEmails.length === 0) return [];
    return this.allMembers().filter((m) => {
      if (m.docId === member.docId) return false;
      const otherEmails = (m.emails || []).map((e) => e.toLowerCase());
      return currentEmails.some((e) => otherEmails.includes(e));
    });
  });

  isDupEmail = computed(() => this.duplicateMembersForEmail().length > 0);

  duplicateMembersForMemberId = computed(() => {
    const member = this.editableMember();
    if (!this.allMembers || !member || !member.memberId || member.memberId.trim() === '') {
      return [];
    }
    return this.allMembers().filter(
      (m) =>
        m.memberId.toLowerCase() === member.memberId.toLowerCase() &&
        m.docId !== member.docId,
    );
  });

  duplicateMembersForInstructorId = computed(() => {
    const member = this.editableMember();
    if (!this.allMembers || !member || !member.instructorId || member.instructorId.trim() === '') {
      return [];
    }
    return this.allMembers().filter(
      (m) =>
        m.instructorId.toLowerCase() === member.instructorId.toLowerCase() &&
        m.docId !== member.docId,
    );
  });

  isDupMemberId = computed(() => this.duplicateMembersForMemberId().length > 0);

  gotoMember(memberId: string) {
    if (!memberId) return;
    const match = this.routingService.matchedPatternId();
    if (match) {
      const signals = this.routingService.signals[match as keyof AppPathPatterns] as any;
      if (signals?.pathVars?.memberId) {
        signals.pathVars.memberId.set(memberId);
        return;
      }
    }
    // Fallback
    this.routingService.navigateToParts(['members', memberId]);
  }

  async saveMember(event: Event) {
    event.preventDefault();
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      // Ensure we have a separate copy, and explicitly sync the array 
      // fields which don't use conventional two-way bindings.
      const member = {
        ...this.editableMember(),
        emails: this.form.emails().value().filter((e) => e.trim() !== ''),
        tags: this.form.tags().value().filter((t) => t.trim() !== ''),
        mastersLevels: this.form.mastersLevels().value(),
      };
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

      if (member.docId) {
        const origId = this.member().instructorId;
        if (this.updateStudentsCheckbox() && this.studentsToUpdateCount() > 0 && origId && member.instructorId && origId !== member.instructorId) {
          try {
            await this.membersService.updateMemberAndStudentInstructorIds(member.docId, member, origId);
          } catch (e) {
            console.error('Error updating member and student instructor IDs:', e);
            throw new Error(`Failed to update member and move students to the new instructor: ${(e as Error).message}`);
          }
        } else {
          if (origId && member.instructorId && origId !== member.instructorId && member.docId) {
            try {
              await this.membersService.clearInstructorMembers(member.docId);
            } catch (e) {
              console.error('Error clearing old instructor members subcollection:', e);
              throw new Error(`Failed to clean up the member's old instructor subcollection: ${(e as Error).message}`);
            }
          }
          try {
            await this.membersService.updateMember(member.docId, member, this.member());
          } catch (e) {
            console.error('Error updating member document:', e);
            throw new Error(`Failed to save updated member details: ${(e as Error).message}`);
          }
        }
      } else {
        try {
          await this.membersService.addMember(member);
        } catch (e) {
          console.error('Error creating new member:', e);
          throw new Error(`Failed to create new member: ${(e as Error).message}`);
        }
      }

      this.form().reset();
      // Shortcut so we don't need to wait for Firebase/firestore sync loop to
      // update the original member that will... also, now we use get-members, we don't directly

      // Object.assign(this.member(), member);
      // this.editableMember.set({ ...member });

      // Now we can update the isSaving state and close the being edited member.
      this.isSaving.set(false);
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
      if (member.docId) {
        try {
          await this.membersService.deleteMember(member.docId);
          this.close.emit();
        } catch (e: unknown) {
          console.error(e);
          this.asyncError.set(e as Error);
        }
      }
    }
  }

  onMasterLevelChange(level: MasterLevel, event: Event) {
    const isChecked = (event.target as HTMLInputElement).checked;
    const current = this.form.mastersLevels().value();
    if (isChecked) {
      this.form.mastersLevels().value.set([...current, level]);
    } else {
      this.form
        .mastersLevels()
        .value.set(current.filter((l: MasterLevel) => l !== level));
    }
    this.form.mastersLevels().markAsDirty();
  }

  closeErrors() {
    this.asyncError.set(null);
  }

  errorMessage = computed(() => {
    const errors: string[] = [];
    const member = this.editableMember();
    // Duplicate email is now a warning, not an error (does not block save).
    // Removed email requirement
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
