/* product-view.ts
 *
 * Public event registration, upgrade, and checkout page.
 * Evaluates compositional EventPricingRules via evaluateEventPricingQuote,
 * live-watches /events/{eventId} via onSnapshot for real-time capacity enforcement,
 * and supports full online payment, deposit + cash at door, pay-at-door registration,
 * sub-options, add-ons, person-status discounts, and registration upgrades.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ProductService } from '../product.service';
import { StripeService } from '../stripe.service';
import { NetworkStateService } from '../network-state.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownViewer } from '../markdown-editor/markdown-viewer';
import { formatDateRange } from '../events-calendar/format-date-range';
import {
  AttendeeRole,
  AttendanceType,
  computeEffectiveCapacityUsage,
  DepositPolicyKind,
  DepositRefundPolicyKind,
  EarlyBirdPolicyKind,
  EvaluatedAddOn,
  EvaluatedDiscount,
  EvaluatedRegistrationOption,
  evaluateEventPricingQuote,
  EventAddOnKind,
  EventPricingQuote,
  EventPricingRules,
  EventRegistration,
  EventRegistrationQuestionResponse,
  EventRegistrationStatus,
  EventRuleConditions,
  formatQuestionResponseValue,
  hasQuestionResponseValue,
  IlcEvent,
  isEventPast,
  MAX_LONG_TEXT_ANSWER_LENGTH,
  MAX_SHORT_TEXT_ANSWER_LENGTH,
  mergeImmutableQuestionResponses,
  PaymentChoice,
  PersonStatusKind,
  PricingValidationErrorCode,
  Product,
  QuestionAnswerInput,
  RegistrationPaymentMethod,
  RegistrationQuestionKind,
  SubSelectionKind,
  validateAndBuildQuestionResponses,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';
import {
  getAttendeeRoleForStatus,
  isLifeMember,
  toMemberStatusContext,
} from '../../../functions/src/data-model/members';
import { environment } from '../../environments/environment';
import { InlineAuthComponent } from '../inline-auth/inline-auth.component';

@Component({
  selector: 'app-product-view',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent, MarkdownViewer, InlineAuthComponent],
  templateUrl: './product-view.html',
  styleUrl: './product-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductViewComponent implements OnInit {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);
  protected stripeService = inject(StripeService);
  protected networkState = inject(NetworkStateService);
  private destroyRef = inject(DestroyRef);

  protected readonly Views = Views;
  protected readonly AttendeeRole = AttendeeRole;
  protected readonly AttendanceType = AttendanceType;
  protected readonly SubSelectionKind = SubSelectionKind;
  protected readonly PaymentChoice = PaymentChoice;
  protected readonly DepositRefundPolicyKind = DepositRefundPolicyKind;
  protected readonly EventRegistrationStatus = EventRegistrationStatus;
  protected readonly PricingValidationErrorCode = PricingValidationErrorCode;
  protected readonly RegistrationQuestionKind = RegistrationQuestionKind;
  protected readonly MAX_SHORT_TEXT_ANSWER_LENGTH = MAX_SHORT_TEXT_ANSWER_LENGTH;
  protected readonly MAX_LONG_TEXT_ANSWER_LENGTH = MAX_LONG_TEXT_ANSWER_LENGTH;
  protected readonly formatQuestionResponseValue = formatQuestionResponseValue;

  isOffline = this.networkState.isOffline;

  eventId = input<string>('');
  productId = input<string>('');

  showInlineLogin = signal(false);

  private watchedEventId = '';
  private watchedProductId = '';
  private eventUnsubscribe: (() => void) | null = null;
  private productUnsubscribe: (() => void) | null = null;

  toggleInlineLogin(): void {
    this.showInlineLogin.update((v) => !v);
  }

  private routeEventId = computed(() => {
    return this.routingService.signals[Views.EventRegister].pathVars.eventId();
  });

  effectiveEventId = computed(() => {
    return this.eventId() || this.routeEventId();
  });

  effectiveProductId = computed(() => {
    return this.productId();
  });

  editRegistrationUrl = computed(() => {
    const evId = this.linkedEvent()?.docId || this.effectiveEventId();
    if (evId) {
      return this.routingService.hrefForView(Views.ManageEventRegistration, { eventId: evId });
    }
    return null;
  });

  isLoading = signal(true);
  isSubmitting = signal(false);
  errorMessage = signal<string | null>(null);
  formErrorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  product = signal<Product | null>(null);
  linkedEvent = signal<IlcEvent | null>(null);
  existingRegistration = signal<EventRegistration | null>(null);

  isPastEvent = computed(() => {
    const ev = this.linkedEvent();
    return ev ? isEventPast(ev) : false;
  });

  user = this.firebaseState.user;
  isAdmin = computed(() => Boolean(this.user()?.isAdmin));
  emailNotificationsEnabled = computed(() => Boolean(environment.emailNotificationsEnabled));

  memberContext = computed(() => toMemberStatusContext(this.user()));

  userRole = computed<AttendeeRole>(() => {
    return getAttendeeRoleForStatus(this.memberContext());
  });

  isLifeMember = computed(() => {
    const m = this.user()?.member;
    return m ? isLifeMember(m) : false;
  });

  selectedRole = computed<AttendeeRole>(() => {
    const reg = this.existingRegistration();
    if (reg) return reg.role;
    return this.userRole();
  });

  attendeeStatusLabel = computed(() => {
    switch (this.selectedRole()) {
      case AttendeeRole.Instructor:
        return 'Certified Instructor';
      case AttendeeRole.Member:
        return 'ILC Member';
      case AttendeeRole.NonMember:
        return 'General Public';
    }
  });

  attendeeStatusSubtitle = computed(() => {
    const u = this.user();
    if (!u) {
      return 'Registering as non-member. Have an account? Log in to access member discounts or member-restricted options.';
    }
    switch (this.selectedRole()) {
      case AttendeeRole.Instructor:
        return 'Verified Instructor status applied.';
      case AttendeeRole.Member:
        return 'Active ILC Membership status applied.';
      case AttendeeRole.NonMember:
        return 'Public rate applied. Want member rates? Join or upgrade your membership.';
    }
  });

  effectiveRules = computed<EventPricingRules | null>(() => {
    const prod = this.product();
    if (!prod) return null;
    const ev = this.linkedEvent();
    if (prod.pricingRules.capacities.length === 0 && ev && ev.capacities.length > 0) {
      return {
        ...prod.pricingRules,
        capacities: ev.capacities,
      };
    }
    return prod.pricingRules;
  });

  hasPersonStatusRelevance = computed(() => {
    const rules = this.effectiveRules();
    if (!rules) return false;
    const isMemberOrInstWho = (who: EventRuleConditions['who']): boolean =>
      who.kind === WhoConditionKind.Status &&
      (who.status === PersonStatusKind.Member || who.status === PersonStatusKind.Instructor);
    const hasMemberOrInstDiscount = rules.discounts.some(
      (d) => isMemberOrInstWho(d.conditions.who) && d.discountCents > 0,
    );
    const hasRestrictedOption = rules.registrationOptions.some((o) =>
      isMemberOrInstWho(o.conditions.who),
    );
    const hasRestrictedAddOn = rules.addOns.some((a) => isMemberOrInstWho(a.conditions.who));
    const hasRestrictedQuestion = rules.questions.some((q) => isMemberOrInstWho(q.conditions.who));
    return (
      hasMemberOrInstDiscount ||
      hasRestrictedOption ||
      hasRestrictedAddOn ||
      hasRestrictedQuestion
    );
  });

  liveCapacityCounts = computed<Record<string, number>>(() => {
    const ev = this.linkedEvent();
    const prod = this.product();
    const rules = this.effectiveRules();
    if (ev && Object.keys(ev.capacityCounts).length > 0) {
      return ev.capacityCounts;
    }
    if (prod && Object.keys(prod.capacityCounts).length > 0) {
      return prod.capacityCounts;
    }
    if (rules && rules.capacities.length === 1) {
      const fallbackCount = ev?.inPersonRegistrationsCount || prod?.inPersonRegistrationsCount || 0;
      if (fallbackCount > 0) {
        return { [rules.capacities[0].id]: fallbackCount };
      }
    }
    return {};
  });

  existingCapacityUsage = computed<Record<string, number>>(() => {
    const reg = this.existingRegistration();
    const rules = this.effectiveRules();
    if (!reg || !rules) return {};
    return computeEffectiveCapacityUsage(reg, rules.capacities);
  });

  isUpgrade = computed(() => Boolean(this.existingRegistration()));

  isPendingInPerson = computed(() => {
    const reg = this.existingRegistration();
    return Boolean(
      reg &&
        (reg.status === EventRegistrationStatus.PendingInPerson ||
          (reg.paymentMethod === RegistrationPaymentMethod.InPerson &&
            reg.status !== EventRegistrationStatus.Paid &&
            reg.status !== EventRegistrationStatus.DepositPaid)),
    );
  });

  isDepositPaid = computed(() => {
    return this.existingRegistration()?.status === EventRegistrationStatus.DepositPaid;
  });

  // Resolve initial option ID from existing registration or rules defaults
  private defaultInitialOptionId = computed<string>(() => {
    const rules = this.effectiveRules();
    if (!rules || rules.registrationOptions.length === 0) return '';
    const reg = this.existingRegistration();
    if (reg) {
      if (reg.optionId && rules.registrationOptions.some((o) => o.id === reg.optionId)) {
        return reg.optionId;
      }
      const byAttendance = rules.registrationOptions.find(
        (o) => o.attendanceType === reg.attendance,
      );
      if (byAttendance) return byAttendance.id;
    }
    if (this.isPastEvent()) {
      const videoOpt = rules.registrationOptions.find(
        (o) => o.attendanceType === AttendanceType.VideoOnly,
      );
      return videoOpt?.id ?? '';
    }
    const prelim = evaluateEventPricingQuote({
      rules,
      memberContext: this.memberContext(),
      isAdmin: this.isAdmin(),
      isEventPast: this.isPastEvent(),
      capacityCounts: this.liveCapacityCounts(),
      existingCapacityUsage: this.existingCapacityUsage(),
      eventStartDate: this.linkedEvent()?.start || '',
    });
    return prelim.selectedOption?.option.id || rules.registrationOptions[0]?.id || '';
  });

  selectedOptionId = linkedSignal<string, string>({
    source: this.defaultInitialOptionId,
    computation: (nextDefault) => nextDefault,
  });

  selectedSuboptions = linkedSignal<
    { optId: string; reg: EventRegistration | null },
    string[]
  >({
    source: computed(() => ({
      optId: this.selectedOptionId(),
      reg: this.existingRegistration(),
    })),
    computation: ({ optId, reg }) => {
      if (reg && reg.optionId === optId && reg.selectedSuboptions.length > 0) {
        return [...reg.selectedSuboptions];
      }
      return [];
    },
  });

  lockedAddOnIds = computed<Set<string>>(() => {
    const reg = this.existingRegistration();
    const rules = this.effectiveRules();
    if (!reg || !rules || this.isPendingInPerson()) return new Set<string>();
    const locked = new Set<string>(reg.selectedAddOnIds);
    if (reg.hasVideoAccess) {
      for (const a of rules.addOns) {
        if (a.spec.kind === EventAddOnKind.EventRecording) {
          locked.add(a.id);
        }
      }
    }
    return locked;
  });

  selectedAddOnIds = linkedSignal<EventRegistration | null, string[]>({
    source: this.existingRegistration,
    computation: (reg) => {
      const rules = this.effectiveRules();
      if (!reg) return [];
      const initial = new Set<string>(reg.selectedAddOnIds);
      if (reg.hasVideoAccess && rules) {
        for (const a of rules.addOns) {
          if (a.spec.kind === EventAddOnKind.EventRecording) {
            initial.add(a.id);
          }
        }
      }
      return Array.from(initial);
    },
  });

  selectedPaymentChoice = signal<PaymentChoice | undefined>(undefined);

  // Attendee contact fields
  attendeeName = linkedSignal(() => {
    return this.existingRegistration()?.name || this.user()?.member?.name || '';
  });
  attendeeEmail = linkedSignal(() => {
    return (
      this.existingRegistration()?.email ||
      this.user()?.firebaseUser?.email ||
      this.user()?.member?.emails?.[0] ||
      ''
    );
  });
  attendeePhone = linkedSignal(() => {
    return this.existingRegistration()?.phone || this.user()?.member?.phone || '';
  });
  attendeeNotes = linkedSignal(() => {
    return this.existingRegistration()?.notes || '';
  });

  questionAnswers = linkedSignal<
    EventRegistration | null,
    Record<string, { answerText: string; selectedOptions: string[] }>
  >({
    source: this.existingRegistration,
    computation: (reg) => {
      if (!reg || reg.questionResponses.length === 0) return {};
      const initial: Record<string, { answerText: string; selectedOptions: string[] }> = {};
      for (const resp of reg.questionResponses) {
        initial[resp.questionId] = {
          answerText: resp.answerText,
          selectedOptions: [...resp.selectedOptions],
        };
      }
      return initial;
    },
  });

  lockedQuestionIds = computed<Set<string>>(() => {
    const reg = this.existingRegistration();
    if (!reg) return new Set<string>();
    return new Set(reg.questionResponses.map((r) => r.questionId));
  });

  answeredExistingResponses = computed<EventRegistrationQuestionResponse[]>(() => {
    const reg = this.existingRegistration();
    if (!reg) return [];
    return reg.questionResponses.filter((r) => hasQuestionResponseValue(r));
  });

  // Preliminary evaluation (before filtering add-ons & payment choice)
  private prelimQuote = computed<EventPricingQuote | null>(() => {
    const rules = this.effectiveRules();
    if (!rules) return null;
    const optId = this.selectedOptionId();
    return evaluateEventPricingQuote({
      rules,
      memberContext: this.memberContext(),
      isAdmin: this.isAdmin(),
      isEventPast: this.isPastEvent(),
      capacityCounts: this.liveCapacityCounts(),
      existingCapacityUsage: this.existingCapacityUsage(),
      eventStartDate: this.linkedEvent()?.start || '',
      selectedOptionId: optId || undefined,
      selectedSuboptions: this.selectedSuboptions(),
    });
  });

  availablePaymentChoicesForUser = computed<PaymentChoice[]>(() => {
    const prelim = this.prelimQuote();
    if (!prelim) return [];
    const reg = this.existingRegistration();
    // Already-paid or deposit-paid registrants cannot switch settlement back to unpaid PayAtDoor
    if (reg && !this.isPendingInPerson()) {
      return prelim.availablePaymentChoices.filter((c) => c !== PaymentChoice.PayAtDoor);
    }
    return prelim.availablePaymentChoices;
  });

  effectivePaymentChoice = computed<PaymentChoice | undefined>(() => {
    const choices = this.availablePaymentChoicesForUser();
    if (choices.length === 0) return undefined;
    const explicit = this.selectedPaymentChoice();
    if (explicit && choices.includes(explicit)) {
      return explicit;
    }
    const reg = this.existingRegistration();
    // If an attendee already paid a deposit and is still in DepositPaid status, keep Deposit unless they choose Full
    if (
      reg?.status === EventRegistrationStatus.DepositPaid &&
      choices.includes(PaymentChoice.Deposit)
    ) {
      return PaymentChoice.Deposit;
    }
    return choices[0];
  });

  quote = computed<EventPricingQuote | null>(() => {
    const rules = this.effectiveRules();
    const prelim = this.prelimQuote();
    if (!rules || !prelim) return null;

    const availAddOnIds = new Set(prelim.availableAddOns.map((a) => a.addOn.id));
    const locked = this.lockedAddOnIds();
    const mergedAddOnIds = Array.from(
      new Set([...this.selectedAddOnIds(), ...Array.from(locked)]),
    ).filter((id) => availAddOnIds.has(id));

    return evaluateEventPricingQuote({
      rules,
      memberContext: this.memberContext(),
      isAdmin: this.isAdmin(),
      isEventPast: this.isPastEvent(),
      capacityCounts: this.liveCapacityCounts(),
      existingCapacityUsage: this.existingCapacityUsage(),
      eventStartDate: this.linkedEvent()?.start || '',
      selectedOptionId: this.selectedOptionId() || undefined,
      selectedSuboptions: this.selectedSuboptions(),
      selectedAddOnIds: mergedAddOnIds,
      paymentChoice: this.effectivePaymentChoice(),
    });
  });

  // Compute credit from existing registration (valuing prior paid entitlement at max(amountPaidCents, current value of prior option + add-ons))
  effectiveCreditCents = computed<number>(() => {
    const reg = this.existingRegistration();
    const rules = this.effectiveRules();
    if (!reg || !rules || this.isPendingInPerson()) return 0;

    const paidCents = Math.max(0, reg.amountPaidCents);
    if (reg.status !== EventRegistrationStatus.Paid) {
      return paidCents;
    }

    const priorOptId =
      reg.optionId && rules.registrationOptions.some((o) => o.id === reg.optionId)
        ? reg.optionId
        : rules.registrationOptions.find((o) => o.attendanceType === reg.attendance)?.id;
    if (!priorOptId) return paidCents;

    const priorAddOnIds = new Set<string>(reg.selectedAddOnIds);
    if (reg.hasVideoAccess) {
      for (const a of rules.addOns) {
        if (a.spec.kind === EventAddOnKind.EventRecording) {
          priorAddOnIds.add(a.id);
        }
      }
    }

    const priorQuote = evaluateEventPricingQuote({
      rules,
      memberContext: this.memberContext(),
      isAdmin: this.isAdmin(),
      capacityCounts: this.liveCapacityCounts(),
      existingCapacityUsage: this.existingCapacityUsage(),
      eventStartDate: this.linkedEvent()?.start || '',
      selectedOptionId: priorOptId,
      selectedAddOnIds: Array.from(priorAddOnIds),
    });

    return Math.max(paidCents, priorQuote.agreedTotalCents);
  });

  onlineDueNowCents = computed<number>(() => {
    const q = this.quote();
    if (!q) return 0;
    const choice = q.effectivePaymentChoice;
    if (choice === PaymentChoice.PayAtDoor) {
      return 0;
    }
    const credit = this.effectiveCreditCents();
    if (choice === PaymentChoice.Deposit) {
      return Math.max(0, q.chargeNowCents - credit);
    }
    return Math.max(0, q.agreedTotalCents - credit);
  });

  doorBalanceDueCents = computed<number>(() => {
    const q = this.quote();
    if (!q) return 0;
    const credit = this.effectiveCreditCents();
    const choice = q.effectivePaymentChoice;
    if (choice === PaymentChoice.PayAtDoor) {
      return Math.max(0, q.agreedTotalCents - credit);
    }
    if (choice === PaymentChoice.Deposit) {
      const remainingCreditAfterOnline = Math.max(0, credit - q.chargeNowCents);
      return Math.max(0, q.cashDueAtDoorCents - remainingCreditAfterOnline);
    }
    return 0;
  });

  offlineInstructions = computed<string>(() => {
    const rules = this.effectiveRules();
    if (!rules || rules.payment.depositPolicy.kind !== DepositPolicyKind.Enabled) {
      return '';
    }
    return rules.payment.depositPolicy.offlineInstructions;
  });

  earlyBirdDeadlineFormatted = computed<string>(() => {
    const rules = this.effectiveRules();
    if (!rules || rules.earlyBird.kind !== EarlyBirdPolicyKind.Enabled) {
      return '';
    }
    return this.formatIsoDate(rules.earlyBird.deadlineDate);
  });

  totalEarlySavingsCents = computed<number>(() => {
    const q = this.quote();
    if (!q) return 0;
    return q.attendanceEarlyDiscountCents;
  });

  formatAppliedDiscountsSummary(appliedDiscounts: EvaluatedDiscount[]): string {
    return appliedDiscounts
      .map((d) => `${d.discount.label || 'Discount'} (−${this.formatCents(d.savedCents)})`)
      .join(', ');
  }

  currentRegistrationOptionLabel = computed<string>(() => {
    const reg = this.existingRegistration();
    if (!reg) return '';
    if (reg.optionLabel) return reg.optionLabel;
    return this.formatAttendanceLabel(reg.attendance);
  });

  requiresOnlineCheckout = computed<boolean>(() => {
    return this.onlineDueNowCents() > 0;
  });

  isFreeOrInPlaceUpdate = computed<boolean>(() => {
    return this.isUpgrade() && this.onlineDueNowCents() === 0;
  });

  questionValidation = computed(() => {
    const q = this.quote();
    if (!q) {
      return { responses: [], errors: [] };
    }
    const answersMap = this.questionAnswers();
    const submittedAnswers: QuestionAnswerInput[] = Object.entries(answersMap).map(
      ([questionId, val]) => ({
        questionId,
        answerText: val.answerText,
        selectedOptions: val.selectedOptions,
      }),
    );
    return validateAndBuildQuestionResponses({
      applicableQuestions: q.applicableQuestions,
      submittedAnswers,
      existingResponses: this.existingRegistration()?.questionResponses ?? [],
    });
  });

  canSubmit = computed<boolean>(() => {
    const q = this.quote();
    if (!q || !q.isValid) return false;
    if (!this.attendeeName().trim() || !this.attendeeEmail().trim()) return false;
    if (this.questionValidation().errors.length > 0) return false;
    if (this.requiresOnlineCheckout() && this.isOffline()) return false;
    return true;
  });

  eventDateDisplay = computed(() => {
    const ev = this.linkedEvent();
    if (!ev) return '';
    return formatDateRange(ev.start, ev.end);
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.cleanupWatchers();
    });

    // Refresh attendee registration and close inline login if auth updates after page load
    effect(() => {
      const user = this.firebaseState.user();
      if (user) {
        this.showInlineLogin.set(false);
      }
      const ev = this.linkedEvent();
      const evId = ev?.docId || this.effectiveEventId();

      if (!user || !evId || this.existingRegistration()) {
        return;
      }
      const memberDocId = user.member?.docId;
      const emails = [user.firebaseUser?.email, ...(user.member?.emails || [])]
        .filter((e): e is string => Boolean(e))
        .map((e) => e.toLowerCase().trim());

      this.productService
        .getUserRegistrationForEvent(evId, memberDocId, emails)
        .then((reg) => {
          if (reg) {
            this.existingRegistration.set(reg);
          }
        })
        .catch((err) => {
          console.warn('Could not load user registration for event upgrade:', err);
        });
    });
  }

  private cleanupWatchers(): void {
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
      this.watchedEventId = '';
    }
    if (this.productUnsubscribe) {
      this.productUnsubscribe();
      this.productUnsubscribe = null;
      this.watchedProductId = '';
    }
  }

  private startLiveWatchers(eventDocId: string, productDocId: string): void {
    if (eventDocId && eventDocId !== this.watchedEventId) {
      if (this.eventUnsubscribe) {
        this.eventUnsubscribe();
      }
      this.watchedEventId = eventDocId;
      this.eventUnsubscribe = this.productService.watchEvent(eventDocId, (liveEv) => {
        this.linkedEvent.set(liveEv);
      });
    }
    if (productDocId && productDocId !== this.watchedProductId) {
      if (this.productUnsubscribe) {
        this.productUnsubscribe();
      }
      this.watchedProductId = productDocId;
      this.productUnsubscribe = this.productService.watchProduct(productDocId, (liveProd) => {
        this.product.set(liveProd);
      });
    }
  }

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadProduct();
  }

  async loadProduct() {
    const evId = this.effectiveEventId();
    const prodId = this.effectiveProductId();

    if (!evId && !prodId) {
      this.errorMessage.set('Event or Registration ID is missing.');
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      if (evId) {
        const ev = await this.dataService.getEventById(evId);
        let prod: Product | undefined;
        if (ev?.productId) {
          prod = await this.productService.getProduct(ev.productId);
        } else {
          prod = await this.productService.getProductByEventId(evId);
        }
        if (ev) this.linkedEvent.set(ev);
        if (prod) this.product.set(prod);
      } else if (prodId) {
        const prod = await this.productService.getProduct(prodId);
        if (prod) {
          this.product.set(prod);
          if (prod.eventDocId) {
            const ev = await this.dataService.getEventById(prod.eventDocId);
            if (ev) this.linkedEvent.set(ev);
          }
        }
      }

      if (this.firebaseState.loginStatus() === LoginStatus.FirebaseLoadingStatus) {
        try {
          await this.firebaseState.loggedIn();
        } catch {
          // Ignored if user not logged in
        }
      }

      const user = this.firebaseState.user();
      const resolvedEvId = this.linkedEvent()?.docId || this.product()?.eventDocId || evId;
      const resolvedProdId = this.product()?.docId || prodId;

      if (user && resolvedEvId) {
        const memberDocId = user.member?.docId;
        const emails = [user.firebaseUser?.email, ...(user.member?.emails || [])]
          .filter((e): e is string => Boolean(e))
          .map((e) => e.toLowerCase().trim());
        try {
          const reg = await this.productService.getUserRegistrationForEvent(
            resolvedEvId,
            memberDocId,
            emails,
          );
          if (reg) {
            this.existingRegistration.set(reg);
          }
        } catch (err) {
          console.warn('Could not load user registration for event:', err);
        }
      }

      if (!this.product()) {
        this.errorMessage.set('Registration setup not found for this event.');
      } else {
        this.startLiveWatchers(resolvedEvId, resolvedProdId);
      }
    } catch (err) {
      console.error('Error loading registration:', err);
      this.errorMessage.set('Failed to load registration details.');
    } finally {
      this.isLoading.set(false);
    }
  }

  // ------------------------------------------------------------------
  // Formatting & Selection Helpers
  // ------------------------------------------------------------------

  formatCents(cents: number): string {
    const currency = (this.product()?.currency || 'usd').toUpperCase();
    const major = cents / 100;
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: major % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  }

  formatIsoDate(isoDate: string): string {
    const parts = isoDate.slice(0, 10).split('-');
    if (parts.length !== 3) return isoDate;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatAttendanceLabel(attendance: AttendanceType): string {
    switch (attendance) {
      case AttendanceType.InPerson:
        return 'In-Person';
      case AttendanceType.Online:
        return 'Online (Zoom)';
      case AttendanceType.InPersonAndOnline:
        return 'In-Person & Online';
      case AttendanceType.VideoOnly:
        return 'Recording Only';
    }
  }

  formatPaymentChoiceLabel(choice: PaymentChoice): string {
    switch (choice) {
      case PaymentChoice.Full:
        return 'Pay Full Amount Online';
      case PaymentChoice.Deposit:
        return 'Pay Deposit Online (Balance at Door)';
      case PaymentChoice.PayAtDoor:
        return 'Pay in Person at Door';
    }
  }

  selectOption(optEval: EvaluatedRegistrationOption): void {
    if (!optEval.isEligibleForPerson || optEval.isSoldOut) return;
    this.selectedOptionId.set(optEval.option.id);
    this.formErrorMessage.set(null);
  }

  isSuboptionSelected(sub: string): boolean {
    return this.selectedSuboptions().includes(sub);
  }

  isSuboptionDisabled(sub: string, pickCount: number): boolean {
    const current = this.selectedSuboptions();
    return !current.includes(sub) && current.length >= pickCount;
  }

  toggleSuboption(sub: string, pickCount: number, checked: boolean): void {
    this.selectedSuboptions.update((prev) => {
      if (checked) {
        if (prev.includes(sub) || prev.length >= pickCount) return prev;
        return [...prev, sub];
      }
      return prev.filter((item) => item !== sub);
    });
    this.formErrorMessage.set(null);
  }

  isAddOnLocked(addOnId: string): boolean {
    return this.lockedAddOnIds().has(addOnId);
  }

  toggleAddOn(addOnEval: EvaluatedAddOn, checked: boolean): void {
    const id = addOnEval.addOn.id;
    if (this.isAddOnLocked(id)) return;
    this.selectedAddOnIds.update((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((item) => item !== id);
    });
    this.formErrorMessage.set(null);
  }

  isQuestionLocked(questionId: string): boolean {
    return this.lockedQuestionIds().has(questionId);
  }

  getQuestionText(questionId: string): string {
    return this.questionAnswers()[questionId]?.answerText ?? '';
  }

  getQuestionSelectedOptions(questionId: string): string[] {
    return this.questionAnswers()[questionId]?.selectedOptions ?? [];
  }

  updateQuestionText(questionId: string, answerText: string): void {
    if (this.isQuestionLocked(questionId)) return;
    this.questionAnswers.update((prev) => ({
      ...prev,
      [questionId]: {
        answerText,
        selectedOptions: prev[questionId]?.selectedOptions ?? [],
      },
    }));
    this.formErrorMessage.set(null);
  }

  updateQuestionSelect(questionId: string, selectedValue: string): void {
    if (this.isQuestionLocked(questionId)) return;
    this.questionAnswers.update((prev) => ({
      ...prev,
      [questionId]: {
        answerText: selectedValue,
        selectedOptions: [],
      },
    }));
    this.formErrorMessage.set(null);
  }

  toggleQuestionCheckbox(questionId: string, choice: string, checked: boolean): void {
    if (this.isQuestionLocked(questionId)) return;
    this.questionAnswers.update((prev) => {
      const existing = prev[questionId]?.selectedOptions ?? [];
      const set = new Set(existing);
      if (checked) {
        set.add(choice);
      } else {
        set.delete(choice);
      }
      return {
        ...prev,
        [questionId]: {
          answerText: prev[questionId]?.answerText ?? '',
          selectedOptions: Array.from(set),
        },
      };
    });
    this.formErrorMessage.set(null);
  }

  private buildQuestionAnswerInputs(): QuestionAnswerInput[] {
    return Object.entries(this.questionAnswers()).map(([questionId, val]) => ({
      questionId,
      answerText: val.answerText,
      selectedOptions: val.selectedOptions,
    }));
  }

  private validateAttendeeContactAndQuestions(): QuestionAnswerInput[] | null {
    if (!this.attendeeName().trim()) {
      this.formErrorMessage.set('Please enter the attendee full name.');
      return null;
    }
    if (!this.attendeeEmail().trim()) {
      this.formErrorMessage.set('Please enter an email address for confirmation and access.');
      return null;
    }
    const qVal = this.questionValidation();
    if (qVal.errors.length > 0) {
      this.formErrorMessage.set(qVal.errors[0].message);
      return null;
    }
    return this.buildQuestionAnswerInputs();
  }

  private computeIncludeVideoFlag(q: EventPricingQuote): boolean {
    if (q.selectedOption?.option.attendanceType === AttendanceType.VideoOnly) {
      return true;
    }
    if (this.existingRegistration()?.hasVideoAccess) {
      return true;
    }
    return q.selectedAddOns.some((a) => a.addOn.spec.kind === EventAddOnKind.EventRecording);
  }

  // ------------------------------------------------------------------
  // Submission Handlers
  // ------------------------------------------------------------------

  async submitRegistration(): Promise<void> {
    const q = this.quote();
    if (!q || !q.isValid) {
      this.formErrorMessage.set(
        q?.validationErrors[0]?.message || 'Please resolve the highlighted selection issues.',
      );
      return;
    }
    if (this.isFreeOrInPlaceUpdate()) {
      await this.saveRegistrationUpdate();
      return;
    }
    if (!this.isUpgrade() && q.effectivePaymentChoice === PaymentChoice.PayAtDoor) {
      await this.registerInPerson();
      return;
    }
    await this.proceedToCheckout();
  }

  async saveRegistrationUpdate(): Promise<void> {
    const prod = this.product();
    const reg = this.existingRegistration();
    const q = this.quote();
    if (!prod || !reg || !q || !q.selectedOption || !q.isValid) return;
    const questionAnswers = this.validateAttendeeContactAndQuestions();
    if (!questionAnswers) return;
    const qVal = this.questionValidation();

    this.isSubmitting.set(true);
    this.formErrorMessage.set(null);
    this.successMessage.set(null);

    try {
      const selectedAddOnIds = q.selectedAddOns.map((a) => a.addOn.id);
      const selectedAddOnLabels = q.selectedAddOns.map((a) => a.addOn.label);
      const hasVideo = this.computeIncludeVideoFlag(q);

      await this.stripeService.updateProductRegistration({
        productId: prod.docId,
        existingRegistrationDocId: reg.docId,
        optionId: q.selectedOption.option.id,
        selectedSuboptions: q.normalizedSuboptions,
        selectedAddOnIds,
        paymentChoice: q.effectivePaymentChoice ?? PaymentChoice.Full,
        role: this.selectedRole(),
        attendance: q.selectedOption.option.attendanceType,
        includeVideo: hasVideo,
        questionAnswers,
        attendeeDetails: {
          name: this.attendeeName().trim(),
          email: this.attendeeEmail().trim().toLowerCase(),
          phone: this.attendeePhone().trim(),
          notes: this.attendeeNotes().trim(),
        },
      });

      this.existingRegistration.set({
        ...reg,
        name: this.attendeeName().trim(),
        email: this.attendeeEmail().trim().toLowerCase(),
        phone: this.attendeePhone().trim(),
        notes: this.attendeeNotes().trim(),
        role: this.selectedRole(),
        attendance: q.selectedOption.option.attendanceType,
        hasVideoAccess: hasVideo,
        optionId: q.selectedOption.option.id,
        optionLabel: q.selectedOption.option.label,
        selectedSuboptions: q.normalizedSuboptions,
        selectedAddOnIds,
        selectedAddOnLabels,
        questionResponses: mergeImmutableQuestionResponses(reg.questionResponses, qVal.responses),
        capacityUsage: { ...q.selectedOption.option.capacityUsage },
        agreedTotalCents: q.agreedTotalCents,
        amountDueCents: this.doorBalanceDueCents(),
        lastUpdated: new Date().toISOString(),
      });

      this.successMessage.set('Your registration has been updated.');
      const evId = this.linkedEvent()?.docId || this.effectiveEventId();
      if (evId) {
        this.routingService.navigateToParts(['events', evId]);
      }
    } catch (err: unknown) {
      console.error('Registration update error:', err);
      const msg =
        err instanceof Error ? err.message : 'Unable to update registration. Please try again.';
      this.formErrorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async proceedToCheckout(): Promise<void> {
    const prod = this.product();
    const q = this.quote();
    if (!prod || !q || !q.selectedOption || !q.isValid) return;
    const questionAnswers = this.validateAttendeeContactAndQuestions();
    if (!questionAnswers) return;

    this.isSubmitting.set(true);
    this.formErrorMessage.set(null);
    this.successMessage.set(null);

    try {
      const isUpgrade = this.isUpgrade();
      const existingReg = this.existingRegistration();
      const selectedAddOnIds = q.selectedAddOns.map((a) => a.addOn.id);

      const result = await this.stripeService.createProductCheckoutSession({
        productId: prod.docId,
        optionId: q.selectedOption.option.id,
        selectedSuboptions: q.normalizedSuboptions,
        selectedAddOnIds,
        paymentChoice: q.effectivePaymentChoice ?? PaymentChoice.Full,
        role: this.selectedRole(),
        attendance: q.selectedOption.option.attendanceType,
        includeVideo: this.computeIncludeVideoFlag(q),
        origin: window.location.origin,
        isUpgrade,
        existingRegistrationDocId: isUpgrade && existingReg ? existingReg.docId : undefined,
        questionAnswers,
        attendeeDetails: {
          name: this.attendeeName().trim(),
          email: this.attendeeEmail().trim().toLowerCase(),
          phone: this.attendeePhone().trim(),
          notes: this.attendeeNotes().trim(),
        },
      });

      if (result.checkoutUrl) {
        this.redirectToCheckout(result.checkoutUrl);
      } else {
        throw new Error('No checkout URL received from server.');
      }
    } catch (err: unknown) {
      console.error('Checkout error:', err);
      const msg =
        err instanceof Error ? err.message : 'Unable to initialize checkout. Please try again.';
      this.formErrorMessage.set(msg);
      this.isSubmitting.set(false);
    }
  }

  protected redirectToCheckout(url: string): void {
    window.location.href = url;
  }

  async registerInPerson(): Promise<void> {
    const prod = this.product();
    const q = this.quote();
    if (!prod || !q || !q.selectedOption || !q.isValid) return;
    const questionAnswers = this.validateAttendeeContactAndQuestions();
    if (!questionAnswers) return;

    this.isSubmitting.set(true);
    this.formErrorMessage.set(null);
    this.successMessage.set(null);

    try {
      const selectedAddOnIds = q.selectedAddOns.map((a) => a.addOn.id);
      const result = await this.stripeService.registerEventInPerson({
        productId: prod.docId,
        optionId: q.selectedOption.option.id,
        selectedSuboptions: q.normalizedSuboptions,
        selectedAddOnIds,
        paymentChoice: PaymentChoice.PayAtDoor,
        role: this.selectedRole(),
        attendance: q.selectedOption.option.attendanceType,
        includeVideo: this.computeIncludeVideoFlag(q),
        questionAnswers,
        attendeeDetails: {
          name: this.attendeeName().trim(),
          email: this.attendeeEmail().trim().toLowerCase(),
          phone: this.attendeePhone().trim(),
          notes: this.attendeeNotes().trim(),
        },
      });

      if (result.success && result.registrationDocId) {
        this.successMessage.set(
          'You are registered to pay in person at the event. Your balance is due upon arrival.',
        );
        const evId = this.linkedEvent()?.docId || this.effectiveEventId();
        if (evId) {
          this.routingService.navigateToParts(['events', evId]);
        }
      } else {
        throw new Error('Failed to complete in-person registration.');
      }
    } catch (err: unknown) {
      console.error('In-person registration error:', err);
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to complete in-person registration. Please try again.';
      this.formErrorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
