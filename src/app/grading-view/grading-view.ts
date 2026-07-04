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
import { Grading, GradingStatus, gradingManagerIdsOf } from '../../../functions/src/data-model';
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

  private fetchedGrading = signal<Grading | undefined>(undefined);
  private fetchLoading = signal(false);

  protected grading = computed<Grading | undefined>(() => {
    const id = this.gradingId();
    if (!id) return undefined;

    // Check local cache first (keeps it reactive for synced items)
    const cached = this.dataService.gradings.get(id) ??
      this.dataService.myGradings.get(id) ??
      this.dataService.myGradingsAssessed.get(id);
    if (cached) return cached;

    return this.fetchedGrading();
  });

  protected loading = computed(() => {
    if (this.fetchLoading()) return true;
    return this.dataService.gradings.loading() ||
      this.dataService.myGradings.loading() ||
      this.dataService.myGradingsAssessed.loading();
  });

  // True when the signed-in user is the student of the grading being viewed
  // (one of their own member profiles). Such a viewer navigates back to their
  // own "My Gradings" page, even if they are also an admin.
  protected isOwnGrading = computed(() => {
    const user = this.firebaseState.user();
    const g = this.grading();
    if (!user || !g) return false;
    return user.memberProfiles.some((p) => p.docId === g.studentMemberDocId);
  });

  // True when the grading was opened from the member-facing "My Gradings" page
  // (any of its tabs), tagged via the `from` URL param on the link.
  protected cameFromMyGradings = computed(
    () => this.routingService.signals[Views.GradingView].urlParams.from() === 'my-gradings',
  );

  // Return to "My Gradings" when the viewer opened this from there or it's their
  // own grading; otherwise (an admin browsing the global list) to "Manage
  // Gradings".
  protected returnsToMyGradings = computed(
    () => this.cameFromMyGradings() || this.isOwnGrading() || !this.userIsAdmin(),
  );

  protected backHref = computed(() =>
    this.returnsToMyGradings()
      ? this.routingService.hrefForView(Views.MemberGradings)
      : this.routingService.hrefForView(Views.ManageGradings),
  );

  protected backLabel = computed(() =>
    this.returnsToMyGradings() ? 'Back to My Gradings' : 'Back to Gradings',
  );

  // Emit the title when the grading is loaded.
  private _emitTitle = effect(() => {
    const g = this.grading();
    if (g) {
      const studentLabel =
        this.dataService.memberDisplayName(
          g.studentMemberDocId,
          g.studentMemberId,
          g.studentName,
        ) || 'Unknown Student';
      this.titleLoaded.emit(`Grading: ${studentLabel}`);
    } else if (!this.loading()) {
      this.titleLoaded.emit('Grading Not Found');
    }
  });

  protected isSaving = signal(false);
  protected asyncError = signal<string | null>(null);

  constructor() {
    // Reactively fetch the grading from Firestore if it's not in the local cache.
    effect(async () => {
      const id = this.gradingId();
      if (!id) {
        this.fetchedGrading.set(undefined);
        return;
      }

      // Wait until global loading completes
      if (this.dataService.loadingState() === 'Loading') {
        return;
      }

      // Check if cached already
      const cached = this.dataService.gradings.get(id) ??
        this.dataService.myGradings.get(id) ??
        this.dataService.myGradingsAssessed.get(id);
      if (cached) {
        this.fetchedGrading.set(undefined);
        return;
      }

      // Fetch directly from Firestore
      this.fetchLoading.set(true);
      try {
        const g = await this.dataService.getGradingById(id);
        this.fetchedGrading.set(g);
      } catch (e) {
        console.error('Error loading grading:', e);
        this.fetchedGrading.set(undefined);
      } finally {
        this.fetchLoading.set(false);
      }
    });
  }

  // Handle actions from the progress component (accept, assign, mark result).
  async onProgressAction(update: Partial<Grading>) {
    const g = this.grading();
    if (!g) return;
    this.isSaving.set(true);
    this.asyncError.set(null);
    try {
      const merged: Grading = { ...g, ...update };
      await this.dataService.updateGrading(g.docId, merged, g);
      // Reflect the save immediately. The visible grading may be backed by the
      // per-instructor mirror (`myGradingsAssessed`), which only refreshes once
      // the Cloud Function re-syncs it — so without this the page would appear
      // unchanged after saving.
      this.dataService.applyLocalGradingUpdate(merged);

      // If this change revoked the current user's own access to the grading
      // (e.g. a grading manager removed themselves), they can no longer see it —
      // send them back to My Gradings rather than stranding them on a page that
      // is about to become inaccessible.
      if (this.hasAccess(g) && !this.hasAccess(merged)) {
        this.routingService.navigateTo('my-gradings');
      }
    } catch (e: unknown) {
      console.error('Error updating grading:', e);
      this.asyncError.set((e as Error).message);
    }
    this.isSaving.set(false);
  }

  // Whether the current (non-admin) user is associated with the grading as its
  // student, primary grading instructor, or a grading manager — i.e. can still
  // read it. Admins always retain access. Event/school-manager access is derived
  // server-side and unaffected by editing the managers list, so it isn't checked
  // here (we only redirect on a definite loss of the student/instructor roles).
  private hasAccess(g: Grading): boolean {
    const user = this.firebaseState.user();
    if (!user) return false;
    if (user.isAdmin) return true;
    if (user.memberProfiles.some((p) => p.docId === g.studentMemberDocId)) return true;
    const myInstructorId = user.member.instructorId;
    if (!myInstructorId) return false;
    return (
      g.gradingInstructorId === myInstructorId ||
      gradingManagerIdsOf(g).includes(myInstructorId)
    );
  }
}
