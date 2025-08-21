import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MembersService } from '../members.service';
import { Member } from '../member.model';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import MiniSearch from 'minisearch';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-find-an-instructor',
  standalone: true,
  imports: [FormsModule, CommonModule, IconComponent],
  templateUrl: './find-an-instructor.html',
  styleUrl: './find-an-instructor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FindAnInstructorComponent {
  private membersService = inject(MembersService);
  searchTerm = signal('');
  instructorMap = computed(
    () => new Map(this.instructors().map((i) => [i.instructorId, i]))
  );

  instructors = computed(() => {
    return this.membersService.members().filter((member) => {
      const isInstructor = member.instructorId.trim() !== '';
      const isActive = new Date(member.membershipExpires) > new Date();
      return isInstructor && isActive;
    });
  });

  miniSearch = new MiniSearch<Member>({
    fields: ['name', 'city', 'country'], // fields to index for full-text search
    storeFields: ['name', 'city', 'country', 'instructorId'], // fields to return with search results
    idField: 'instructorId',
  });

  constructor() {
    effect(() => {
      this.miniSearch.removeAll();
      this.miniSearch.addAll(this.instructors());
    });
  }

  filteredInstructors = computed(() => {
    const searchTerm = this.searchTerm();
    if (!searchTerm) {
      return this.instructors();
    }
    const searchResults = this.miniSearch.search(searchTerm, { fuzzy: 0.2 });
    return searchResults.map((result) => this.instructorMap().get(result.id)!);
  });
}
