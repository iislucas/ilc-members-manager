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
  EventRegistrationOption,
  EventRuleConditions,
  PersonStatusKind,
  RegistrationConditionKind,
  TimingConditionKind,
  TimingWindow,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';
import { IconComponent } from '../icons/icon.component';

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
  readonly registrationOptions = input<EventRegistrationOption[]>([]);
  readonly earlyBirdEnabled = input<boolean>(false);
  readonly earlyBirdDeadline = input<string>('');
  readonly eventStartDate = input<string>('');

  readonly conditionsChange = output<EventRuleConditions>();

  protected readonly WhoConditionKind = WhoConditionKind;
  protected readonly PersonStatusKind = PersonStatusKind;
  protected readonly TimingConditionKind = TimingConditionKind;
  protected readonly TimingWindow = TimingWindow;
  protected readonly RegistrationConditionKind = RegistrationConditionKind;

  // Preserve previously configured condition values in memory if removed and re-added during editing.
  private cachedWhoStatus: PersonStatusKind = PersonStatusKind.Member;
  private cachedTimingWindow: TimingWindow = TimingWindow.BeforeEarlyBird;
  private cachedOptionIds: string[] | null = null;

  constructor() {
    effect(() => {
      const c = this.conditions();
      if (c.who.kind === WhoConditionKind.Status) {
        this.cachedWhoStatus = c.who.status;
      }
      if (c.timing.kind === TimingConditionKind.Window) {
        this.cachedTimingWindow = c.timing.window;
      }
      if (c.registration.kind === RegistrationConditionKind.SpecificOptions) {
        this.cachedOptionIds = [...c.registration.optionIds];
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

  readonly hasWho = computed(() => this.conditions().who.kind === WhoConditionKind.Status);
  readonly hasTiming = computed(
    () => this.conditions().timing.kind === TimingConditionKind.Window,
  );
  readonly hasRegistrationCondition = computed(
    () =>
      this.allowRegistrationCondition() &&
      this.conditions().registration.kind === RegistrationConditionKind.SpecificOptions,
  );

  readonly hasAnyActiveCondition = computed(
    () => this.hasWho() || this.hasTiming() || this.hasRegistrationCondition(),
  );

  readonly canAddMore = computed(
    () =>
      !this.hasWho() ||
      !this.hasTiming() ||
      (this.allowRegistrationCondition() && !this.hasRegistrationCondition()),
  );

  readonly timingWarning = computed<string>(() => {
    const t = this.conditions().timing;
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
    const defaultWindow =
      this.cachedTimingWindow === TimingWindow.BeforeEarlyBird &&
      !this.earlyBirdEnabled() &&
      Boolean(this.normalizedEventStartDate())
        ? TimingWindow.BeforeEventStart
        : this.cachedTimingWindow;
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
      this.cachedTimingWindow = current.window;
    }
    this.emitUpdated((draft) => {
      draft.timing = { kind: TimingConditionKind.Anytime };
    });
  }

  updateTimingWindow(window: TimingWindow): void {
    this.cachedTimingWindow = window;
    this.emitUpdated((draft) => {
      draft.timing = { kind: TimingConditionKind.Window, window };
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

  private emitUpdated(mutator: (draft: EventRuleConditions) => void): void {
    const next = structuredClone(this.conditions());
    mutator(next);
    if (!this.allowRegistrationCondition()) {
      next.registration = { kind: RegistrationConditionKind.AllOptions };
    }
    this.conditionsChange.emit(next);
  }
}
