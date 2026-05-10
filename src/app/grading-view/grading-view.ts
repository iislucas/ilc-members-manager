/* grading-view.ts
 *
 * Detail view page for a single grading. Displays a 3-step workflow progress
 * indicator (via GradingProgressComponent) above the full grading-edit form.
 * Loads the grading by docId from the URL path variable.
 *
 * This follows the same pattern as event-view and member-view: the list page
 * shows summary rows, and clicking one navigates to this detail page.
 */

import { Component, computed, inject, input, output, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { Grading, GradingStatus } from '../../../functions/src/data-model';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { GradingRowHeaderComponent } from '../grading-row-header/grading-row-header';
import { GradingProgressComponent } from '../grading-progress/grading-progress';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

@Component({
  selector: 'app-grading-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GradingEditComponent,
    GradingRowHeaderComponent,
    GradingProgressComponent,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './grading-view.html',
  styleUrl: './grading-view.scss',
})
export class GradingViewComponent {
  private dataService = inject(DataManagerService);
  private routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService<AppPathPatterns>);
  private firebaseState = inject(FirebaseStateService);

  userIsAdmin = computed(() => this.firebaseState.user()?.isAdmin ?? false);
  showFullEdit = signal(false);

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

  protected isSaving = signal(false);
  protected asyncError = signal<string | null>(null);

  // Handle actions from the progress component (accept, assign, mark result).
  async onProgressAction(update: Partial<Grading>) {
    const g = this.grading();
    if (!g) return;
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      const merged: Grading = { ...g, ...update };
      await this.dataService.updateGrading(g.docId, merged, g);
    } catch (e: unknown) {
      console.error('Error updating grading:', e);
      this.asyncError.set((e as Error).message);
    }
    this.isSaving.set(false);
  }
}
