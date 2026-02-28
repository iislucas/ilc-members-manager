import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns, Views } from '../app.config';
import { MemberEditComponent } from '../member-edit/member-edit';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-member-view',
  standalone: true,
  imports: [CommonModule, MemberEditComponent, IconComponent],
  templateUrl: './member-view.html',
  styleUrl: './member-view.scss',
})
export class MemberViewComponent {
  routingService = inject(RoutingService<AppPathPatterns>);
  dataService = inject(DataManagerService);

  viewContext = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (!match) return null;

    let memberId = '';
    let backUrl = '';
    let backLabel = '';

    if (match === Views.ManageMemberView) {
      memberId = this.routingService.signals[Views.ManageMemberView].pathVars['memberId']();
      backUrl = `#/members?jumpTo=${memberId}`;
      backLabel = 'Members List';
    } else if (match === Views.SchoolMemberView) {
      memberId = this.routingService.signals[Views.SchoolMemberView].pathVars['memberId']();
      const schoolId = this.routingService.signals[Views.SchoolMemberView].pathVars['schoolId']();
      backUrl = `#/school/${schoolId}/members?jumpTo=${memberId}`;
      backLabel = `School ${schoolId} Members`;
    } else if (match === Views.InstructorStudentView) {
      memberId = this.routingService.signals[Views.InstructorStudentView].pathVars['memberId']();
      const instId = this.routingService.signals[Views.InstructorStudentView].pathVars['instructorId']();
      backUrl = `#/instructor/${instId}/students?jumpTo=${memberId}`;
      backLabel = 'Students List';
    } else if (match === Views.MyStudentView) {
      memberId = this.routingService.signals[Views.MyStudentView].pathVars['memberId']();
      backUrl = `#/my-students?jumpTo=${memberId}`;
      backLabel = 'My Students';
    } else {
      return null;
    }

    // Find the member from the loaded data
    const entries = this.dataService.members.entries();
    const member = entries.find((m) => m.memberId === memberId || m.docId === memberId);

    return { memberId, backUrl, backLabel, member };
  });

  goBack() {
    const ctx = this.viewContext();
    if (!ctx) return;
    window.location.hash = ctx.backUrl;
  }
}
