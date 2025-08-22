import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MembersService } from '../members.service';
import { Member } from '../member.model';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-member-search',
  templateUrl: './member-search.html',
  styleUrls: ['./member-search.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class MemberSearchComponent {
  private membersService = inject(MembersService);

  searchTerm = input.required<string>();
  searchTermChange = output<string>();
  memberSelected = output<Member>();

  showResults = signal(false);

  filteredMembers = computed(() => {
    return this.membersService.searchMembers(this.searchTerm());
  });

  onSearchTermChange(event: Event) {
    this.searchTermChange.emit((event.target as HTMLInputElement).value);
  }

  selectMember(member: Member) {
    this.memberSelected.emit(member);
    this.searchTermChange.emit(member.email);
    this.showResults.set(false);
  }

  onFocus() {
    this.showResults.set(true);
  }

  onBlur() {
    // Delay hiding results to allow click event to register
    setTimeout(() => this.showResults.set(false), 200);
  }
}
