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
import { Member } from '../member.model';
import { MemberEditComponent } from '../member-edit/member-edit';
import { FirebaseStateService } from '../../firebase-state.service';

@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, MemberEditComponent],
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
          member.public.name.toLowerCase().includes(term) ||
          member.public.email.toLowerCase().includes(term)
      );
  });
  loading = this.membersService.loading;
  error = this.membersService.error;

  selectMember = output<Member>();

  onSearch(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  async saveMember(member: Member) {
    console.log(`saving `, member);
    if (member.id) {
      const originalMember = await this.membersService.getMember(member.id);
      if (originalMember && originalMember.isAdmin !== member.isAdmin) {
        if (member.isAdmin) {
          await this.firebaseStateService.addAdmin(
            member.id,
            member.public.email
          );
        } else {
          await this.firebaseStateService.removeAdmin(
            member.id,
            member.public.email
          );
        }
      }
      this.membersService.updateMember(member.id, member);
    } else {
      console.log(`saving a new member`, member);

      const newMember = await this.membersService.addMember(member);
      if (member.isAdmin) {
        await this.firebaseStateService.addAdmin(
          newMember.id,
          member.public.email
        );
      }
    }
    this.selectedMember.set(null);
  }

  async deleteMember(member: Member) {
    await this.membersService.deleteMember(member.id);
    if (member.isAdmin) {
      await this.firebaseStateService.removeAdmin(
        member.id,
        member.public.email
      );
    }
    this.selectedMember.set(null);
  }
}
