/* grading-row-header.ts
 *
 * Summary header row for a grading in the list view. Displays the grading
 * status, student name, level, and instructor name in a compact format
 * matching the existing edit-form-header pattern.
 */

import { Component, computed, inject, input } from '@angular/core';
import { Grading, GradingStatus, getPrettyGradingStatus } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

@Component({
  selector: 'app-grading-row-header',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './grading-row-header.html',
  styleUrl: './grading-row-header.scss',
})
export class GradingRowHeaderComponent {
  private dataService = inject(DataManagerService);
  private routingService = inject(RoutingService<AppPathPatterns>);

  grading = input.required<Grading>();

  GradingStatus = GradingStatus;
  getPrettyGradingStatus = getPrettyGradingStatus;

  studentName = computed(() => {
    const docId = this.grading().studentMemberDocId;
    if (!docId) return '';
    const member = this.dataService.members.get(docId);
    return member ? `(${member.memberId}) ${member.name}` : (this.grading().studentMemberId || docId);
  });

  eventLink = computed(() => {
    const docId = this.grading().gradingEventDocId;
    if (!docId) return '';
    return this.routingService.hrefForView(Views.EventView, { eventId: docId });
  });

  instructorName = computed(() => {
    const instructorId = this.grading().gradingInstructorId;
    if (!instructorId) return '';
    const instructor = this.dataService.instructors.get(instructorId);
    return instructor
      ? `${instructor.name} [${instructor.instructorId}]`
      : instructorId;
  });

  formatLevel(lvl: string): string {
    if (!lvl) return '';
    if (lvl.startsWith('Student ') || lvl.startsWith('Application ')) {
      return lvl;
    }
    // Backward compatibility for data originally stored without prefix
    if (lvl === 'Entry' || !isNaN(Number(lvl))) {
      return 'Student ' + lvl;
    }
    return lvl;
  }
}
