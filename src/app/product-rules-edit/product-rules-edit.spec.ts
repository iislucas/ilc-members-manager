/* product-rules-edit.spec.ts
 *
 * Unit tests for ProductRulesEditComponent: named Capacity Limits before Registration Options,
 * worked example, shared Eligibility Conditions & Discounts with RuleConditionsEditorComponent,
 * direct option pricing, suboptions, cumulative discounts, add-ons (with VOD/Series autocomplete),
 * deposit refund policies, and Simulator quotes.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductRulesEditComponent, SimulatedPersonRole } from './product-rules-edit';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { SearchableSet } from '../searchable-set';
import { VodOptionItem } from '../product-edit/product-edit';
import {
  AttendanceType,
  DepositPolicyKind,
  DepositRefundPolicyKind,
  EarlyBirdPolicyKind,
  EventAddOnKind,
  EventPricingRules,
  initEventPricingRules,
  initEventRuleConditions,
  PaymentChoice,
  PersonStatusKind,
  PricingValidationErrorCode,
  RegistrationConditionKind,
  RegistrationQuestionKind,
  SubSelectionKind,
  TimingConditionKind,
  TimingWindow,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';

describe('ProductRulesEditComponent', () => {
  let component: ProductRulesEditComponent;
  let fixture: ComponentFixture<ProductRulesEditComponent>;
  let currentRules: EventPricingRules;
  let vodOptionsSet: SearchableSet<'id', VodOptionItem>;

  const mockDataManagerService = {
    videos: {
      entries: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined),
    },
    getVideoSeriesList: vi.fn().mockReturnValue([]),
  };

  const mockRoutingService = {
    hrefForView: vi.fn().mockReturnValue('/videos/mock-id'),
  };

  function setRules(next: EventPricingRules) {
    currentRules = next;
    fixture.componentRef.setInput('rules', currentRules);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vodOptionsSet = new SearchableSet<'id', VodOptionItem>(
      ['title', 'seriesTitle', 'id', 'displayName'],
      'id',
    );
    vodOptionsSet.setEntries([
      {
        id: 'series_foundations',
        type: 'series',
        title: 'Foundations Series',
        displayName: '[Series (4 parts)] Foundations Series (series_foundations)',
      },
      {
        id: 'vid_sticky_hands',
        type: 'video',
        title: 'Spinning Hands Intro',
        displayName: '[Video] Spinning Hands Intro (vid_sticky_hands)',
      },
    ]);
    currentRules = initEventPricingRules();

    await TestBed.configureTestingModule({
      imports: [ProductRulesEditComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductRulesEditComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('rules', currentRules);
    fixture.componentRef.setInput('vodOptionsSet', vodOptionsSet);
    fixture.componentRef.setInput('eventStartDate', '2027-02-12');

    component.rulesChange.subscribe((emitted) => {
      setRules(emitted);
    });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('populates initial <select> dropdowns cleanly, omits per-option Early Registration Rule, and configures Early Bird discounts via unified Discounts section', async () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Enable Early Bird Pricing');
    expect(el.textContent).not.toContain('Early Registration Rule');
    expect(el.textContent).not.toContain('Person-Status Discounts');
    expect(el.textContent).toContain('Discounts');

    // Every rendered <select> has a valid selected option (never blank selectedIndex -1)
    const selects = Array.from(el.querySelectorAll('select')) as HTMLSelectElement[];
    expect(selects.length).toBeGreaterThanOrEqual(3);
    for (const sel of selects) {
      expect(sel.selectedIndex).toBeGreaterThanOrEqual(0);
    }

    const attSelect = el.querySelector('#opt-att-full_event') as HTMLSelectElement;
    expect(attSelect.selectedOptions[0]?.textContent?.trim()).toBe('In-Person');

    const subSelect = el.querySelector('#opt-sub-full_event') as HTMLSelectElement;
    expect(subSelect.selectedOptions[0]?.textContent?.trim()).toBe('No sub-options');

    // Enable Early Bird Pricing and add a $50 Early Bird Discount via unified Discounts section
    component.updateOptionStandardPrice('full_event', '490');
    component.toggleEarlyBirdPolicy(true);
    component.updateEarlyBirdDeadline('2027-01-31');
    component.addDiscount();
    const ebDisc = currentRules.discounts[0];
    expect(ebDisc.label).toBe('Early Bird Discount');
    expect(ebDisc.conditions.timing).toEqual({
      kind: TimingConditionKind.Window,
      window: TimingWindow.OnOrBeforeEarlyBird,
    });
    component.updateDiscountAmount(ebDisc.id, '50');
    component.simDateAoE.set('2027-01-15');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.simulatedQuote().agreedTotalCents).toBe(44000);
    expect(el.textContent).toContain('Early Bird Discount');
    expect(el.textContent).toContain('−$50.00');
  });

  it('places Capacity Limits before Registration Options with a worked example, configures per-option usage, and simulates Sold Out capacity limits', () => {
    const el: HTMLElement = fixture.nativeElement;
    const headings = Array.from(el.querySelectorAll('.rules-section h2')).map((h) =>
      h.textContent?.trim(),
    );
    const earlyIdx = headings.indexOf('Early Bird Pricing & Currency');
    const capacityIdx = headings.indexOf('Capacity Limits');
    const optionsIdx = headings.indexOf('Registration Options');
    const discountsIdx = headings.indexOf('Discounts');
    const simulatorIdx = headings.indexOf('Interactive Registration Simulator');

    expect(earlyIdx).toBe(0);
    expect(capacityIdx).toBe(1);
    expect(optionsIdx).toBe(2);
    expect(discountsIdx).toBe(3);
    expect(capacityIdx).toBeLessThan(optionsIdx);
    expect(simulatorIdx).toBeGreaterThan(discountsIdx);

    // Worked example is displayed
    expect(el.textContent).toContain('Worked Example — Daily Participant Limits');
    expect(el.textContent).toContain('Friday Participants');
    expect(el.textContent).not.toContain('Basic Registration Options');

    // Default has no capacity limits
    expect(currentRules.capacities).toEqual([]);

    // Add two capacities: Friday Participants (25) and Saturday Participants (25)
    component.addCapacity();
    const friCapId = currentRules.capacities[0].id;
    component.updateCapacityLabel(friCapId, 'Friday Participants');
    component.updateCapacityLimit(friCapId, '25');
    component.updateCapacityDescription(friCapId, 'Max training hall spots on Friday');

    component.addCapacity();
    const satCapId = currentRules.capacities[1].id;
    component.updateCapacityLabel(satCapId, 'Saturday Participants');
    component.updateCapacityLimit(satCapId, '25');
    component.updateOptionCapacityUsage(currentRules.registrationOptions[0].id, satCapId, '1');

    // Default in-person option uses 1 unit of Friday and 1 unit of Saturday
    expect(currentRules.registrationOptions[0].capacityUsage[friCapId]).toBe(1);
    expect(currentRules.registrationOptions[0].capacityUsage[satCapId]).toBe(1);

    // Simulate 25 Friday bookings when only In-Person option exists -> CapacityExceeded
    component.updateSimCapacityCount(friCapId, '25');
    fixture.detectChanges();
    expect(component.simulatedQuote().isValid).toBe(false);
    expect(
      component
        .simulatedQuote()
        .validationErrors.some((e) => e.code === PricingValidationErrorCode.CapacityExceeded),
    ).toBe(true);
    expect(el.textContent).toContain('Sold Out');

    // Add a Recording Only option -> uses 0 capacity units and automatically becomes the available selection
    component.addRegistrationOption();
    const recOptId = currentRules.registrationOptions[1].id;
    component.updateOptionLabel(recOptId, 'Recording Only');
    component.updateOptionAttendance(recOptId, AttendanceType.VideoOnly);
    expect(currentRules.registrationOptions[1].capacityUsage).toEqual({});
    fixture.detectChanges();

    const quoteWithFallback = component.simulatedQuote();
    expect(quoteWithFallback.allEvaluatedOptions[0].isSoldOut).toBe(true);
    expect(quoteWithFallback.selectedOption?.option.id).toBe(recOptId);
    expect(quoteWithFallback.isValid).toBe(true);
  });

  it('sets each registration option price directly without Default Option or Delta controls, and supports reordering options', () => {
    const el: HTMLElement = fixture.nativeElement;
    const firstId = currentRules.registrationOptions[0].id;

    expect(el.querySelector(`#opt-delta-${firstId}`)).toBeNull();
    expect(el.textContent).not.toContain('Delta from Default');
    expect(el.textContent).not.toContain('Set as default');
    expect(el.textContent).not.toContain('Default Option');
    expect(el.textContent).toContain('Add Another Registration Option');

    component.updateOptionStandardPrice(firstId, '490');
    expect(currentRules.registrationOptions[0].priceCents).toBe(49000);

    component.addRegistrationOption();
    expect(currentRules.registrationOptions.length).toBe(2);
    const secondId = currentRules.registrationOptions[1].id;
    expect(el.querySelector(`#opt-delta-${secondId}`)).toBeNull();

    component.updateOptionStandardPrice(secondId, '330');
    expect(currentRules.registrationOptions[0].priceCents).toBe(49000);
    expect(currentRules.registrationOptions[1].priceCents).toBe(33000);

    // Reordering options preserves each option's independent price
    component.moveRegistrationOption(1, -1);
    expect(currentRules.registrationOptions[0].id).toBe(secondId);
    expect(currentRules.registrationOptions[0].priceCents).toBe(33000);
    expect(currentRules.registrationOptions[1].id).toBe(firstId);
    expect(currentRules.registrationOptions[1].priceCents).toBe(49000);
  });

  it('supports PickSuboptions configuration and disables/greys out unselected sub-options once pickCount is reached', () => {
    const el: HTMLElement = fixture.nativeElement;
    const optId = currentRules.registrationOptions[0].id;
    component.updateOptionStandardPrice(optId, '330');
    component.updateOptionSubSelectionKind(optId, SubSelectionKind.PickSuboptions);
    component.updateOptionPickCount(optId, '2');

    component.setSuboptionDraft(optId, 'Monday AM');
    component.addSuboptionsFromDraft(optId);
    const subSelection = currentRules.registrationOptions[0].subSelection;
    expect(subSelection.kind).toBe(SubSelectionKind.PickSuboptions);
    if (subSelection.kind === SubSelectionKind.PickSuboptions) {
      expect(subSelection.availableSuboptions).toContain('Monday AM');
      expect(subSelection.pickCount).toBe(2);
    }

    expect(component.simulatedQuote().isValid).toBe(false);
    const getSubPills = () =>
      Array.from(
        el.querySelectorAll('.rules-sim-suboptions .rules-scope-pill'),
      ) as HTMLLabelElement[];
    expect(getSubPills().every((p) => !p.classList.contains('disabled'))).toBe(true);

    component.toggleSimSuboption('Friday', true);
    fixture.detectChanges();
    expect(getSubPills().every((p) => !p.classList.contains('disabled'))).toBe(true);

    component.toggleSimSuboption('Saturday', true);
    fixture.detectChanges();

    expect(component.simulatedQuote().isValid).toBe(true);
    expect(component.simulatedQuote().normalizedSuboptions).toEqual(['Friday', 'Saturday']);

    const pillsAtMax = getSubPills();
    expect(pillsAtMax.length).toBe(4);
    for (const pill of pillsAtMax) {
      const labelText = pill.textContent?.trim() ?? '';
      const input = pill.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (labelText === 'Friday' || labelText === 'Saturday') {
        expect(pill.classList.contains('disabled')).toBe(false);
        expect(input.disabled).toBe(false);
        expect(input.checked).toBe(true);
      } else {
        expect(pill.classList.contains('disabled')).toBe(true);
        expect(input.disabled).toBe(true);
        expect(input.checked).toBe(false);
      }
    }

    component.toggleSimSuboption('Sunday', true);
    fixture.detectChanges();
    expect(component.simSelectedSuboptions()).toEqual(['Friday', 'Saturday']);

    component.toggleSimSuboption('Saturday', false);
    fixture.detectChanges();
    expect(getSubPills().every((p) => !p.classList.contains('disabled'))).toBe(true);

    component.toggleSimSuboption('Sunday', true);
    fixture.detectChanges();
    expect(component.simulatedQuote().normalizedSuboptions).toEqual(['Friday', 'Sunday']);
  });

  it('sums all matching Discounts (Who + Timing window + Registration scope) and supports Deposit RefundableBefore policy', () => {
    const optId = currentRules.registrationOptions[0].id;
    component.updateOptionStandardPrice(optId, '400');

    // Member discount ($40)
    component.addDiscount();
    const memberDiscId = currentRules.discounts[0].id;
    component.updateDiscountAmount(memberDiscId, '40');

    // Instructor extra discount ($100)
    component.addDiscount();
    const secondDiscId = currentRules.discounts[1].id;
    component.updateDiscountLabel(secondDiscId, 'Extra Instructor Discount');
    component.updateDiscountConditions(
      secondDiscId,
      initEventRuleConditions({
        who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
      }),
    );
    component.updateDiscountAmount(secondDiscId, '100');

    // Late-only discount ($25 after Early Bird cutoff)
    component.toggleEarlyBirdPolicy(true);
    component.updateEarlyBirdDeadline('2027-01-10');
    component.addDiscount();
    const lateDiscId = currentRules.discounts[2].id;
    component.updateDiscountLabel(lateDiscId, 'Late Promo');
    component.updateDiscountConditions(
      lateDiscId,
      initEventRuleConditions({
        timing: {
          kind: TimingConditionKind.Window,
          window: TimingWindow.AfterEarlyBird,
        },
      }),
    );
    component.updateDiscountAmount(lateDiscId, '25');

    component.toggleDepositPolicy(true);
    component.updateDepositRefundKind(DepositRefundPolicyKind.RefundableBefore);
    component.updateDepositRefundDeadline('2027-01-15');
    expect(currentRules.payment.depositPolicy).toMatchObject({
      kind: DepositPolicyKind.Enabled,
      depositCents: 5000,
      refundPolicy: {
        kind: DepositRefundPolicyKind.RefundableBefore,
        deadlineDate: '2027-01-15',
      },
    });

    // Before cutoff (2027-01-05): Member ($40) + Instructor ($100) sum to $140 -> $260 total
    component.simDateAoE.set('2027-01-05');
    component.simRole.set(SimulatedPersonRole.ActiveInstructor);
    component.simPaymentChoice.set(PaymentChoice.Deposit);
    fixture.detectChanges();

    const earlyQuote = component.simulatedQuote();
    expect(earlyQuote.isValid).toBe(true);
    expect(earlyQuote.selectedOption?.appliedDiscounts.length).toBe(2);
    expect(earlyQuote.attendanceDiscountCents).toBe(14000);
    expect(earlyQuote.agreedTotalCents).toBe(26000);
    expect(earlyQuote.chargeNowCents).toBe(5000);
    expect(earlyQuote.cashDueAtDoorCents).toBe(21000);

    // After cutoff (2027-01-20): Member ($40) + Instructor ($100) + Late Promo ($25) = $165 -> $235 total
    component.simDateAoE.set('2027-01-20');
    fixture.detectChanges();
    expect(component.simulatedQuote().attendanceDiscountCents).toBe(16500);
    expect(component.simulatedQuote().agreedTotalCents).toBe(23500);
  });

  it('supports per-option Eligibility Conditions (Who, Early Bird, Before Event Starts) including Recording Only options', () => {
    const inPersonOptId = currentRules.registrationOptions[0].id;
    component.updateOptionStandardPrice(inPersonOptId, '200');
    component.updateOptionConditions(
      inPersonOptId,
      initEventRuleConditions({
        who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
      }),
    );

    // Public user cannot register when only Instructors option exists
    component.simRole.set(SimulatedPersonRole.Public);
    fixture.detectChanges();
    expect(component.simulatedQuote().isEligibleToRegister).toBe(false);
    expect(component.simulatedQuote().validationErrors[0]?.code).toBe(
      PricingValidationErrorCode.InstructorRequired,
    );

    // Add a Recording Only option open to Members
    component.addRegistrationOption();
    const recOptId = currentRules.registrationOptions[1].id;
    component.updateOptionLabel(recOptId, 'Recording Pre-Order');
    component.updateOptionAttendance(recOptId, AttendanceType.VideoOnly);
    component.updateOptionStandardPrice(recOptId, '60');
    component.updateOptionConditions(
      recOptId,
      initEventRuleConditions({
        who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
      }),
    );
    fixture.detectChanges();

    // Public user still cannot register for either option
    expect(component.simulatedQuote().isEligibleToRegister).toBe(false);

    // ActiveMember is ineligible for the Instructors-only option, so Simulator selects Recording Pre-Order ($60)
    component.simRole.set(SimulatedPersonRole.ActiveMember);
    fixture.detectChanges();
    expect(component.simulatedQuote().allEvaluatedOptions[0].isEligibleForPerson).toBe(false);
    expect(component.simulatedQuote().selectedOption?.option.id).toBe(recOptId);
    expect(component.simulatedQuote().isValid).toBe(true);
    expect(component.simulatedQuote().agreedTotalCents).toBe(6000);

    // ActiveInstructor can select the Instructors-only in-person option ($200)
    component.simRole.set(SimulatedPersonRole.ActiveInstructor);
    component.simSelectedOptionId.set(inPersonOptId);
    fixture.detectChanges();
    expect(component.simulatedQuote().selectedOption?.option.id).toBe(inPersonOptId);
    expect(component.simulatedQuote().isValid).toBe(true);
    expect(component.simulatedQuote().agreedTotalCents).toBe(20000);
  });

  it('uses standard autocomplete for Target Catalog Video and Target Catalog VOD Series add-ons', () => {
    component.addEventAddOn();
    const addOnId = currentRules.addOns[0].id;

    // Switch to CatalogSeries and select via autocomplete text/ID handler
    component.updateAddOnSpecKind(addOnId, EventAddOnKind.CatalogSeries);
    fixture.detectChanges();
    expect(component.vodSeriesOptionsSet.entries().map((e) => e.id)).toEqual([
      'series_foundations',
    ]);
    expect(component.vodVideoOptionsSet.entries().map((e) => e.id)).toEqual(['vid_sticky_hands']);

    component.onCatalogSeriesTextUpdated(addOnId, 'series_foundations');
    expect(currentRules.addOns[0].spec).toEqual({
      kind: EventAddOnKind.CatalogSeries,
      seriesId: 'series_foundations',
    });

    // Switch to CatalogVideo and select via autocomplete text/ID handler
    component.updateAddOnSpecKind(addOnId, EventAddOnKind.CatalogVideo);
    component.onCatalogVideoTextUpdated(addOnId, 'vid_sticky_hands');
    expect(currentRules.addOns[0].spec).toEqual({
      kind: EventAddOnKind.CatalogVideo,
      videoId: 'vid_sticky_hands',
    });
  });

  it('loads the 4-Day Intensive Workshop example (with capacities, Recording Only option, unified discounts, and add-on conditions) with all <select> values populated', async () => {
    component.loadMultiDayIntensiveExample();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(currentRules.capacities).toEqual([
      {
        id: 'training_hall',
        label: 'Main Training Hall',
        description: 'Maximum in-person floor spots',
        limit: 30,
      },
    ]);
    expect(currentRules.earlyBird).toEqual({
      kind: EarlyBirdPolicyKind.Enabled,
      deadlineDate: '2026-12-31',
    });
    expect(currentRules.registrationOptions.length).toBe(5);
    expect(currentRules.registrationOptions[4].id).toBe('recording_only');
    expect(currentRules.registrationOptions[4].attendanceType).toBe(AttendanceType.VideoOnly);
    expect(currentRules.registrationOptions[4].capacityUsage).toEqual({});
    expect(currentRules.discounts.length).toBe(4);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.rules-money-prefix')).toBeNull();
    const selects = Array.from(el.querySelectorAll('select')) as HTMLSelectElement[];
    expect(selects.length).toBeGreaterThanOrEqual(15);
    for (const sel of selects) {
      expect(sel.selectedIndex).toBeGreaterThanOrEqual(0);
    }

    component.simPaymentChoice.set(PaymentChoice.Deposit);
    fixture.detectChanges();

    const earlyQuote = component.simulatedQuote();
    expect(earlyQuote.isEligibleToRegister).toBe(true);
    expect(earlyQuote.isEarlyBird).toBe(true);
    expect(earlyQuote.attendanceEarlyDiscountCents).toBe(5000);
    expect(earlyQuote.agreedTotalCents).toBe(46500);
    expect(earlyQuote.depositCents).toBe(5000);
    expect(earlyQuote.addOnsTotalCents).toBe(2500);
    expect(earlyQuote.chargeNowCents).toBe(7500);
    expect(earlyQuote.cashDueAtDoorCents).toBe(39000);

    // Live Quote Summary separates Event Deposit and Add-Ons paid online now from Event Balance Due at Door
    const breakdownBox = el.querySelector('.charge-now-box') as HTMLElement;
    expect(breakdownBox).toBeTruthy();
    expect(breakdownBox.textContent).toContain('Event Deposit (Paid Online Now)');
    expect(breakdownBox.textContent).toContain('$50.00');
    expect(breakdownBox.textContent).toContain(
      'Add-On: Personal Video Review (Paid Online Now)',
    );
    expect(breakdownBox.textContent).toContain('$25.00');
    expect(breakdownBox.textContent).toContain('Charged Online Now (Stripe)');
    expect(breakdownBox.textContent).toContain('$75.00');
    expect(el.textContent).toContain('Event Balance Due at Door');
    expect(el.textContent).toContain('$390.00');

    // Simulated Date (AoE) pre-select buttons cover Today + all 3 timing condition windows
    const presetButtons = Array.from(
      el.querySelectorAll('.sim-date-preset-btn'),
    ) as HTMLButtonElement[];
    expect(presetButtons.map((b) => b.textContent?.trim())).toEqual([
      'Today',
      'Before Early Bird',
      'After Early Bird, Before Start',
      'After Start',
    ]);

    // 1. Click "Before Early Bird" -> Early Bird active, Before Event Start active
    presetButtons[1].click();
    fixture.detectChanges();
    expect(component.simDateAoE()).toBe('2026-12-30');
    expect(component.simulatedQuote().isEarlyBird).toBe(true);
    expect(component.simulatedQuote().isBeforeEventStart).toBe(true);

    // 2. Click "After Early Bird, Before Start" -> Personal Video Review add-on (Early Bird Only) becomes unavailable, combo add-on available
    presetButtons[2].click();
    fixture.detectChanges();

    const lateQuote = component.simulatedQuote();
    expect(component.simDateAoE()).toBe('2027-01-01');
    expect(lateQuote.isEarlyBird).toBe(false);
    expect(lateQuote.isBeforeEventStart).toBe(true);
    expect(lateQuote.agreedTotalCents).toBe(49000);
    expect(lateQuote.chargeNowCents).toBe(5000);
    expect(lateQuote.cashDueAtDoorCents).toBe(44000);
    expect(
      component.unavailableSimAddOns().some((u) => u.addOn.id === 'eb_video_review'),
    ).toBe(true);
    expect(
      lateQuote.availableAddOns.some((a) => a.addOn.id === 'videos_and_review_combo'),
    ).toBe(true);

    // 3. Click "After Start" -> isBeforeEventStart becomes false
    presetButtons[3].click();
    fixture.detectChanges();
    expect(component.simDateAoE()).toBe('2027-02-13');
    expect(component.simulatedQuote().isEarlyBird).toBe(false);
    expect(component.simulatedQuote().isBeforeEventStart).toBe(false);
  });

  it('preserves original values (early bird deadline, suboptions, capacity usage, add-on targets, deposit policy) when toggled away and back', () => {
    const optId = currentRules.registrationOptions[0].id;
    component.addCapacity();
    const capId = currentRules.capacities[0].id;
    component.updateOptionCapacityUsage(optId, capId, '2');

    // Switch option to VideoOnly -> capacityUsage clears -> switch back to InPerson -> restores 2
    component.updateOptionAttendance(optId, AttendanceType.VideoOnly);
    expect(currentRules.registrationOptions[0].capacityUsage).toEqual({});
    component.updateOptionAttendance(optId, AttendanceType.InPerson);
    expect(currentRules.registrationOptions[0].capacityUsage[capId]).toBe(2);

    // Early Bird Policy deadline -> Disabled -> Enabled restores deadline
    component.toggleEarlyBirdPolicy(true);
    component.updateEarlyBirdDeadline('2027-01-20');
    component.toggleEarlyBirdPolicy(false);
    component.toggleEarlyBirdPolicy(true);
    expect(currentRules.earlyBird).toEqual({
      kind: EarlyBirdPolicyKind.Enabled,
      deadlineDate: '2027-01-20',
    });

    // SubSelection PickSuboptions -> None -> PickSuboptions
    component.updateOptionSubSelectionKind(optId, SubSelectionKind.PickSuboptions);
    component.updateOptionPickCount(optId, '2');
    const savedSuboptions =
      currentRules.registrationOptions[0].subSelection.kind === SubSelectionKind.PickSuboptions
        ? [...currentRules.registrationOptions[0].subSelection.availableSuboptions]
        : [];
    component.updateOptionSubSelectionKind(optId, SubSelectionKind.None);
    component.updateOptionSubSelectionKind(optId, SubSelectionKind.PickSuboptions);
    expect(currentRules.registrationOptions[0].subSelection).toEqual({
      kind: SubSelectionKind.PickSuboptions,
      availableSuboptions: savedSuboptions,
      pickCount: 2,
    });

    // Add-On CatalogVideo -> Other -> CatalogVideo and BeforeEventStart condition
    component.addRegistrationOption();
    component.addEventAddOn();
    const addOnId = currentRules.addOns[0].id;
    component.updateAddOnSpecKind(addOnId, EventAddOnKind.CatalogVideo);
    component.updateAddOnCatalogVideoId(addOnId, 'vid_sticky_hands');
    component.updateAddOnConditions(
      addOnId,
      initEventRuleConditions({
        timing: {
          kind: TimingConditionKind.Window,
          window: TimingWindow.BeforeEventStart,
        },
        registration: {
          kind: RegistrationConditionKind.SpecificOptions,
          optionIds: [optId],
        },
      }),
    );

    component.updateAddOnSpecKind(addOnId, EventAddOnKind.Other);
    component.updateAddOnSpecKind(addOnId, EventAddOnKind.CatalogVideo);
    expect(currentRules.addOns[0].spec).toEqual({
      kind: EventAddOnKind.CatalogVideo,
      videoId: 'vid_sticky_hands',
    });

    // Deposit policy ($75, RefundableBefore 2027-01-10) -> Disabled -> Enabled
    component.toggleDepositPolicy(true);
    component.updateDepositModifierValue('75');
    component.updateDepositRefundKind(DepositRefundPolicyKind.RefundableBefore);
    component.updateDepositRefundDeadline('2027-01-10');

    component.toggleDepositPolicy(false);
    component.toggleDepositPolicy(true);
    expect(currentRules.payment.depositPolicy).toMatchObject({
      kind: DepositPolicyKind.Enabled,
      depositCents: 7500,
      refundPolicy: {
        kind: DepositRefundPolicyKind.RefundableBefore,
        deadlineDate: '2027-01-10',
      },
    });
  });

  it('configures Registration Form Questions (short text, long text, menu select, checkboxes), preserves cached choices, prunes registration condition on option removal, and previews in Simulator', async () => {
    const el: HTMLElement = fixture.nativeElement;
    const inPersonOptId = currentRules.registrationOptions[0].id;
    component.addRegistrationOption();
    const onlineOptId = currentRules.registrationOptions[1].id;
    component.updateOptionLabel(onlineOptId, 'Online Zoom');
    component.updateOptionAttendance(onlineOptId, AttendanceType.Online);

    // 1. Add a required Select question scoped only to In-Person
    component.addQuestion();
    const qSelectId = currentRules.questions[0].id;
    component.updateQuestionLabel(qSelectId, 'T-Shirt Size');
    component.updateQuestionDescription(qSelectId, 'Included for in-person attendees');
    component.updateQuestionKind(qSelectId, RegistrationQuestionKind.Select);
    component.removeQuestionChoice(qSelectId, 'Option 1');
    component.removeQuestionChoice(qSelectId, 'Option 2');
    component.setQuestionChoiceDraft(qSelectId, 'Small, Medium, Large');
    component.addQuestionChoicesFromDraft(qSelectId);
    component.updateQuestionConditions(
      qSelectId,
      initEventRuleConditions({
        registration: {
          kind: RegistrationConditionKind.SpecificOptions,
          optionIds: [inPersonOptId, onlineOptId],
        },
      }),
    );

    // Switching kind to ShortText and back to Select preserves the custom choices
    component.updateQuestionKind(qSelectId, RegistrationQuestionKind.ShortText);
    component.updateQuestionPlaceholder(qSelectId, 'Enter size...');
    component.updateQuestionKind(qSelectId, RegistrationQuestionKind.Select);
    expect(currentRules.questions[0].spec).toEqual({
      kind: RegistrationQuestionKind.Select,
      options: ['Small', 'Medium', 'Large'],
    });

    // 2. Add a Checkboxes question and a LongText question
    component.addQuestion();
    const qChecksId = currentRules.questions[1].id;
    component.updateQuestionLabel(qChecksId, 'Focus Areas');
    component.updateQuestionKind(qChecksId, RegistrationQuestionKind.Checkboxes);
    component.removeQuestionChoice(qChecksId, 'Option 1');
    component.removeQuestionChoice(qChecksId, 'Option 2');
    component.setQuestionChoiceDraft(qChecksId, 'Spinning Hands, Chin Na');
    component.addQuestionChoicesFromDraft(qChecksId);

    component.addQuestion();
    const qLongId = currentRules.questions[2].id;
    component.updateQuestionLabel(qLongId, 'Additional Background');
    component.updateQuestionRequired(qLongId, false);
    component.updateQuestionKind(qLongId, RegistrationQuestionKind.LongText);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Simulator validates unanswered required questions
    expect(component.simQuestionValidation().errors.length).toBe(2);
    expect(el.textContent).toContain('Please select an option for: "T-Shirt Size".');

    // Fill out simulator answers
    component.updateSimQuestionSelect(qSelectId, 'Medium');
    component.toggleSimQuestionCheckbox(qChecksId, 'Chin Na', true);
    component.updateSimQuestionText(qLongId, '5 years practice');
    fixture.detectChanges();

    expect(component.simQuestionValidation().errors).toEqual([]);
    expect(component.simQuestionValidation().responses).toHaveLength(3);

    // Removing onlineOptId prunes it from question registration condition
    component.removeRegistrationOption(onlineOptId);
    expect(currentRules.questions[0].conditions.registration).toEqual({
      kind: RegistrationConditionKind.SpecificOptions,
      optionIds: [inPersonOptId],
    });
  });
});
