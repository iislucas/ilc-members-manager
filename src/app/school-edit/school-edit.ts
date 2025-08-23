import {
  Component,
  input,
  output,
  effect,
  inject,
  signal,
  HostBinding,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { School, Member } from '../member.model';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';
import { MembersService } from '../members.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MemberSearchComponent } from '../member-search/member-search';

@Component({
  selector: 'app-school-edit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    MemberSearchComponent,
    IconComponent,
  ],
  templateUrl: './school-edit.html',
  styleUrl: './school-edit.scss',
})
export class SchoolEditComponent {
  school = input.required<School>();
  allSchools = input.required<School[]>();
  canDelete = input<boolean>(true);
  collapse = input<boolean | null>(null);
  close = output();
  editableSchool!: School;
  schoolIdExists = false;
  errorMessage = signal<string[]>([]);
  isSaving = signal(false);
  collapsed = signal(true);
  isDirty = signal(false);
  private membersService = inject(MembersService);
  private elementRef = inject(ElementRef);
  owner = signal<Member | null>(null);
  managers = signal<(Member | null)[]>([]);

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
    effect(() => {
      this.editableSchool = JSON.parse(JSON.stringify(this.school()));
      this.validateForm();
      this.isDirty.set(false);
      this.updateOwnerAndManagers();
    });
  }

  updateOwnerAndManagers() {
    const ownerEmail = this.editableSchool.owner;
    const owner = this.membersService
      .instructors()
      .find((m) => m.email === ownerEmail);
    this.owner.set(owner || null);

    const managerEmails = this.editableSchool.managers;
    const managers = managerEmails.map(
      (email) =>
        this.membersService.instructors().find((m) => m.email === email) || null
    );
    this.managers.set(managers);
  }

  removeManager(index: number) {
    const currentManagers = this.managers();
    const newManagers = [...currentManagers];
    newManagers.splice(index, 1);
    this.managers.set(newManagers);
    this.editableSchool.managers.splice(index, 1);
    this.validateForm();
  }

  updateManager(index: number, member: Member) {
    const currentManagers = this.managers();
    const newManagers = [...currentManagers];
    newManagers[index] = member;
    this.managers.set(newManagers);
    this.editableSchool.managers[index] = member.email;
    this.validateForm();
  }

  cancel($event: Event) {
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

  isDupSchoolId() {
    const self = this;
    if (!this.allSchools || !this.editableSchool) {
      this.schoolIdExists = false;
      return false;
    }
    this.schoolIdExists = this.allSchools().some((school) => {
      return (
        school.schoolId?.toLowerCase() ===
          self.editableSchool.schoolId?.toLowerCase() &&
        school.id !== self.editableSchool.id
      );
    });
    return this.schoolIdExists;
  }

  async saveSchool() {
    this.isSaving.set(true);
    try {
      if (this.editableSchool.id) {
        await this.membersService.updateSchool(
          this.editableSchool.id,
          this.editableSchool
        );
      } else {
        await this.membersService.addSchool(this.editableSchool);
      }
      this.isSaving.set(false);
      this.collapsed.set(true);
      this.close.emit();
    } catch (e: any) {
      this.errorMessage.set([e.message]);
      this.isSaving.set(false);
    }
  }

  async deleteSchool($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    if (
      confirm(
        `Are you sure you want to delete ${this.editableSchool.schoolName}?`
      )
    ) {
      if (this.editableSchool.id) {
        try {
          await this.membersService.deleteSchool(this.editableSchool.id);
        } catch (e: any) {
          this.errorMessage.set([e.message]);
        }
      }
    }
  }

  closeErrors() {
    this.errorMessage.set([]);
  }

  validateForm() {
    this.isDirty.set(
      JSON.stringify(this.school()) !== JSON.stringify(this.editableSchool)
    );

    const errors: string[] = [];
    if (this.isDupSchoolId()) {
      errors.push('This school ID is already in use.');
    }
    if (this.editableSchool.schoolName.trim() === '') {
      errors.push('School Name cannot be empty.');
    }
    if (!this.editableSchool.id && this.editableSchool.schoolId.trim() === '') {
      errors.push('School ID cannot be empty for a new school.');
    }

    if (errors.length > 0) {
      this.errorMessage.set(errors);
      this.isSaving.set(false);
      return;
    }

    this.errorMessage.set([]);
  }
}
