import { Component, computed, inject } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FilteredMembersComponent } from '../filtered-members/filtered-members';
import { SpinnerComponent } from '../spinner/spinner.component';
import { InstructorPublicData } from '../../../functions/src/data-model';

export enum InstructorStatusKind {
  InstructorsLoading = 'InstructorsLoading',
  InstructorNotFound = 'InstructorNotFound',
  InstructorFound = 'InstructorFound',
  NoInstructorInPath = 'NoInstructorInPath',
}

type InstructorStatus =
  | {
      status: InstructorStatusKind.NoInstructorInPath;
    }
  | {
      status: InstructorStatusKind.InstructorFound;
      instructor: InstructorPublicData;
    }
  | {
      status: InstructorStatusKind.InstructorNotFound;
    }
  | {
      status: InstructorStatusKind.InstructorsLoading;
    };

@Component({
  selector: 'app-instructor-students',
  imports: [FilteredMembersComponent, SpinnerComponent],
  templateUrl: './instructor-students.html',
  styleUrl: './instructor-students.scss',
  standalone: true,
})
export class InstructorStudentsComponent {
  public dataService = inject(DataManagerService);
  public routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);

  Views = Views;
  InstructorStatusKind = InstructorStatusKind;

  public instructorInUrlPathStatus = computed<InstructorStatus>(() => {
    if (this.dataService.instructors.loading()) {
      return { status: InstructorStatusKind.InstructorsLoading };
    }
    const instructorId =
      this.routingService.signals[Views.InstructorStudents].pathVars.instructorId();
    if (!instructorId) {
      return { status: InstructorStatusKind.NoInstructorInPath };
    }
    const instructor = this.dataService.instructors
      .entries()
      .find((i) => i.instructorId === instructorId);
    if (!instructor) {
      return { status: InstructorStatusKind.InstructorNotFound };
    }
    return { status: InstructorStatusKind.InstructorFound, instructor };
  });
}
