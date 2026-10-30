/* product-rules-edit.ts
 *
 * Standalone HQ Admin editor and interactive registration simulator for
 * unified compositional rule-based event pricing, named capacities,
 * shared rule conditions, and cumulative registration discounts.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { SearchableSet } from '../searchable-set';
import { VodPreviewComponent } from '../vod-preview/vod-preview';
import { VodOptionItem } from '../product-edit/product-edit';
import { RuleConditionsEditorComponent } from '../rule-conditions-editor/rule-conditions-editor';
import {
  AttendanceType,
  DepositPolicyKind,
  DepositRefundPolicy,
  DepositRefundPolicyKind,
  EarlyBirdPolicyKind,
  evaluateEventPricingQuote,
  EventAddOn,
  EventAddOnKind,
  EventCapacity,
  EventPricingRules,
  EventRegistrationOption,
  EventRegistrationQuestion,
  EventRuleConditions,
  getAnywhereOnEarthDate,
  initEventAddOn,
  initEventCapacity,
  initEventDiscount,
  initEventRegistrationOption,
  initEventRegistrationQuestion,
  initEventRuleConditions,
  matchesRegistrationCondition,
  matchesTimingCondition,
  MAX_LONG_TEXT_ANSWER_LENGTH,
  MAX_SHORT_TEXT_ANSWER_LENGTH,
  PaymentChoice,
  PersonStatusKind,
  PricingValidationErrorCode,
  QuestionAnswerInput,
  RegistrationConditionKind,
  RegistrationQuestionKind,
  SubSelectionKind,
  TimingConditionKind,
  TimingWindow,
  validateAndBuildQuestionResponses,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';
import { InstructorLicenseType } from '../../../functions/src/data-model/curriculum';
import {
  MemberStatusContext,
  MembershipType,
  PUBLIC_MEMBER_STATUS_CONTEXT,
  toMemberStatusContext,
} from '../../../functions/src/data-model/member-status';

export enum SimulatedPersonRole {
  Public = 'public',
  ActiveMember = 'active_member',
  ActiveInstructor = 'active_instructor',
}

export interface SimDatePreset {
  id: string;
  label: string;
  date: string;
}

@Component({
  selector: 'app-product-rules-edit',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    AutocompleteComponent,
    VodPreviewComponent,
    RuleConditionsEditorComponent,
  ],
  templateUrl: './product-rules-edit.html',
  styleUrl: './product-rules-edit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductRulesEditComponent {
  rules = input.required<EventPricingRules>();
  currency = input<string>('usd');
  currencySymbol = input<string>('$');
  eventStartDate = input<string>('');
  recordedVideoId = input<string>('');
  vodOptionsSet = input.required<SearchableSet<'id', VodOptionItem>>();

  rulesChange = output<EventPricingRules>();
  currencyChange = output<string>();

  // Expose enums to template
  protected readonly AttendanceType = AttendanceType;
  protected readonly EarlyBirdPolicyKind = EarlyBirdPolicyKind;
  protected readonly RegistrationConditionKind = RegistrationConditionKind;
  protected readonly SubSelectionKind = SubSelectionKind;
  protected readonly EventAddOnKind = EventAddOnKind;
  protected readonly PersonStatusKind = PersonStatusKind;
  protected readonly WhoConditionKind = WhoConditionKind;
  protected readonly DepositPolicyKind = DepositPolicyKind;
  protected readonly DepositRefundPolicyKind = DepositRefundPolicyKind;
  protected readonly PaymentChoice = PaymentChoice;
  protected readonly PricingValidationErrorCode = PricingValidationErrorCode;
  protected readonly RegistrationQuestionKind = RegistrationQuestionKind;
  protected readonly MAX_SHORT_TEXT_ANSWER_LENGTH = MAX_SHORT_TEXT_ANSWER_LENGTH;
  protected readonly MAX_LONG_TEXT_ANSWER_LENGTH = MAX_LONG_TEXT_ANSWER_LENGTH;
  protected readonly SimulatedPersonRole = SimulatedPersonRole;

  // Filtered VOD autocomplete sets for CatalogVideo vs CatalogSeries add-ons
  vodVideoOptionsSet = new SearchableSet<'id', VodOptionItem>(
    ['title', 'seriesTitle', 'id', 'displayName'],
    'id',
  );
  vodSeriesOptionsSet = new SearchableSet<'id', VodOptionItem>(
    ['title', 'seriesTitle', 'id', 'displayName'],
    'id',
  );
  vodDisplayFns: DisplayFns<VodOptionItem> = {
    toChipId: (v: VodOptionItem) => v.id,
    toName: (v: VodOptionItem) =>
      v.seriesTitle && v.type === 'video' ? `${v.title} (${v.seriesTitle})` : v.title,
  };

  onCatalogVideoTextUpdated(addOnId: string, rawText: string): void {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    const exact = this.vodVideoOptionsSet
      .entries()
      .find((v) => v.id.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      this.updateAddOnCatalogVideoId(addOnId, exact.id);
    }
  }

  onCatalogSeriesTextUpdated(addOnId: string, rawText: string): void {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    const exact = this.vodSeriesOptionsSet
      .entries()
      .find((s) => s.id.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      this.updateAddOnCatalogSeriesId(addOnId, exact.id);
    }
  }

  // Draft suboption text inputs keyed by option ID
  suboptionDrafts = signal<Record<string, string>>({});
  // Draft choice text inputs keyed by question ID
  questionChoiceDrafts = signal<Record<string, string>>({});

  // Value-preserving caches so switching union modes away and back restores previous user edits
  private earlyPolicyDeadlineCache = '';
  private optionSubSelectionCache: Record<
    string,
    { availableSuboptions: string[]; pickCount: number }
  > = {};
  private optionCapacityUsageCache: Record<string, Record<string, number>> = {};
  private addOnCatalogVideoCache: Record<string, string> = {};
  private addOnCatalogSeriesCache: Record<string, string> = {};
  private questionChoicesCache: Record<string, string[]> = {};
  private questionPlaceholderCache: Record<string, string> = {};
  private depositPolicyCache: {
    depositCents: number;
    refundPolicy: DepositRefundPolicy;
    offlineInstructions: string;
  } | null = null;
  private depositRefundDeadlineCache = '';

  // Interactive Registration Simulator state
  simDateAoE = signal<string>(getAnywhereOnEarthDate());
  simRole = signal<SimulatedPersonRole>(SimulatedPersonRole.Public);
  simCapacityCounts = signal<Record<string, number>>({});

  simSelectedOptionId = linkedSignal<EventPricingRules, string>({
    source: this.rules,
    computation: (r, prev) => {
      if (prev && r.registrationOptions.some((o) => o.id === prev.value)) {
        return prev.value;
      }
      return r.registrationOptions[0]?.id || '';
    },
  });
  simSelectedSuboptions = signal<string[]>([]);
  simSelectedAddOnIds = signal<string[]>([]);
  simPaymentChoice = signal<PaymentChoice | undefined>(undefined);
  simQuestionAnswers = signal<Record<string, { answerText: string; selectedOptions: string[] }>>(
    {},
  );

  constructor() {
    effect(() => {
      const allItems = this.vodOptionsSet().entries();
      this.vodVideoOptionsSet.setEntries(allItems.filter((item) => item.type === 'video'));
      this.vodSeriesOptionsSet.setEntries(allItems.filter((item) => item.type === 'series'));
    });

    effect(() => {
      const r = this.rules();
      this.syncValueCachesFromRules(r);
    });
  }

  simMemberContext = computed<MemberStatusContext>(() => {
    const role = this.simRole();
    if (role === SimulatedPersonRole.ActiveInstructor) {
      return toMemberStatusContext({
        member: {
          membershipType: MembershipType.Life,
          currentMembershipExpires: '',
          instructorId: 'SIM-INST',
          instructorLicenseType: InstructorLicenseType.Life,
          instructorLicenseExpires: 'life',
        },
      });
    }
    if (role === SimulatedPersonRole.ActiveMember) {
      return toMemberStatusContext({
        member: {
          membershipType: MembershipType.Life,
          currentMembershipExpires: '',
          instructorId: '',
          instructorLicenseType: InstructorLicenseType.None,
          instructorLicenseExpires: '',
        },
      });
    }
    return PUBLIC_MEMBER_STATUS_CONTEXT;
  });

  simulatedQuote = computed(() => {
    const r = this.rules();
    const counts = this.simCapacityCounts();
    const desiredOptId = this.simSelectedOptionId();

    const prelimQuote = evaluateEventPricingQuote({
      rules: r,
      memberContext: this.simMemberContext(),
      capacityCounts: counts,
      eventStartDate: this.eventStartDate(),
      evaluationDateAoE: this.simDateAoE(),
      selectedOptionId: desiredOptId || undefined,
      selectedSuboptions: this.simSelectedSuboptions(),
    });

    // If the currently selected option became ineligible or sold out and another option is
    // available, fall back to the first available option; otherwise keep it to show validation.
    let effectiveSelectedId: string | undefined = prelimQuote.selectedOption?.option.id;
    if (
      prelimQuote.selectedOption &&
      (!prelimQuote.selectedOption.isEligibleForPerson || prelimQuote.selectedOption.isSoldOut) &&
      prelimQuote.availableOptions.length > 0
    ) {
      effectiveSelectedId = prelimQuote.availableOptions[0].option.id;
    }

    const secondPass =
      effectiveSelectedId !== prelimQuote.selectedOption?.option.id
        ? evaluateEventPricingQuote({
            rules: r,
            memberContext: this.simMemberContext(),
            capacityCounts: counts,
            eventStartDate: this.eventStartDate(),
            evaluationDateAoE: this.simDateAoE(),
            selectedOptionId: effectiveSelectedId,
            selectedSuboptions: this.simSelectedSuboptions(),
          })
        : prelimQuote;

    const availAddOnIds = new Set(secondPass.availableAddOns.map((a) => a.addOn.id));
    const filteredAddOnIds = this.simSelectedAddOnIds().filter((id) => availAddOnIds.has(id));
    const chosenPayment = this.simPaymentChoice();
    const validPayment =
      chosenPayment && secondPass.availablePaymentChoices.includes(chosenPayment)
        ? chosenPayment
        : secondPass.availablePaymentChoices[0];

    return evaluateEventPricingQuote({
      rules: r,
      memberContext: this.simMemberContext(),
      capacityCounts: counts,
      eventStartDate: this.eventStartDate(),
      evaluationDateAoE: this.simDateAoE(),
      selectedOptionId: effectiveSelectedId,
      selectedSuboptions: this.simSelectedSuboptions(),
      selectedAddOnIds: filteredAddOnIds,
      paymentChoice: validPayment,
    });
  });

  // ------------------------------------------------------------------
  // Formatting & Parsing Helpers (Fixed Cents Only)
  // ------------------------------------------------------------------

  centsToMajorInput(cents: number): number {
    const safe = Number.isFinite(cents) && cents > 0 ? cents : 0;
    return Number((safe / 100).toFixed(2));
  }

  parseMajorToCents(raw: string): number {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.round(parsed * 100);
  }

  formatCents(cents: number): string {
    return `${this.currencySymbol()}${(cents / 100).toFixed(2)}`;
  }

  getOptionCapacityUnits(opt: EventRegistrationOption, capacityId: string): number {
    return opt.capacityUsage[capacityId] ?? 0;
  }

  private syncValueCachesFromRules(r: EventPricingRules): void {
    if (
      r.earlyBird.kind === EarlyBirdPolicyKind.Enabled &&
      r.earlyBird.deadlineDate.trim()
    ) {
      this.earlyPolicyDeadlineCache = r.earlyBird.deadlineDate.trim();
    }

    for (const opt of r.registrationOptions) {
      if (opt.subSelection.kind === SubSelectionKind.PickSuboptions) {
        this.optionSubSelectionCache[opt.id] = {
          availableSuboptions: [...opt.subSelection.availableSuboptions],
          pickCount: opt.subSelection.pickCount,
        };
      }
      if (Object.keys(opt.capacityUsage).length > 0) {
        this.optionCapacityUsageCache[opt.id] = {
          ...(this.optionCapacityUsageCache[opt.id] ?? {}),
          ...opt.capacityUsage,
        };
      }
    }

    for (const addOn of r.addOns) {
      if (addOn.spec.kind === EventAddOnKind.CatalogVideo && addOn.spec.videoId) {
        this.addOnCatalogVideoCache[addOn.id] = addOn.spec.videoId;
      } else if (addOn.spec.kind === EventAddOnKind.CatalogSeries && addOn.spec.seriesId) {
        this.addOnCatalogSeriesCache[addOn.id] = addOn.spec.seriesId;
      }
    }

    for (const q of r.questions) {
      if (
        (q.spec.kind === RegistrationQuestionKind.Select ||
          q.spec.kind === RegistrationQuestionKind.Checkboxes) &&
        q.spec.options.length > 0
      ) {
        this.questionChoicesCache[q.id] = [...q.spec.options];
      } else if (
        (q.spec.kind === RegistrationQuestionKind.ShortText ||
          q.spec.kind === RegistrationQuestionKind.LongText) &&
        q.spec.placeholder
      ) {
        this.questionPlaceholderCache[q.id] = q.spec.placeholder;
      }
    }

    if (r.payment.depositPolicy.kind === DepositPolicyKind.Enabled) {
      this.depositPolicyCache = {
        depositCents: r.payment.depositPolicy.depositCents,
        refundPolicy: structuredClone(r.payment.depositPolicy.refundPolicy),
        offlineInstructions: r.payment.depositPolicy.offlineInstructions,
      };
      if (
        r.payment.depositPolicy.refundPolicy.kind === DepositRefundPolicyKind.RefundableBefore &&
        r.payment.depositPolicy.refundPolicy.deadlineDate.trim()
      ) {
        this.depositRefundDeadlineCache =
          r.payment.depositPolicy.refundPolicy.deadlineDate.trim();
      }
    }
  }

  private defaultCutoffDate(): string {
    const startRaw = this.eventStartDate().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
      const startMs = Date.parse(`${startRaw}T00:00:00Z`);
      if (Number.isFinite(startMs)) {
        return new Date(startMs - 14 * 24 * 3600_000).toISOString().slice(0, 10);
      }
    }
    const todayAoE = getAnywhereOnEarthDate();
    const todayMs = Date.parse(`${todayAoE}T00:00:00Z`);
    return new Date(todayMs + 30 * 24 * 3600_000).toISOString().slice(0, 10);
  }

  private emitUpdated(mutator: (draft: EventPricingRules) => void): void {
    this.syncValueCachesFromRules(this.rules());
    const clone = structuredClone(this.rules());
    mutator(clone);
    this.syncValueCachesFromRules(clone);
    this.rulesChange.emit(clone);
  }

  private generateUniqueId(prefix: string, existingIds: string[]): string {
    const used = new Set(existingIds);
    let idx = existingIds.length + 1;
    while (used.has(`${prefix}_${idx}`)) {
      idx++;
    }
    return `${prefix}_${idx}`;
  }

  // ------------------------------------------------------------------
  // Early Bird Policy Mutations
  // ------------------------------------------------------------------

  toggleEarlyBirdPolicy(enabled: boolean): void {
    this.emitUpdated((r) => {
      if (enabled) {
        const existingDate =
          (r.earlyBird.kind === EarlyBirdPolicyKind.Enabled &&
            r.earlyBird.deadlineDate.trim()) ||
          this.earlyPolicyDeadlineCache ||
          this.defaultCutoffDate();
        r.earlyBird = {
          kind: EarlyBirdPolicyKind.Enabled,
          deadlineDate: existingDate,
        };
      } else {
        r.earlyBird = { kind: EarlyBirdPolicyKind.Disabled };
      }
    });
  }

  updateEarlyBirdDeadline(deadlineDate: string): void {
    this.emitUpdated((r) => {
      r.earlyBird = {
        kind: EarlyBirdPolicyKind.Enabled,
        deadlineDate: deadlineDate.trim(),
      };
    });
  }

  // ------------------------------------------------------------------
  // Capacity Limits Mutations (Configured Before Registration Options)
  // ------------------------------------------------------------------

  addCapacity(): void {
    this.emitUpdated((r) => {
      const wasEmpty = r.capacities.length === 0;
      const id = this.generateUniqueId(
        'capacity',
        r.capacities.map((c) => c.id),
      );
      const defaultLabel = wasEmpty
        ? 'In-Person Participants'
        : `Capacity ${r.capacities.length + 1}`;
      const newCap: EventCapacity = initEventCapacity({
        id,
        label: defaultLabel,
        description: '',
        limit: 25,
      });
      r.capacities.push(newCap);

      for (const opt of r.registrationOptions) {
        const cachedUnits = this.optionCapacityUsageCache[opt.id]?.[id];
        if (cachedUnits !== undefined && cachedUnits > 0) {
          opt.capacityUsage[id] = cachedUnits;
        } else if (
          wasEmpty &&
          (opt.attendanceType === AttendanceType.InPerson ||
            opt.attendanceType === AttendanceType.InPersonAndOnline)
        ) {
          opt.capacityUsage[id] = 1;
        }
      }
    });
  }

  removeCapacity(capacityId: string): void {
    this.emitUpdated((r) => {
      r.capacities = r.capacities.filter((c) => c.id !== capacityId);
      for (const opt of r.registrationOptions) {
        if (opt.capacityUsage[capacityId] !== undefined) {
          this.optionCapacityUsageCache[opt.id] = {
            ...(this.optionCapacityUsageCache[opt.id] ?? {}),
            [capacityId]: opt.capacityUsage[capacityId],
          };
          delete opt.capacityUsage[capacityId];
        }
      }
    });
    this.simCapacityCounts.update((prev) => {
      const next = { ...prev };
      delete next[capacityId];
      return next;
    });
  }

  updateCapacityLabel(capacityId: string, label: string): void {
    this.emitUpdated((r) => {
      const cap = r.capacities.find((c) => c.id === capacityId);
      if (cap) cap.label = label;
    });
  }

  updateCapacityDescription(capacityId: string, description: string): void {
    this.emitUpdated((r) => {
      const cap = r.capacities.find((c) => c.id === capacityId);
      if (cap) cap.description = description;
    });
  }

  updateCapacityLimit(capacityId: string, raw: string): void {
    const parsed = parseInt(raw, 10);
    const limit = Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : 1;
    this.emitUpdated((r) => {
      const cap = r.capacities.find((c) => c.id === capacityId);
      if (cap) cap.limit = limit;
    });
  }

  updateOptionCapacityUsage(optionId: string, capacityId: string, raw: string): void {
    const parsed = parseInt(raw, 10);
    const units = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (!opt) return;
      if (units > 0) {
        opt.capacityUsage[capacityId] = units;
        this.optionCapacityUsageCache[opt.id] = {
          ...(this.optionCapacityUsageCache[opt.id] ?? {}),
          [capacityId]: units,
        };
      } else {
        delete opt.capacityUsage[capacityId];
      }
    });
  }

  updateSimCapacityCount(capacityId: string, raw: string): void {
    const parsed = parseInt(raw, 10);
    const used = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
    this.simCapacityCounts.update((prev) => ({
      ...prev,
      [capacityId]: used,
    }));
  }

  // ------------------------------------------------------------------
  // Registration Options Mutations
  // ------------------------------------------------------------------

  addRegistrationOption(): void {
    this.emitUpdated((r) => {
      const id = this.generateUniqueId(
        'option',
        r.registrationOptions.map((o) => o.id),
      );
      const firstOpt = r.registrationOptions[0];
      const initialUsage: Record<string, number> =
        r.capacities.length === 1 ? { [r.capacities[0].id]: 1 } : {};
      r.registrationOptions.push(
        initEventRegistrationOption({
          id,
          label: `Option ${r.registrationOptions.length + 1}`,
          attendanceType: AttendanceType.InPerson,
          conditions: initEventRuleConditions({
            who: firstOpt ? structuredClone(firstOpt.conditions.who) : undefined,
          }),
          capacityUsage: initialUsage,
          subSelection: { kind: SubSelectionKind.None },
          priceCents: 0,
        }),
      );
    });
  }

  removeRegistrationOption(optionId: string): void {
    if (this.rules().registrationOptions.length <= 1) return;
    this.emitUpdated((r) => {
      r.registrationOptions = r.registrationOptions.filter((o) => o.id !== optionId);
      for (const disc of r.discounts) {
        if (disc.conditions.registration.kind === RegistrationConditionKind.SpecificOptions) {
          disc.conditions.registration.optionIds = disc.conditions.registration.optionIds.filter(
            (id) => id !== optionId,
          );
        }
      }
      for (const addOn of r.addOns) {
        if (addOn.conditions.registration.kind === RegistrationConditionKind.SpecificOptions) {
          addOn.conditions.registration.optionIds = addOn.conditions.registration.optionIds.filter(
            (id) => id !== optionId,
          );
        }
      }
      for (const q of r.questions) {
        if (q.conditions.registration.kind === RegistrationConditionKind.SpecificOptions) {
          q.conditions.registration.optionIds = q.conditions.registration.optionIds.filter(
            (id) => id !== optionId,
          );
        }
      }
    });
  }

  moveRegistrationOption(index: number, direction: -1 | 1): void {
    this.emitUpdated((r) => {
      const target = index + direction;
      if (target < 0 || target >= r.registrationOptions.length) return;
      const [moved] = r.registrationOptions.splice(index, 1);
      r.registrationOptions.splice(target, 0, moved);
    });
  }

  updateOptionLabel(optionId: string, label: string): void {
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (opt) opt.label = label;
    });
  }

  updateOptionDescription(optionId: string, description: string): void {
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (opt) opt.description = description;
    });
  }

  updateOptionAttendance(optionId: string, attendanceType: AttendanceType): void {
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (!opt) return;
      const prevWasInPerson =
        opt.attendanceType === AttendanceType.InPerson ||
        opt.attendanceType === AttendanceType.InPersonAndOnline;
      const nextIsInPerson =
        attendanceType === AttendanceType.InPerson ||
        attendanceType === AttendanceType.InPersonAndOnline;
      opt.attendanceType = attendanceType;

      // Preserve cached venue capacity usage if switching between In-Person and Online/Recording
      if (prevWasInPerson && !nextIsInPerson) {
        if (Object.keys(opt.capacityUsage).length > 0) {
          this.optionCapacityUsageCache[opt.id] = {
            ...(this.optionCapacityUsageCache[opt.id] ?? {}),
            ...opt.capacityUsage,
          };
          opt.capacityUsage = {};
        }
      } else if (!prevWasInPerson && nextIsInPerson && Object.keys(opt.capacityUsage).length === 0) {
        const cached = this.optionCapacityUsageCache[opt.id];
        if (cached) {
          const validCapIds = new Set(r.capacities.map((c) => c.id));
          const restored: Record<string, number> = {};
          for (const [k, v] of Object.entries(cached)) {
            if (validCapIds.has(k) && v > 0) restored[k] = v;
          }
          opt.capacityUsage = restored;
        } else if (r.capacities.length === 1) {
          opt.capacityUsage = { [r.capacities[0].id]: 1 };
        }
      }
    });
  }

  updateOptionConditions(optionId: string, conditions: EventRuleConditions): void {
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (opt) {
        opt.conditions = {
          ...structuredClone(conditions),
          registration: { kind: RegistrationConditionKind.AllOptions },
        };
      }
    });
  }

  updateOptionStandardPrice(optionId: string, rawMajor: string): void {
    const targetCents = this.parseMajorToCents(rawMajor);
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (opt) opt.priceCents = targetCents;
    });
  }

  updateOptionSubSelectionKind(optionId: string, kind: SubSelectionKind): void {
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (!opt) return;
      if (kind === SubSelectionKind.PickSuboptions) {
        const cached = this.optionSubSelectionCache[optionId];
        const availableSuboptions =
          opt.subSelection.kind === SubSelectionKind.PickSuboptions &&
          opt.subSelection.availableSuboptions.length > 0
            ? opt.subSelection.availableSuboptions
            : cached && cached.availableSuboptions.length > 0
              ? [...cached.availableSuboptions]
              : ['Friday', 'Saturday', 'Sunday'];
        const rawPickCount =
          opt.subSelection.kind === SubSelectionKind.PickSuboptions
            ? opt.subSelection.pickCount
            : (cached?.pickCount ?? 1);
        const pickCount = Math.min(
          Math.max(1, availableSuboptions.length),
          Math.max(1, rawPickCount),
        );
        opt.subSelection = {
          kind: SubSelectionKind.PickSuboptions,
          availableSuboptions,
          pickCount,
        };
        this.clampSimSuboptionsIfActive(optionId, availableSuboptions, pickCount);
      } else {
        opt.subSelection = { kind: SubSelectionKind.None };
        this.clampSimSuboptionsIfActive(optionId, [], 0);
      }
    });
  }

  updateOptionPickCount(optionId: string, raw: string): void {
    const parsed = parseInt(raw, 10);
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (!opt || opt.subSelection.kind !== SubSelectionKind.PickSuboptions) return;
      const max = Math.max(1, opt.subSelection.availableSuboptions.length);
      const count = Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : 1;
      opt.subSelection = {
        ...opt.subSelection,
        pickCount: count,
      };
      this.clampSimSuboptionsIfActive(optionId, opt.subSelection.availableSuboptions, count);
    });
  }

  setSuboptionDraft(optionId: string, value: string): void {
    this.suboptionDrafts.update((m) => ({ ...m, [optionId]: value }));
  }

  addSuboptionsFromDraft(optionId: string): void {
    const draft = (this.suboptionDrafts()[optionId] || '').trim();
    if (!draft) return;
    const parts = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (!opt || opt.subSelection.kind !== SubSelectionKind.PickSuboptions) return;
      const merged = Array.from(new Set([...opt.subSelection.availableSuboptions, ...parts]));
      opt.subSelection = {
        kind: SubSelectionKind.PickSuboptions,
        availableSuboptions: merged,
        pickCount: Math.min(merged.length, Math.max(1, opt.subSelection.pickCount)),
      };
    });
    this.setSuboptionDraft(optionId, '');
  }

  removeSuboption(optionId: string, suboption: string): void {
    this.emitUpdated((r) => {
      const opt = r.registrationOptions.find((o) => o.id === optionId);
      if (!opt || opt.subSelection.kind !== SubSelectionKind.PickSuboptions) return;
      const next = opt.subSelection.availableSuboptions.filter((s) => s !== suboption);
      const nextPickCount = Math.min(Math.max(1, next.length), opt.subSelection.pickCount);
      opt.subSelection = {
        kind: SubSelectionKind.PickSuboptions,
        availableSuboptions: next,
        pickCount: nextPickCount,
      };
      this.clampSimSuboptionsIfActive(optionId, next, nextPickCount);
    });
  }

  // ------------------------------------------------------------------
  // Discounts Mutations (Shared Conditions: Who, Timing, Registration)
  // ------------------------------------------------------------------

  addDiscount(): void {
    this.emitUpdated((r) => {
      const id = this.generateUniqueId(
        'discount',
        r.discounts.map((d) => d.id),
      );
      const earlyEnabled = r.earlyBird.kind === EarlyBirdPolicyKind.Enabled;
      const hasPublicEarlyBird = r.discounts.some(
        (d) =>
          d.conditions.who.kind === WhoConditionKind.Anyone &&
          d.conditions.timing.kind === TimingConditionKind.Window &&
          d.conditions.timing.window === TimingWindow.OnOrBeforeEarlyBird,
      );
      const hasMemberDisc = r.discounts.some(
        (d) =>
          d.conditions.who.kind === WhoConditionKind.Status &&
          d.conditions.who.status === PersonStatusKind.Member,
      );
      const hasInstructorDisc = r.discounts.some(
        (d) =>
          d.conditions.who.kind === WhoConditionKind.Status &&
          d.conditions.who.status === PersonStatusKind.Instructor,
      );

      if (earlyEnabled && !hasPublicEarlyBird) {
        r.discounts.push(
          initEventDiscount({
            id,
            label: 'Early Bird Discount',
            discountCents: 0,
            conditions: initEventRuleConditions({
              timing: {
                kind: TimingConditionKind.Window,
                window: TimingWindow.OnOrBeforeEarlyBird,
              },
            }),
          }),
        );
      } else if (!hasMemberDisc) {
        r.discounts.push(
          initEventDiscount({
            id,
            label: 'ILC Member Discount',
            discountCents: 0,
            conditions: initEventRuleConditions({
              who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
            }),
          }),
        );
      } else if (!hasInstructorDisc) {
        r.discounts.push(
          initEventDiscount({
            id,
            label: 'Extra Instructor Discount',
            discountCents: 0,
            conditions: initEventRuleConditions({
              who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
            }),
          }),
        );
      } else {
        r.discounts.push(
          initEventDiscount({
            id,
            label: 'Registration Discount',
            discountCents: 0,
          }),
        );
      }
    });
  }

  removeDiscount(discountId: string): void {
    this.emitUpdated((r) => {
      r.discounts = r.discounts.filter((d) => d.id !== discountId);
    });
  }

  moveDiscount(index: number, direction: -1 | 1): void {
    this.emitUpdated((r) => {
      const target = index + direction;
      if (target < 0 || target >= r.discounts.length) return;
      const [moved] = r.discounts.splice(index, 1);
      r.discounts.splice(target, 0, moved);
    });
  }

  updateDiscountLabel(discountId: string, label: string): void {
    this.emitUpdated((r) => {
      const d = r.discounts.find((item) => item.id === discountId);
      if (d) d.label = label;
    });
  }

  updateDiscountAmount(discountId: string, rawMajor: string): void {
    const discountCents = this.parseMajorToCents(rawMajor);
    this.emitUpdated((r) => {
      const d = r.discounts.find((item) => item.id === discountId);
      if (d) d.discountCents = discountCents;
    });
  }

  updateDiscountConditions(discountId: string, conditions: EventRuleConditions): void {
    this.emitUpdated((r) => {
      const d = r.discounts.find((item) => item.id === discountId);
      if (d) d.conditions = structuredClone(conditions);
    });
  }

  // ------------------------------------------------------------------
  // Event Add-Ons Mutations
  // ------------------------------------------------------------------

  addEventAddOn(): void {
    this.emitUpdated((r) => {
      const id = this.generateUniqueId(
        'addon',
        r.addOns.map((a) => a.id),
      );
      const hasRecordingAlready = r.addOns.some(
        (a) => a.spec.kind === EventAddOnKind.EventRecording,
      );
      r.addOns.push(
        initEventAddOn({
          id,
          label: hasRecordingAlready ? 'Additional Add-On' : 'Event Video Recording',
          spec: hasRecordingAlready
            ? { kind: EventAddOnKind.Other }
            : { kind: EventAddOnKind.EventRecording },
        }),
      );
    });
  }

  removeEventAddOn(addOnId: string): void {
    this.emitUpdated((r) => {
      r.addOns = r.addOns.filter((a) => a.id !== addOnId);
    });
  }

  moveEventAddOn(index: number, direction: -1 | 1): void {
    this.emitUpdated((r) => {
      const target = index + direction;
      if (target < 0 || target >= r.addOns.length) return;
      const [moved] = r.addOns.splice(index, 1);
      r.addOns.splice(target, 0, moved);
    });
  }

  updateAddOnLabel(addOnId: string, label: string): void {
    this.emitUpdated((r) => {
      const a = r.addOns.find((item) => item.id === addOnId);
      if (a) a.label = label;
    });
  }

  updateAddOnDescription(addOnId: string, description: string): void {
    this.emitUpdated((r) => {
      const a = r.addOns.find((item) => item.id === addOnId);
      if (a) a.description = description;
    });
  }

  updateAddOnPrice(addOnId: string, rawMajor: string): void {
    const cents = this.parseMajorToCents(rawMajor);
    this.emitUpdated((r) => {
      const a = r.addOns.find((item) => item.id === addOnId);
      if (a) a.priceCents = cents;
    });
  }

  updateAddOnSpecKind(addOnId: string, kind: EventAddOnKind): void {
    this.emitUpdated((r) => {
      const a = r.addOns.find((item) => item.id === addOnId);
      if (!a) return;
      switch (kind) {
        case EventAddOnKind.EventRecording:
          a.spec = { kind: EventAddOnKind.EventRecording };
          break;
        case EventAddOnKind.CatalogVideo:
          a.spec = {
            kind: EventAddOnKind.CatalogVideo,
            videoId: this.addOnCatalogVideoCache[addOnId] ?? '',
          };
          break;
        case EventAddOnKind.CatalogSeries:
          a.spec = {
            kind: EventAddOnKind.CatalogSeries,
            seriesId: this.addOnCatalogSeriesCache[addOnId] ?? '',
          };
          break;
        case EventAddOnKind.Other:
          a.spec = { kind: EventAddOnKind.Other };
          break;
      }
    });
  }

  updateAddOnCatalogVideoId(addOnId: string, videoId: string): void {
    this.emitUpdated((r) => {
      const a = r.addOns.find((item) => item.id === addOnId);
      if (a && a.spec.kind === EventAddOnKind.CatalogVideo) {
        a.spec = { kind: EventAddOnKind.CatalogVideo, videoId: videoId.trim() };
      }
    });
  }

  updateAddOnCatalogSeriesId(addOnId: string, seriesId: string): void {
    this.emitUpdated((r) => {
      const a = r.addOns.find((item) => item.id === addOnId);
      if (a && a.spec.kind === EventAddOnKind.CatalogSeries) {
        a.spec = { kind: EventAddOnKind.CatalogSeries, seriesId: seriesId.trim() };
      }
    });
  }

  updateAddOnConditions(addOnId: string, conditions: EventRuleConditions): void {
    this.emitUpdated((r) => {
      const a = r.addOns.find((item) => item.id === addOnId);
      if (a) a.conditions = structuredClone(conditions);
    });
  }

  // ------------------------------------------------------------------
  // Registration Form Questions Mutations
  // ------------------------------------------------------------------

  addQuestion(): void {
    this.emitUpdated((r) => {
      const id = this.generateUniqueId(
        'question',
        r.questions.map((q) => q.id),
      );
      r.questions.push(
        initEventRegistrationQuestion({
          id,
          label: '',
          description: '',
          required: true,
          spec: { kind: RegistrationQuestionKind.ShortText, placeholder: '' },
        }),
      );
    });
  }

  removeQuestion(questionId: string): void {
    this.emitUpdated((r) => {
      r.questions = r.questions.filter((q) => q.id !== questionId);
    });
    this.simQuestionAnswers.update((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }

  moveQuestion(index: number, direction: -1 | 1): void {
    this.emitUpdated((r) => {
      const target = index + direction;
      if (target < 0 || target >= r.questions.length) return;
      const [moved] = r.questions.splice(index, 1);
      r.questions.splice(target, 0, moved);
    });
  }

  updateQuestionLabel(questionId: string, label: string): void {
    this.emitUpdated((r) => {
      const q = r.questions.find((item) => item.id === questionId);
      if (q) q.label = label;
    });
  }

  updateQuestionDescription(questionId: string, description: string): void {
    this.emitUpdated((r) => {
      const q = r.questions.find((item) => item.id === questionId);
      if (q) q.description = description;
    });
  }

  updateQuestionRequired(questionId: string, required: boolean): void {
    this.emitUpdated((r) => {
      const q = r.questions.find((item) => item.id === questionId);
      if (q) q.required = required;
    });
  }

  updateQuestionKind(questionId: string, kind: RegistrationQuestionKind): void {
    this.emitUpdated((r) => {
      const q = r.questions.find((item) => item.id === questionId);
      if (!q) return;
      switch (kind) {
        case RegistrationQuestionKind.ShortText:
        case RegistrationQuestionKind.LongText: {
          const placeholder =
            q.spec.kind === RegistrationQuestionKind.ShortText ||
            q.spec.kind === RegistrationQuestionKind.LongText
              ? q.spec.placeholder
              : (this.questionPlaceholderCache[questionId] ?? '');
          q.spec = { kind, placeholder };
          break;
        }
        case RegistrationQuestionKind.Select:
        case RegistrationQuestionKind.Checkboxes: {
          const options =
            (q.spec.kind === RegistrationQuestionKind.Select ||
              q.spec.kind === RegistrationQuestionKind.Checkboxes) &&
            q.spec.options.length > 0
              ? [...q.spec.options]
              : this.questionChoicesCache[questionId]?.length
                ? [...this.questionChoicesCache[questionId]]
                : ['Option 1', 'Option 2'];
          q.spec = { kind, options };
          if (kind === RegistrationQuestionKind.Select) {
            this.simQuestionAnswers.update((prev) => {
              const cur = prev[questionId];
              if (!cur) return prev;
              const nextAnswerText = options.includes(cur.answerText)
                ? cur.answerText
                : (cur.selectedOptions.find((opt) => options.includes(opt)) ?? '');
              return {
                ...prev,
                [questionId]: {
                  answerText: nextAnswerText,
                  selectedOptions: [],
                },
              };
            });
          }
          break;
        }
      }
    });
  }

  updateQuestionPlaceholder(questionId: string, placeholder: string): void {
    this.emitUpdated((r) => {
      const q = r.questions.find((item) => item.id === questionId);
      if (
        q &&
        (q.spec.kind === RegistrationQuestionKind.ShortText ||
          q.spec.kind === RegistrationQuestionKind.LongText)
      ) {
        q.spec = { kind: q.spec.kind, placeholder };
      }
    });
  }

  setQuestionChoiceDraft(questionId: string, value: string): void {
    this.questionChoiceDrafts.update((m) => ({ ...m, [questionId]: value }));
  }

  addQuestionChoicesFromDraft(questionId: string): void {
    const draft = (this.questionChoiceDrafts()[questionId] || '').trim();
    if (!draft) return;
    const parts = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    this.emitUpdated((r) => {
      const q = r.questions.find((item) => item.id === questionId);
      if (
        !q ||
        (q.spec.kind !== RegistrationQuestionKind.Select &&
          q.spec.kind !== RegistrationQuestionKind.Checkboxes)
      ) {
        return;
      }
      const merged = Array.from(new Set([...q.spec.options, ...parts]));
      q.spec = {
        kind: q.spec.kind,
        options: merged,
      };
    });
    this.setQuestionChoiceDraft(questionId, '');
  }

  removeQuestionChoice(questionId: string, choice: string): void {
    this.emitUpdated((r) => {
      const q = r.questions.find((item) => item.id === questionId);
      if (
        !q ||
        (q.spec.kind !== RegistrationQuestionKind.Select &&
          q.spec.kind !== RegistrationQuestionKind.Checkboxes)
      ) {
        return;
      }
      const next = q.spec.options.filter((opt) => opt !== choice);
      q.spec = {
        kind: q.spec.kind,
        options: next,
      };
      this.questionChoicesCache[questionId] = [...next];
    });
    this.simQuestionAnswers.update((prev) => {
      const cur = prev[questionId];
      if (!cur) return prev;
      const hadText = cur.answerText === choice;
      const hadCheckbox = cur.selectedOptions.includes(choice);
      if (!hadText && !hadCheckbox) return prev;
      return {
        ...prev,
        [questionId]: {
          answerText: hadText ? '' : cur.answerText,
          selectedOptions: cur.selectedOptions.filter((opt) => opt !== choice),
        },
      };
    });
  }

  updateQuestionConditions(questionId: string, conditions: EventRuleConditions): void {
    this.emitUpdated((r) => {
      const q = r.questions.find((item) => item.id === questionId);
      if (q) q.conditions = structuredClone(conditions);
    });
  }

  questionKindBadge(q: EventRegistrationQuestion): string {
    switch (q.spec.kind) {
      case RegistrationQuestionKind.ShortText:
        return 'Short Text';
      case RegistrationQuestionKind.LongText:
        return 'Long Text';
      case RegistrationQuestionKind.Select:
        return 'Dropdown Menu';
      case RegistrationQuestionKind.Checkboxes:
        return 'Checkboxes';
    }
  }

  // ------------------------------------------------------------------
  // Payment & Deposit Policy Mutations
  // ------------------------------------------------------------------

  updateAllowFullPayment(allowFullPayment: boolean): void {
    this.emitUpdated((r) => {
      r.payment.allowFullPayment = allowFullPayment;
    });
  }

  toggleDepositPolicy(enabled: boolean): void {
    this.emitUpdated((r) => {
      if (enabled) {
        const cached = this.depositPolicyCache;
        r.payment.depositPolicy = cached
          ? {
              kind: DepositPolicyKind.Enabled,
              depositCents: cached.depositCents,
              refundPolicy: { ...cached.refundPolicy },
              offlineInstructions: cached.offlineInstructions,
            }
          : {
              kind: DepositPolicyKind.Enabled,
              depositCents: 5000,
              refundPolicy: { kind: DepositRefundPolicyKind.NonRefundable },
              offlineInstructions: 'Remaining balance due in cash at registration',
            };
      } else {
        r.payment.depositPolicy = { kind: DepositPolicyKind.Disabled };
      }
    });
  }

  updateDepositModifierValue(rawMajor: string): void {
    const depositCents = this.parseMajorToCents(rawMajor);
    this.emitUpdated((r) => {
      if (r.payment.depositPolicy.kind !== DepositPolicyKind.Enabled) return;
      r.payment.depositPolicy.depositCents = depositCents;
    });
  }

  updateDepositRefundKind(kind: DepositRefundPolicyKind): void {
    this.emitUpdated((r) => {
      if (r.payment.depositPolicy.kind !== DepositPolicyKind.Enabled) return;
      if (kind === DepositRefundPolicyKind.RefundableBefore) {
        const existingDeadline =
          r.payment.depositPolicy.refundPolicy.kind === DepositRefundPolicyKind.RefundableBefore &&
          r.payment.depositPolicy.refundPolicy.deadlineDate.trim()
            ? r.payment.depositPolicy.refundPolicy.deadlineDate
            : this.depositRefundDeadlineCache || this.defaultCutoffDate();
        r.payment.depositPolicy.refundPolicy = {
          kind: DepositRefundPolicyKind.RefundableBefore,
          deadlineDate: existingDeadline,
        };
      } else {
        r.payment.depositPolicy.refundPolicy = { kind: DepositRefundPolicyKind.NonRefundable };
      }
    });
  }

  updateDepositRefundDeadline(deadlineDate: string): void {
    this.emitUpdated((r) => {
      if (
        r.payment.depositPolicy.kind !== DepositPolicyKind.Enabled ||
        r.payment.depositPolicy.refundPolicy.kind !== DepositRefundPolicyKind.RefundableBefore
      ) {
        return;
      }
      r.payment.depositPolicy.refundPolicy = {
        kind: DepositRefundPolicyKind.RefundableBefore,
        deadlineDate: deadlineDate.trim(),
      };
    });
  }

  updateDepositOfflineInstructions(offlineInstructions: string): void {
    this.emitUpdated((r) => {
      if (r.payment.depositPolicy.kind !== DepositPolicyKind.Enabled) return;
      r.payment.depositPolicy.offlineInstructions = offlineInstructions;
    });
  }

  updateAllowZeroDepositInPerson(allowZeroDepositInPerson: boolean): void {
    this.emitUpdated((r) => {
      r.payment.allowZeroDepositInPerson = allowZeroDepositInPerson;
    });
  }

  // ------------------------------------------------------------------
  // Simulator Controls & Multi-Day Template Helper
  // ------------------------------------------------------------------

  private clampSimSuboptionsIfActive(
    optionId: string,
    availableSuboptions: string[],
    maxCount: number,
  ): void {
    const activeOptionId = this.simulatedQuote().selectedOption?.option.id;
    if (activeOptionId !== optionId) return;
    const availSet = new Set(availableSuboptions);
    this.simSelectedSuboptions.update((list) =>
      list.filter((s) => availSet.has(s)).slice(0, Math.max(0, maxCount)),
    );
  }

  selectSimOption(optionId: string): void {
    this.simSelectedOptionId.set(optionId);
    this.simSelectedSuboptions.set([]);
  }

  isSimSuboptionDisabled(opt: EventRegistrationOption, suboption: string): boolean {
    if (opt.subSelection.kind !== SubSelectionKind.PickSuboptions) {
      return false;
    }
    const selected = this.simSelectedSuboptions();
    if (selected.includes(suboption)) {
      return false;
    }
    const availSet = new Set(opt.subSelection.availableSuboptions);
    const validSelectedCount = selected.filter((s) => availSet.has(s)).length;
    return validSelectedCount >= opt.subSelection.pickCount;
  }

  toggleSimSuboption(suboption: string, checked: boolean): void {
    const selectedOpt = this.simulatedQuote().selectedOption?.option;
    this.simSelectedSuboptions.update((list) => {
      if (selectedOpt?.subSelection.kind === SubSelectionKind.PickSuboptions) {
        const availSet = new Set(selectedOpt.subSelection.availableSuboptions);
        const set = new Set(list.filter((s) => availSet.has(s)));
        if (checked) {
          if (!set.has(suboption) && set.size >= selectedOpt.subSelection.pickCount) {
            return Array.from(set);
          }
          if (availSet.has(suboption)) {
            set.add(suboption);
          }
        } else {
          set.delete(suboption);
        }
        return Array.from(set);
      }

      const set = new Set(list);
      if (checked) {
        set.add(suboption);
      } else {
        set.delete(suboption);
      }
      return Array.from(set);
    });
  }

  toggleSimAddOn(addOnId: string, checked: boolean): void {
    this.simSelectedAddOnIds.update((list) => {
      const set = new Set(list);
      if (checked) {
        set.add(addOnId);
      } else {
        set.delete(addOnId);
      }
      return Array.from(set);
    });
  }

  unavailableSimAddOns = computed<{ addOn: EventAddOn; reason: string }[]>(() => {
    const quote = this.simulatedQuote();
    const r = this.rules();
    const availIds = new Set(quote.availableAddOns.map((a) => a.addOn.id));
    const selectedOptionId = quote.selectedOption?.option.id ?? '';
    const cutoff =
      r.earlyBird.kind === EarlyBirdPolicyKind.Enabled
        ? r.earlyBird.deadlineDate
        : '';

    return r.addOns
      .filter((a) => !availIds.has(a.id))
      .map((addOn) => {
        let reason = 'Not available for current selection';
        if (
          selectedOptionId &&
          !matchesRegistrationCondition(addOn.conditions.registration, selectedOptionId)
        ) {
          const allowedLabels = r.registrationOptions
            .filter((o) => matchesRegistrationCondition(addOn.conditions.registration, o.id))
            .map((o) => o.label || o.id);
          reason =
            allowedLabels.length > 0
              ? `Enabled only for: ${allowedLabels.join(', ')}`
              : 'No registration options enabled in conditions';
        } else if (
          !matchesTimingCondition(
            addOn.conditions.timing,
            quote.isEarlyBird,
            quote.isBeforeEventStart,
          )
        ) {
          if (
            addOn.conditions.timing.kind === TimingConditionKind.Window &&
            addOn.conditions.timing.window === TimingWindow.AfterEarlyBird
          ) {
            reason = cutoff
              ? `Available after Early Bird cutoff (${cutoff})`
              : 'Available after Early Bird cutoff';
          } else if (
            addOn.conditions.timing.kind === TimingConditionKind.Window &&
            addOn.conditions.timing.window === TimingWindow.BeforeEventStart
          ) {
            reason = 'Unavailable once event starts';
          } else {
            reason = cutoff ? `Early Bird only (cutoff ${cutoff})` : 'Early Bird only';
          }
        } else if (addOn.conditions.who.kind === WhoConditionKind.Status) {
          reason =
            addOn.conditions.who.status === PersonStatusKind.Instructor
              ? 'Active ILC Instructors only'
              : 'Active ILC Members only';
        }
        return { addOn, reason };
      });
  });

  addOnKindBadge(addOn: EventAddOn): string {
    switch (addOn.spec.kind) {
      case EventAddOnKind.EventRecording:
        return 'Recording';
      case EventAddOnKind.CatalogVideo:
        return 'Catalog Video';
      case EventAddOnKind.CatalogSeries:
        return 'VOD Series';
      case EventAddOnKind.Other:
        return '';
    }
  }

  getSimQuestionText(questionId: string): string {
    return this.simQuestionAnswers()[questionId]?.answerText ?? '';
  }

  getSimQuestionSelectedOptions(questionId: string): string[] {
    return this.simQuestionAnswers()[questionId]?.selectedOptions ?? [];
  }

  updateSimQuestionText(questionId: string, answerText: string): void {
    this.simQuestionAnswers.update((prev) => ({
      ...prev,
      [questionId]: {
        answerText,
        selectedOptions: prev[questionId]?.selectedOptions ?? [],
      },
    }));
  }

  updateSimQuestionSelect(questionId: string, selectedValue: string): void {
    this.simQuestionAnswers.update((prev) => ({
      ...prev,
      [questionId]: {
        answerText: selectedValue,
        selectedOptions: [],
      },
    }));
  }

  toggleSimQuestionCheckbox(questionId: string, option: string, checked: boolean): void {
    this.simQuestionAnswers.update((prev) => {
      const existing = prev[questionId]?.selectedOptions ?? [];
      const set = new Set(existing);
      if (checked) {
        set.add(option);
      } else {
        set.delete(option);
      }
      return {
        ...prev,
        [questionId]: {
          answerText: prev[questionId]?.answerText ?? '',
          selectedOptions: Array.from(set),
        },
      };
    });
  }

  simQuestionValidation = computed(() => {
    const quote = this.simulatedQuote();
    const answersMap = this.simQuestionAnswers();
    const submittedAnswers: QuestionAnswerInput[] = Object.entries(answersMap).map(
      ([questionId, val]) => ({
        questionId,
        answerText: val.answerText,
        selectedOptions: val.selectedOptions,
      }),
    );
    return validateAndBuildQuestionResponses({
      applicableQuestions: quote.applicableQuestions,
      submittedAnswers,
      existingResponses: [],
    });
  });

  unavailableSimQuestions = computed<{ question: EventRegistrationQuestion; reason: string }[]>(
    () => {
      const quote = this.simulatedQuote();
      const r = this.rules();
      const availIds = new Set(quote.applicableQuestions.map((q) => q.id));
      const selectedOptionId = quote.selectedOption?.option.id ?? '';
      const cutoff =
        r.earlyBird.kind === EarlyBirdPolicyKind.Enabled
          ? r.earlyBird.deadlineDate
          : '';

      return r.questions
        .filter((q) => !availIds.has(q.id))
        .map((question) => {
          let reason = 'Not asked for current selection';
          if (
            selectedOptionId &&
            !matchesRegistrationCondition(question.conditions.registration, selectedOptionId)
          ) {
            const allowedLabels = r.registrationOptions
              .filter((o) => matchesRegistrationCondition(question.conditions.registration, o.id))
              .map((o) => o.label || o.id);
            reason =
              allowedLabels.length > 0
                ? `Asked only for: ${allowedLabels.join(', ')}`
                : 'No registration options enabled in conditions';
          } else if (
            !matchesTimingCondition(
              question.conditions.timing,
              quote.isEarlyBird,
              quote.isBeforeEventStart,
            )
          ) {
            if (
              question.conditions.timing.kind === TimingConditionKind.Window &&
              question.conditions.timing.window === TimingWindow.AfterEarlyBird
            ) {
              reason = cutoff
                ? `Asked after Early Bird cutoff (${cutoff})`
                : 'Asked after Early Bird cutoff';
            } else if (
              question.conditions.timing.kind === TimingConditionKind.Window &&
              question.conditions.timing.window === TimingWindow.BeforeEventStart
            ) {
              reason = 'Not asked once event starts';
            } else {
              reason = cutoff ? `Early Bird only (cutoff ${cutoff})` : 'Early Bird only';
            }
          } else if (question.conditions.who.kind === WhoConditionKind.Status) {
            reason =
              question.conditions.who.status === PersonStatusKind.Instructor
                ? 'Active ILC Instructors only'
                : 'Active ILC Members only';
          }
          return { question, reason };
        });
    },
  );

  private shiftIsoDateDays(isoDate: string, deltaDays: number): string {
    const clean = isoDate.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return '';
    const ms = Date.parse(`${clean}T00:00:00Z`);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms + deltaDays * 24 * 3600_000).toISOString().slice(0, 10);
  }

  simDatePresets = computed<SimDatePreset[]>(() => {
    const presets: SimDatePreset[] = [
      { id: 'today', label: 'Today', date: getAnywhereOnEarthDate() },
    ];
    const r = this.rules();
    const earlyDeadline =
      r.earlyBird.kind === EarlyBirdPolicyKind.Enabled
        ? r.earlyBird.deadlineDate.trim().slice(0, 10)
        : '';
    const hasEarly = /^\d{4}-\d{2}-\d{2}$/.test(earlyDeadline);
    const rawStart = this.eventStartDate().trim().slice(0, 10);
    const hasStart = /^\d{4}-\d{2}-\d{2}$/.test(rawStart);

    if (hasEarly && hasStart) {
      const dayBeforeEb = this.shiftIsoDateDays(earlyDeadline, -1);
      const dayBeforeStart = this.shiftIsoDateDays(rawStart, -1);
      const beforeEbDate =
        dayBeforeStart && dayBeforeEb >= rawStart ? dayBeforeStart : dayBeforeEb;
      if (beforeEbDate) {
        presets.push({
          id: 'before_early_bird',
          label: 'Before Early Bird',
          date: beforeEbDate,
        });
      }

      const dayAfterEb = this.shiftIsoDateDays(earlyDeadline, 1);
      if (dayAfterEb && dayAfterEb < rawStart) {
        presets.push({
          id: 'after_eb_before_start',
          label: 'After Early Bird, Before Start',
          date: dayAfterEb,
        });
      } else {
        if (dayAfterEb) {
          presets.push({
            id: 'after_early_bird',
            label: 'After Early Bird',
            date: dayAfterEb,
          });
        }
        if (dayBeforeStart && dayBeforeStart !== beforeEbDate) {
          presets.push({
            id: 'before_start',
            label: 'Before Start',
            date: dayBeforeStart,
          });
        }
      }

      const dayAfterStart = this.shiftIsoDateDays(rawStart, 1);
      if (dayAfterStart) {
        presets.push({
          id: 'after_start',
          label: 'After Start',
          date: dayAfterStart,
        });
      }
    } else if (hasEarly) {
      const beforeEb = this.shiftIsoDateDays(earlyDeadline, -1);
      const afterEb = this.shiftIsoDateDays(earlyDeadline, 1);
      if (beforeEb) {
        presets.push({ id: 'before_early_bird', label: 'Before Early Bird', date: beforeEb });
      }
      if (afterEb) {
        presets.push({ id: 'after_early_bird', label: 'After Early Bird', date: afterEb });
      }
    } else if (hasStart) {
      const beforeStart = this.shiftIsoDateDays(rawStart, -1);
      const afterStart = this.shiftIsoDateDays(rawStart, 1);
      if (beforeStart) {
        presets.push({ id: 'before_start', label: 'Before Start', date: beforeStart });
      }
      if (afterStart) {
        presets.push({ id: 'after_start', label: 'After Start', date: afterStart });
      }
    }

    return presets;
  });

  setSimDateToday(): void {
    this.simDateAoE.set(getAnywhereOnEarthDate());
  }

  setSimDateAfterDeadline(deadlineDate: string): void {
    const nextDay = this.shiftIsoDateDays(deadlineDate, 1);
    if (!nextDay) return;
    this.simDateAoE.set(nextDay);
  }

  loadMultiDayIntensiveExample(): void {
    const r = this.rules();
    const isNonEmpty =
      r.registrationOptions.some((o) => o.priceCents > 0) ||
      r.capacities.length > 0 ||
      r.registrationOptions.length > 1 ||
      r.discounts.length > 0 ||
      r.addOns.length > 0 ||
      r.questions.length > 0;
    if (
      isNonEmpty &&
      typeof window !== 'undefined' &&
      window.confirm &&
      !window.confirm('Replace current pricing rules with the 4-Day Intensive Workshop example?')
    ) {
      return;
    }

    let deadlineDate = '2026-12-31';
    let exampleSimDate = '2026-12-15';
    const evStart = this.eventStartDate().slice(0, 10);
    if (evStart.length === 10 && evStart <= deadlineDate) {
      const startMs = Date.parse(`${evStart}T00:00:00Z`);
      if (Number.isFinite(startMs)) {
        deadlineDate = new Date(startMs - 14 * 24 * 3600_000).toISOString().slice(0, 10);
        exampleSimDate = new Date(startMs - 28 * 24 * 3600_000).toISOString().slice(0, 10);
      }
    }

    const example: EventPricingRules = {
      capacities: [
        {
          id: 'training_hall',
          label: 'Main Training Hall',
          description: 'Maximum in-person floor spots',
          limit: 30,
        },
      ],
      earlyBird: {
        kind: EarlyBirdPolicyKind.Enabled,
        deadlineDate,
      },
      registrationOptions: [
        initEventRegistrationOption({
          id: 'full_workshop',
          label: 'Full Workshop, Fri - Mon',
          description: 'All 4 days of training',
          attendanceType: AttendanceType.InPerson,
          conditions: initEventRuleConditions(),
          capacityUsage: { training_hall: 1 },
          subSelection: { kind: SubSelectionKind.None },
          priceCents: 49000,
        }),
        initEventRegistrationOption({
          id: 'two_days',
          label: 'Two Days (any two of Fri, Sat, Sun)',
          description: 'Choose any two full days',
          attendanceType: AttendanceType.InPerson,
          conditions: initEventRuleConditions(),
          capacityUsage: { training_hall: 1 },
          subSelection: {
            kind: SubSelectionKind.PickSuboptions,
            availableSuboptions: ['Friday', 'Saturday', 'Sunday'],
            pickCount: 2,
          },
          priceCents: 33000,
        }),
        initEventRegistrationOption({
          id: 'single_day',
          label: 'Single Day (Fri, Sat or Sun)',
          description: 'Choose one full day',
          attendanceType: AttendanceType.InPerson,
          conditions: initEventRuleConditions(),
          capacityUsage: { training_hall: 1 },
          subSelection: {
            kind: SubSelectionKind.PickSuboptions,
            availableSuboptions: ['Friday', 'Saturday', 'Sunday'],
            pickCount: 1,
          },
          priceCents: 18000,
        }),
        initEventRegistrationOption({
          id: 'mon_half_day',
          label: 'Monday Half Day',
          description: 'Monday morning session',
          attendanceType: AttendanceType.InPerson,
          conditions: initEventRuleConditions(),
          capacityUsage: { training_hall: 1 },
          subSelection: { kind: SubSelectionKind.None },
          priceCents: 5000,
        }),
        initEventRegistrationOption({
          id: 'recording_only',
          label: 'Intensive Video Recording Only',
          description: 'Pre-order event videos independently (not attending in person)',
          attendanceType: AttendanceType.VideoOnly,
          conditions: initEventRuleConditions(),
          capacityUsage: {},
          subSelection: { kind: SubSelectionKind.None },
          priceCents: 9000,
        }),
      ],
      discounts: [
        initEventDiscount({
          id: 'eb_full_workshop',
          label: 'Early Bird Discount (Full Workshop)',
          discountCents: 5000,
          conditions: initEventRuleConditions({
            timing: {
              kind: TimingConditionKind.Window,
              window: TimingWindow.OnOrBeforeEarlyBird,
            },
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_workshop'],
            },
          }),
        }),
        initEventDiscount({
          id: 'eb_two_days',
          label: 'Early Bird Discount (Two Days)',
          discountCents: 3000,
          conditions: initEventRuleConditions({
            timing: {
              kind: TimingConditionKind.Window,
              window: TimingWindow.OnOrBeforeEarlyBird,
            },
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['two_days'],
            },
          }),
        }),
        initEventDiscount({
          id: 'member_discount',
          label: 'ILC Member Discount',
          discountCents: 4000,
          conditions: initEventRuleConditions({
            who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_workshop', 'two_days'],
            },
          }),
        }),
        initEventDiscount({
          id: 'instructor_discount',
          label: 'Extra Instructor Discount',
          discountCents: 4000,
          conditions: initEventRuleConditions({
            who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_workshop', 'two_days'],
            },
          }),
        }),
      ],
      addOns: [
        initEventAddOn({
          id: 'eb_free_videos',
          label: 'Intensive Videos (Early Bird Bonus)',
          description: 'All intensive videos FREE with Early Bird registration for the Full Workshop',
          spec: { kind: EventAddOnKind.EventRecording },
          conditions: initEventRuleConditions({
            timing: {
              kind: TimingConditionKind.Window,
              window: TimingWindow.OnOrBeforeEarlyBird,
            },
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_workshop'],
            },
          }),
          priceCents: 0,
        }),
        initEventAddOn({
          id: 'eb_video_review',
          label: 'Personal Video Review',
          description: 'Early Bird add-on for Full Workshop participants',
          spec: { kind: EventAddOnKind.Other },
          conditions: initEventRuleConditions({
            timing: {
              kind: TimingConditionKind.Window,
              window: TimingWindow.OnOrBeforeEarlyBird,
            },
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_workshop'],
            },
          }),
          priceCents: 2500,
        }),
        initEventAddOn({
          id: 'videos_and_review_combo',
          label: 'Intensive Videos + 1 Personal Video Review',
          description: 'Standard video package after Early Bird ends',
          spec: { kind: EventAddOnKind.EventRecording },
          conditions: initEventRuleConditions({
            timing: {
              kind: TimingConditionKind.Window,
              window: TimingWindow.AfterEarlyBird,
            },
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_workshop', 'two_days', 'single_day', 'mon_half_day'],
            },
          }),
          priceCents: 7500,
        }),
      ],
      questions: [
        initEventRegistrationQuestion({
          id: 'dietary_notes',
          label: 'Dietary or Medical Notes',
          description:
            'Optional allergies, dietary needs, or injuries instructors should know about',
          required: false,
          spec: {
            kind: RegistrationQuestionKind.ShortText,
            placeholder: 'e.g. Vegetarian, knee injury',
          },
          conditions: initEventRuleConditions({
            registration: {
              kind: RegistrationConditionKind.SpecificOptions,
              optionIds: ['full_workshop', 'two_days', 'single_day', 'mon_half_day'],
            },
          }),
        }),
        initEventRegistrationQuestion({
          id: 'training_focus',
          label: 'Primary Training Focus',
          description: 'Select any areas you are most interested in exploring during the workshop',
          required: false,
          spec: {
            kind: RegistrationQuestionKind.Checkboxes,
            options: ['Spinning Hands', 'Sticky Hands', 'Chin Na', 'Applications'],
          },
          conditions: initEventRuleConditions(),
        }),
      ],
      payment: {
        allowFullPayment: true,
        depositPolicy: {
          kind: DepositPolicyKind.Enabled,
          depositCents: 5000,
          refundPolicy: { kind: DepositRefundPolicyKind.NonRefundable },
          offlineInstructions: 'the rest by cash/check at registration on Friday',
        },
        allowZeroDepositInPerson: false,
      },
    };

    this.syncValueCachesFromRules(example);
    this.rulesChange.emit(example);
    this.simRole.set(SimulatedPersonRole.Public);
    this.simDateAoE.set(exampleSimDate);
    this.simCapacityCounts.set({});
    this.simSelectedOptionId.set('full_workshop');
    this.simSelectedSuboptions.set([]);
    this.simSelectedAddOnIds.set(['eb_free_videos', 'eb_video_review']);
    this.simQuestionAnswers.set({});
  }
}
