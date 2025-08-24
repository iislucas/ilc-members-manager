import { Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { initMember, Member } from '../../../functions/src/data-model';
import { SearchableMemberSet } from '../searchable-member-set';
import { MemberEditComponent } from '../member-edit/member-edit';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, MemberEditComponent, IconComponent, SpinnerComponent],
  templateUrl: './member-list.html',
  styleUrl: './member-list.scss',
})
export class MemberListComponent {
  memberSet = input.required<SearchableMemberSet>();
  private searchTerm = signal('');
  isAddingMember = signal(false);
  newMember = signal<Member>(initMember());

  // Expose signals from the service to the template
  members = computed(() => {
    return this.memberSet().searchMembers(this.searchTerm());
  });
  loading = computed(() => this.memberSet().loading());
  error = computed(() => this.memberSet().error());

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
