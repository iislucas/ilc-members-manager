/* grading-row-header.ts
 *
 * Summary header row for a grading in the list view. Displays the grading
 * status, student name, level, and instructor name in a compact format
 * matching the existing edit-form-header pattern.
 */

import { Component, computed, inject, input } from '@angular/core';
import { Grading, GradingStatus, getPrettyGradingStatus, previousGradingLevel, isGradingPaid } from '../../../functions/src/data-model';
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

  // Suppress the linked-event name (set when the row is rendered under an event
  // heading that already shows it, so it isn't repeated for every grading).
  hideEvent = input<boolean>(false);

  GradingStatus = GradingStatus;
  getPrettyGradingStatus = getPrettyGradingStatus;

  // Flag gradings that have been accepted or completed but are not yet paid —
  // payment is expected by that point, so the row shows an "unpaid" warning.
  isUnpaid = computed(() => {
    const g = this.grading();
    const acceptedOrDone =
      g.status === GradingStatus.AwaitingGrading ||
      g.status === GradingStatus.Passed ||
      g.status === GradingStatus.NotPassed;
    return acceptedOrDone && !isGradingPaid(g);
  });

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

  // The student's level just before this grading: the entry immediately
  // preceding the grading's target level in the canonical progression (which
  // interleaves the Student and Application tracks). Derived from the grading's
  // target level so it shows in every view — including the instructor My
  // Gradings tabs where the student's member record isn't loaded. '' when the
  // grading is for the first progression entry.
  previousLevel = computed(() => previousGradingLevel(this.grading().level));

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
