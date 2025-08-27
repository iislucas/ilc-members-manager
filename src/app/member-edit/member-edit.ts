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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Member,
  MembershipType,
  MasterLevel,
  School,
  InstructorPublicData,
} from '../../../functions/src/data-model';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MemberSearchComponent } from '../member-search/member-search';
import { SchoolSearchComponent } from '../school-search/school-search';
import { deepObjEq } from '../utils';

@Component({
  selector: 'app-member-edit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    MemberSearchComponent,
    SchoolSearchComponent,
  ],
  templateUrl: './member-edit.html',
  styleUrl: './member-edit.scss',
})
export class MemberEditComponent {
  member = input.required<Member>();
  allMembers = input.required<Member[]>();
  canDelete = input<boolean>(true);
  collapse = input<boolean | null>(null);
  close = output();
  MembershipType = MembershipType;
  membershipTypes = Object.values(MembershipType);
  masterLevels = Object.values(MasterLevel).sort();
  editableMember = linkedSignal<Member>(() => {
    const m = this.member();
    return JSON.parse(JSON.stringify(m));
  });
  isSaving = signal(false);
  collapsed = linkedSignal<boolean>(() => {
    return this.collapse() ?? true;
  });
  isDirty = computed(() => !deepObjEq(this.member(), this.editableMember()));
  saveComplete = computed(() => {
    return this.isSaving() && !this.isDirty();
  });
  studentOfMemberId = linkedSignal<string>(() => {
    const member = this.editableMember();
    return member.sifuMemberId;
  });
  schoolSearch = linkedSignal<string>(() => {
    const member = this.editableMember();
    return member.managingOrgId;
  });
  private membersService = inject(DataManagerService);
  private elementRef = inject(ElementRef);
  asyncError = signal<Error | null>(null);
  studentOfName = computed(() => {
    const sifuMemId = this.studentOfMemberId();
    if (sifuMemId) {
      const studentOf = this.allMembers().find((m) => m.memberId === sifuMemId);
      return studentOf?.name ?? '';
    }
    return '';
  });
  schoolName = computed(() => {
    const schoolId = this.schoolSearch();
    if (schoolId) {
      const school = this.membersService.schools
        .entries()
        .find((s) => s.schoolId === schoolId);
      return school?.schoolName ?? '';
    }
    return '';
  });

  @HostBinding('class.is-open')
  get isOpen() {
    return !this.collapsed();
  }

  @HostBinding('class.is-dirty')
  get isDirtyClass() {
    return this.isDirty();
  }

  constructor() {}

  studendOfSelected(sifu: InstructorPublicData) {
    this.editableMember.update((m) => {
      m.sifuMemberId = sifu.memberId;
      return { ...m };
    });
  }

  schoolSelected(school: School) {
    this.editableMember.update((m) => {
      m.managingOrgId = school.schoolId;
      return { ...m };
    });
  }

  updateMember() {
    this.editableMember.set({ ...this.editableMember() });
  }

  cancel($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    this.editableMember.set({ ...this.member() });
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

  isDupEmail = computed(() => {
    const member = this.editableMember();
    if (!this.allMembers || !member) {
      return false;
    }
    return this.allMembers().some(
      (m) =>
        m.email?.toLowerCase() === member.email?.toLowerCase() &&
        m.id !== member.id,
    );
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

  async saveMember() {
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      const member = this.editableMember();
      if (member.email) {
        await this.membersService.updateMember(member.email, member);
      } else {
        await this.membersService.addMember(member);
      }
      // Shortcut so we don't need to wait for Firebase/firestore sync loop to
      // update the original member that will... also, now we use get-members, we don't directly
      Object.assign(this.member(), member);
      this.editableMember.set({ ...member });
      // Now we can update the isSaving state and close the being edited member.
      this.isSaving.set(false);
      this.collapsed.set(true);
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
    this.editableMember.update((m) => {
      if (isChecked) {
        m.mastersLevels.push(level);
      } else {
        const index = m.mastersLevels.indexOf(level);
        if (index > -1) {
          m.mastersLevels.splice(index, 1);
        }
      }
      return { ...m };
    });
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
    if (member.email.trim() === '') {
      errors.push('An email must be provided.');
    }
    if (this.isDupMemberId()) {
      errors.push('This member ID is already in use.');
    }
    if (member.name.trim() === '') {
      errors.push('Name cannot be empty.');
    }
    if (!member.id && member.memberId.trim() === '') {
      errors.push('Member ID cannot be empty for a new member.');
    }
    const asyncError = this.asyncError();
    if (asyncError) {
      errors.push(asyncError.message);
    }
    return errors;
  });
}
