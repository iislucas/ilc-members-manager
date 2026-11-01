/* event-registration-view.ts
 *
 * Detail and HQ Admin edit view for a single event registration at
 * /events/:eventId/registrations/:registrationId.
 *
 * Event organizers/managers can view the complete registration record and
 * toggle offline Paid-in-Full status; HQ Admins can edit and save all fields.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ProductService } from '../product.service';
import { StripeService } from '../stripe.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MemberSelectorComponent } from '../member-selector/member-selector';
import {
  ApplicationLevel,
  InstructorLicenseType,
  StudentLevel,
  studentLevelLabel,
  toApplicationLevel,
} from '../../../functions/src/data-model/curriculum';
import {
  AttendeeRole,
  AttendanceType,
  computeEffectiveCapacityUsage,
  evaluateEventPricingQuote,
  EventAddOn,
  EventAddOnKind,
  EventCapacity,
  EventRegistration,
  EventRegistrationOption,
  EventRegistrationQuestion,
  EventRegistrationQuestionResponse,
  EventRegistrationStatus,
  formatQuestionResponseValue,
  IlcEvent,
  isRegistrationPaidInFull,
  normalizeCapacityMap,
  PaymentChoice,
  PricingTierType,
  Product,
  RegistrationPaymentMethod,
  RegistrationQuestionKind,
  SubSelectionKind,
} from '../../../functions/src/data-model/events';
import {
  getAttendeeRoleForStatus,
  Member,
  MembershipType,
  MemberStatusContext,
  PUBLIC_MEMBER_STATUS_CONTEXT,
  toMemberStatusContext,
} from '../../../functions/src/data-model/members';
import { AdminUpdateEventRegistrationFields } from '../../../functions/src/stripe-types';
import { deepObjEq } from '../utils';

export interface MergedQuestionItem {
  questionId: string;
  label: string;
  description: string;
  required: boolean;
  kind: RegistrationQuestionKind;
  options: string[];
  placeholder: string;
  isArchived: boolean;
}

export enum QuickPayConfirmAction {
  None = 'none',
  MarkPaid = 'mark_paid',
  UnmarkPaid = 'unmark_paid',
}

@Component({
  selector: 'app-event-registration-view',
  standalone: true,
  imports: [IconComponent, SpinnerComponent, MemberSelectorComponent],
  templateUrl: './event-registration-view.html',
  styleUrl: './event-registration-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventRegistrationViewComponent {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  private productService = inject(ProductService);
  private stripeService = inject(StripeService);

  private viewSignals = this.routingService.signals[Views.EventRegistrationView];

  readonly titleLoaded = output<string>();
  readonly eventTitleLoaded = output<string>();

  readonly AttendeeRole = AttendeeRole;
  readonly AttendanceType = AttendanceType;
  readonly EventRegistrationStatus = EventRegistrationStatus;
  readonly RegistrationPaymentMethod = RegistrationPaymentMethod;
  readonly PaymentChoice = PaymentChoice;
  readonly PricingTierType = PricingTierType;
  readonly RegistrationQuestionKind = RegistrationQuestionKind;
  readonly QuickPayConfirmAction = QuickPayConfirmAction;

  readonly attendeeRoles = [
    AttendeeRole.NonMember,
    AttendeeRole.Member,
    AttendeeRole.Instructor,
  ];
  readonly attendanceModes = [
    AttendanceType.InPerson,
    AttendanceType.Online,
    AttendanceType.InPersonAndOnline,
    AttendanceType.VideoOnly,
  ];
  readonly registrationStatuses = [
    EventRegistrationStatus.Paid,
    EventRegistrationStatus.DepositPaid,
    EventRegistrationStatus.PendingInPerson,
    EventRegistrationStatus.Cancelled,
    EventRegistrationStatus.Refunded,
  ];
  readonly paymentMethods = [
    RegistrationPaymentMethod.Stripe,
    RegistrationPaymentMethod.InPerson,
  ];
  readonly paymentChoices = [
    PaymentChoice.Full,
    PaymentChoice.Deposit,
    PaymentChoice.PayAtDoor,
  ];
  readonly pricingTiers = [
    PricingTierType.Standard,
    PricingTierType.EarlyBird,
    PricingTierType.InPerson,
  ];
  readonly studentLevelOptions: string[] = Object.values(StudentLevel).filter(
    (l) => l !== '',
  );
  readonly applicationLevelOptions: string[] = Object.values(ApplicationLevel).filter(
    (l) => l !== '',
  );

  eventId = computed(() => this.viewSignals.pathVars.eventId());
  registrationId = computed(() => this.viewSignals.pathVars.registrationId());

  isLoading = signal<boolean>(true);
  loadError = signal<string | null>(null);
  event = signal<IlcEvent | null>(null);
  product = signal<Product | null>(null);
  registration = signal<EventRegistration | null>(null);

  // Action states
  isSaving = signal<boolean>(false);
  saveSuccessMessage = signal<string | null>(null);
  saveErrorMessage = signal<string | null>(null);
  recalcMessage = signal<string | null>(null);
  quickPayConfirm = signal<QuickPayConfirmAction>(QuickPayConfirmAction.None);
  isQuickUpdatingPay = signal<boolean>(false);

  // Editable form signals
  formName = signal<string>('');
  formEmail = signal<string>('');
  formPhone = signal<string>('');
  formNotes = signal<string>('');
  formMemberDocId = signal<string>('');
  formMemberId = signal<string>('');
  formMemberSelectorValue = signal<string>('');
  formStudentLevel = signal<string>('');
  formApplicationLevel = signal<string>('');
  formRole = signal<AttendeeRole>(AttendeeRole.NonMember);

  formOptionId = signal<string>('');
  formOptionLabel = signal<string>('');
  formAttendance = signal<AttendanceType>(AttendanceType.InPerson);
  formSelectedSuboptions = signal<string[]>([]);
  formSelectedAddOnIds = signal<string[]>([]);
  formSelectedAddOnLabels = signal<string[]>([]);
  formAutoGrantedAddOnIds = signal<string[]>([]);
  formHasVideoAccess = signal<boolean>(false);
  formCapacityUsage = signal<Record<string, number>>({});

  formStatus = signal<EventRegistrationStatus>(EventRegistrationStatus.Paid);
  formPaidInFullOffline = signal<boolean>(false);
  formPaymentMethod = signal<RegistrationPaymentMethod>(RegistrationPaymentMethod.Stripe);
  formPaymentChoice = signal<PaymentChoice>(PaymentChoice.Full);
  formPricingTierType = signal<PricingTierType>(PricingTierType.Standard);
  formCurrency = signal<string>('USD');
  formTotalPriceMajor = signal<string>('0.00');
  formDepositPaidMajor = signal<string>('0.00');
  formAmountPaidMajor = signal<string>('0.00');
  formAmountDueMajor = signal<string>('0.00');
  formPaidAtDate = signal<string>('');
  private originalPaidAtIso = signal<string>('');

  formQuestionResponses = signal<EventRegistrationQuestionResponse[]>([]);

  private loadSeq = 0;

  isAdmin = computed(() => Boolean(this.firebaseState.user()?.isAdmin));

  isEventOrganizer = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return false;
    const ev = this.event();
    if (!ev) return false;

    const myDocId = user.member?.docId;
    if (
      myDocId &&
      (ev.ownerDocId === myDocId || (ev.managerDocIds || []).includes(myDocId))
    ) {
      return true;
    }

    const emails = [user.firebaseUser?.email, ...(user.member?.emails || [])]
      .filter((e): e is string => Boolean(e))
      .map((e) => e.toLowerCase().trim());
    if (emails.length > 0) {
      const owners = (ev.ownerEmails || []).map((e) => e.toLowerCase().trim());
      const managers = (ev.managerEmails || []).map((e) => e.toLowerCase().trim());
      if (emails.some((em) => owners.includes(em) || managers.includes(em))) {
        return true;
      }
    }
    return false;
  });

  canView = computed(() => this.isAdmin() || this.isEventOrganizer());
  canEdit = computed(() => this.isAdmin());

  configuredOptions = computed<EventRegistrationOption[]>(
    () => this.product()?.pricingRules.registrationOptions ?? [],
  );

  selectedConfiguredOption = computed<EventRegistrationOption | null>(() => {
    const optId = this.formOptionId();
    if (!optId) return null;
    return this.configuredOptions().find((o) => o.id === optId) ?? null;
  });

  availableSuboptionsForSelectedOption = computed<string[]>(() => {
    const opt = this.selectedConfiguredOption();
    const fromRule =
      opt && opt.subSelection.kind === SubSelectionKind.PickSuboptions
        ? opt.subSelection.availableSuboptions
        : [];
    const current = this.formSelectedSuboptions();
    return Array.from(new Set([...fromRule, ...current]));
  });

  configuredAddOns = computed<EventAddOn[]>(
    () => this.product()?.pricingRules.addOns ?? [],
  );

  unmatchedAddOnLabels = computed<string[]>(() => {
    const knownIds = new Set(this.configuredAddOns().map((a) => a.id));
    const ids = this.formSelectedAddOnIds();
    const labels = this.formSelectedAddOnLabels();
    if (ids.length === 0 && labels.length > 0) {
      return labels;
    }
    const extras: string[] = [];
    ids.forEach((id, idx) => {
      if (!knownIds.has(id)) {
        extras.push(labels[idx] || id);
      }
    });
    return extras;
  });

  effectiveCapacities = computed<EventCapacity[]>(() => {
    const ev = this.event();
    if (ev && ev.capacities.length > 0) {
      return ev.capacities;
    }
    return this.product()?.pricingRules.capacities ?? [];
  });

  capacityPoolRows = computed(() => {
    const caps = this.effectiveCapacities();
    const counts = this.event()?.capacityCounts ?? this.product()?.capacityCounts ?? {};
    const usage = this.formCapacityUsage();
    const seen = new Set<string>();
    const rows: {
      id: string;
      label: string;
      limit: number | null;
      totalUsed: number;
      heldUnits: number;
    }[] = [];

    for (const cap of caps) {
      seen.add(cap.id);
      rows.push({
        id: cap.id,
        label: cap.label || cap.id,
        limit: cap.limit,
        totalUsed: counts[cap.id] || 0,
        heldUnits: usage[cap.id] || 0,
      });
    }
    for (const [capId, units] of Object.entries(usage)) {
      if (!seen.has(capId)) {
        rows.push({
          id: capId,
          label: capId,
          limit: null,
          totalUsed: counts[capId] || 0,
          heldUnits: units,
        });
      }
    }
    return rows;
  });

  linkedMember = computed<Member | null>(() => {
    const docId = this.formMemberDocId();
    const memberId = this.formMemberId();
    if (docId) {
      const byDoc = this.dataService.getMemberByDocId(docId);
      if (byDoc) return byDoc;
    }
    if (memberId) {
      const byId = this.dataService.getMemberByMemberId(memberId);
      if (byId) return byId;
    }
    return null;
  });

  mergedQuestions = computed<MergedQuestionItem[]>(() => {
    const items: MergedQuestionItem[] = [];
    const seen = new Set<string>();
    const configured: EventRegistrationQuestion[] =
      this.product()?.pricingRules.questions ?? [];

    for (const q of configured) {
      if (!q.id || seen.has(q.id)) continue;
      seen.add(q.id);
      items.push({
        questionId: q.id,
        label: q.label || q.id,
        description: q.description,
        required: q.required,
        kind: q.spec.kind,
        options:
          q.spec.kind === RegistrationQuestionKind.Select ||
          q.spec.kind === RegistrationQuestionKind.Checkboxes
            ? q.spec.options
            : [],
        placeholder:
          q.spec.kind === RegistrationQuestionKind.ShortText ||
          q.spec.kind === RegistrationQuestionKind.LongText
            ? q.spec.placeholder
            : '',
        isArchived: false,
      });
    }

    for (const resp of this.formQuestionResponses()) {
      if (!resp.questionId || seen.has(resp.questionId)) continue;
      seen.add(resp.questionId);
      items.push({
        questionId: resp.questionId,
        label: resp.questionLabel || resp.questionId,
        description: '',
        required: false,
        kind: resp.kind,
        options: resp.selectedOptions,
        placeholder: '',
        isArchived: true,
      });
    }

    return items;
  });

  isDirty = computed<boolean>(() => {
    const reg = this.registration();
    if (!reg || !this.canEdit()) return false;
    const current = this.buildFieldsPayload();
    const baseline = this.registrationToEditableFields(reg);
    return !deepObjEq(current, baseline);
  });

  constructor() {
    effect(() => {
      const evId = this.eventId();
      const regId = this.registrationId();
      if (evId && regId) {
        void this.loadData(evId, regId);
      }
    });
  }

  async loadData(evId: string = this.eventId(), regId: string = this.registrationId()) {
    if (!evId || !regId) return;
    const seq = ++this.loadSeq;
    this.isLoading.set(true);
    this.loadError.set(null);

    try {
      const [ev, reg] = await Promise.all([
        this.dataService.getEventById(evId),
        this.productService.getEventRegistration(evId, regId),
      ]);
      if (seq !== this.loadSeq) return;

      const prod = ev?.productId
        ? await this.productService.getProduct(ev.productId)
        : reg?.productId
          ? await this.productService.getProduct(reg.productId)
          : await this.productService.getProductByEventId(evId);
      if (seq !== this.loadSeq) return;

      this.event.set(ev ?? null);
      this.product.set(prod ?? null);
      this.registration.set(reg);

      if (ev?.title) {
        this.eventTitleLoaded.emit(ev.title);
      }

      if (reg) {
        this.populateFormFromRegistration(reg, ev ?? null, prod ?? null);
        const label = reg.name.trim() || reg.email.trim() || reg.docId;
        this.titleLoaded.emit(`Registration: ${label}`);
      } else {
        this.titleLoaded.emit('Registration Not Found');
      }
    } catch (err: unknown) {
      if (seq !== this.loadSeq) return;
      console.error('Error loading event registration view:', err);
      this.loadError.set(
        err instanceof Error ? err.message : 'Failed to load registration details.',
      );
      this.titleLoaded.emit('Error Loading Registration');
    } finally {
      if (seq === this.loadSeq) {
        this.isLoading.set(false);
      }
    }
  }

  populateFormFromRegistration(
    reg: EventRegistration,
    ev: IlcEvent | null = this.event(),
    prod: Product | null = this.product(),
  ) {
    this.formName.set(reg.name);
    this.formEmail.set(reg.email);
    this.formPhone.set(reg.phone);
    this.formNotes.set(reg.notes);
    this.formMemberDocId.set(reg.memberDocId);
    this.formMemberId.set(reg.memberId);
    this.formMemberSelectorValue.set(reg.memberId || reg.memberDocId || '');
    this.formStudentLevel.set(reg.studentLevel);
    this.formApplicationLevel.set(reg.applicationLevel);
    this.formRole.set(reg.role);

    this.formOptionId.set(reg.optionId);
    this.formOptionLabel.set(reg.optionLabel);
    this.formAttendance.set(reg.attendance);
    this.formSelectedSuboptions.set([...reg.selectedSuboptions]);
    this.formSelectedAddOnIds.set([...reg.selectedAddOnIds]);
    this.formSelectedAddOnLabels.set([...reg.selectedAddOnLabels]);
    this.formAutoGrantedAddOnIds.set([...reg.autoGrantedAddOnIds]);
    this.formHasVideoAccess.set(reg.hasVideoAccess);

    const caps =
      ev && ev.capacities.length > 0
        ? ev.capacities
        : prod?.pricingRules.capacities ?? [];
    const effectiveCapUsage =
      Object.keys(reg.capacityUsage).length > 0
        ? normalizeCapacityMap(reg.capacityUsage)
        : computeEffectiveCapacityUsage(reg, caps);
    this.formCapacityUsage.set(effectiveCapUsage);

    this.formStatus.set(reg.status);
    this.formPaidInFullOffline.set(reg.paidInFullOffline);
    this.formPaymentMethod.set(reg.paymentMethod);
    this.formPaymentChoice.set(reg.paymentChoice);
    this.formPricingTierType.set(reg.pricingTierType);
    this.formCurrency.set((reg.currency || 'usd').toUpperCase());
    this.formTotalPriceMajor.set(this.centsToMajorString(reg.totalPriceCents));
    this.formDepositPaidMajor.set(this.centsToMajorString(reg.depositPaidCents));
    this.formAmountPaidMajor.set(this.centsToMajorString(reg.amountPaidCents));
    this.formAmountDueMajor.set(this.centsToMajorString(reg.amountDueCents));
    this.originalPaidAtIso.set(reg.paidAt || '');
    this.formPaidAtDate.set(this.isoToDateInput(reg.paidAt));

    this.formQuestionResponses.set(
      reg.questionResponses.map((r) => ({
        ...r,
        selectedOptions: [...r.selectedOptions],
      })),
    );
  }

  resetChanges() {
    const reg = this.registration();
    if (!reg) return;
    this.saveErrorMessage.set(null);
    this.saveSuccessMessage.set(null);
    this.recalcMessage.set(null);
    this.populateFormFromRegistration(reg);
  }

  private centsToMajorString(cents: number): string {
    const safe = Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : 0;
    return (safe / 100).toFixed(2);
  }

  private majorStringToCents(raw: string): number {
    const cleaned = (raw || '').trim().replace(/[^0-9.]/g, '');
    if (!cleaned) return 0;
    const parsed = Number.parseFloat(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.round(parsed * 100);
  }

  private isoToDateInput(iso: string): string {
    if (!iso) return '';
    const trimmed = iso.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  private resolvePaidAtForSave(): string {
    const dateVal = this.formPaidAtDate().trim();
    if (!dateVal) return '';
    const orig = this.originalPaidAtIso().trim();
    if (orig && this.isoToDateInput(orig) === dateVal) {
      return orig;
    }
    return `${dateVal}T00:00:00.000Z`;
  }

  private registrationToEditableFields(
    reg: EventRegistration,
  ): AdminUpdateEventRegistrationFields {
    const ev = this.event();
    const prod = this.product();
    const caps =
      ev && ev.capacities.length > 0
        ? ev.capacities
        : prod?.pricingRules.capacities ?? [];
    const baselineCapUsage =
      Object.keys(reg.capacityUsage).length > 0
        ? normalizeCapacityMap(reg.capacityUsage)
        : computeEffectiveCapacityUsage(reg, caps);

    return {
      name: reg.name.trim(),
      email: reg.email.trim().toLowerCase(),
      phone: reg.phone.trim(),
      notes: reg.notes.trim(),
      memberDocId: reg.memberDocId.trim(),
      memberId: reg.memberId.trim(),
      studentLevel: reg.studentLevel.trim(),
      applicationLevel: reg.applicationLevel.trim(),
      role: reg.role,
      attendance: reg.attendance,
      optionId: reg.optionId.trim(),
      optionLabel: reg.optionLabel.trim(),
      selectedSuboptions: reg.selectedSuboptions.map((s) => s.trim()).filter(Boolean),
      selectedAddOnIds: reg.selectedAddOnIds.map((s) => s.trim()).filter(Boolean),
      selectedAddOnLabels: reg.selectedAddOnLabels.map((s) => s.trim()).filter(Boolean),
      autoGrantedAddOnIds: reg.autoGrantedAddOnIds.map((s) => s.trim()).filter(Boolean),
      hasVideoAccess: Boolean(reg.hasVideoAccess),
      capacityUsage: baselineCapUsage,
      status: reg.status,
      paymentMethod: reg.paymentMethod,
      paymentChoice: reg.paymentChoice,
      pricingTierType: reg.pricingTierType,
      totalPriceCents: Math.max(0, Math.round(reg.totalPriceCents)),
      depositPaidCents: Math.max(0, Math.round(reg.depositPaidCents)),
      amountPaidCents: Math.max(0, Math.round(reg.amountPaidCents)),
      amountDueCents: Math.max(0, Math.round(reg.amountDueCents)),
      currency: (reg.currency || 'usd').trim().toLowerCase(),
      paidInFullOffline: Boolean(reg.paidInFullOffline),
      paidAt: reg.paidAt.trim(),
      questionResponses: reg.questionResponses
        .filter((r) => Boolean(r.questionId.trim()))
        .map((r) => ({
          questionId: r.questionId.trim(),
          questionLabel: (r.questionLabel || r.questionId).trim(),
          kind: r.kind,
          answerText: r.answerText.trim(),
          selectedOptions: r.selectedOptions.map((s) => s.trim()).filter(Boolean),
        })),
    };
  }

  buildFieldsPayload(): AdminUpdateEventRegistrationFields {
    return {
      name: this.formName().trim(),
      email: this.formEmail().trim().toLowerCase(),
      phone: this.formPhone().trim(),
      notes: this.formNotes().trim(),
      memberDocId: this.formMemberDocId().trim(),
      memberId: this.formMemberId().trim(),
      studentLevel: this.formStudentLevel().trim(),
      applicationLevel: this.formApplicationLevel().trim(),
      role: this.formRole(),
      attendance: this.formAttendance(),
      optionId: this.formOptionId().trim(),
      optionLabel: this.formOptionLabel().trim(),
      selectedSuboptions: this.formSelectedSuboptions().map((s) => s.trim()).filter(Boolean),
      selectedAddOnIds: this.formSelectedAddOnIds().map((s) => s.trim()).filter(Boolean),
      selectedAddOnLabels: this.formSelectedAddOnLabels().map((s) => s.trim()).filter(Boolean),
      autoGrantedAddOnIds: this.formAutoGrantedAddOnIds().map((s) => s.trim()).filter(Boolean),
      hasVideoAccess: Boolean(this.formHasVideoAccess()),
      capacityUsage: normalizeCapacityMap(this.formCapacityUsage()),
      status: this.formStatus(),
      paymentMethod: this.formPaymentMethod(),
      paymentChoice: this.formPaymentChoice(),
      pricingTierType: this.formPricingTierType(),
      totalPriceCents: this.majorStringToCents(this.formTotalPriceMajor()),
      depositPaidCents: this.majorStringToCents(this.formDepositPaidMajor()),
      amountPaidCents: this.majorStringToCents(this.formAmountPaidMajor()),
      amountDueCents: this.majorStringToCents(this.formAmountDueMajor()),
      currency: (this.formCurrency() || 'usd').trim().toLowerCase(),
      paidInFullOffline: Boolean(this.formPaidInFullOffline()),
      paidAt: this.resolvePaidAtForSave(),
      questionResponses: this.formQuestionResponses()
        .filter(
          (r) =>
            Boolean(r.questionId.trim()) &&
            (Boolean(r.answerText.trim()) || r.selectedOptions.length > 0),
        )
        .map((r) => ({
          questionId: r.questionId.trim(),
          questionLabel: (r.questionLabel || r.questionId).trim(),
          kind: r.kind,
          answerText: r.answerText.trim(),
          selectedOptions: r.selectedOptions.map((s) => s.trim()).filter(Boolean),
        })),
    };
  }

  onMemberSelectorValueChange(val: string) {
    this.formMemberSelectorValue.set(val);
    if (!val.trim()) {
      this.formMemberDocId.set('');
      this.formMemberId.set('');
    }
  }

  onMemberSelected(member: Member | null) {
    if (!member) return;
    this.formMemberDocId.set(member.docId);
    this.formMemberId.set(member.memberId || '');
    this.formMemberSelectorValue.set(member.memberId || member.docId);
    if (!this.formStudentLevel() && member.studentLevel) {
      this.formStudentLevel.set(member.studentLevel);
    }
    if (!this.formApplicationLevel() && member.applicationLevel) {
      this.formApplicationLevel.set(member.applicationLevel);
    }
  }

  unlinkMember() {
    this.formMemberDocId.set('');
    this.formMemberId.set('');
    this.formMemberSelectorValue.set('');
  }

  syncRoleAndLevelsFromMember() {
    const member = this.linkedMember();
    if (!member) return;
    const ctx = toMemberStatusContext({ member, isAdmin: false });
    this.formRole.set(getAttendeeRoleForStatus(ctx));
    this.formStudentLevel.set(member.studentLevel || '');
    this.formApplicationLevel.set(member.applicationLevel || '');
  }

  onConfiguredOptionChange(optionId: string) {
    this.formOptionId.set(optionId);
    const opt = this.configuredOptions().find((o) => o.id === optionId);
    if (!opt) return;
    this.formOptionLabel.set(opt.label);
    this.formAttendance.set(opt.attendanceType);
    this.formCapacityUsage.set(normalizeCapacityMap(opt.capacityUsage));
    if (opt.attendanceType === AttendanceType.VideoOnly) {
      this.formHasVideoAccess.set(true);
    }
    if (opt.subSelection.kind === SubSelectionKind.PickSuboptions) {
      const valid = this.formSelectedSuboptions().filter((s) =>
        opt.subSelection.kind === SubSelectionKind.PickSuboptions &&
        opt.subSelection.availableSuboptions.includes(s),
      );
      this.formSelectedSuboptions.set(valid);
    } else {
      this.formSelectedSuboptions.set([]);
    }
  }

  isSuboptionChecked(sub: string): boolean {
    return this.formSelectedSuboptions().includes(sub);
  }

  toggleSuboption(sub: string, checked: boolean) {
    const current = this.formSelectedSuboptions();
    if (checked) {
      if (!current.includes(sub)) {
        this.formSelectedSuboptions.set([...current, sub]);
      }
    } else {
      this.formSelectedSuboptions.set(current.filter((s) => s !== sub));
    }
  }

  isAddOnChecked(addOnId: string): boolean {
    return this.formSelectedAddOnIds().includes(addOnId);
  }

  isAutoGrantedAddOn(addOnId: string): boolean {
    return this.formAutoGrantedAddOnIds().includes(addOnId);
  }

  toggleConfiguredAddOn(addOn: EventAddOn, checked: boolean) {
    const configured = this.configuredAddOns();
    const nextIds = checked
      ? Array.from(new Set([...this.formSelectedAddOnIds(), addOn.id]))
      : this.formSelectedAddOnIds().filter((id) => id !== addOn.id);

    const nextLabels = nextIds.map((id) => {
      const found = configured.find((a) => a.id === id);
      if (found) return found.label;
      const oldIdx = this.formSelectedAddOnIds().indexOf(id);
      return oldIdx >= 0 ? this.formSelectedAddOnLabels()[oldIdx] || id : id;
    });

    this.formSelectedAddOnIds.set(nextIds);
    this.formSelectedAddOnLabels.set(nextLabels);
    if (!checked) {
      this.formAutoGrantedAddOnIds.set(
        this.formAutoGrantedAddOnIds().filter((id) => id !== addOn.id),
      );
    }
    if (checked && addOn.spec.kind === EventAddOnKind.EventRecording) {
      this.formHasVideoAccess.set(true);
    }
  }

  updateCapacityUnits(capId: string, rawVal: string) {
    const parsed = Number.parseInt(rawVal, 10);
    const units = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const next = { ...this.formCapacityUsage() };
    if (units > 0) {
      next[capId] = units;
    } else {
      delete next[capId];
    }
    this.formCapacityUsage.set(next);
  }

  private resolveAttendeeStatusContext(): MemberStatusContext {
    const member = this.linkedMember();
    if (member) {
      return toMemberStatusContext({ member, isAdmin: false });
    }
    const role = this.formRole();
    if (role === AttendeeRole.Instructor) {
      return {
        hasAccount: true,
        isAdmin: false,
        member: {
          membershipType: MembershipType.Annual,
          currentMembershipExpires: '9999-12-31',
          instructorId: 'INST',
          instructorLicenseType: InstructorLicenseType.Annual,
          instructorLicenseExpires: '9999-12-31',
        },
      };
    }
    if (role === AttendeeRole.Member) {
      return {
        hasAccount: true,
        isAdmin: false,
        member: {
          membershipType: MembershipType.Annual,
          currentMembershipExpires: '9999-12-31',
          instructorId: '',
          instructorLicenseType: InstructorLicenseType.None,
          instructorLicenseExpires: '',
        },
      };
    }
    return PUBLIC_MEMBER_STATUS_CONTEXT;
  }

  recalculatePriceFromRules() {
    const prod = this.product();
    if (!prod) return;
    const rules = prod.pricingRules;
    const ev = this.event();
    const reg = this.registration();

    const optId =
      this.formOptionId() ||
      rules.registrationOptions.find((o) => o.attendanceType === this.formAttendance())?.id ||
      '';
    const isPaidFull =
      this.formStatus() === EventRegistrationStatus.Paid ||
      this.formPaidInFullOffline() ||
      (reg ? isRegistrationPaidInFull(reg) : false);

    const quote = evaluateEventPricingQuote({
      rules,
      memberContext: this.resolveAttendeeStatusContext(),
      isAdmin: true,
      isEventPast: false,
      eventStartDate: ev?.start || '',
      selectedOptionId: optId,
      selectedSuboptions: this.formSelectedSuboptions(),
      selectedAddOnIds: this.formSelectedAddOnIds(),
      paymentChoice: this.formPaymentChoice(),
      isExistingRegistrationPaidInFull: isPaidFull,
    });

    let totalCents = quote.totalPriceCents;
    let noteParts: string[] = [];

    if (!quote.selectedOption) {
      // Fallback manual sum if option is custom or rules couldn't select it
      const opt = rules.registrationOptions.find((o) => o.id === optId);
      const optPrice = opt?.priceCents ?? 0;
      const addOnsPrice = this.formSelectedAddOnIds().reduce((sum, id) => {
        const a = rules.addOns.find((item) => item.id === id);
        return sum + (a ? Math.max(0, a.priceCents) : 0);
      }, 0);
      totalCents = optPrice + addOnsPrice;
      noteParts.push(`Option + add-ons sum: ${this.formatAmount(totalCents, this.formCurrency())}`);
    } else {
      noteParts.push(
        `${quote.selectedOption.option.label}: ${this.formatAmount(quote.selectedOption.netPriceCents, this.formCurrency())}`,
      );
      if (quote.addOnsTotalCents > 0) {
        noteParts.push(
          `Add-ons: ${this.formatAmount(quote.addOnsTotalCents, this.formCurrency())}`,
        );
      }
    }

    const paidCents = this.majorStringToCents(this.formAmountPaidMajor());
    const dueCents =
      this.formStatus() === EventRegistrationStatus.Cancelled ||
      this.formStatus() === EventRegistrationStatus.Refunded
        ? 0
        : Math.max(0, totalCents - paidCents);

    this.formTotalPriceMajor.set(this.centsToMajorString(totalCents));
    this.formAmountDueMajor.set(this.centsToMajorString(dueCents));
    this.recalcMessage.set(
      `Recalculated from pricing rules (${noteParts.join(' + ')}) — review and click Save Changes to apply.`,
    );
  }

  setPaidAtToday() {
    this.formPaidAtDate.set(new Date().toISOString().slice(0, 10));
  }

  clearPaidAt() {
    this.formPaidAtDate.set('');
  }

  getQuestionResponse(questionId: string): EventRegistrationQuestionResponse | undefined {
    return this.formQuestionResponses().find((r) => r.questionId === questionId);
  }

  getQuestionTextAnswer(item: MergedQuestionItem): string {
    return this.getQuestionResponse(item.questionId)?.answerText ?? '';
  }

  getQuestionSelectedOption(item: MergedQuestionItem): string {
    const resp = this.getQuestionResponse(item.questionId);
    return resp?.selectedOptions[0] ?? resp?.answerText ?? '';
  }

  isQuestionOptionChecked(item: MergedQuestionItem, opt: string): boolean {
    const resp = this.getQuestionResponse(item.questionId);
    return resp ? resp.selectedOptions.includes(opt) : false;
  }

  updateQuestionText(item: MergedQuestionItem, value: string) {
    this.upsertQuestionResponse(item, {
      answerText: value,
      selectedOptions: [],
    });
  }

  updateQuestionSelect(item: MergedQuestionItem, value: string) {
    this.upsertQuestionResponse(item, {
      answerText: value,
      selectedOptions: value ? [value] : [],
    });
  }

  toggleQuestionCheckbox(item: MergedQuestionItem, opt: string, checked: boolean) {
    const existing = this.getQuestionResponse(item.questionId)?.selectedOptions ?? [];
    const next = checked
      ? Array.from(new Set([...existing, opt]))
      : existing.filter((o) => o !== opt);
    this.upsertQuestionResponse(item, {
      answerText: next.join(', '),
      selectedOptions: next,
    });
  }

  private upsertQuestionResponse(
    item: MergedQuestionItem,
    patch: { answerText: string; selectedOptions: string[] },
  ) {
    const current = this.formQuestionResponses();
    const idx = current.findIndex((r) => r.questionId === item.questionId);
    const updatedEntry: EventRegistrationQuestionResponse = {
      questionId: item.questionId,
      questionLabel: item.label,
      kind: item.kind,
      answerText: patch.answerText,
      selectedOptions: patch.selectedOptions,
    };
    if (idx >= 0) {
      const copy = [...current];
      copy[idx] = updatedEntry;
      this.formQuestionResponses.set(copy);
    } else {
      this.formQuestionResponses.set([...current, updatedEntry]);
    }
  }

  formatQuestionReadonly(item: MergedQuestionItem): string {
    const resp = this.getQuestionResponse(item.questionId);
    if (!resp) return '—';
    return formatQuestionResponseValue(resp) || '—';
  }

  canMarkPaidInFull(reg: EventRegistration): boolean {
    return (
      reg.status !== EventRegistrationStatus.Paid &&
      reg.status !== EventRegistrationStatus.Cancelled &&
      reg.status !== EventRegistrationStatus.Refunded
    );
  }

  canUnmarkPaid(reg: EventRegistration): boolean {
    if (reg.status !== EventRegistrationStatus.Paid) return false;
    return (
      reg.paidInFullOffline ||
      reg.paymentMethod === RegistrationPaymentMethod.InPerson ||
      (reg.depositPaidCents > 0 && reg.totalPriceCents > reg.depositPaidCents)
    );
  }

  async confirmQuickPayToggle() {
    const reg = this.registration();
    const action = this.quickPayConfirm();
    if (!reg || action === QuickPayConfirmAction.None) return;

    this.isQuickUpdatingPay.set(true);
    this.saveErrorMessage.set(null);
    this.saveSuccessMessage.set(null);

    try {
      if (action === QuickPayConfirmAction.MarkPaid) {
        const res = await this.stripeService.markEventRegistrationPaid({
          eventId: this.eventId(),
          registrationId: reg.docId,
        });
        if (!res.success) {
          throw new Error('Failed to mark registration as paid in full.');
        }
        this.saveSuccessMessage.set('Registration marked as paid in full.');
      } else {
        const res = await this.stripeService.unmarkEventRegistrationPaid({
          eventId: this.eventId(),
          registrationId: reg.docId,
        });
        if (!res.success) {
          throw new Error('Failed to revert offline payment status.');
        }
        this.saveSuccessMessage.set('Offline full payment reverted.');
      }
      this.quickPayConfirm.set(QuickPayConfirmAction.None);
      await this.loadData();
    } catch (err: unknown) {
      console.error('Error toggling registration paid status:', err);
      this.saveErrorMessage.set(
        err instanceof Error ? err.message : 'Failed to update payment status.',
      );
    } finally {
      this.isQuickUpdatingPay.set(false);
    }
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    if (!this.canEdit() || this.isSaving()) return;
    const reg = this.registration();
    if (!reg) return;

    this.saveErrorMessage.set(null);
    this.saveSuccessMessage.set(null);
    this.recalcMessage.set(null);

    const payload = this.buildFieldsPayload();
    if (!payload.name) {
      this.saveErrorMessage.set('Attendee full name is required.');
      return;
    }
    if (!payload.email || !payload.email.includes('@')) {
      this.saveErrorMessage.set('A valid attendee email address is required.');
      return;
    }
    if (!/^[a-z]{3}$/.test(payload.currency)) {
      this.saveErrorMessage.set('Currency must be a 3-letter ISO code (e.g. USD, EUR, GBP).');
      return;
    }

    this.isSaving.set(true);
    try {
      const result = await this.stripeService.adminUpdateEventRegistration({
        eventId: this.eventId(),
        registrationId: reg.docId,
        updates: payload,
      });

      if (result.success && result.registration) {
        this.registration.set(result.registration);
        this.populateFormFromRegistration(result.registration);
        const label =
          result.registration.name.trim() ||
          result.registration.email.trim() ||
          result.registration.docId;
        this.titleLoaded.emit(`Registration: ${label}`);
        this.saveSuccessMessage.set('Registration changes saved.');
      } else {
        this.saveErrorMessage.set('Failed to save registration changes.');
      }
    } catch (err: unknown) {
      console.error('Error saving registration changes:', err);
      this.saveErrorMessage.set(
        err instanceof Error ? err.message : 'Failed to save registration changes.',
      );
    } finally {
      this.isSaving.set(false);
    }
  }

  // Typed DOM event helpers (avoids $any in templates)
  eventValue(event: Event): string {
    const target = event.target as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | null;
    return target?.value ?? '';
  }

  eventChecked(event: Event): boolean {
    const target = event.target as HTMLInputElement | null;
    return Boolean(target?.checked);
  }

  onStatusSelectChange(event: Event) {
    const val = this.eventValue(event);
    const match = this.registrationStatuses.find((s) => s === val);
    if (match) {
      this.formStatus.set(match);
    }
  }

  isKnownStudentLevel(lvl: string): boolean {
    return this.studentLevelOptions.includes(lvl);
  }

  isKnownApplicationLevel(lvl: string): boolean {
    return this.applicationLevelOptions.includes(lvl);
  }

  // Formatting & navigation helpers
  eventUrl(): string {
    return this.routingService.hrefForView(Views.EventView, { eventId: this.eventId() });
  }

  registrationsListUrl(): string {
    return this.routingService.hrefForView(Views.EventRegistrations, {
      eventId: this.eventId(),
    });
  }

  orderUrl(orderId: string): string {
    return this.routingService.hrefForView(Views.OrderView, { orderId });
  }

  memberUrl(memberIdOrDocId: string): string {
    return this.routingService.hrefForView(Views.ManageMemberView, {
      memberId: memberIdOrDocId,
    });
  }

  hasLinkedStripeOrder(reg: EventRegistration): boolean {
    if (!reg.orderDocId) return false;
    // In-person registrations set orderDocId === registrationId without an /orders doc unless Stripe was used
    if (reg.orderDocId === reg.docId && !reg.stripeSessionId) {
      return false;
    }
    return true;
  }

  formatRole(role: AttendeeRole): string {
    switch (role) {
      case AttendeeRole.Instructor:
        return 'Instructor';
      case AttendeeRole.Member:
        return 'Member';
      case AttendeeRole.NonMember:
      default:
        return 'Non-Member';
    }
  }

  formatAttendance(att: AttendanceType): string {
    if (att === AttendanceType.InPersonAndOnline) return 'In-Person & Online';
    if (att === AttendanceType.Online) return 'Online';
    if (att === AttendanceType.VideoOnly) return 'Video Pre-Order';
    return 'In-Person';
  }

  formatStatusBadge(reg: EventRegistration): string {
    switch (reg.status) {
      case EventRegistrationStatus.Paid:
        return reg.paidInFullOffline ? 'PAID IN FULL (OFFLINE)' : 'PAID IN FULL';
      case EventRegistrationStatus.DepositPaid:
        return 'DEPOSIT PAID';
      case EventRegistrationStatus.PendingInPerson:
        return 'PAY AT DOOR';
      case EventRegistrationStatus.Cancelled:
        return 'CANCELLED';
      case EventRegistrationStatus.Refunded:
        return 'REFUNDED';
      default:
        return String(reg.status || '').toUpperCase();
    }
  }

  formatStatusOptionLabel(status: EventRegistrationStatus): string {
    switch (status) {
      case EventRegistrationStatus.Paid:
        return 'Paid in Full';
      case EventRegistrationStatus.DepositPaid:
        return 'Deposit Paid';
      case EventRegistrationStatus.PendingInPerson:
        return 'Pending (Pay at Door)';
      case EventRegistrationStatus.Cancelled:
        return 'Cancelled';
      case EventRegistrationStatus.Refunded:
        return 'Refunded';
    }
  }

  formatPaymentMethodLabel(method: RegistrationPaymentMethod): string {
    return method === RegistrationPaymentMethod.InPerson
      ? 'In-Person / Offline'
      : 'Stripe (Online)';
  }

  formatPaymentChoiceLabel(choice: PaymentChoice): string {
    switch (choice) {
      case PaymentChoice.Deposit:
        return 'Deposit + Balance at Door';
      case PaymentChoice.PayAtDoor:
        return 'Pay at Door';
      case PaymentChoice.Full:
      default:
        return 'Full Payment';
    }
  }

  formatPricingTierLabel(tier: PricingTierType): string {
    switch (tier) {
      case PricingTierType.EarlyBird:
        return 'Early-Bird';
      case PricingTierType.InPerson:
        return 'At Door';
      case PricingTierType.Standard:
      default:
        return 'Standard';
    }
  }

  formatStudentLevel(lvl: string): string {
    return studentLevelLabel(lvl) || lvl.trim();
  }

  formatApplicationLevel(lvl: string): string {
    const parsed = toApplicationLevel(lvl);
    return parsed ? `Application ${parsed}` : lvl.trim();
  }

  formatAmount(cents: number, currency: string = 'usd'): string {
    const amount = ((cents || 0) / 100).toFixed(2);
    const curr = (currency || 'usd').toUpperCase();
    if (curr === 'USD') return `$${amount}`;
    if (curr === 'EUR') return `€${amount}`;
    if (curr === 'GBP') return `£${amount}`;
    return `${curr} ${amount}`;
  }

  formatDateTime(val: string): string {
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (Number.isNaN(d.getTime())) return val;
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return val;
    }
  }
}
