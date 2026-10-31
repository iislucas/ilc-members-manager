import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CustomDateDirection,
  EventRegistrationOption,
  EventRuleConditions,
  PaymentConditionKind,
  PersonStatusKind,
  RegistrationConditionKind,
  TimingConditionKind,
  TimingWindow,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';
import { IconComponent } from '../icons/icon.component';

export enum TimingSelectionValue {
  BeforeEarlyBird = 'before_early_bird',
  BeforeEventStart = 'before_event_start',
  CustomBefore = 'custom_before',
  CustomOnOrAfter = 'custom_on_or_after',
}

@Component({
  selector: 'app-rule-conditions-editor',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './rule-conditions-editor.html',
  styleUrl: './rule-conditions-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleConditionsEditorComponent {
  readonly conditions = input.required<EventRuleConditions>();
  readonly idPrefix = input<string>('rule-cond');
  readonly heading = input<string>('Conditions');
  readonly emptySummary = input<string>('No restrictions — applies to everyone, anytime.');
  // False when applied directly to a Registration Option (scoping to that option is implicit).
  readonly allowRegistrationCondition = input<boolean>(true);
  // True only on Event Add-Ons (Payment conditions apply exclusively to Add-Ons).
  readonly allowPaymentCondition = input<boolean>(false);
  readonly registrationOptions = input<EventRegistrationOption[]>([]);
  readonly earlyBirdEnabled = input<boolean>(false);
  readonly earlyBirdDeadline = input<string>('');
  readonly eventStartDate = input<string>('');

  readonly conditionsChange = output<EventRuleConditions>();

  protected readonly WhoConditionKind = WhoConditionKind;
  protected readonly PersonStatusKind = PersonStatusKind;
  protected readonly TimingConditionKind = TimingConditionKind;
  protected readonly TimingWindow = TimingWindow;
  protected readonly CustomDateDirection = CustomDateDirection;
  protected readonly TimingSelectionValue = TimingSelectionValue;
  protected readonly RegistrationConditionKind = RegistrationConditionKind;
  protected readonly PaymentConditionKind = PaymentConditionKind;

  // Preserve previously configured condition values in memory if removed and re-added during editing.
  private cachedWhoStatus: PersonStatusKind = PersonStatusKind.Member;
  private cachedTimingSelection: TimingSelectionValue = TimingSelectionValue.BeforeEarlyBird;
  private cachedCustomDate = '';
  private cachedOptionIds: string[] | null = null;
  private cachedPaymentKind: PaymentConditionKind = PaymentConditionKind.PaidInFull;

  constructor() {
    effect(() => {
      const c = this.conditions();
      if (c.who.kind === WhoConditionKind.Status) {
        this.cachedWhoStatus = c.who.status;
      }
      if (c.timing.kind === TimingConditionKind.Window) {
        this.cachedTimingSelection =
          c.timing.window === TimingWindow.BeforeEventStart
            ? TimingSelectionValue.BeforeEventStart
            : TimingSelectionValue.BeforeEarlyBird;
      } else if (c.timing.kind === TimingConditionKind.CustomDate) {
        this.cachedTimingSelection =
          c.timing.direction === CustomDateDirection.OnOrAfter
            ? TimingSelectionValue.CustomOnOrAfter
            : TimingSelectionValue.CustomBefore;
        if (c.timing.date) {
          this.cachedCustomDate = c.timing.date;
        }
      }
      if (c.registration.kind === RegistrationConditionKind.SpecificOptions) {
        this.cachedOptionIds = [...c.registration.optionIds];
      }
      if (c.payment.kind !== PaymentConditionKind.AnyPayment) {
        this.cachedPaymentKind = c.payment.kind;
      }
    });
  }

  readonly normalizedEarlyBirdDate = computed(() => {
    const raw = this.earlyBirdDeadline().trim().slice(0, 10);
    return raw.length === 10 ? raw : '';
  });

  readonly normalizedEventStartDate = computed(() => {
    const raw = this.eventStartDate().trim().slice(0, 10);
    return raw.length === 10 ? raw : '';
  });

  readonly timingSelectionValue = computed<TimingSelectionValue>(() => {
    const t = this.conditions().timing;
    if (t.kind === TimingConditionKind.Window) {
      return t.window === TimingWindow.BeforeEventStart
        ? TimingSelectionValue.BeforeEventStart
        : TimingSelectionValue.BeforeEarlyBird;
    }
    if (t.kind === TimingConditionKind.CustomDate) {
      return t.direction === CustomDateDirection.OnOrAfter
        ? TimingSelectionValue.CustomOnOrAfter
        : TimingSelectionValue.CustomBefore;
    }
    return TimingSelectionValue.BeforeEarlyBird;
  });

  readonly hasWho = computed(() => this.conditions().who.kind === WhoConditionKind.Status);
  readonly hasTiming = computed(
    () => this.conditions().timing.kind !== TimingConditionKind.Anytime,
  );
  readonly hasRegistrationCondition = computed(
    () =>
      this.allowRegistrationCondition() &&
      this.conditions().registration.kind === RegistrationConditionKind.SpecificOptions,
  );
  readonly hasPaymentCondition = computed(
    () =>
      this.allowPaymentCondition() &&
      this.conditions().payment.kind !== PaymentConditionKind.AnyPayment,
  );

  readonly hasAnyActiveCondition = computed(
    () =>
      this.hasWho() ||
      this.hasTiming() ||
      this.hasRegistrationCondition() ||
      this.hasPaymentCondition(),
  );

  readonly canAddMore = computed(
    () =>
      !this.hasWho() ||
      !this.hasTiming() ||
      (this.allowRegistrationCondition() && !this.hasRegistrationCondition()) ||
      (this.allowPaymentCondition() && !this.hasPaymentCondition()),
  );

  readonly timingWarning = computed<string>(() => {
    const t = this.conditions().timing;
    if (t.kind === TimingConditionKind.CustomDate) {
      if (!t.date || t.date.trim().length < 10) {
        return 'Enter a custom date (YYYY-MM-DD) to activate this timing condition.';
      }
      return '';
    }
    if (t.kind !== TimingConditionKind.Window) return '';
    if (
      t.window === TimingWindow.BeforeEarlyBird &&
      (!this.earlyBirdEnabled() || !this.normalizedEarlyBirdDate())
    ) {
      return 'Enable Early Bird Pricing above and set a cutoff date to activate this timing condition.';
    }
    if (t.window === TimingWindow.BeforeEventStart && !this.normalizedEventStartDate()) {
      return 'Link an event with a start date so "Before Event starts" has an event date.';
    }
    return '';
  });

  readonly registrationWarning = computed<string>(() => {
    if (!this.allowRegistrationCondition()) return '';
    const reg = this.conditions().registration;
    if (reg.kind !== RegistrationConditionKind.SpecificOptions) return '';
    if (this.registrationOptions().length === 0) return '';
    const validIds = new Set(this.registrationOptions().map((o) => o.id));
    const hasMatch = reg.optionIds.some((id) => validIds.has(id));
    return hasMatch
      ? ''
      : 'Select at least one registration option below so this condition can match.';
  });

  addWhoCondition(): void {
    this.emitUpdated((draft) => {
      draft.who = {
        kind: WhoConditionKind.Status,
        status: this.cachedWhoStatus,
      };
    });
  }

  removeWhoCondition(): void {
    const current = this.conditions().who;
    if (current.kind === WhoConditionKind.Status) {
      this.cachedWhoStatus = current.status;
    }
    this.emitUpdated((draft) => {
      draft.who = { kind: WhoConditionKind.Anyone };
    });
  }

  updateWhoStatus(status: PersonStatusKind): void {
    this.cachedWhoStatus = status;
    this.emitUpdated((draft) => {
      draft.who = { kind: WhoConditionKind.Status, status };
    });
  }

  addTimingCondition(): void {
    const sel = this.cachedTimingSelection;
    if (
      sel === TimingSelectionValue.CustomBefore ||
      sel === TimingSelectionValue.CustomOnOrAfter
    ) {
      const direction =
        sel === TimingSelectionValue.CustomOnOrAfter
          ? CustomDateDirection.OnOrAfter
          : CustomDateDirection.Before;
      this.emitUpdated((draft) => {
        draft.timing = {
          kind: TimingConditionKind.CustomDate,
          direction,
          date: this.cachedCustomDate,
        };
      });
      return;
    }

    const defaultWindow =
      sel === TimingSelectionValue.BeforeEarlyBird &&
      !this.earlyBirdEnabled() &&
      Boolean(this.normalizedEventStartDate())
        ? TimingWindow.BeforeEventStart
        : sel === TimingSelectionValue.BeforeEventStart
          ? TimingWindow.BeforeEventStart
          : TimingWindow.BeforeEarlyBird;
    this.emitUpdated((draft) => {
      draft.timing = {
        kind: TimingConditionKind.Window,
        window: defaultWindow,
      };
    });
  }

  removeTimingCondition(): void {
    const current = this.conditions().timing;
    if (current.kind === TimingConditionKind.Window) {
      this.cachedTimingSelection =
        current.window === TimingWindow.BeforeEventStart
          ? TimingSelectionValue.BeforeEventStart
          : TimingSelectionValue.BeforeEarlyBird;
    } else if (current.kind === TimingConditionKind.CustomDate) {
      this.cachedTimingSelection =
        current.direction === CustomDateDirection.OnOrAfter
          ? TimingSelectionValue.CustomOnOrAfter
          : TimingSelectionValue.CustomBefore;
      this.cachedCustomDate = current.date;
    }
    this.emitUpdated((draft) => {
      draft.timing = { kind: TimingConditionKind.Anytime };
    });
  }

  updateTimingWindow(window: TimingWindow): void {
    this.cachedTimingSelection =
      window === TimingWindow.BeforeEventStart
        ? TimingSelectionValue.BeforeEventStart
        : TimingSelectionValue.BeforeEarlyBird;
    this.emitUpdated((draft) => {
      draft.timing = { kind: TimingConditionKind.Window, window };
    });
  }

  updateTimingSelection(selection: TimingSelectionValue): void {
    this.cachedTimingSelection = selection;
    switch (selection) {
      case TimingSelectionValue.BeforeEventStart:
        this.emitUpdated((draft) => {
          draft.timing = {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEventStart,
          };
        });
        return;
      case TimingSelectionValue.CustomBefore:
      case TimingSelectionValue.CustomOnOrAfter: {
        const direction =
          selection === TimingSelectionValue.CustomOnOrAfter
            ? CustomDateDirection.OnOrAfter
            : CustomDateDirection.Before;
        const current = this.conditions().timing;
        const date =
          current.kind === TimingConditionKind.CustomDate && current.date
            ? current.date
            : this.cachedCustomDate ||
              this.normalizedEarlyBirdDate() ||
              this.normalizedEventStartDate();
        this.cachedCustomDate = date;
        this.emitUpdated((draft) => {
          draft.timing = {
            kind: TimingConditionKind.CustomDate,
            direction,
            date,
          };
        });
        return;
      }
      case TimingSelectionValue.BeforeEarlyBird:
      default:
        this.emitUpdated((draft) => {
          draft.timing = {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEarlyBird,
          };
        });
        return;
    }
  }

  updateCustomTimingDate(date: string): void {
    const trimmed = (date || '').trim().slice(0, 10);
    this.cachedCustomDate = trimmed;
    const current = this.conditions().timing;
    const direction =
      current.kind === TimingConditionKind.CustomDate
        ? current.direction
        : this.cachedTimingSelection === TimingSelectionValue.CustomOnOrAfter
          ? CustomDateDirection.OnOrAfter
          : CustomDateDirection.Before;
    this.emitUpdated((draft) => {
      draft.timing = {
        kind: TimingConditionKind.CustomDate,
        direction,
        date: trimmed,
      };
    });
  }

  addRegistrationCondition(): void {
    if (!this.allowRegistrationCondition()) return;
    const validIds = this.registrationOptions().map((o) => o.id);
    const validSet = new Set(validIds);
    const restored =
      this.cachedOptionIds !== null
        ? this.cachedOptionIds.filter((id) => validSet.has(id))
        : validIds;
    this.emitUpdated((draft) => {
      draft.registration = {
        kind: RegistrationConditionKind.SpecificOptions,
        optionIds: restored,
      };
    });
  }

  removeRegistrationCondition(): void {
    const current = this.conditions().registration;
    if (current.kind === RegistrationConditionKind.SpecificOptions) {
      this.cachedOptionIds = [...current.optionIds];
    }
    this.emitUpdated((draft) => {
      draft.registration = { kind: RegistrationConditionKind.AllOptions };
    });
  }

  isOptionChecked(optionId: string): boolean {
    const reg = this.conditions().registration;
    return (
      reg.kind === RegistrationConditionKind.SpecificOptions && reg.optionIds.includes(optionId)
    );
  }

  onOptionCheckboxChange(optionId: string, event: Event): void {
    const inputEl = event.target as HTMLInputElement | null;
    const checked = Boolean(inputEl?.checked);
    this.toggleRegistrationOption(optionId, checked);
  }

  toggleRegistrationOption(optionId: string, checked: boolean): void {
    const reg = this.conditions().registration;
    if (reg.kind !== RegistrationConditionKind.SpecificOptions) return;
    const set = new Set(reg.optionIds);
    if (checked) {
      set.add(optionId);
    } else {
      set.delete(optionId);
    }
    // Preserve display order matching registrationOptions
    const orderedIds = this.registrationOptions()
      .map((o) => o.id)
      .filter((id) => set.has(id));
    this.cachedOptionIds = orderedIds;
    this.emitUpdated((draft) => {
      draft.registration = {
        kind: RegistrationConditionKind.SpecificOptions,
        optionIds: orderedIds,
      };
    });
  }

  addPaymentCondition(): void {
    if (!this.allowPaymentCondition()) return;
    const kind =
      this.cachedPaymentKind !== PaymentConditionKind.AnyPayment
        ? this.cachedPaymentKind
        : PaymentConditionKind.PaidInFull;
    this.emitUpdated((draft) => {
      draft.payment = { kind: PaymentConditionKind.PaidInFull };
      if (kind === PaymentConditionKind.PaidInFull) {
        draft.payment = { kind: PaymentConditionKind.PaidInFull };
      }
    });
  }

  removePaymentCondition(): void {
    const current = this.conditions().payment;
    if (current.kind !== PaymentConditionKind.AnyPayment) {
      this.cachedPaymentKind = current.kind;
    }
    this.emitUpdated((draft) => {
      draft.payment = { kind: PaymentConditionKind.AnyPayment };
    });
  }

  updatePaymentCondition(kind: PaymentConditionKind): void {
    if (!this.allowPaymentCondition()) return;
    if (kind === PaymentConditionKind.PaidInFull) {
      this.cachedPaymentKind = kind;
      this.emitUpdated((draft) => {
        draft.payment = { kind: PaymentConditionKind.PaidInFull };
      });
    } else {
      this.emitUpdated((draft) => {
        draft.payment = { kind: PaymentConditionKind.AnyPayment };
      });
    }
  }

  private emitUpdated(mutator: (draft: EventRuleConditions) => void): void {
    const next = structuredClone(this.conditions());
    mutator(next);
    if (!this.allowRegistrationCondition()) {
      next.registration = { kind: RegistrationConditionKind.AllOptions };
    }
    if (!this.allowPaymentCondition()) {
      next.payment = { kind: PaymentConditionKind.AnyPayment };
    }
    this.conditionsChange.emit(next);
  }
}
