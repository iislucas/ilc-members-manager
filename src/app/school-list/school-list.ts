import { Component, computed, inject, signal, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { SearchableSet } from '../searchable-set';
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
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);
  stateService = inject(FirebaseStateService);
  private dataManager = inject(DataManagerService);

  // Both ManageSchools and MySchools share the same URL param shape (q, schoolId).
  private viewSignals = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MySchools) return this.routingService.signals[Views.MySchools];
    return this.routingService.signals[Views.ManageSchools];
  });

  searchTerm = computed(() => this.viewSignals().urlParams.q());

  urlSchoolId = computed(() => this.viewSignals().urlParams.schoolId());

  isAddingSchool = signal(false);
  newSchool = signal<School>(initSchool());

  // Expose signals from the service to the template
  @Input() schoolSet: SearchableSet<'schoolId', School> | null = null;

  targetSchoolSet = computed<SearchableSet<'schoolId', School>>(() => this.schoolSet || this.dataManager.schools);

  limit = signal(50);
  schools = computed(() => {
    const all = this.targetSchoolSet().search(this.searchTerm());
    return all.slice(0, this.limit());
  });
  totalSchools = computed(
    () => this.targetSchoolSet().search(this.searchTerm()).length,
  );

  duplicateEntries = computed(() => this.targetSchoolSet().duplicateEntries().sort((a, b) => a.schoolId.localeCompare(b.schoolId)));
  errorsExist = computed(() => this.duplicateEntries().length > 0);
  showErrors = signal(false);
  loading = computed(() => this.targetSchoolSet().loading());
  error = computed(() => this.targetSchoolSet().error());

  toggleErrors() {
    this.showErrors.set(!this.showErrors());
  }

  showAll() {
    this.limit.set(Infinity);
  }

  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.viewSignals().urlParams.q.set(value);
    this.limit.set(50);
  }

  setExpandedSchool(schoolId: string) {
    if (schoolId) {
      this.viewSignals().urlParams.schoolId.set(schoolId);
    }
  }

  onNewSchool() {
    this.newSchool.set(initSchool());
    this.isAddingSchool.set(true);
  }

  onNewSchoolClose() {
    this.isAddingSchool.set(false);
  }
}
