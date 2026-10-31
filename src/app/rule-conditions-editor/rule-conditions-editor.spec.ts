import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AttendanceType,
  CustomDateDirection,
  EventRegistrationOption,
  EventRuleConditions,
  initEventRegistrationOption,
  initEventRuleConditions,
  PaymentConditionKind,
  PersonStatusKind,
  RegistrationConditionKind,
  TimingConditionKind,
  TimingWindow,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';
import { RuleConditionsEditorComponent, TimingSelectionValue } from './rule-conditions-editor';

describe('RuleConditionsEditorComponent', () => {
  let fixture: ComponentFixture<RuleConditionsEditorComponent>;
  let component: RuleConditionsEditorComponent;
  let currentConditions: EventRuleConditions;

  const sampleOptions: EventRegistrationOption[] = [
    initEventRegistrationOption({
      id: 'full_workshop',
      label: 'Full Workshop',
      attendanceType: AttendanceType.InPerson,
      priceCents: 49000,
    }),
    initEventRegistrationOption({
      id: 'single_day',
      label: 'Single Day',
      attendanceType: AttendanceType.InPerson,
      priceCents: 18000,
    }),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RuleConditionsEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RuleConditionsEditorComponent);
    component = fixture.componentInstance;
    currentConditions = initEventRuleConditions();

    fixture.componentRef.setInput('conditions', currentConditions);
    fixture.componentRef.setInput('registrationOptions', sampleOptions);
    fixture.componentRef.setInput('earlyBirdEnabled', true);
    fixture.componentRef.setInput('earlyBirdDeadline', '2026-12-31');
    fixture.componentRef.setInput('eventStartDate', '2027-01-15T09:00:00Z');

    component.conditionsChange.subscribe((next: EventRuleConditions) => {
      currentConditions = next;
      fixture.componentRef.setInput('conditions', next);
      fixture.detectChanges();
    });

    fixture.detectChanges();
  });

  it('supports Who (Members, Instructors), Timing (Early Bird {date}, Before Event starts {event date}), and Registration conditions (max 1 each)', async () => {
    expect(component.hasAnyActiveCondition()).toBe(false);
    expect(component.canAddMore()).toBe(true);

    component.addWhoCondition();
    expect(currentConditions.who).toEqual({
      kind: WhoConditionKind.Status,
      status: PersonStatusKind.Member,
    });
    expect(component.hasWho()).toBe(true);

    component.addTimingCondition();
    expect(currentConditions.timing).toEqual({
      kind: TimingConditionKind.Window,
      window: TimingWindow.BeforeEarlyBird,
    });
    expect(component.hasTiming()).toBe(true);

    component.addRegistrationCondition();
    expect(currentConditions.registration).toEqual({
      kind: RegistrationConditionKind.SpecificOptions,
      optionIds: ['full_workshop', 'single_day'],
    });
    expect(component.hasRegistrationCondition()).toBe(true);
    expect(component.canAddMore()).toBe(false);

    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const whoSelect = el.querySelector('select[id$="-who"]') as HTMLSelectElement;
    const whoOptionLabels = Array.from(whoSelect.options).map((o) => o.textContent?.trim());
    expect(whoOptionLabels).toEqual(['Members (incl. Instructors)', 'Instructors']);

    const timingSelect = el.querySelector('select[id$="-timing"]') as HTMLSelectElement;
    const timingOptionLabels = Array.from(timingSelect.options).map((o) => o.textContent?.trim());
    expect(timingOptionLabels).toEqual([
      'Before Early Bird (2026-12-31)',
      'Before Event starts (2027-01-15)',
      'Before custom date',
      'On or after custom date',
    ]);
  });

  it('preserves previously configured condition values when removed and re-added', () => {
    component.addWhoCondition();
    component.updateWhoStatus(PersonStatusKind.Instructor);
    component.removeWhoCondition();
    expect(currentConditions.who).toEqual({ kind: WhoConditionKind.Anyone });

    component.addWhoCondition();
    expect(currentConditions.who).toEqual({
      kind: WhoConditionKind.Status,
      status: PersonStatusKind.Instructor,
    });

    component.addTimingCondition();
    component.updateTimingWindow(TimingWindow.BeforeEventStart);
    component.removeTimingCondition();
    expect(currentConditions.timing).toEqual({ kind: TimingConditionKind.Anytime });

    component.addTimingCondition();
    expect(currentConditions.timing).toEqual({
      kind: TimingConditionKind.Window,
      window: TimingWindow.BeforeEventStart,
    });

    component.addRegistrationCondition();
    component.toggleRegistrationOption('single_day', false);
    expect(currentConditions.registration).toEqual({
      kind: RegistrationConditionKind.SpecificOptions,
      optionIds: ['full_workshop'],
    });
    component.removeRegistrationCondition();
    expect(currentConditions.registration).toEqual({
      kind: RegistrationConditionKind.AllOptions,
    });

    component.addRegistrationCondition();
    expect(currentConditions.registration).toEqual({
      kind: RegistrationConditionKind.SpecificOptions,
      optionIds: ['full_workshop'],
    });
  });

  it('hides Registration condition when allowRegistrationCondition is false (implicit on Registration Options) and shows validation warnings for incomplete conditions', () => {
    // 1. Warn when Early Bird timing is selected while Early Bird Pricing is disabled
    fixture.componentRef.setInput('earlyBirdEnabled', false);
    component.addTimingCondition();
    component.updateTimingWindow(TimingWindow.BeforeEarlyBird);
    fixture.detectChanges();
    expect(component.timingWarning()).toContain('Enable Early Bird Pricing above');

    // 2. Warn when Registration condition has 0 options selected
    component.addRegistrationCondition();
    component.toggleRegistrationOption('full_workshop', false);
    component.toggleRegistrationOption('single_day', false);
    fixture.detectChanges();
    expect(component.registrationWarning()).toContain('Select at least one registration option');

    // 3. Implicit Registration condition when editing a Registration Option itself
    component.removeTimingCondition();
    component.removeRegistrationCondition();
    fixture.componentRef.setInput('allowRegistrationCondition', false);
    fixture.detectChanges();

    const addButtonsText = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(addButtonsText).toContain('Who');
    expect(addButtonsText).toContain('Timing');
    expect(addButtonsText).not.toContain('Registration');

    component.addRegistrationCondition();
    expect(currentConditions.registration).toEqual({
      kind: RegistrationConditionKind.AllOptions,
    });
  });

  it('supports Custom Date timing (Before and On or after) with date input, validation warning when empty, and remove/re-add caching', async () => {
    component.addTimingCondition();
    component.updateTimingSelection(TimingSelectionValue.CustomBefore);
    fixture.detectChanges();

    // Defaults to earlyBirdDeadline ('2026-12-31') when switching to CustomDate for the first time
    expect(currentConditions.timing).toEqual({
      kind: TimingConditionKind.CustomDate,
      direction: CustomDateDirection.Before,
      date: '2026-12-31',
    });

    // Clearing the custom date shows validation warning
    component.updateCustomTimingDate('');
    fixture.detectChanges();
    expect(component.timingWarning()).toContain('Enter a custom date (YYYY-MM-DD)');

    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const dateInput = el.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();

    component.updateCustomTimingDate('2026-11-30');
    fixture.detectChanges();
    expect(currentConditions.timing).toEqual({
      kind: TimingConditionKind.CustomDate,
      direction: CustomDateDirection.Before,
      date: '2026-11-30',
    });
    expect(component.timingWarning()).toBe('');

    component.updateTimingSelection(TimingSelectionValue.CustomOnOrAfter);
    expect(currentConditions.timing).toEqual({
      kind: TimingConditionKind.CustomDate,
      direction: CustomDateDirection.OnOrAfter,
      date: '2026-11-30',
    });

    // Remove and re-add preserves custom date & direction
    component.removeTimingCondition();
    expect(currentConditions.timing).toEqual({ kind: TimingConditionKind.Anytime });

    component.addTimingCondition();
    expect(currentConditions.timing).toEqual({
      kind: TimingConditionKind.CustomDate,
      direction: CustomDateDirection.OnOrAfter,
      date: '2026-11-30',
    });
  });

  it('shows Payment ("Paid in full") condition only when allowPaymentCondition is true', async () => {
    // Default: allowPaymentCondition is false -> + Payment button hidden, addPaymentCondition is a no-op
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Payment');
    component.addPaymentCondition();
    expect(currentConditions.payment).toEqual({ kind: PaymentConditionKind.AnyPayment });

    // Enable allowPaymentCondition (used on Event Add-Ons)
    fixture.componentRef.setInput('allowPaymentCondition', true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Payment');

    component.addPaymentCondition();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(currentConditions.payment).toEqual({ kind: PaymentConditionKind.PaidInFull });
    expect(component.hasPaymentCondition()).toBe(true);

    const paymentSelect = (fixture.nativeElement as HTMLElement).querySelector(
      'select[id$="-payment"]',
    ) as HTMLSelectElement;
    expect(Array.from(paymentSelect.options).map((o) => o.textContent?.trim())).toEqual([
      'Paid in full',
    ]);

    component.removePaymentCondition();
    expect(currentConditions.payment).toEqual({ kind: PaymentConditionKind.AnyPayment });
    expect(component.hasPaymentCondition()).toBe(false);
  });
});
