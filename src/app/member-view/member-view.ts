import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns } from '../app.config';
import { MemberDetailsComponent } from '../member-details/member-details';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-member-view',
  standalone: true,
  imports: [CommonModule, MemberDetailsComponent, IconComponent, SpinnerComponent],
  templateUrl: './member-view.html',
  styleUrl: './member-view.scss',
})
export class MemberViewComponent implements OnInit {
  routingService = inject(RoutingService<AppPathPatterns>);
  dataService = inject(DataManagerService);

  memberId = input.required<string>();
  basePath = input.required<string>();
  backLabel = input.required<string>();

  // Offers the "remove from my students" action. Only set on the My Students
  // route, where the viewer is the member's primary instructor.
  allowRemoveStudent = input<boolean>(false);

  // Two-step confirmation state for the removal.
  confirmingRemove = signal(false);
  isRemoving = signal(false);
  removeError = signal('');

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

  goBack() {
    this.routingService.navigateToParts([`/${this.basePath()}?jumpTo=${this.memberId()}`]);
  }

  async removeStudent() {
    const m = this.member();
    if (!m || this.isRemoving()) return;
    this.isRemoving.set(true);
    this.removeError.set('');
    try {
      await this.dataService.removeStudentFromInstructor(m.docId);
      this.routingService.navigateToParts([`/${this.basePath()}`]);
    } catch (e) {
      console.error('Failed to remove student', e);
      this.removeError.set(
        e instanceof Error ? e.message : 'Failed to remove this student.',
      );
    } finally {
      this.isRemoving.set(false);
      this.confirmingRemove.set(false);
    }
  }
}
