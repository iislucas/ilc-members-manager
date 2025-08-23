import {
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MembersService } from '../members.service';
import { initMember, Member } from '../data-model';
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
  private membersService = inject(MembersService);
  private searchTerm = signal('');
  isAddingMember = signal(false);
  newMember = signal<Member>(initMember());

  // Expose signals from the service to the template
  members = computed(() => {
    return this.membersService.searchMembers(this.searchTerm());
  });
  loading = this.membersService.loading;
  error = this.membersService.error;

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
