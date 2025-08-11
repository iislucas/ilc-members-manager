import { Component, computed, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MembersService } from '../members.service';
import { Member } from '../member.model';

@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './member-list.html',
  styleUrl: './member-list.scss',
})
export class MemberListComponent {
  private membersService = inject(MembersService);
  private searchTerm = signal('');

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
}
