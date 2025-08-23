import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { initSchool, School } from '../data-model';
import { RoutingService } from '../routing.service';
import { PathParamValues, Views } from '../app.config';
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
  private dataManager = inject(DataManagerService);
  private routingService: RoutingService<PathParamValues> =
    inject(RoutingService);
  private searchTerm = signal('');
  isAddingSchool = signal(false);
  newSchool = signal<School>(initSchool());

  // Expose signals from the service to the template
  schools = computed(() => {
    const term = this.searchTerm().toLowerCase();
    return this.dataManager
      .schools()
      .filter((school) => school.schoolName.toLowerCase().includes(term));
  });
  loading = this.dataManager.loadingSchools;
  error = this.dataManager.errorSchools;

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
  gotoViewMembers(school: School) {
    // TODO: we need to set the router path too... and have a method to handle it. needs some thinking.
    this.routingService.pathParamSignals.view.set(Views.SchoolMembers);
    this.routingService.pathParamSignals.schoolId.set(school.id);
  }
}
