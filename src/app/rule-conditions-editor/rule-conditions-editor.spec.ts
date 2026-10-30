import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AttendanceType,
  EventRegistrationOption,
  EventRuleConditions,
  initEventRegistrationOption,
  initEventRuleConditions,
  PersonStatusKind,
  RegistrationConditionKind,
  TimingConditionKind,
  TimingWindow,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';
import { RuleConditionsEditorComponent } from './rule-conditions-editor';

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
      window: TimingWindow.OnOrBeforeEarlyBird,
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
      'On or before Early Bird (2026-12-31)',
      'After Early Bird (2026-12-31)',
      'Before Event starts (2027-01-15)',
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
    component.updateTimingWindow(TimingWindow.OnOrBeforeEarlyBird);
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
});
