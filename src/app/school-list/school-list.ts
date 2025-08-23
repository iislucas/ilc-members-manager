import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MembersService } from '../members.service';
import { initSchool, School } from '../data-model';
import { SchoolEditComponent } from '../school-edit/school-edit';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-school-list',
  standalone: true,
  imports: [CommonModule, SchoolEditComponent, IconComponent, SpinnerComponent],
  templateUrl: './school-list.html',
  styleUrls: ['./school-list.scss'],
})
export class SchoolListComponent {
  private membersService = inject(MembersService);
  private searchTerm = signal('');
  isAddingSchool = signal(false);
  newSchool = signal<School>(initSchool());

  // Expose signals from the service to the template
  schools = computed(() => {
    const term = this.searchTerm().toLowerCase();
    return this.membersService
      .schools()
      .filter((school) => school.schoolName.toLowerCase().includes(term));
  });
  loading = this.membersService.loading;
  error = this.membersService.error;

  onSearch(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onNewSchool() {
    this.newSchool.set(initSchool());
    this.isAddingSchool.set(true);
  }

  onNewSchoolClose() {
    this.isAddingSchool.set(false);
  }
}
