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
import { initMember, Member } from '../member.model';
import { MemberEditComponent } from '../member-edit/member-edit';
import { FirebaseStateService } from '../firebase-state.service';
import { Timestamp } from 'firebase/firestore';
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
  private firebaseStateService = inject(FirebaseStateService);
  private membersService = inject(MembersService);
  private searchTerm = signal('');
  selectedMember = signal<Member | null>(null);

  constructor() {
    effect(() => {
      const member = this.selectedMember();
      if (member) {
        this.selectMember.emit(member);
      }
    });
  }

  // Expose signals from the service to the template
  members = computed(() => {
    const term = this.searchTerm().toLowerCase();
    return this.membersService
      .members()
      .filter(
        (member) =>
          member.name.toLowerCase().includes(term) ||
          member.email.toLowerCase().includes(term)
      );
  });
  loading = this.membersService.loading;
  error = this.membersService.error;

  selectMember = output<Member>();

  onSearch(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onNewMember() {
    this.selectedMember.set(initMember());
  }
}
