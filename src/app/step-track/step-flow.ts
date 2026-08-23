/* step-flow.ts
 *
 * Wizard bookkeeping shared by the guided purchase flows. Pair it with
 * <app-step-track> and <app-step-card>:
 *
 *   flow = new StepFlow(
 *     computed(() => {
 *       if (!this.isLoggedIn()) return 1;
 *       if (!this.hasDetails()) return 2;
 *       return 3;
 *     }),
 *     ['Account', 'Details', 'Payment'],
 *   );
 *
 * The page only ever says which step is the first one still needing work; this
 * class turns that into per-step states and handles the user jumping back to an
 * earlier step. Because the "first incomplete" signal is derived from the data,
 * a step re-opens by itself as soon as its answer stops being valid, rather
 * than leaving the user stranded further along the flow.
 */

import { Signal, computed, signal } from '@angular/core';
import { StepState, StepTrackItem } from './step-track';

export class StepFlow {
  /** A step the user jumped to explicitly via the track or an Edit button. */
  private readonly revisited = signal<number | null>(null);

  /** The one expanded step: 1-based, matching the numbers shown to the user. */
  readonly current: Signal<number>;

  /** Per-step states for <app-step-track>. */
  readonly steps: Signal<StepTrackItem[]>;

  constructor(
    readonly firstIncompleteStep: Signal<number>,
    labels: string[],
  ) {
    this.current = computed(() => {
      const revisited = this.revisited();
      const firstIncomplete = this.firstIncompleteStep();
      // Honour a revisit only while everything before it is still complete.
      if (revisited !== null && revisited <= firstIncomplete) return revisited;
      return firstIncomplete;
    });

    this.steps = computed(() =>
      labels.map((label, i) => ({ label, state: this.stateOf(i + 1) })),
    );
  }

  stateOf(step: number): StepState {
    if (step === this.current()) return 'current';
    return step < this.firstIncompleteStep() ? 'done' : 'todo';
  }

  /** Jump to a step, e.g. from an Edit button or the track itself. */
  goTo(step: number): void {
    this.revisited.set(step);
  }

  /** Move on from the current step; never skips past unfinished work. */
  next(): void {
    this.revisited.set(
      Math.min(this.current() + 1, this.firstIncompleteStep()),
    );
  }

  /** Drop any revisit, returning the user to the first incomplete step. */
  resume(): void {
    this.revisited.set(null);
  }
}
