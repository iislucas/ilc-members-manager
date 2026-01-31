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
  members = computed(() => {
    return this.memberSet().search(this.searchTerm());
  });
  loading = computed(() => this.memberSet().loading());
  error = computed(() => this.memberSet().error());

  constructor() {
    effect(() => {
      const jumpTo = this.jumpToMember();
      if (jumpTo !== '') {
      }
    });
  }

  onSearch(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onNewMember() {
    this.newMember.set(initMember());
    this.isAddingMember.set(true);
  }

  onNewMemberClose() {
    this.isAddingMember.set(false);
  }
}
