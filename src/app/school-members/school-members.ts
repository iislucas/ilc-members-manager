import { Component, computed, inject } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FilteredMembersComponent } from '../filtered-members/filtered-members';
import { SpinnerComponent } from '../spinner/spinner.component';
import { School } from '../../../functions/src/data-model';

export enum SchoolStatusKind {
  SchoolsLoading = 'SchoolsLoading',
  SchoolNotFound = 'SchoolNotFound',
  SchoolFound = 'SchoolFound',
  NoSchoolInPath = 'NoSchoolInPath',
}

type SchoolStatus =
  | {
      status: SchoolStatusKind.NoSchoolInPath;
    }
  | {
      status: SchoolStatusKind.SchoolFound;
      school: School;
    }
  | {
      status: SchoolStatusKind.SchoolNotFound;
    }
  | {
      status: SchoolStatusKind.SchoolsLoading;
    };

@Component({
  selector: 'app-school-members',
  imports: [FilteredMembersComponent, SpinnerComponent],
  templateUrl: './school-members.html',
  styleUrl: './school-members.scss',
  standalone: true,
})
export class SchoolMembersComponent {
  public dataService = inject(DataManagerService);
  public routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  Views = Views;
  SchoolStatusKind = SchoolStatusKind;

  public schoolInUrlPathStatus = computed<SchoolStatus>(() => {
    if (this.dataService.schools.loading()) {
      return { status: SchoolStatusKind.SchoolsLoading };
    }
    const schoolId =
      this.routingService.signals[Views.SchoolMembers].pathVars.schoolId();
    if (!schoolId) {
      return { status: SchoolStatusKind.NoSchoolInPath };
    }
    const school = this.dataService.schools
      .entries()
      .find((s) => s.schoolId === schoolId);
    if (!school) {
      return { status: SchoolStatusKind.SchoolNotFound };
    }
    return { status: SchoolStatusKind.SchoolFound, school };
  });
}
