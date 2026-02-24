import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { initMember, Member } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { MemberEditComponent } from '../member-edit/member-edit';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FirebaseStateService } from '../firebase-state.service';

@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, MemberEditComponent, IconComponent, SpinnerComponent],
  templateUrl: './member-list.html',
  styleUrl: './member-list.scss',
})
export class MemberListComponent {
  firebaseStateService = inject(FirebaseStateService);
  user = this.firebaseStateService.user;
  canMakeNewMembers = computed(() => {
    const user = this.user();
    if (!user) {
      console.warn('Got to members list without a valid user.');
      return false;
    }
    return user.isAdmin || user.schoolsManaged.length > 0;
  });

  memberSet = input.required<SearchableSet<'memberId', Member>>();
  jumpToMember = input<string>('');

  private searchTerm = signal('');
  isAddingMember = signal(false);
  newMember = signal<Member>(initMember());

  // Expose signals from the service to the template
  limit = signal(50);
  members = computed(() => {
    const all = this.memberSet().search(this.searchTerm());
    return all.slice(0, this.limit());
  });
  totalMembers = computed(
    () => this.memberSet().search(this.searchTerm()).length,
  );

  duplicateMemberIdEntries = computed(() => {
    const dups = this.memberSet().duplicateEntries();
    // optionally ignore empty memberIds but let's just use what SearchableSet does
    return dups;
  });
  errorsExist = computed(() => this.duplicateMemberIdEntries().length > 0);
  showErrors = signal(false);

  duplicateInstructorIdEntries = computed(() => {
    const entries = this.memberSet().entries();
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const entry of entries) {
      const id = entry.instructorId;
      if (!id) continue;
      if (seen.has(id)) {
        dups.add(id);
      }
      seen.add(id);
    }
    return entries.filter((e) => e.instructorId && dups.has(e.instructorId));
  });
  instructorErrorsExist = computed(() => this.duplicateInstructorIdEntries().length > 0);
  showInstructorErrors = signal(false);

  loading = computed(() => this.memberSet().loading());
  error = computed(() => this.memberSet().error());

  toggleErrors() {
    this.showErrors.set(!this.showErrors());
  }

  toggleInstructorErrors() {
    this.showInstructorErrors.set(!this.showInstructorErrors());
  }

  showAll() {
    this.limit.set(Infinity);
  }

  constructor() {
    effect(() => {
      const jumpTo = this.jumpToMember();
      if (jumpTo !== '') {
      }
    });
  }

  onSearch(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
    this.limit.set(50);
  }

  onNewMember() {
    this.newMember.set(initMember());
    this.isAddingMember.set(true);
  }

  onNewMemberClose() {
    this.isAddingMember.set(false);
  }
}
