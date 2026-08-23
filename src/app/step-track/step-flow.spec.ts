import { signal } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { StepFlow } from './step-flow';

describe('StepFlow', () => {
  /** A flow of four steps whose gate the test drives directly. */
  function makeFlow(firstIncomplete = 1) {
    const gate = signal(firstIncomplete);
    const flow = new StepFlow(gate, ['Account', 'Details', 'Plan', 'Payment']);
    return { gate, flow };
  }

  it('should expand the first step still needing work', () => {
    const { flow } = makeFlow(2);
    expect(flow.current()).toBe(2);
    expect(flow.stateOf(1)).toBe('done');
    expect(flow.stateOf(2)).toBe('current');
    expect(flow.stateOf(3)).toBe('todo');
  });

  it('should label the track from the same states', () => {
    const { flow } = makeFlow(3);
    expect(flow.steps()).toEqual([
      { label: 'Account', state: 'done' },
      { label: 'Details', state: 'done' },
      { label: 'Plan', state: 'current' },
      { label: 'Payment', state: 'todo' },
    ]);
  });

  it('should honour a jump back to a completed step', () => {
    const { flow } = makeFlow(4);
    flow.goTo(2);
    expect(flow.current()).toBe(2);
    expect(flow.stateOf(2)).toBe('current');
    // Step 3 remains complete; it is simply no longer the expanded one.
    expect(flow.stateOf(3)).toBe('done');
  });

  it('should not let next() skip past unfinished work', () => {
    const { flow } = makeFlow(2);
    flow.next();
    expect(flow.current()).toBe(2);
  });

  it('should step forward one at a time once work is done', () => {
    const { flow } = makeFlow(4);
    flow.goTo(1);
    flow.next();
    expect(flow.current()).toBe(2);
    flow.next();
    expect(flow.current()).toBe(3);
  });

  it('should pull the user back when an earlier step stops being complete', () => {
    const { gate, flow } = makeFlow(4);
    flow.goTo(4);
    expect(flow.current()).toBe(4);

    // The user cleared a required field on step 2.
    gate.set(2);
    expect(flow.current()).toBe(2);
  });

  it('should resume at the outstanding step when a revisit is dropped', () => {
    const { flow } = makeFlow(3);
    flow.goTo(1);
    expect(flow.current()).toBe(1);

    flow.resume();
    expect(flow.current()).toBe(3);
  });
});
