import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { StepTrackComponent, StepTrackItem } from './step-track';

describe('StepTrackComponent', () => {
  let fixture: ComponentFixture<StepTrackComponent>;

  const steps: StepTrackItem[] = [
    { label: 'Account', state: 'done' },
    { label: 'Details', state: 'current' },
    { label: 'Payment', state: 'todo' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StepTrackComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StepTrackComponent);
  });

  function render(items: StepTrackItem[], navigable = false) {
    fixture.componentRef.setInput('steps', items);
    fixture.componentRef.setInput('navigable', navigable);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('should show a tick for a completed step and its number otherwise', () => {
    const el = render(steps);
    const markers = el.querySelectorAll('.step-marker');

    expect(markers[0].querySelector('app-icon')).toBeTruthy();
    expect(markers[0].querySelector('.step-number')).toBeNull();
    expect(markers[1].querySelector('.step-number')?.textContent?.trim()).toBe('2');
    expect(markers[2].querySelector('.step-number')?.textContent?.trim()).toBe('3');
  });

  it('should mark the current step for assistive technology', () => {
    const el = render(steps);
    const current = el.querySelectorAll('[aria-current="step"]');
    expect(current.length).toBe(1);
    expect(current[0].textContent).toContain('Details');
  });

  it('should fill in the connector only after a completed step', () => {
    const el = render(steps);
    const connectors = el.querySelectorAll('.step-connector');
    expect(connectors.length).toBe(2);
    expect(connectors[0].classList.contains('done')).toBe(true);
    expect(connectors[1].classList.contains('done')).toBe(false);
  });

  it('should keep every step inert unless navigable', () => {
    const el = render(steps);
    const buttons = el.querySelectorAll<HTMLButtonElement>('.step');
    expect([...buttons].every((b) => b.disabled)).toBe(true);
  });

  it('should let the user click back to a reached step when navigable', () => {
    const el = render(steps, true);
    const buttons = el.querySelectorAll<HTMLButtonElement>('.step');
    expect(buttons[0].disabled).toBe(false); // done
    expect(buttons[1].disabled).toBe(false); // current
    expect(buttons[2].disabled).toBe(true); // not yet reached

    const selected: number[] = [];
    fixture.componentInstance.stepSelected.subscribe((i: number) => selected.push(i));
    buttons[0].click();
    buttons[2].click();

    expect(selected).toEqual([0]);
  });
});
