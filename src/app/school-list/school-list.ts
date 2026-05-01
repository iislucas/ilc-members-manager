/* school-list.ts
 *
 * Displays a searchable list of schools with links to individual school
 * edit pages. Follows the same navigation pattern as manage-events:
 * each school row is a clickable <a> that navigates to a dedicated
 * edit page at /schools/:schoolId/edit (or /my-schools/:schoolId/edit).
 */

import { Component, computed, inject, signal, Input, ChangeDetectionStrategy } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { SearchableSet } from '../searchable-set';
import { School, initSchool, ExpiryStatus } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FirebaseStateService } from '../firebase-state.service';

@Component({
  selector: 'app-school-list',
  standalone: true,
  imports: [IconComponent, SpinnerComponent],
  templateUrl: './school-list.html',
  styleUrls: ['./school-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolListComponent {
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);
  stateService = inject(FirebaseStateService);
  private dataManager = inject(DataManagerService);

  // Constants
  ExpiryStatus = ExpiryStatus;

  // Both ManageSchools and MySchools share the same URL param shape (q).
  private viewSignals = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MySchools) return this.routingService.signals[Views.MySchools];
    return this.routingService.signals[Views.ManageSchools];
  });

  searchTerm = computed(() => this.viewSignals().urlParams.q());

  isMySchools = computed(() => this.routingService.matchedPatternId() === Views.MySchools);

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
  todayIsoString = signal(new Date().toISOString().split('T')[0]);

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

  // Build the edit link for a school, using the correct base path.
  editLink(school: School): string {
    const id = school.docId || school.schoolId;
    if (this.isMySchools()) {
      return `#/my-schools/${encodeURIComponent(id)}/edit`;
    }
    return `#/schools/${encodeURIComponent(id)}/edit`;
  }


  // Resolve the owner instructor to a display name.
  ownerLabel(school: School): string {
    if (!school.ownerInstructorId) return '';
    const owner = this.dataManager.instructors.get(school.ownerInstructorId);
    return owner?.name || '';
  }

  // Check school license expiry status.
  schoolLicenseStatus(school: School): ExpiryStatus {
    const expires = school.schoolLicenseExpires;
    if (!expires || expires >= this.todayIsoString()) return ExpiryStatus.Valid;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? ExpiryStatus.Recent : ExpiryStatus.Expired;
  }

  onNewSchool() {
    // Navigate to the edit page with a special 'new' placeholder ID
    if (this.isMySchools()) {
      this.routingService.navigateTo('/my-schools/new/edit');
    } else {
      this.routingService.navigateTo('/schools/new/edit');
    }
  }
}
