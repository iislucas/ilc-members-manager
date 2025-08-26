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
import { School, Member } from '../../../functions/src/data-model';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MemberSearchComponent } from '../member-search/member-search';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

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
  // this component's element ref to support scrolling into view?
  private elementRef = inject(ElementRef);

  school = input.required<School>();
  allSchools = input.required<School[]>();
  canDelete = input<boolean>(true);
  collapse = input<boolean | null>(null);
  close = output();
  editableSchool = linkedSignal<School>(() => {
    const s = this.school();
    return JSON.parse(JSON.stringify(s));
  });
  isSaving = signal(false);
  collapsed = signal(true);
  isDirty = computed(
    () =>
      JSON.stringify(this.school()) !== JSON.stringify(this.editableSchool())
  );
  private membersService = inject(DataManagerService);
  owner = computed(() => {
    const ownerMemId = this.editableSchool().owner;
    const owner = this.membersService.instructors
      .entries()
      .find((m) => m.memberId === ownerMemId);
    return owner || null;
  });
  managers = computed(() => {
    const managerMemIds = this.editableSchool().managers;
    return managerMemIds.map(
      (memberId) =>
        this.membersService.instructors
          .entries()
          .find((m) => m.memberId === memberId) || null
    );
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

  updateSchool() {
    this.editableSchool.set({ ...this.editableSchool() });
  }

  removeManager(index: number) {
    const currentManagers = this.managers();
    const newManagers = [...currentManagers];
    newManagers.splice(index, 1);
    this.editableSchool.update((school) => {
      school!.managers.splice(index, 1);
      return { ...school! };
    });
  }

  updateManager(index: number, member: Member) {
    this.editableSchool.update((school) => {
      school.managers[index] = member.email;
      return { ...school };
    });
  }

  updateOwner(member: Member) {
    this.editableSchool.update((school) => {
      school!.owner = member.memberId;
      return { ...school! };
    });
  }

  cancel($event: Event) {
    this.editableSchool.set({ ...this.school() });
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
        s.id !== school.id
    );
  });

  async saveSchool() {
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      const school = this.editableSchool()!;
      if (school.id) {
        await this.membersService.updateSchool(school.id, school);
      } else {
        await this.membersService.addSchool(school);
      }
      this.isSaving.set(false);
      this.collapsed.set(true);
      this.close.emit();
    } catch (e: unknown) {
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
        `Are you sure you want to delete ${this.editableSchool()!.schoolName}?`
      )
    ) {
      if (this.editableSchool()!.id) {
        try {
          await this.membersService.deleteSchool(this.editableSchool()!.id!);
        } catch (e: unknown) {
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
    if (school.schoolName.trim() === '') {
      errors.push('School Name cannot be empty.');
    }
    if (!school.id && school.schoolId.trim() === '') {
      errors.push('School ID cannot be empty for a new school.');
    }
    const asyncError = this.asyncError();
    if (asyncError) {
      errors.push(asyncError.message);
    }
    return errors;
  });
}
