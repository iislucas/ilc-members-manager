/* step-card.ts
 *
 * One numbered stage of a guided flow, paired with <app-step-track>.
 *
 * Only the current step shows its body; completed steps collapse to a one-line
 * summary with an Edit action, and steps not yet reached show a muted header so
 * the user can see what is still coming without being able to type into it.
 *
 * Usage:
 *   <app-step-card [number]="2" title="Basic Information"
 *                  [state]="basicInfoState()" [expanded]="currentStep() === 2"
 *                  (editRequested)="goToStep(2)">
 *     <span stepSummary>{{ name() }} • {{ country() }}</span>
 *     ...form fields...
 *   </app-step-card>
 */

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../icons/icon.component';
import { StepState } from '../step-track/step-track';

@Component({
  selector: 'app-step-card',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './step-card.html',
  styleUrl: './step-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StepCardComponent {
  number = input.required<number>();
  title = input.required<string>();
  state = input.required<StepState>();
  expanded = input.required<boolean>();

  /** Set false for a completed step the user must not go back and change. */
  editable = input(true);

  editRequested = output<void>();

  /** A finished step the user may reopen to change their answer. */
  canReopen = computed(
    () => this.editable() && !this.expanded() && this.state() === 'done',
  );

  onHeaderClick(): void {
    if (this.canReopen()) {
      this.editRequested.emit();
    }
  }
}
