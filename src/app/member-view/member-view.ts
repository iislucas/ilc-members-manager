import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns } from '../app.config';
import { MemberDetailsComponent } from '../member-details/member-details';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { NavigationTreeService } from '../navigation-tree';
import { canMarkMembershipInactive } from '../../../functions/src/data-model';

/** The actions a primary instructor can take on one of their own students. */
export enum StudentAction {
  // Record a lapsed membership as Inactive, which hides the student from the
  // default (active-only) view of the instructor's students list.
  MarkInactive = 'MarkInactive',
  // Clear the student's primaryInstructorId, ending the relationship.
  Remove = 'Remove',
}

@Component({
  selector: 'app-member-view',
  standalone: true,
  imports: [
    CommonModule,
    MemberDetailsComponent,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './member-view.html',
  styleUrl: './member-view.scss',
})
export class MemberViewComponent implements OnInit {
  routingService = inject(RoutingService<AppPathPatterns>);
  dataService = inject(DataManagerService);
  private navTree = inject(NavigationTreeService);

  memberId = input.required<string>();
  basePath = input.required<string>();

  // Offers the instructor actions menu. Only set on the My Students route,
  // where the viewer is the member's primary instructor.
  allowStudentActions = input<boolean>(false);

  StudentAction = StudentAction;

  // The three-dot actions menu, and the two-step confirmation every action in
  // it goes through.
  menuOpen = signal(false);
  pendingAction = signal<StudentAction | null>(null);
  isWorking = signal(false);
  actionError = signal('');

  ngOnInit() {
    window.scrollTo(0, 0);
  }

  // An instructor who is neither an admin nor a school manager has an empty
  // `members` set, so their students are only reachable via `myStudents` (the
  // mirrored /instructors/{docId}/members collection).
  member = computed(() => {
    const id = this.memberId();
    const byDocId =
      this.dataService.members.get(id) || this.dataService.myStudents.get(id);
    if (byDocId) return byDocId;
    return (
      this.dataService.members.entries().find((m) => m.memberId === id) ||
      this.dataService.myStudents.entries().find((m) => m.memberId === id)
    );
  });

  // "Mark as inactive" is only on offer once the membership has actually
  // lapsed. The callable re-checks this, so a stale copy of the member here can
  // only cost the instructor an error message, never deactivate a live
  // membership.
  canMarkInactive = computed(() => {
    const m = this.member();
    if (!m || !this.allowStudentActions()) return false;
    const today = new Date().toISOString().split('T')[0];
    return canMarkMembershipInactive(m, today);
  });

  // Closing the details goes exactly where the back link goes: up to the list,
  // scrolled to this member's row.
  goBack() {
    this.routingService.navigateTo(
      this.navTree.parent()?.url ?? `/${this.basePath()}`,
    );
  }

  /** Closes the menu and asks the instructor to confirm `action`. */
  startAction(action: StudentAction) {
    this.menuOpen.set(false);
    this.actionError.set('');
    this.pendingAction.set(action);
  }

  cancelAction() {
    this.pendingAction.set(null);
    this.actionError.set('');
  }

  /**
   * Runs the confirmed action. Both actions take the student out of the
   * instructor's default list view, so both return to that list on success —
   * where the effect of the action is visible.
   */
  async confirmAction() {
    const m = this.member();
    const action = this.pendingAction();
    if (!m || !action || this.isWorking()) return;
    this.isWorking.set(true);
    this.actionError.set('');
    try {
      if (action === StudentAction.Remove) {
        await this.dataService.removeStudentFromInstructor(m.docId);
      } else {
        await this.dataService.markStudentInactive(m.docId);
      }
      this.pendingAction.set(null);
      // Back to the plain list — the student has just been taken out of it, so
      // there is no row left to jump to.
      this.routingService.navigateToParts([`/${this.basePath()}`]);
    } catch (e) {
      console.error(`Failed to run ${action} on student ${m.docId}`, e);
      this.actionError.set(
        e instanceof Error
          ? e.message
          : action === StudentAction.Remove
            ? 'Failed to remove this student.'
            : 'Failed to mark this student inactive.',
      );
    } finally {
      this.isWorking.set(false);
    }
  }
}
