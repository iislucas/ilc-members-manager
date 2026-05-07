/* grading-view.ts
 *
 * Detail view page for a single grading. Loads the grading by docId from the
 * URL path variable and renders it using the existing grading-edit component
 * in non-collapsible mode, with a back link to the gradings list.
 *
 * This follows the same pattern as event-view and member-view: the list page
 * shows summary rows, and clicking one navigates to this detail page.
 */

import { Component, computed, inject, input, output, signal, effect } from '@angular/core';
import { Grading } from '../../../functions/src/data-model';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { GradingRowHeaderComponent } from '../grading-row-header/grading-row-header';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

@Component({
  selector: 'app-grading-view',
  standalone: true,
  imports: [
    GradingEditComponent,
    GradingRowHeaderComponent,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './grading-view.html',
  styleUrl: './grading-view.scss',
})
export class GradingViewComponent {
  private dataService = inject(DataManagerService);
  protected routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService<AppPathPatterns>);

  gradingId = input.required<string>();
  titleLoaded = output<string>();

  protected grading = computed<Grading | undefined>(() => {
    const id = this.gradingId();
    if (!id) return undefined;
    return this.dataService.gradings.get(id);
  });

  protected loading = computed(() => this.dataService.gradings.loading());

  protected backHref = computed(() =>
    this.routingService.hrefForView(Views.ManageGradings),
  );

  // Emit the title when the grading is loaded.
  private _emitTitle = effect(() => {
    const g = this.grading();
    if (g) {
      const studentMemberId = g.studentMemberId;
      const member = this.dataService.members
        .entries()
        .find((m) => m.memberId === studentMemberId);
      const studentLabel = member
        ? `${member.name} (${member.memberId})`
        : studentMemberId || 'Unknown Student';
      this.titleLoaded.emit(`Grading: ${studentLabel}`);
    } else if (!this.loading()) {
      this.titleLoaded.emit('Grading Not Found');
    }
  });
}
