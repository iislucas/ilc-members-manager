/* step-track.ts
 *
 * Shared "1 — 2 — 3" progress indicator used across the guided purchase flows
 * (Become a Member, Next Grading, Class Video Library, Instructor License,
 * School License) and the grading workflow.
 *
 * Each step carries its own state so the caller decides what "done" means:
 *   todo    — not reached yet: dashed grey marker.
 *   current — what the user has to do now: grey marker with a red outline.
 *   done    — completed: blue marker with a tick.
 *   review  — stalled awaiting someone else: solid neutral marker.
 *
 * When `navigable` is set, completed steps become clickable so the user can go
 * back and change an earlier answer; `stepSelected` emits the step's 0-based
 * index.
 */

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icons/icon.component';

export type StepState = 'todo' | 'current' | 'done' | 'review';

export interface StepTrackItem {
  /** Short label under the marker, e.g. "Account". */
  label: string;
  state: StepState;
}

@Component({
  selector: 'app-step-track',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './step-track.html',
  styleUrl: './step-track.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StepTrackComponent {
  steps = input.required<StepTrackItem[]>();

  /** When true, completed steps are clickable and emit `stepSelected`. */
  navigable = input(false);

  stepSelected = output<number>();

  isClickable(step: StepTrackItem): boolean {
    return this.navigable() && (step.state === 'done' || step.state === 'current');
  }

  onStepClick(step: StepTrackItem, index: number): void {
    if (this.isClickable(step)) {
      this.stepSelected.emit(index);
    }
  }
}
