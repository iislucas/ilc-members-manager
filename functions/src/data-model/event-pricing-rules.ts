/* event-pricing-rules.ts
 *
 * Compositional rule-based event pricing, named capacities, shared rule conditions,
 * unified discounts, & add-ons data model and pure quote evaluator.
 *
 * All monetary amounts, discounts, and deposits in this module are fixed
 * non-negative integer minor units (cents). Conditional structures use explicit
 * discriminated unions ({ kind: ... }) rather than nullable/optional fields,
 * and option/capacity/discount/add-on list membership defines active items and
 * display order directly.
 */

import { AttendanceType } from './events';
import {
  getMemberStatusLevel,
  MemberStatusContext,
  MemberStatusLevel,
  satisfiesMemberStatusLevel,
} from './member-status';

// Product-level Early Bird pricing cutoff policy (evaluated Anywhere-on-Earth UTC-12).
export enum EarlyBirdPolicyKind {
  Disabled = 'disabled',
  Enabled = 'enabled',
}

export type EarlyBirdPolicy =
  | { kind: EarlyBirdPolicyKind.Disabled }
  | {
      kind: EarlyBirdPolicyKind.Enabled;
      // Inclusive YYYY-MM-DD deadline; Early Bird pricing holds while AoE date <= deadlineDate.
      deadlineDate: string;
    };

// ------------------------------------------------------------------
// Shared Compositional Conditions (max one per axis; zero optional fields)
// ------------------------------------------------------------------

// Condition Axis 1: Who the rule applies to (Members or Instructors).
export enum WhoConditionKind {
  Anyone = 'anyone',
  Status = 'status',
}

// Person status categories. Note: Active ILC Instructors also satisfy ActiveMember (MemberStatusLevel invariant).
export enum PersonStatusKind {
  Member = 'member',
  Instructor = 'instructor',
}

export type WhoCondition =
  | { kind: WhoConditionKind.Anyone }
  | { kind: WhoConditionKind.Status; status: PersonStatusKind };

// Condition Axis 2: Timing condition (Early Bird cutoff window or Before Event starts).
export enum TimingConditionKind {
  Anytime = 'anytime',
  Window = 'window',
}

export enum TimingWindow {
  BeforeEarlyBird = 'before_early_bird',
  BeforeEventStart = 'before_event_start',
}

export type TimingCondition =
  | { kind: TimingConditionKind.Anytime }
  | { kind: TimingConditionKind.Window; window: TimingWindow };

// Condition Axis 3: Registration condition (explicit scope over Registration Options;
// implicit / AllOptions when the condition belongs to a Registration Option itself).
export enum RegistrationConditionKind {
  AllOptions = 'all_options',
  SpecificOptions = 'specific_options',
}

export type RegistrationCondition =
  | { kind: RegistrationConditionKind.AllOptions }
  | { kind: RegistrationConditionKind.SpecificOptions; optionIds: string[] };

// Shared condition set used across Registration Options, Discounts, Event Add-Ons, and Form Questions.
export interface EventRuleConditions {
  who: WhoCondition;
  timing: TimingCondition;
  registration: RegistrationCondition;
}

// Whether selecting a Registration Option requires choosing suboptions (e.g. specific days, sessions, tracks).
export enum SubSelectionKind {
  None = 'none',
  PickSuboptions = 'pick_suboptions',
}

export type SubSelectionRule =
  | { kind: SubSelectionKind.None }
  | {
      kind: SubSelectionKind.PickSuboptions;
      availableSuboptions: string[];
      pickCount: number;
    };

// Explicit target/type of an Event Add-On.
export enum EventAddOnKind {
  // Grants access to THIS event's recording (Product.recordedVideoId / IlcEvent.recordedVideoId),
  // including when sold before filming/upload and linked by HQ after the event.
  EventRecording = 'event_recording',
  // Grants access to a specific existing /videos/{videoId} item in the VOD catalog.
  CatalogVideo = 'catalog_video',
  // Grants access to a specific existing VOD series (seriesId) in /videos.
  CatalogSeries = 'catalog_series',
  // General add-on carrying only label and description (e.g. Personal Video Review).
  Other = 'other',
}

export type EventAddOnSpec =
  | { kind: EventAddOnKind.EventRecording }
  | { kind: EventAddOnKind.CatalogVideo; videoId: string }
  | { kind: EventAddOnKind.CatalogSeries; seriesId: string }
  | { kind: EventAddOnKind.Other };

// Whether an online deposit is non-refundable or refundable before a specific date (AoE UTC-12).
export enum DepositRefundPolicyKind {
  NonRefundable = 'non_refundable',
  RefundableBefore = 'refundable_before',
}

export type DepositRefundPolicy =
  | { kind: DepositRefundPolicyKind.NonRefundable }
  | {
      kind: DepositRefundPolicyKind.RefundableBefore;
      // Inclusive YYYY-MM-DD deadline (evaluated Anywhere-on-Earth UTC-12).
      deadlineDate: string;
    };

// Explicit deposit policy for paying a deposit online now and cash balance at the door.
export enum DepositPolicyKind {
  Disabled = 'disabled',
  Enabled = 'enabled',
}

export type DepositPolicy =
  | { kind: DepositPolicyKind.Disabled }
  | {
      kind: DepositPolicyKind.Enabled;
      depositCents: number;
      refundPolicy: DepositRefundPolicy;
      offlineInstructions: string;
    };

// How the attendee settles payment at checkout.
export enum PaymentChoice {
  Full = 'full',
  Deposit = 'deposit',
  PayAtDoor = 'pay_at_door',
}

// A named shared resource limit on an event (e.g. "Friday Participants" = 25, "Main Hall" = 40).
export interface EventCapacity {
  id: string;
  label: string;
  description: string;
  limit: number;
}

// One exclusive registration option priced directly at priceCents, gated by eligibility conditions.
export interface EventRegistrationOption {
  id: string;
  label: string;
  description: string;
  attendanceType: AttendanceType;
  conditions: EventRuleConditions;
  // Non-negative integer units consumed from each EventCapacity.id (missing or 0 = uses none).
  capacityUsage: Record<string, number>;
  subSelection: SubSelectionRule;
  priceCents: number;
}

// Registration discount whose conditions are evaluated compositionally; all matching discounts sum together.
export interface EventDiscount {
  id: string;
  label: string;
  discountCents: number;
  conditions: EventRuleConditions;
}

// Event Add-On gated by shared eligibility conditions, with explicit spec and fixed priceCents.
export interface EventAddOn {
  id: string;
  label: string;
  description: string;
  spec: EventAddOnSpec;
  conditions: EventRuleConditions;
  priceCents: number;
}

// ------------------------------------------------------------------
// Registration Form Questions & Attendee Responses (zero optional fields)
// ------------------------------------------------------------------

export enum RegistrationQuestionKind {
  ShortText = 'short_text',
  LongText = 'long_text',
  Select = 'select',
  Checkboxes = 'checkboxes',
}

export type RegistrationQuestionSpec =
  | { kind: RegistrationQuestionKind.ShortText; placeholder: string }
  | { kind: RegistrationQuestionKind.LongText; placeholder: string }
  | { kind: RegistrationQuestionKind.Select; options: string[] }
  | { kind: RegistrationQuestionKind.Checkboxes; options: string[] };

export interface EventRegistrationQuestion {
  id: string;
  label: string;
  description: string;
  required: boolean;
  spec: RegistrationQuestionSpec;
  conditions: EventRuleConditions;
}

export interface EventRegistrationQuestionResponse {
  questionId: string;
  questionLabel: string;
  kind: RegistrationQuestionKind;
  answerText: string;
  selectedOptions: string[];
}

export interface QuestionAnswerInput {
  questionId: string;
  answerText: string;
  selectedOptions: string[];
}

export const MAX_SHORT_TEXT_ANSWER_LENGTH = 300;
export const MAX_LONG_TEXT_ANSWER_LENGTH = 1500;
const STRIPE_METADATA_CHUNK_LENGTH = 450;
const MAX_STRIPE_METADATA_CHUNKS = 14;

export interface EventPaymentRules {
  allowFullPayment: boolean;
  depositPolicy: DepositPolicy;
  allowZeroDepositInPerson: boolean;
}

export interface EventPricingRules {
  capacities: EventCapacity[];
  earlyBird: EarlyBirdPolicy;
  registrationOptions: EventRegistrationOption[];
  discounts: EventDiscount[];
  addOns: EventAddOn[];
  questions: EventRegistrationQuestion[];
  payment: EventPaymentRules;
}

// ------------------------------------------------------------------
// Initializers & Firestore Normalizers
// ------------------------------------------------------------------

function clampNonNegativeInt(val: unknown): number {
  const num = typeof val === 'number' && Number.isFinite(val) ? Math.round(val) : 0;
  return Math.max(0, num);
}

// Reads either a plain integer cents field or legacy { value } object if present.
function readCentsOrLegacyObject(primary: unknown, legacyObj?: unknown): number {
  if (typeof primary === 'number') {
    return clampNonNegativeInt(primary);
  }
  if (legacyObj && typeof legacyObj === 'object') {
    return clampNonNegativeInt((legacyObj as Record<string, unknown>)['value']);
  }
  return 0;
}

function asTrimmedString(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

function asString(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

export function normalizeCapacityMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    const units = clampNonNegativeInt(val);
    if (units > 0) {
      result[cleanKey] = units;
    }
  }
  return result;
}

export function initEventCapacity(overrides: Partial<EventCapacity> = {}): EventCapacity {
  return {
    id: overrides.id ?? 'venue_capacity',
    label: overrides.label ?? 'In-Person Participants',
    description: overrides.description ?? '',
    limit: overrides.limit !== undefined ? Math.max(1, clampNonNegativeInt(overrides.limit)) : 30,
  };
}

export function normalizeEventCapacity(raw: unknown, fallbackIndex = 0): EventCapacity {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawLimit = clampNonNegativeInt(obj['limit']);
  return {
    id: asTrimmedString(obj['id']) || `capacity_${fallbackIndex + 1}`,
    label: asString(obj['label']),
    description: asString(obj['description']),
    limit: Math.max(1, rawLimit || 1),
  };
}

export function normalizeEarlyBirdPolicy(raw: unknown): EarlyBirdPolicy {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (obj['kind'] === EarlyBirdPolicyKind.Enabled) {
    return {
      kind: EarlyBirdPolicyKind.Enabled,
      deadlineDate: asTrimmedString(obj['deadlineDate']),
    };
  }
  return { kind: EarlyBirdPolicyKind.Disabled };
}

function normalizePersonStatusKind(raw: unknown): PersonStatusKind {
  if (raw === PersonStatusKind.Instructor) return PersonStatusKind.Instructor;
  return PersonStatusKind.Member;
}

export function normalizeWhoCondition(raw: unknown): WhoCondition {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (
    obj['kind'] === WhoConditionKind.Status &&
    (obj['status'] === PersonStatusKind.Member || obj['status'] === PersonStatusKind.Instructor)
  ) {
    return {
      kind: WhoConditionKind.Status,
      status: normalizePersonStatusKind(obj['status']),
    };
  }
  return { kind: WhoConditionKind.Anyone };
}

export function normalizeTimingCondition(
  raw: unknown,
  legacyEarlyBird?: unknown,
  legacyEventStart?: unknown,
): TimingCondition {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj['kind'] === TimingConditionKind.Window) {
      const win = obj['window'];
      if (win === 'after_early_bird' || win === 'after_cutoff') {
        return { kind: TimingConditionKind.Anytime };
      }
      const window =
        win === TimingWindow.BeforeEventStart
          ? TimingWindow.BeforeEventStart
          : TimingWindow.BeforeEarlyBird;
      return {
        kind: TimingConditionKind.Window,
        window,
      };
    }
    return { kind: TimingConditionKind.Anytime };
  }

  // Transparent migration from legacy separate earlyBird / eventStart condition fields
  if (legacyEarlyBird && typeof legacyEarlyBird === 'object') {
    const eb = legacyEarlyBird as Record<string, unknown>;
    if (eb['kind'] === 'window') {
      if (eb['window'] === 'after_cutoff') {
        return { kind: TimingConditionKind.Anytime };
      }
      return {
        kind: TimingConditionKind.Window,
        window: TimingWindow.BeforeEarlyBird,
      };
    }
  }
  if (legacyEventStart && typeof legacyEventStart === 'object') {
    const es = legacyEventStart as Record<string, unknown>;
    if (es['kind'] === 'before_event_start') {
      return {
        kind: TimingConditionKind.Window,
        window: TimingWindow.BeforeEventStart,
      };
    }
  }
  return { kind: TimingConditionKind.Anytime };
}

export function normalizeRegistrationCondition(raw: unknown): RegistrationCondition {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (obj['kind'] === RegistrationConditionKind.SpecificOptions) {
    const rawIds = Array.isArray(obj['optionIds']) ? obj['optionIds'] : [];
    const optionIds = Array.from(
      new Set(rawIds.map((id) => asTrimmedString(id)).filter(Boolean)),
    );
    return {
      kind: RegistrationConditionKind.SpecificOptions,
      optionIds,
    };
  }
  return { kind: RegistrationConditionKind.AllOptions };
}

export function initEventRuleConditions(
  overrides: Partial<EventRuleConditions> = {},
): EventRuleConditions {
  return {
    who: overrides.who ? normalizeWhoCondition(overrides.who) : { kind: WhoConditionKind.Anyone },
    timing: overrides.timing
      ? normalizeTimingCondition(overrides.timing)
      : { kind: TimingConditionKind.Anytime },
    registration: overrides.registration
      ? normalizeRegistrationCondition(overrides.registration)
      : { kind: RegistrationConditionKind.AllOptions },
  };
}

export function normalizeEventRuleConditions(
  raw: unknown,
  allowRegistrationCondition = true,
): EventRuleConditions {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    who: normalizeWhoCondition(obj['who']),
    timing: normalizeTimingCondition(obj['timing'], obj['earlyBird'], obj['eventStart']),
    registration: allowRegistrationCondition
      ? normalizeRegistrationCondition(obj['registration'] ?? obj['optionScope'])
      : { kind: RegistrationConditionKind.AllOptions },
  };
}

// Converts legacy eligibility string ('anyone' | 'members' | 'instructors') or requireActiveMembership flag to WhoCondition.
export function legacyEligibilityToWhoCondition(
  rawEligibility: unknown,
  legacyRequireActiveMembership?: unknown,
): WhoCondition {
  if (rawEligibility === 'instructors') {
    return { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor };
  }
  if (rawEligibility === 'members') {
    return { kind: WhoConditionKind.Status, status: PersonStatusKind.Member };
  }
  if (rawEligibility === 'anyone') {
    return { kind: WhoConditionKind.Anyone };
  }
  if (Boolean(legacyRequireActiveMembership)) {
    return { kind: WhoConditionKind.Status, status: PersonStatusKind.Member };
  }
  return { kind: WhoConditionKind.Anyone };
}

export function normalizeSubSelectionRule(raw: unknown): SubSelectionRule {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (obj['kind'] === SubSelectionKind.PickSuboptions) {
    const rawSubs = Array.isArray(obj['availableSuboptions']) ? obj['availableSuboptions'] : [];
    const availableSuboptions = Array.from(
      new Set(rawSubs.map((s) => asTrimmedString(s)).filter(Boolean)),
    );
    const maxPick = availableSuboptions.length > 0 ? availableSuboptions.length : 1;
    const rawPick = clampNonNegativeInt(obj['pickCount']);
    const pickCount = Math.min(maxPick, Math.max(1, rawPick || 1));
    return {
      kind: SubSelectionKind.PickSuboptions,
      availableSuboptions,
      pickCount,
    };
  }
  return { kind: SubSelectionKind.None };
}

export function normalizeEventAddOnSpec(raw: unknown): EventAddOnSpec {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (obj['kind']) {
    case EventAddOnKind.EventRecording:
      return { kind: EventAddOnKind.EventRecording };
    case EventAddOnKind.CatalogVideo:
      return {
        kind: EventAddOnKind.CatalogVideo,
        videoId: asTrimmedString(obj['videoId']),
      };
    case EventAddOnKind.CatalogSeries:
      return {
        kind: EventAddOnKind.CatalogSeries,
        seriesId: asTrimmedString(obj['seriesId']),
      };
    case EventAddOnKind.Other:
    default:
      return { kind: EventAddOnKind.Other };
  }
}

export function normalizeDepositRefundPolicy(raw: unknown): DepositRefundPolicy {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (obj['kind'] === DepositRefundPolicyKind.RefundableBefore) {
    return {
      kind: DepositRefundPolicyKind.RefundableBefore,
      deadlineDate: asTrimmedString(obj['deadlineDate']),
    };
  }
  return { kind: DepositRefundPolicyKind.NonRefundable };
}

export function normalizeDepositPolicy(raw: unknown): DepositPolicy {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (obj['kind'] === DepositPolicyKind.Enabled) {
    return {
      kind: DepositPolicyKind.Enabled,
      depositCents: readCentsOrLegacyObject(obj['depositCents'], obj['deposit']),
      refundPolicy: normalizeDepositRefundPolicy(obj['refundPolicy']),
      offlineInstructions: asString(obj['offlineInstructions']),
    };
  }
  return { kind: DepositPolicyKind.Disabled };
}

function normalizeAttendanceType(raw: unknown): AttendanceType {
  if (raw === AttendanceType.Online) return AttendanceType.Online;
  if (raw === AttendanceType.InPersonAndOnline) return AttendanceType.InPersonAndOnline;
  if (raw === AttendanceType.VideoOnly) return AttendanceType.VideoOnly;
  return AttendanceType.InPerson;
}

export function initEventRegistrationOption(
  overrides: Partial<EventRegistrationOption> = {},
): EventRegistrationOption {
  const conditions = overrides.conditions
    ? normalizeEventRuleConditions(overrides.conditions, false)
    : initEventRuleConditions();
  return {
    id: overrides.id ?? 'full_event',
    label: overrides.label ?? 'Full Event',
    description: overrides.description ?? '',
    attendanceType: overrides.attendanceType ?? AttendanceType.InPerson,
    conditions,
    capacityUsage: overrides.capacityUsage ? normalizeCapacityMap(overrides.capacityUsage) : {},
    subSelection: overrides.subSelection
      ? normalizeSubSelectionRule(overrides.subSelection)
      : { kind: SubSelectionKind.None },
    priceCents: clampNonNegativeInt(overrides.priceCents ?? 0),
  };
}

export function initEventDiscount(overrides: Partial<EventDiscount> = {}): EventDiscount {
  return {
    id: overrides.id ?? 'discount_1',
    label: overrides.label ?? 'Registration Discount',
    discountCents: clampNonNegativeInt(overrides.discountCents ?? 0),
    conditions: overrides.conditions
      ? normalizeEventRuleConditions(overrides.conditions, true)
      : initEventRuleConditions(),
  };
}

export function initEventAddOn(overrides: Partial<EventAddOn> = {}): EventAddOn {
  return {
    id: overrides.id ?? 'event_recording',
    label: overrides.label ?? 'Event Video Recording',
    description: overrides.description ?? '',
    spec: overrides.spec
      ? normalizeEventAddOnSpec(overrides.spec)
      : { kind: EventAddOnKind.EventRecording },
    conditions: overrides.conditions
      ? normalizeEventRuleConditions(overrides.conditions, true)
      : initEventRuleConditions(),
    priceCents: clampNonNegativeInt(overrides.priceCents ?? 0),
  };
}

export function normalizeRegistrationQuestionSpec(raw: unknown): RegistrationQuestionSpec {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (obj['kind']) {
    case RegistrationQuestionKind.LongText:
      return {
        kind: RegistrationQuestionKind.LongText,
        placeholder: asString(obj['placeholder']),
      };
    case RegistrationQuestionKind.Select: {
      const rawOpts = Array.isArray(obj['options']) ? obj['options'] : [];
      const options = Array.from(
        new Set(rawOpts.map((item) => asTrimmedString(item)).filter(Boolean)),
      );
      return {
        kind: RegistrationQuestionKind.Select,
        options,
      };
    }
    case RegistrationQuestionKind.Checkboxes: {
      const rawOpts = Array.isArray(obj['options']) ? obj['options'] : [];
      const options = Array.from(
        new Set(rawOpts.map((item) => asTrimmedString(item)).filter(Boolean)),
      );
      return {
        kind: RegistrationQuestionKind.Checkboxes,
        options,
      };
    }
    case RegistrationQuestionKind.ShortText:
    default:
      return {
        kind: RegistrationQuestionKind.ShortText,
        placeholder: asString(obj['placeholder']),
      };
  }
}

export function initEventRegistrationQuestion(
  overrides: Partial<EventRegistrationQuestion> = {},
): EventRegistrationQuestion {
  return {
    id: overrides.id ?? 'question_1',
    label: overrides.label ?? '',
    description: overrides.description ?? '',
    required: overrides.required !== undefined ? Boolean(overrides.required) : true,
    spec: overrides.spec
      ? normalizeRegistrationQuestionSpec(overrides.spec)
      : { kind: RegistrationQuestionKind.ShortText, placeholder: '' },
    conditions: overrides.conditions
      ? normalizeEventRuleConditions(overrides.conditions, true)
      : initEventRuleConditions(),
  };
}

export function normalizeEventRegistrationQuestion(
  raw: unknown,
  fallbackIndex = 0,
): EventRegistrationQuestion {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id: asTrimmedString(obj['id']) || `question_${fallbackIndex + 1}`,
    label: asString(obj['label']),
    description: asString(obj['description']),
    required: obj['required'] !== undefined ? Boolean(obj['required']) : true,
    spec: normalizeRegistrationQuestionSpec(obj['spec']),
    conditions: normalizeEventRuleConditions(obj['conditions'], true),
  };
}

export function normalizeEventRegistrationQuestionResponse(
  raw: unknown,
): EventRegistrationQuestionResponse | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const questionId = asTrimmedString(obj['questionId']);
  if (!questionId) {
    return null;
  }
  const rawKind = obj['kind'];
  const kind: RegistrationQuestionKind =
    rawKind === RegistrationQuestionKind.LongText
      ? RegistrationQuestionKind.LongText
      : rawKind === RegistrationQuestionKind.Select
        ? RegistrationQuestionKind.Select
        : rawKind === RegistrationQuestionKind.Checkboxes
          ? RegistrationQuestionKind.Checkboxes
          : RegistrationQuestionKind.ShortText;

  const rawSelected = Array.isArray(obj['selectedOptions']) ? obj['selectedOptions'] : [];
  const selectedOptions = Array.from(
    new Set(rawSelected.map((s) => asTrimmedString(s)).filter(Boolean)),
  );
  const answerText =
    kind === RegistrationQuestionKind.Checkboxes ? '' : asTrimmedString(obj['answerText']);

  return {
    questionId,
    questionLabel: asTrimmedString(obj['questionLabel']) || questionId,
    kind,
    answerText,
    selectedOptions: kind === RegistrationQuestionKind.Checkboxes ? selectedOptions : [],
  };
}

export function normalizeQuestionResponseList(
  raw: unknown,
): EventRegistrationQuestionResponse[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: EventRegistrationQuestionResponse[] = [];
  for (const item of raw) {
    const parsed = normalizeEventRegistrationQuestionResponse(item);
    if (parsed && !seen.has(parsed.questionId)) {
      seen.add(parsed.questionId);
      result.push(parsed);
    }
  }
  return result;
}

// Formats a single question response into human-readable text ('' when unanswered).
export function formatQuestionResponseValue(
  resp: EventRegistrationQuestionResponse,
): string {
  if (resp.kind === RegistrationQuestionKind.Checkboxes) {
    return resp.selectedOptions.join(', ');
  }
  return resp.answerText;
}

export function hasQuestionResponseValue(
  resp: EventRegistrationQuestionResponse,
): boolean {
  return formatQuestionResponseValue(resp).trim().length > 0;
}

export function initEventPaymentRules(): EventPaymentRules {
  return {
    allowFullPayment: true,
    depositPolicy: { kind: DepositPolicyKind.Disabled },
    allowZeroDepositInPerson: false,
  };
}

export function initEventPricingRules(): EventPricingRules {
  const firstOpt = initEventRegistrationOption({
    id: 'full_event',
    label: 'Full Event',
  });
  return {
    capacities: [],
    earlyBird: { kind: EarlyBirdPolicyKind.Disabled },
    registrationOptions: [firstOpt],
    discounts: [],
    addOns: [],
    questions: [],
    payment: initEventPaymentRules(),
  };
}

interface LegacyEarlyRule {
  kind: 'none' | 'discount' | 'early_registration_only';
  discountCents: number;
}

function parseLegacyEarlyRule(raw: unknown): LegacyEarlyRule {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (obj['kind'] === 'discount') {
    return {
      kind: 'discount',
      discountCents: readCentsOrLegacyObject(obj['discountCents'], obj['discount']),
    };
  }
  if (obj['kind'] === 'early_registration_only') {
    return { kind: 'early_registration_only', discountCents: 0 };
  }
  return { kind: 'none', discountCents: 0 };
}

export function normalizeEventRegistrationOption(
  raw: unknown,
  fallbackIndex = 0,
  fallbackWho: WhoCondition = { kind: WhoConditionKind.Anyone },
  legacyPricing?: { basePriceCents: number; defaultOptionId: string },
): { option: EventRegistrationOption; legacyEarlyDiscountCents: number } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = asTrimmedString(obj['id']) || `option_${fallbackIndex + 1}`;
  let priceCents = 0;
  if (obj['priceCents'] !== undefined || obj['price'] !== undefined) {
    priceCents = readCentsOrLegacyObject(obj['priceCents'], obj['price']);
  } else if (legacyPricing) {
    if (id === legacyPricing.defaultOptionId) {
      priceCents = legacyPricing.basePriceCents;
    } else if (
      typeof obj['deltaFromDefaultCents'] === 'number' &&
      Number.isFinite(obj['deltaFromDefaultCents'])
    ) {
      priceCents = Math.max(
        0,
        legacyPricing.basePriceCents + Math.round(obj['deltaFromDefaultCents']),
      );
    } else if (
      obj['reductionFromBaseCents'] !== undefined ||
      obj['reductionFromBase'] !== undefined
    ) {
      priceCents = Math.max(
        0,
        legacyPricing.basePriceCents -
          readCentsOrLegacyObject(obj['reductionFromBaseCents'], obj['reductionFromBase']),
      );
    } else {
      priceCents = legacyPricing.basePriceCents;
    }
  }

  let conditions: EventRuleConditions;
  let legacyEarlyDiscountCents = 0;

  if (obj['conditions'] && typeof obj['conditions'] === 'object') {
    conditions = normalizeEventRuleConditions(obj['conditions'], false);
  } else {
    const who =
      obj['eligibility'] !== undefined
        ? legacyEligibilityToWhoCondition(obj['eligibility'])
        : fallbackWho;
    const legacyEarly = parseLegacyEarlyRule(obj['earlyRegistration']);
    const timing: TimingCondition =
      legacyEarly.kind === 'early_registration_only'
        ? {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEarlyBird,
          }
        : { kind: TimingConditionKind.Anytime };
    if (legacyEarly.kind === 'discount' && legacyEarly.discountCents > 0) {
      legacyEarlyDiscountCents = legacyEarly.discountCents;
    }
    conditions = initEventRuleConditions({ who, timing });
  }

  return {
    option: {
      id,
      label: asString(obj['label']),
      description: asString(obj['description']),
      attendanceType: normalizeAttendanceType(obj['attendanceType']),
      conditions,
      capacityUsage: normalizeCapacityMap(obj['capacityUsage']),
      subSelection: normalizeSubSelectionRule(obj['subSelection']),
      priceCents,
    },
    legacyEarlyDiscountCents,
  };
}

function hasLegacyRemovedSpouseWho(rawConditions: unknown): boolean {
  if (!rawConditions || typeof rawConditions !== 'object') return false;
  const who = (rawConditions as Record<string, unknown>)['who'];
  if (!who || typeof who !== 'object') return false;
  const whoObj = who as Record<string, unknown>;
  return whoObj['kind'] === WhoConditionKind.Status && whoObj['status'] === 'spouse';
}

export function normalizeEventDiscount(raw: unknown, fallbackIndex = 0): EventDiscount {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id: asTrimmedString(obj['id']) || `discount_${fallbackIndex + 1}`,
    label: asString(obj['label']),
    discountCents: readCentsOrLegacyObject(obj['discountCents'], obj['discount']),
    conditions: normalizeEventRuleConditions(obj['conditions'], true),
  };
}

function normalizeEventAddOnListItem(raw: unknown, fallbackIndex = 0): EventAddOn[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = asTrimmedString(obj['id']) || `addon_${fallbackIndex + 1}`;
  const label = asString(obj['label']);
  const description = asString(obj['description']);
  const spec = normalizeEventAddOnSpec(obj['spec']);
  const priceCents = clampNonNegativeInt(obj['priceCents']);

  if (obj['conditions'] && typeof obj['conditions'] === 'object') {
    return [
      {
        id,
        label,
        description,
        spec,
        conditions: normalizeEventRuleConditions(obj['conditions'], true),
        priceCents,
      },
    ];
  }

  // Legacy EventAddOn migration (optionScope + earlyRegistration + onlyBeforeEventStart)
  const registration = normalizeRegistrationCondition(obj['registration'] ?? obj['optionScope']);
  const legacyBeforeStart = Boolean(obj['onlyBeforeEventStart']);
  const legacyEarly = parseLegacyEarlyRule(obj['earlyRegistration']);

  if (legacyEarly.kind === 'discount' && legacyEarly.discountCents > 0 && priceCents > 0) {
    const earlyPriceCents = applyDiscount(priceCents, legacyEarly.discountCents);
    return [
      {
        id,
        label: label ? `${label} (Early Bird)` : 'Early Bird Add-On',
        description,
        spec,
        conditions: initEventRuleConditions({
          timing: {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEarlyBird,
          },
          registration,
        }),
        priceCents: earlyPriceCents,
      },
      {
        id: `${id}_standard`,
        label,
        description,
        spec,
        conditions: initEventRuleConditions({
          timing: legacyBeforeStart
            ? {
                kind: TimingConditionKind.Window,
                window: TimingWindow.BeforeEventStart,
              }
            : { kind: TimingConditionKind.Anytime },
          registration,
        }),
        priceCents,
      },
    ];
  }

  const timing: TimingCondition =
    legacyEarly.kind === 'early_registration_only'
      ? {
          kind: TimingConditionKind.Window,
          window: TimingWindow.BeforeEarlyBird,
        }
      : legacyBeforeStart
        ? {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEventStart,
          }
        : { kind: TimingConditionKind.Anytime };

  return [
    {
      id,
      label,
      description,
      spec,
      conditions: initEventRuleConditions({
        timing,
        registration,
      }),
      priceCents,
    },
  ];
}

export function normalizeEventAddOn(raw: unknown, fallbackIndex = 0): EventAddOn {
  return normalizeEventAddOnListItem(raw, fallbackIndex)[0];
}

export function normalizeEventPaymentRules(raw: unknown): EventPaymentRules {
  if (!raw || typeof raw !== 'object') {
    return initEventPaymentRules();
  }
  const obj = raw as Record<string, unknown>;
  return {
    allowFullPayment: obj['allowFullPayment'] !== undefined ? Boolean(obj['allowFullPayment']) : true,
    depositPolicy: normalizeDepositPolicy(obj['depositPolicy']),
    allowZeroDepositInPerson: Boolean(obj['allowZeroDepositInPerson']),
  };
}

// Helper: checks if condA covers every option in condB (used when migrating legacy max-wins personDiscounts).
function registrationCoversRegistration(
  condA: RegistrationCondition,
  condB: RegistrationCondition,
  allOptionIds: string[],
): boolean {
  if (condA.kind === RegistrationConditionKind.AllOptions) return true;
  const setA = new Set(condA.optionIds);
  const targetsB =
    condB.kind === RegistrationConditionKind.AllOptions ? allOptionIds : condB.optionIds;
  return targetsB.every((id) => setA.has(id));
}

function migrateLegacyPersonDiscounts(
  rawPersonDiscounts: unknown[],
  allOptionIds: string[],
): EventDiscount[] {
  const parsed = rawPersonDiscounts
    .map((item, idx) => {
      const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        rawStatusKind: obj['statusKind'],
        id: asTrimmedString(obj['id']) || `discount_${idx + 1}`,
        statusKind: normalizePersonStatusKind(obj['statusKind']),
        label: asString(obj['label']),
        discountCents: readCentsOrLegacyObject(obj['discountCents'], obj['discount']),
        registration: normalizeRegistrationCondition(obj['registration'] ?? obj['optionScope']),
      };
    })
    .filter((item) => item.rawStatusKind !== 'spouse');

  const memberMods = parsed.filter((m) => m.statusKind === PersonStatusKind.Member);
  const result: EventDiscount[] = [];

  for (const mod of parsed) {
    let adjustedCents = mod.discountCents;
    if (mod.statusKind === PersonStatusKind.Instructor && memberMods.length > 0) {
      // Legacy max-wins gave Instructors max(memberDisc, instDisc); since ActiveInstructor satisfies
      // ActiveMember, convert overlapping Instructor discount into the incremental difference.
      const coveringMemberMax = memberMods
        .filter((m) => registrationCoversRegistration(m.registration, mod.registration, allOptionIds))
        .reduce((max, m) => Math.max(max, m.discountCents), 0);
      if (coveringMemberMax > 0) {
        adjustedCents = Math.max(0, mod.discountCents - coveringMemberMax);
        if (adjustedCents === 0) continue;
      }
    }
    const defaultLabel =
      mod.statusKind === PersonStatusKind.Instructor
        ? 'Certified Instructor Discount'
        : 'ILC Member Discount';
    result.push(
      initEventDiscount({
        id: mod.id,
        label: mod.label || defaultLabel,
        discountCents: adjustedCents,
        conditions: initEventRuleConditions({
          who: { kind: WhoConditionKind.Status, status: mod.statusKind },
          registration: mod.registration,
        }),
      }),
    );
  }
  return result;
}

export function buildEarlyBirdDiscountsFromOptionMap(
  earlyDiscountByOptionId: Map<string, number>,
  allOptionIds: string[],
): EventDiscount[] {
  const groups = new Map<number, string[]>();
  for (const [optId, cents] of earlyDiscountByOptionId.entries()) {
    if (cents <= 0) continue;
    const list = groups.get(cents) ?? [];
    list.push(optId);
    groups.set(cents, list);
  }
  const discounts: EventDiscount[] = [];
  let idx = 1;
  for (const [cents, optIds] of groups.entries()) {
    const coversAll =
      allOptionIds.length > 0 && allOptionIds.every((id) => optIds.includes(id));
    discounts.push(
      initEventDiscount({
        id: groups.size === 1 ? 'early_bird_discount' : `early_bird_discount_${idx}`,
        label: 'Early Bird Discount',
        discountCents: cents,
        conditions: initEventRuleConditions({
          timing: {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEarlyBird,
          },
          registration: coversAll
            ? { kind: RegistrationConditionKind.AllOptions }
            : { kind: RegistrationConditionKind.SpecificOptions, optionIds: optIds },
        }),
      }),
    );
    idx++;
  }
  return discounts;
}

export function normalizeEventPricingRules(raw: unknown): EventPricingRules {
  if (!raw || typeof raw !== 'object') {
    return initEventPricingRules();
  }
  const obj = raw as Record<string, unknown>;
  const fallbackWho = legacyEligibilityToWhoCondition(
    obj['eligibility'],
    obj['requireActiveMembership'],
  );

  const rawCapacities = Array.isArray(obj['capacities']) ? obj['capacities'] : [];
  const seenCapIds = new Set<string>();
  const capacities: EventCapacity[] = [];
  for (let i = 0; i < rawCapacities.length; i++) {
    const cap = normalizeEventCapacity(rawCapacities[i], i);
    if (!seenCapIds.has(cap.id)) {
      seenCapIds.add(cap.id);
      capacities.push(cap);
    }
  }

  const legacyBasePriceCents = clampNonNegativeInt(obj['basePriceCents']);
  const rawDefaultId = asTrimmedString(obj['defaultOptionId']);
  const rawOptionsSource = Array.isArray(obj['registrationOptions'])
    ? obj['registrationOptions']
    : Array.isArray(obj['baseOptions'])
      ? obj['baseOptions']
      : [];
  const rawIds = rawOptionsSource.map((item, idx) => {
    const itemObj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return asTrimmedString(itemObj['id']) || `option_${idx + 1}`;
  });
  const effectiveLegacyDefaultId = rawIds.includes(rawDefaultId)
    ? rawDefaultId
    : (rawIds[0] ?? '');
  const legacyPricing = {
    basePriceCents: legacyBasePriceCents,
    defaultOptionId: effectiveLegacyDefaultId,
  };

  const legacyOptionEarlyDiscounts = new Map<string, number>();
  const registrationOptions: EventRegistrationOption[] =
    rawOptionsSource.length > 0
      ? rawOptionsSource.map((item, idx) => {
          const parsed = normalizeEventRegistrationOption(item, idx, fallbackWho, legacyPricing);
          if (parsed.legacyEarlyDiscountCents > 0) {
            legacyOptionEarlyDiscounts.set(parsed.option.id, parsed.legacyEarlyDiscountCents);
          }
          return parsed.option;
        })
      : [
          initEventRegistrationOption({
            id: 'full_event',
            label: 'Full Event',
            conditions: initEventRuleConditions({ who: fallbackWho }),
            priceCents: legacyBasePriceCents,
          }),
        ];

  const rawAddOns = Array.isArray(obj['addOns']) ? obj['addOns'] : [];
  const addOns: EventAddOn[] = [];
  for (let i = 0; i < rawAddOns.length; i++) {
    addOns.push(...normalizeEventAddOnListItem(rawAddOns[i], i));
  }

  // Migrate any legacy standalonePreOrder on an EventRecording add-on into an explicit VideoOnly option.
  if (!registrationOptions.some((o) => o.attendanceType === AttendanceType.VideoOnly)) {
    for (let i = 0; i < rawAddOns.length; i++) {
      const rawItem = rawAddOns[i];
      if (!rawItem || typeof rawItem !== 'object') continue;
      const rawSpec = (rawItem as Record<string, unknown>)['spec'];
      if (!rawSpec || typeof rawSpec !== 'object') continue;
      const rawStandalone = (rawSpec as Record<string, unknown>)['standalonePreOrder'];
      if (
        (rawSpec as Record<string, unknown>)['kind'] === EventAddOnKind.EventRecording &&
        rawStandalone &&
        typeof rawStandalone === 'object' &&
        (rawStandalone as Record<string, unknown>)['kind'] === 'enabled'
      ) {
        const standalonePriceCents = clampNonNegativeInt(
          (rawStandalone as Record<string, unknown>)['priceCents'],
        );
        const migratedOptId = registrationOptions.some((o) => o.id === 'recording_only')
          ? `recording_only_${i + 1}`
          : 'recording_only';
        const nonRecordingOptionIds = registrationOptions.map((o) => o.id);
        const rawAddOnId =
          asTrimmedString((rawItem as Record<string, unknown>)['id']) || `addon_${i + 1}`;
        const matchingAddOn = addOns.find((a) => a.id === rawAddOnId);
        registrationOptions.push(
          initEventRegistrationOption({
            id: migratedOptId,
            label: matchingAddOn?.label
              ? `${matchingAddOn.label} (Recording Only)`
              : 'Event Recording Only',
            description: matchingAddOn?.description ?? '',
            attendanceType: AttendanceType.VideoOnly,
            conditions: initEventRuleConditions({
              who: fallbackWho,
              timing: matchingAddOn?.conditions.timing,
            }),
            capacityUsage: {},
            priceCents: standalonePriceCents,
          }),
        );
        for (let j = 0; j < addOns.length; j++) {
          if (
            (addOns[j].id === rawAddOnId || addOns[j].id === `${rawAddOnId}_standard`) &&
            addOns[j].conditions.registration.kind === RegistrationConditionKind.AllOptions
          ) {
            addOns[j] = {
              ...addOns[j],
              conditions: {
                ...addOns[j].conditions,
                registration: {
                  kind: RegistrationConditionKind.SpecificOptions,
                  optionIds: nonRecordingOptionIds,
                },
              },
            };
          }
        }
        break;
      }
    }
  }

  const allOptionIds = registrationOptions.map((o) => o.id);
  const migratedEarlyDiscounts = buildEarlyBirdDiscountsFromOptionMap(
    legacyOptionEarlyDiscounts,
    allOptionIds,
  );

  let discounts: EventDiscount[];
  if (Array.isArray(obj['discounts'])) {
    const explicit = obj['discounts']
      .filter((item) => {
        if (!item || typeof item !== 'object') return true;
        return !hasLegacyRemovedSpouseWho((item as Record<string, unknown>)['conditions']);
      })
      .map((item, idx) => normalizeEventDiscount(item, idx));
    discounts = [...migratedEarlyDiscounts, ...explicit];
  } else if (Array.isArray(obj['personDiscounts'])) {
    discounts = [
      ...migratedEarlyDiscounts,
      ...migrateLegacyPersonDiscounts(obj['personDiscounts'], allOptionIds),
    ];
  } else {
    discounts = migratedEarlyDiscounts;
  }

  // De-duplicate discount IDs if legacy early bird migration + explicit discounts collided
  const seenDiscIds = new Set<string>();
  discounts = discounts.map((d, idx) => {
    let id = d.id || `discount_${idx + 1}`;
    while (seenDiscIds.has(id)) {
      id = `${id}_${idx + 1}`;
    }
    seenDiscIds.add(id);
    return { ...d, id };
  });

  const rawQuestions = Array.isArray(obj['questions']) ? obj['questions'] : [];
  const seenQuestionIds = new Set<string>();
  const questions: EventRegistrationQuestion[] = rawQuestions.map((item, idx) => {
    const parsed = normalizeEventRegistrationQuestion(item, idx);
    let id = parsed.id || `question_${idx + 1}`;
    while (seenQuestionIds.has(id)) {
      id = `${id}_${idx + 1}`;
    }
    seenQuestionIds.add(id);
    return { ...parsed, id };
  });

  return {
    capacities,
    earlyBird: normalizeEarlyBirdPolicy(obj['earlyBird'] ?? obj['earlyRegistration']),
    registrationOptions,
    discounts,
    addOns,
    questions,
    payment: normalizeEventPaymentRules(obj['payment']),
  };
}

// ------------------------------------------------------------------
// Pure Condition, Discount & Date Evaluation Helpers
// ------------------------------------------------------------------

export function applyDiscount(baseCents: number, discountCents: number): number {
  if (baseCents <= 0) return 0;
  return Math.max(0, baseCents - Math.max(0, Math.round(discountCents)));
}

// Evaluates current YYYY-MM-DD date in UTC-12 (Anywhere-on-Earth).
// A deadline D holds as long as it is still D anywhere on Earth (up to D+1 11:59:59.999 UTC).
export function getAnywhereOnEarthDate(nowMs: number = Date.now()): string {
  return new Date(nowMs - 12 * 3600_000).toISOString().slice(0, 10);
}

export function matchesRegistrationCondition(
  cond: RegistrationCondition,
  optionId: string,
): boolean {
  if (cond.kind === RegistrationConditionKind.AllOptions) {
    return true;
  }
  return cond.optionIds.includes(optionId);
}

export function matchesTimingCondition(
  cond: TimingCondition,
  isEarlyBird: boolean,
  isBeforeEventStart: boolean,
): boolean {
  if (cond.kind === TimingConditionKind.Anytime) {
    return true;
  }
  switch (cond.window) {
    case TimingWindow.BeforeEarlyBird:
      return isEarlyBird;
    case TimingWindow.BeforeEventStart:
      return isBeforeEventStart;
  }
}

export interface ValidateRuleConditionsContext {
  itemLabel: string;
  allowRegistrationCondition: boolean;
  earlyBirdEnabled: boolean;
  validOptionIds?: ReadonlySet<string>;
}

// Validates a shared EventRuleConditions block for configuration consistency.
export function validateRuleConditions(
  conditions: EventRuleConditions,
  context: ValidateRuleConditionsContext,
): string[] {
  const errors: string[] = [];
  if (
    conditions.timing.kind === TimingConditionKind.Window &&
    conditions.timing.window === TimingWindow.BeforeEarlyBird &&
    !context.earlyBirdEnabled
  ) {
    errors.push(
      `Enable Early Bird Pricing (with a cutoff date) to use an Early Bird timing condition on "${context.itemLabel}".`,
    );
  }
  if (
    !context.allowRegistrationCondition &&
    conditions.registration.kind !== RegistrationConditionKind.AllOptions
  ) {
    errors.push(
      `Registration condition is implicit on "${context.itemLabel}" and cannot target other registration options.`,
    );
  }
  if (
    context.allowRegistrationCondition &&
    conditions.registration.kind === RegistrationConditionKind.SpecificOptions
  ) {
    const matchedIds = context.validOptionIds
      ? conditions.registration.optionIds.filter((id) => context.validOptionIds!.has(id))
      : conditions.registration.optionIds;
    if (matchedIds.length === 0) {
      errors.push(
        `Select at least one registration option in the Registration condition for "${context.itemLabel}" (or remove the Registration condition).`,
      );
    }
  }
  return errors;
}

// ------------------------------------------------------------------
// Pure Quote Evaluator
// ------------------------------------------------------------------

export enum PricingValidationErrorCode {
  MembershipRequired = 'membership_required',
  InstructorRequired = 'instructor_required',
  NoOptionSelected = 'no_option_selected',
  OptionUnavailable = 'option_unavailable',
  CapacityExceeded = 'capacity_exceeded',
  InvalidSuboptionCount = 'invalid_suboption_count',
  InvalidSuboptionValue = 'invalid_suboption_value',
  AddOnUnavailable = 'addon_unavailable',
  PaymentChoiceUnavailable = 'payment_choice_unavailable',
  MissingRequiredQuestion = 'missing_required_question',
  InvalidQuestionResponse = 'invalid_question_response',
}

export interface PricingValidationError {
  code: PricingValidationErrorCode;
  message: string;
}

export interface OptionCapacityItem {
  capacityId: string;
  label: string;
  limit: number;
  used: number;
  remaining: number;
  optionUses: number;
  additionalNeeded: number;
  exceeds: boolean;
}

export interface EvaluatedCapacity {
  capacity: EventCapacity;
  used: number;
  remaining: number;
  selectedOptionUses: number;
  additionalNeeded: number;
  remainingAfterSelection: number;
  isFull: boolean;
  exceedsLimit: boolean;
}

export interface EvaluatedDiscount {
  discount: EventDiscount;
  // Actual amount saved in cents after clamping cumulative discounts to standardPriceCents.
  savedCents: number;
}

export interface EvaluatedRegistrationOption {
  option: EventRegistrationOption;
  standardPriceCents: number;
  appliedDiscounts: EvaluatedDiscount[];
  discountSavedCents: number;
  earlyDiscountSavedCents: number;
  netPriceCents: number;
  isEligibleForPerson: boolean;
  ineligibleReason:
    | PricingValidationErrorCode.MembershipRequired
    | PricingValidationErrorCode.InstructorRequired
    | null;
  isSoldOut: boolean;
  capacityBreakdown: OptionCapacityItem[];
}

export interface EvaluatedAddOn {
  addOn: EventAddOn;
  priceCents: number;
  selected: boolean;
}

export interface EventPricingQuoteInput {
  rules: EventPricingRules;
  memberContext: MemberStatusContext;
  // Admin callers bypass eligibility restrictions while retaining actual member/instructor pricing.
  isAdmin?: boolean;
  // When true, live attendance options and door/deposit settlement are unavailable (only VideoOnly remains open).
  isEventPast?: boolean;
  // Current live used units per capacity ID (from IlcEvent.capacityCounts).
  capacityCounts?: Record<string, number>;
  // Units already held by an existing registration when evaluating an upgrade.
  existingCapacityUsage?: Record<string, number>;
  // Optional event start date (YYYY-MM-DD or ISO string; first 10 chars used).
  eventStartDate?: string;
  // Optional explicit AoE date (YYYY-MM-DD) for simulation/tests; otherwise derived from nowMs.
  evaluationDateAoE?: string;
  nowMs?: number;
  selectedOptionId?: string;
  selectedSuboptions?: string[];
  selectedAddOnIds?: string[];
  paymentChoice?: PaymentChoice;
}

export interface EventPricingQuote {
  evaluationDateAoE: string;
  isEarlyBird: boolean;
  isBeforeEventStart: boolean;
  isEligibleToRegister: boolean;
  evaluatedCapacities: EvaluatedCapacity[];
  allEvaluatedOptions: EvaluatedRegistrationOption[];
  availableOptions: EvaluatedRegistrationOption[];
  selectedOption: EvaluatedRegistrationOption | null;
  normalizedSuboptions: string[];
  availableAddOns: EvaluatedAddOn[];
  selectedAddOns: EvaluatedAddOn[];
  applicableQuestions: EventRegistrationQuestion[];
  availablePaymentChoices: PaymentChoice[];
  effectivePaymentChoice: PaymentChoice | null;
  attendanceStandardCents: number;
  attendanceDiscountCents: number;
  attendanceEarlyDiscountCents: number;
  attendanceNetCents: number;
  addOnsTotalCents: number;
  agreedTotalCents: number;
  depositCents: number;
  chargeNowCents: number;
  cashDueAtDoorCents: number;
  depositRefundPolicy: DepositRefundPolicy | null;
  isDepositCurrentlyRefundable: boolean;
  validationErrors: PricingValidationError[];
  isValid: boolean;
}

function matchesWhoForDiscount(who: WhoCondition, memberLevel: MemberStatusLevel): boolean {
  if (who.kind === WhoConditionKind.Anyone) {
    return true;
  }
  switch (who.status) {
    case PersonStatusKind.Instructor:
      return memberLevel >= MemberStatusLevel.ActiveInstructor;
    case PersonStatusKind.Member:
      return memberLevel >= MemberStatusLevel.ActiveMember;
  }
}

function checkWhoEligibility(
  who: WhoCondition,
  memberContext: MemberStatusContext,
  evaluationDateAoE: string,
  isAdmin: boolean,
): {
  isEligible: boolean;
  reason:
    | PricingValidationErrorCode.MembershipRequired
    | PricingValidationErrorCode.InstructorRequired
    | null;
} {
  if (isAdmin || who.kind === WhoConditionKind.Anyone) {
    return { isEligible: true, reason: null };
  }
  if (who.status === PersonStatusKind.Instructor) {
    const ok = satisfiesMemberStatusLevel(
      memberContext,
      MemberStatusLevel.ActiveInstructor,
      evaluationDateAoE,
    );
    return {
      isEligible: ok,
      reason: ok ? null : PricingValidationErrorCode.InstructorRequired,
    };
  }
  const ok = satisfiesMemberStatusLevel(
    memberContext,
    MemberStatusLevel.ActiveMember,
    evaluationDateAoE,
  );
  return {
    isEligible: ok,
    reason: ok ? null : PricingValidationErrorCode.MembershipRequired,
  };
}

function evaluateSingleRegistrationOption(
  rules: EventPricingRules,
  option: EventRegistrationOption,
  isEarlyBird: boolean,
  isBeforeEventStart: boolean,
  memberContext: MemberStatusContext,
  memberLevel: MemberStatusLevel,
  evaluationDateAoE: string,
  capacityCounts: Record<string, number>,
  existingCapacityUsage: Record<string, number>,
  isAdmin: boolean,
): EvaluatedRegistrationOption {
  const standardPriceCents = clampNonNegativeInt(option.priceCents);
  let remainingPriceCents = standardPriceCents;
  const appliedDiscounts: EvaluatedDiscount[] = [];
  let earlyDiscountSavedCents = 0;

  for (const disc of rules.discounts) {
    if (disc.discountCents <= 0) continue;
    if (!matchesRegistrationCondition(disc.conditions.registration, option.id)) continue;
    if (!matchesTimingCondition(disc.conditions.timing, isEarlyBird, isBeforeEventStart)) {
      continue;
    }
    if (!matchesWhoForDiscount(disc.conditions.who, memberLevel)) continue;

    const savedCents = Math.min(remainingPriceCents, Math.max(0, disc.discountCents));
    if (savedCents > 0) {
      remainingPriceCents -= savedCents;
      appliedDiscounts.push({ discount: disc, savedCents });
      if (
        disc.conditions.timing.kind === TimingConditionKind.Window &&
        disc.conditions.timing.window === TimingWindow.BeforeEarlyBird
      ) {
        earlyDiscountSavedCents += savedCents;
      }
    }
  }

  const netPriceCents = remainingPriceCents;
  const discountSavedCents = standardPriceCents - netPriceCents;

  const { isEligible, reason } = checkWhoEligibility(
    option.conditions.who,
    memberContext,
    evaluationDateAoE,
    isAdmin,
  );

  const capacityBreakdown: OptionCapacityItem[] = rules.capacities.map((cap) => {
    const used = clampNonNegativeInt(capacityCounts[cap.id]);
    const existingHeld = clampNonNegativeInt(existingCapacityUsage[cap.id]);
    const effectiveUsedWithoutSelf = Math.max(0, used - existingHeld);
    const optionUses = clampNonNegativeInt(option.capacityUsage[cap.id]);
    const additionalNeeded = Math.max(0, optionUses - existingHeld);
    const remaining = Math.max(0, cap.limit - used);
    const exceeds = optionUses > 0 && effectiveUsedWithoutSelf + optionUses > cap.limit;
    return {
      capacityId: cap.id,
      label: cap.label,
      limit: cap.limit,
      used,
      remaining,
      optionUses,
      additionalNeeded,
      exceeds,
    };
  });

  const isSoldOut = capacityBreakdown.some((item) => item.exceeds);

  return {
    option,
    standardPriceCents,
    appliedDiscounts,
    discountSavedCents,
    earlyDiscountSavedCents,
    netPriceCents,
    isEligibleForPerson: isEligible,
    ineligibleReason: reason,
    isSoldOut,
    capacityBreakdown,
  };
}

export function evaluateEventPricingQuote(input: EventPricingQuoteInput): EventPricingQuote {
  const { rules, memberContext } = input;
  const validationErrors: PricingValidationError[] = [];
  const capacityCounts = normalizeCapacityMap(input.capacityCounts);
  const existingCapacityUsage = normalizeCapacityMap(input.existingCapacityUsage);

  // 1. Date & Member Level evaluation (Anywhere-on-Earth UTC-12)
  const evaluationDateAoE =
    input.evaluationDateAoE && input.evaluationDateAoE.length >= 10
      ? input.evaluationDateAoE.slice(0, 10)
      : getAnywhereOnEarthDate(input.nowMs);

  const earlyBirdDeadline =
    rules.earlyBird.kind === EarlyBirdPolicyKind.Enabled ? rules.earlyBird.deadlineDate : '';
  const isEarlyBirdPolicyEnabled = Boolean(earlyBirdDeadline);
  const isEarlyBird = isEarlyBirdPolicyEnabled && evaluationDateAoE <= earlyBirdDeadline;

  const normalizedEventStart = input.eventStartDate ? input.eventStartDate.slice(0, 10) : '';
  const isBeforeEventStart = !normalizedEventStart || evaluationDateAoE < normalizedEventStart;

  const memberLevel = getMemberStatusLevel(memberContext, evaluationDateAoE);
  const isAdmin = Boolean(input.isAdmin);
  const isPast = Boolean(input.isEventPast);

  // 2. Evaluate Registration Options (filtering timing conditions and live options when event is past)
  const allEvaluatedOptions = rules.registrationOptions
    .filter((opt) => {
      if (isPast && opt.attendanceType !== AttendanceType.VideoOnly) {
        return false;
      }
      if (!matchesTimingCondition(opt.conditions.timing, isEarlyBird, isBeforeEventStart)) {
        return false;
      }
      return true;
    })
    .map((opt) =>
      evaluateSingleRegistrationOption(
        rules,
        opt,
        isEarlyBird,
        isBeforeEventStart,
        memberContext,
        memberLevel,
        evaluationDateAoE,
        capacityCounts,
        existingCapacityUsage,
        isAdmin,
      ),
    );

  const availableOptions = allEvaluatedOptions.filter(
    (opt) => opt.isEligibleForPerson && !opt.isSoldOut,
  );
  const isEligibleToRegister =
    allEvaluatedOptions.length === 0 || allEvaluatedOptions.some((opt) => opt.isEligibleForPerson);

  // Resolve selected option
  let selectedOption: EvaluatedRegistrationOption | null = null;
  if (input.selectedOptionId !== undefined) {
    const matchedInAll =
      allEvaluatedOptions.find((o) => o.option.id === input.selectedOptionId) ?? null;
    if (!matchedInAll) {
      const matchedRaw = rules.registrationOptions.find((o) => o.id === input.selectedOptionId);
      let unavailMsg = 'Please select a valid registration option.';
      if (matchedRaw) {
        if (isPast && matchedRaw.attendanceType !== AttendanceType.VideoOnly) {
          unavailMsg = 'Live attendance is closed because this event has already taken place.';
        } else if (
          matchedRaw.conditions.timing.kind === TimingConditionKind.Window &&
          matchedRaw.conditions.timing.window === TimingWindow.BeforeEventStart &&
          !isBeforeEventStart
        ) {
          unavailMsg =
            'The selected registration option is no longer available once the event has started.';
        } else {
          unavailMsg =
            'The selected registration option is only available during Early Bird pricing.';
        }
      }
      validationErrors.push({
        code: matchedRaw
          ? PricingValidationErrorCode.OptionUnavailable
          : PricingValidationErrorCode.NoOptionSelected,
        message: unavailMsg,
      });
    } else {
      selectedOption = matchedInAll;
      if (!matchedInAll.isEligibleForPerson) {
        if (matchedInAll.ineligibleReason === PricingValidationErrorCode.InstructorRequired) {
          validationErrors.push({
            code: PricingValidationErrorCode.InstructorRequired,
            message: 'Active ILC instructor certification is required for this registration option.',
          });
        } else {
          validationErrors.push({
            code: PricingValidationErrorCode.MembershipRequired,
            message: 'Active ILC membership is required for this registration option.',
          });
        }
      }
      if (matchedInAll.isSoldOut) {
        const fullLabels = matchedInAll.capacityBreakdown
          .filter((c) => c.exceeds)
          .map((c) => c.label || c.capacityId)
          .join(', ');
        validationErrors.push({
          code: PricingValidationErrorCode.CapacityExceeded,
          message: fullLabels
            ? `Capacity limit reached for: ${fullLabels}.`
            : 'The selected registration option has reached capacity.',
        });
      }
    }
  } else {
    selectedOption = availableOptions[0] ?? null;
    if (!selectedOption) {
      if (allEvaluatedOptions.length > 0 && !isEligibleToRegister) {
        const allRequireInstructor = allEvaluatedOptions.every(
          (o) => o.ineligibleReason === PricingValidationErrorCode.InstructorRequired,
        );
        validationErrors.push({
          code: allRequireInstructor
            ? PricingValidationErrorCode.InstructorRequired
            : PricingValidationErrorCode.MembershipRequired,
          message: allRequireInstructor
            ? 'Active ILC instructor certification is required to register for this event.'
            : 'Active ILC membership is required to register for this event.',
        });
      } else if (
        allEvaluatedOptions.some((o) => o.isEligibleForPerson && o.isSoldOut)
      ) {
        validationErrors.push({
          code: PricingValidationErrorCode.CapacityExceeded,
          message: 'All eligible registration options for this event have reached capacity.',
        });
      } else {
        validationErrors.push({
          code: PricingValidationErrorCode.NoOptionSelected,
          message: 'No registration options are currently available.',
        });
      }
    }
  }

  // Evaluate overall capacity summary against the currently selected option
  const evaluatedCapacities: EvaluatedCapacity[] = rules.capacities.map((cap) => {
    const used = clampNonNegativeInt(capacityCounts[cap.id]);
    const existingHeld = clampNonNegativeInt(existingCapacityUsage[cap.id]);
    const effectiveUsedWithoutSelf = Math.max(0, used - existingHeld);
    const selectedOptionUses = selectedOption
      ? clampNonNegativeInt(selectedOption.option.capacityUsage[cap.id])
      : 0;
    const additionalNeeded = Math.max(0, selectedOptionUses - existingHeld);
    const remaining = Math.max(0, cap.limit - used);
    const remainingAfterSelection = Math.max(
      0,
      cap.limit - (effectiveUsedWithoutSelf + selectedOptionUses),
    );
    const exceedsLimit =
      selectedOptionUses > 0 && effectiveUsedWithoutSelf + selectedOptionUses > cap.limit;
    return {
      capacity: cap,
      used,
      remaining,
      selectedOptionUses,
      additionalNeeded,
      remainingAfterSelection,
      isFull: remaining <= 0,
      exceedsLimit,
    };
  });

  // 3. Validate Suboptions
  const rawSuboptions = Array.isArray(input.selectedSuboptions) ? input.selectedSuboptions : [];
  const normalizedSuboptions = Array.from(
    new Set(rawSuboptions.map((s) => s.trim()).filter(Boolean)),
  );

  if (selectedOption) {
    const subRule = selectedOption.option.subSelection;
    if (subRule.kind === SubSelectionKind.PickSuboptions) {
      const invalidValues = normalizedSuboptions.filter(
        (s) => !subRule.availableSuboptions.includes(s),
      );
      if (invalidValues.length > 0) {
        validationErrors.push({
          code: PricingValidationErrorCode.InvalidSuboptionValue,
          message: `Invalid selection: ${invalidValues.join(', ')}.`,
        });
      }
      if (normalizedSuboptions.length !== subRule.pickCount) {
        validationErrors.push({
          code: PricingValidationErrorCode.InvalidSuboptionCount,
          message: `Please select ${subRule.pickCount} option${subRule.pickCount === 1 ? '' : 's'} (currently ${normalizedSuboptions.length} selected).`,
        });
      }
    }
  }

  // 4. Filter & evaluate Add-Ons for the selected option using shared EventRuleConditions
  const requestedAddOnIds = new Set(
    (input.selectedAddOnIds ?? []).map((id) => id.trim()).filter(Boolean),
  );

  const availableAddOns: EvaluatedAddOn[] = selectedOption
    ? rules.addOns
        .filter((addOn) => {
          if (!matchesRegistrationCondition(addOn.conditions.registration, selectedOption.option.id)) {
            return false;
          }
          if (
            !matchesTimingCondition(
              addOn.conditions.timing,
              isEarlyBird,
              isBeforeEventStart,
            )
          ) {
            return false;
          }
          if (
            !checkWhoEligibility(
              addOn.conditions.who,
              memberContext,
              evaluationDateAoE,
              isAdmin,
            ).isEligible
          ) {
            return false;
          }
          return true;
        })
        .map((addOn) => ({
          addOn,
          priceCents: clampNonNegativeInt(addOn.priceCents),
          selected: requestedAddOnIds.has(addOn.id),
        }))
    : [];

  const availableAddOnIdSet = new Set(availableAddOns.map((a) => a.addOn.id));
  for (const reqId of requestedAddOnIds) {
    if (!availableAddOnIdSet.has(reqId)) {
      validationErrors.push({
        code: PricingValidationErrorCode.AddOnUnavailable,
        message: `Selected add-on "${reqId}" is not available for this option or date.`,
      });
    }
  }

  const selectedAddOns = availableAddOns.filter((a) => a.selected);
  const addOnsTotalCents = selectedAddOns.reduce((sum, a) => sum + a.priceCents, 0);

  // 4b. Filter applicable Registration Form Questions for the selected option
  const applicableQuestions: EventRegistrationQuestion[] = selectedOption
    ? rules.questions.filter((q) => {
        if (!matchesRegistrationCondition(q.conditions.registration, selectedOption.option.id)) {
          return false;
        }
        if (!matchesTimingCondition(q.conditions.timing, isEarlyBird, isBeforeEventStart)) {
          return false;
        }
        if (!matchesWhoForDiscount(q.conditions.who, memberLevel)) {
          return false;
        }
        return true;
      })
    : [];

  // 5. Payment choices & split
  let depositRefundPolicy: DepositRefundPolicy | null = null;
  let isDepositCurrentlyRefundable = false;
  if (rules.payment.depositPolicy.kind === DepositPolicyKind.Enabled) {
    depositRefundPolicy = rules.payment.depositPolicy.refundPolicy;
    isDepositCurrentlyRefundable =
      depositRefundPolicy.kind === DepositRefundPolicyKind.RefundableBefore &&
      Boolean(depositRefundPolicy.deadlineDate) &&
      evaluationDateAoE <= depositRefundPolicy.deadlineDate;
  }

  const isSelectedOptionLiveInPerson =
    !selectedOption ||
    selectedOption.option.attendanceType === AttendanceType.InPerson ||
    selectedOption.option.attendanceType === AttendanceType.InPersonAndOnline;

  const isSelectedOptionVideoOnly =
    selectedOption?.option.attendanceType === AttendanceType.VideoOnly;

  const availablePaymentChoices: PaymentChoice[] = [];
  if (rules.payment.allowFullPayment || isSelectedOptionVideoOnly || isPast) {
    availablePaymentChoices.push(PaymentChoice.Full);
  }
  if (
    rules.payment.depositPolicy.kind === DepositPolicyKind.Enabled &&
    !isSelectedOptionVideoOnly &&
    !isPast
  ) {
    availablePaymentChoices.push(PaymentChoice.Deposit);
  }
  if (rules.payment.allowZeroDepositInPerson && isSelectedOptionLiveInPerson && !isPast) {
    availablePaymentChoices.push(PaymentChoice.PayAtDoor);
  }

  let effectivePaymentChoice: PaymentChoice | null = null;
  if (input.paymentChoice !== undefined) {
    if (availablePaymentChoices.includes(input.paymentChoice)) {
      effectivePaymentChoice = input.paymentChoice;
    } else {
      validationErrors.push({
        code: PricingValidationErrorCode.PaymentChoiceUnavailable,
        message: 'The selected payment method is not available for this registration option.',
      });
    }
  } else {
    effectivePaymentChoice = availablePaymentChoices[0] ?? null;
    if (!effectivePaymentChoice) {
      validationErrors.push({
        code: PricingValidationErrorCode.PaymentChoiceUnavailable,
        message: 'No payment method is enabled for this registration setup.',
      });
    }
  }

  const attendanceStandardCents = selectedOption?.standardPriceCents ?? 0;
  const attendanceDiscountCents = selectedOption?.discountSavedCents ?? 0;
  const attendanceEarlyDiscountCents = selectedOption?.earlyDiscountSavedCents ?? 0;
  const attendanceNetCents = selectedOption?.netPriceCents ?? 0;
  const agreedTotalCents = attendanceNetCents + addOnsTotalCents;

  let depositCents = 0;
  let chargeNowCents = agreedTotalCents;
  let cashDueAtDoorCents = 0;

  if (
    effectivePaymentChoice === PaymentChoice.Deposit &&
    rules.payment.depositPolicy.kind === DepositPolicyKind.Enabled
  ) {
    depositCents = Math.min(
      attendanceNetCents,
      Math.max(0, rules.payment.depositPolicy.depositCents),
    );
    chargeNowCents = depositCents + addOnsTotalCents;
    cashDueAtDoorCents = attendanceNetCents - depositCents;
  } else if (effectivePaymentChoice === PaymentChoice.PayAtDoor) {
    depositCents = 0;
    chargeNowCents = 0;
    cashDueAtDoorCents = agreedTotalCents;
  } else {
    depositCents = 0;
    chargeNowCents = agreedTotalCents;
    cashDueAtDoorCents = 0;
  }

  const isValid =
    validationErrors.length === 0 &&
    selectedOption !== null &&
    selectedOption.isEligibleForPerson &&
    !selectedOption.isSoldOut &&
    effectivePaymentChoice !== null;

  return {
    evaluationDateAoE,
    isEarlyBird,
    isBeforeEventStart,
    isEligibleToRegister,
    evaluatedCapacities,
    allEvaluatedOptions,
    availableOptions,
    selectedOption,
    normalizedSuboptions,
    availableAddOns,
    selectedAddOns,
    applicableQuestions,
    availablePaymentChoices,
    effectivePaymentChoice,
    attendanceStandardCents,
    attendanceDiscountCents,
    attendanceEarlyDiscountCents,
    attendanceNetCents,
    addOnsTotalCents,
    agreedTotalCents,
    depositCents,
    chargeNowCents,
    cashDueAtDoorCents,
    depositRefundPolicy,
    isDepositCurrentlyRefundable,
    validationErrors,
    isValid,
  };
}

// ------------------------------------------------------------------
// Registration Question Response Validation & Stripe Metadata Chunking
// ------------------------------------------------------------------

export interface ValidateQuestionResponsesInput {
  applicableQuestions: EventRegistrationQuestion[];
  submittedAnswers: unknown;
  existingResponses?: EventRegistrationQuestionResponse[];
}

export interface ValidateQuestionResponsesResult {
  responses: EventRegistrationQuestionResponse[];
  errors: PricingValidationError[];
}

// Merges existing responses with newly recorded responses while strictly preserving
// any questionId already recorded on the registration (read-only immutability).
export function mergeImmutableQuestionResponses(
  existingResponses: EventRegistrationQuestionResponse[],
  incomingResponses: EventRegistrationQuestionResponse[],
): EventRegistrationQuestionResponse[] {
  const result: EventRegistrationQuestionResponse[] = [];
  const seenIds = new Set<string>();
  for (const existing of existingResponses) {
    if (!existing.questionId || seenIds.has(existing.questionId)) continue;
    seenIds.add(existing.questionId);
    result.push({
      ...existing,
      selectedOptions: [...existing.selectedOptions],
    });
  }
  for (const incoming of incomingResponses) {
    if (!incoming.questionId || seenIds.has(incoming.questionId)) continue;
    seenIds.add(incoming.questionId);
    result.push({
      ...incoming,
      selectedOptions: [...incoming.selectedOptions],
    });
  }
  return result;
}

// Validates submitted answers against applicableQuestions while locking any question
// already present in existingResponses so submitted answers remain read-only.
export function validateAndBuildQuestionResponses(
  input: ValidateQuestionResponsesInput,
): ValidateQuestionResponsesResult {
  const errors: PricingValidationError[] = [];
  const existingResponses = input.existingResponses ?? [];
  const existingById = new Map<string, EventRegistrationQuestionResponse>();
  for (const resp of existingResponses) {
    if (resp.questionId && !existingById.has(resp.questionId)) {
      existingById.set(resp.questionId, resp);
    }
  }

  const submittedMap = new Map<
    string,
    { answerText: string; selectedOptions: string[] }
  >();
  if (Array.isArray(input.submittedAnswers)) {
    for (const rawItem of input.submittedAnswers) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const obj = rawItem as Record<string, unknown>;
      const qId = asTrimmedString(obj['questionId']);
      if (!qId) continue;
      const answerText = asTrimmedString(obj['answerText']);
      const rawSelected = Array.isArray(obj['selectedOptions']) ? obj['selectedOptions'] : [];
      const selectedOptions = Array.from(
        new Set(rawSelected.map((s) => asTrimmedString(s)).filter(Boolean)),
      );
      submittedMap.set(qId, { answerText, selectedOptions });
    }
  }

  const applicableBuilt: EventRegistrationQuestionResponse[] = [];

  for (const q of input.applicableQuestions) {
    const lockedExisting = existingById.get(q.id);
    if (lockedExisting) {
      // Previously submitted responses are locked read-only and never mutated or re-validated.
      applicableBuilt.push({
        ...lockedExisting,
        selectedOptions: [...lockedExisting.selectedOptions],
      });
      continue;
    }

    const qLabel = q.label.trim() || q.id;
    const sub = submittedMap.get(q.id) ?? { answerText: '', selectedOptions: [] };

    switch (q.spec.kind) {
      case RegistrationQuestionKind.ShortText: {
        const text = sub.answerText;
        if (q.required && !text) {
          errors.push({
            code: PricingValidationErrorCode.MissingRequiredQuestion,
            message: `Please answer the required question: "${qLabel}".`,
          });
        } else if (text.length > MAX_SHORT_TEXT_ANSWER_LENGTH) {
          errors.push({
            code: PricingValidationErrorCode.InvalidQuestionResponse,
            message: `Answer for "${qLabel}" must be ${MAX_SHORT_TEXT_ANSWER_LENGTH} characters or fewer.`,
          });
        }
        applicableBuilt.push({
          questionId: q.id,
          questionLabel: qLabel,
          kind: RegistrationQuestionKind.ShortText,
          answerText: text.slice(0, MAX_SHORT_TEXT_ANSWER_LENGTH),
          selectedOptions: [],
        });
        break;
      }
      case RegistrationQuestionKind.LongText: {
        const text = sub.answerText;
        if (q.required && !text) {
          errors.push({
            code: PricingValidationErrorCode.MissingRequiredQuestion,
            message: `Please answer the required question: "${qLabel}".`,
          });
        } else if (text.length > MAX_LONG_TEXT_ANSWER_LENGTH) {
          errors.push({
            code: PricingValidationErrorCode.InvalidQuestionResponse,
            message: `Answer for "${qLabel}" must be ${MAX_LONG_TEXT_ANSWER_LENGTH} characters or fewer.`,
          });
        }
        applicableBuilt.push({
          questionId: q.id,
          questionLabel: qLabel,
          kind: RegistrationQuestionKind.LongText,
          answerText: text.slice(0, MAX_LONG_TEXT_ANSWER_LENGTH),
          selectedOptions: [],
        });
        break;
      }
      case RegistrationQuestionKind.Select: {
        const choice = sub.answerText;
        if (!choice) {
          if (q.required) {
            errors.push({
              code: PricingValidationErrorCode.MissingRequiredQuestion,
              message: `Please select an option for: "${qLabel}".`,
            });
          }
          applicableBuilt.push({
            questionId: q.id,
            questionLabel: qLabel,
            kind: RegistrationQuestionKind.Select,
            answerText: '',
            selectedOptions: [],
          });
        } else if (!q.spec.options.includes(choice)) {
          errors.push({
            code: PricingValidationErrorCode.InvalidQuestionResponse,
            message: `Invalid selection "${choice}" for "${qLabel}".`,
          });
        } else {
          applicableBuilt.push({
            questionId: q.id,
            questionLabel: qLabel,
            kind: RegistrationQuestionKind.Select,
            answerText: choice,
            selectedOptions: [],
          });
        }
        break;
      }
      case RegistrationQuestionKind.Checkboxes: {
        const specOptions = q.spec.options;
        const invalidChoices = sub.selectedOptions.filter(
          (opt) => !specOptions.includes(opt),
        );
        if (invalidChoices.length > 0) {
          errors.push({
            code: PricingValidationErrorCode.InvalidQuestionResponse,
            message: `Invalid checkbox selection for "${qLabel}".`,
          });
        }
        const canonicalChoices = specOptions.filter((opt) =>
          sub.selectedOptions.includes(opt),
        );
        if (q.required && canonicalChoices.length === 0) {
          errors.push({
            code: PricingValidationErrorCode.MissingRequiredQuestion,
            message: `Please select at least one option for: "${qLabel}".`,
          });
        }
        applicableBuilt.push({
          questionId: q.id,
          questionLabel: qLabel,
          kind: RegistrationQuestionKind.Checkboxes,
          answerText: '',
          selectedOptions: canonicalChoices,
        });
        break;
      }
    }
  }

  const responses = mergeImmutableQuestionResponses(
    existingResponses,
    applicableBuilt,
  );

  if (responses.length > 0) {
    const serialized = JSON.stringify(responses);
    const neededChunks = Math.ceil(serialized.length / STRIPE_METADATA_CHUNK_LENGTH);
    if (neededChunks > MAX_STRIPE_METADATA_CHUNKS) {
      errors.push({
        code: PricingValidationErrorCode.InvalidQuestionResponse,
        message: 'Combined registration form answers are too long. Please shorten your responses.',
      });
    }
  }

  return { responses, errors };
}

// Encodes validated question responses into <=450-character Stripe metadata chunks
// so multi-line responses never hit Stripe's 500-character per-key metadata limit.
export function encodeQuestionResponsesToMetadata(
  responses: EventRegistrationQuestionResponse[],
): Record<string, string> {
  if (responses.length === 0) {
    return {};
  }
  const serialized = JSON.stringify(responses);
  const chunks: string[] = [];
  for (let i = 0; i < serialized.length; i += STRIPE_METADATA_CHUNK_LENGTH) {
    chunks.push(serialized.slice(i, i + STRIPE_METADATA_CHUNK_LENGTH));
  }
  const meta: Record<string, string> = {
    questionResponsesChunks: String(chunks.length),
  };
  for (let i = 0; i < chunks.length; i++) {
    meta[`questionResponses_${i}`] = chunks[i];
  }
  return meta;
}

export function decodeQuestionResponsesFromMetadata(
  metadata: Record<string, string> | undefined,
): EventRegistrationQuestionResponse[] {
  if (!metadata) {
    return [];
  }
  const chunkCountRaw = metadata['questionResponsesChunks'];
  let jsonStr = '';
  if (chunkCountRaw) {
    const count = parseInt(chunkCountRaw, 10);
    if (Number.isFinite(count) && count > 0 && count <= 50) {
      for (let i = 0; i < count; i++) {
        jsonStr += metadata[`questionResponses_${i}`] || '';
      }
    }
  } else if (metadata['questionResponses']) {
    jsonStr = metadata['questionResponses'];
  }
  if (!jsonStr) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(jsonStr);
    return normalizeQuestionResponseList(parsed);
  } catch {
    return [];
  }
}
