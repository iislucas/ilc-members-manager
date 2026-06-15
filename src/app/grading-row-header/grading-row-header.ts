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
    const g = this.grading();
    return this.dataService.memberDisplayName(
      g.studentMemberDocId,
      g.studentMemberId,
      g.studentName,
    );
  });

  // The date of the grading: the grading event date once it's known, otherwise
  // the date the grading was purchased/requested so the row always shows a date.
  gradingDate = computed(() => {
    const g = this.grading();
    return g.gradingEventDate || g.gradingPurchaseDate || '';
  });

  eventLink = computed(() => {
    const docId = this.grading().gradingEventDocId;
    if (!docId) return '';
    return this.routingService.hrefForView(Views.EventView, { eventId: docId });
  });

  instructorName = computed(() =>
    this.dataService.instructorDisplayName(
      this.grading().gradingInstructorId,
      this.grading().gradingInstructorName,
    ),
  );

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
