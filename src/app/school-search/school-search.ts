import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MembersService } from '../members.service';
import { School } from '../data-model';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-school-search',
  templateUrl: './school-search.html',
  styleUrls: ['./school-search.scss'],
  standalone: true,
  imports: [CommonModule, IconComponent],
})
export class SchoolSearchComponent {
  private membersService = inject(MembersService);

  searchTerm = input.required<string>();
  searchTermChange = output<string>();
  schoolSelected = output<School>();

  showResults = signal(false);

  filteredSchools = computed(() => {
    return this.membersService.searchSchools(this.searchTerm());
  });

  onSearchTermChange(event: Event) {
    this.searchTermChange.emit((event.target as HTMLInputElement).value);
  }

  selectSchool(school: School) {
    this.schoolSelected.emit(school);
    this.searchTermChange.emit(school.schoolId);
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
