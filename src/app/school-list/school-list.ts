import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { initSchool, School } from '../../../functions/src/data-model';
import { SchoolEditComponent } from '../school-edit/school-edit';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FirebaseStateService } from '../firebase-state.service';

@Component({
  selector: 'app-school-list',
  standalone: true,
  imports: [CommonModule, SchoolEditComponent, IconComponent, SpinnerComponent],
  templateUrl: './school-list.html',
  styleUrls: ['./school-list.scss'],
})
export class SchoolListComponent {
  stateService = inject(FirebaseStateService);
  private dataManager = inject(DataManagerService);
  private searchTerm = signal('');
  isAddingSchool = signal(false);
  newSchool = signal<School>(initSchool());

  // Expose signals from the service to the template
  limit = signal(50);
  schools = computed(() => {
    const all = this.dataManager.schools.search(this.searchTerm());
    return all.slice(0, this.limit());
  });
  totalSchools = computed(
    () => this.dataManager.schools.search(this.searchTerm()).length,
  );

  duplicateEntries = computed(() =>
    this.dataManager.schools.duplicateEntries(),
  );
  errorsExist = computed(() => this.duplicateEntries().length > 0);
  showErrors = signal(false);
  loading = this.dataManager.schools.loading;
  error = this.dataManager.schools.error;

  toggleErrors() {
    this.showErrors.set(!this.showErrors());
  }

  showAll() {
    this.limit.set(Infinity);
  }

  onSearch(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
    this.limit.set(50);
  }

  onNewSchool() {
    this.newSchool.set(initSchool());
    this.isAddingSchool.set(true);
  }

  onNewSchoolClose() {
    this.isAddingSchool.set(false);
  }
}
