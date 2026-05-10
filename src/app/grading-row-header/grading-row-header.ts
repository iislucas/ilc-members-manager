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

@Component({
  selector: 'app-grading-row-header',
  standalone: true,
  imports: [],
  templateUrl: './grading-row-header.html',
  styleUrl: './grading-row-header.scss',
})
export class GradingRowHeaderComponent {
  private dataService = inject(DataManagerService);

  grading = input.required<Grading>();

  GradingStatus = GradingStatus;
  getPrettyGradingStatus = getPrettyGradingStatus;

  studentName = computed(() => {
    const docId = this.grading().studentMemberDocId;
    if (!docId) return '';
    const member = this.dataService.members.get(docId);
    return member ? `${member.name} (${member.memberId})` : (this.grading().studentMemberId || docId);
  });

  instructorName = computed(() => {
    const instructorId = this.grading().gradingInstructorId;
    if (!instructorId) return '';
    const instructor = this.dataService.instructors.get(instructorId);
    return instructor
      ? `${instructor.name} (${instructor.instructorId})`
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
