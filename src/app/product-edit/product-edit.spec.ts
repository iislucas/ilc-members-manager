/* product-edit.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductEditComponent } from './product-edit';
import { ProductService } from '../product.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import {
  AttendanceType,
  EarlyBirdPolicyKind,
  EventAddOnKind,
  EventRegistrationStatus,
  initEvent,
  initEventAddOn,
  initEventCapacity,
  initEventDiscount,
  initEventPricingRules,
  initEventRegistration,
  initEventRegistrationOption,
  initEventRegistrationQuestion,
  initEventRuleConditions,
  initProduct,
  PersonStatusKind,
  RegistrationConditionKind,
  RegistrationQuestionKind,
  TimingConditionKind,
  TimingWindow,
  WhoConditionKind,
} from '../../../functions/src/data-model/events';
import { signal } from '@angular/core';

describe('ProductEditComponent', () => {
  let component: ProductEditComponent;
  let fixture: ComponentFixture<ProductEditComponent>;

  const mockProductService = {
    getProduct: vi.fn().mockResolvedValue(initProduct()),
    getProductByEventId: vi.fn().mockResolvedValue(undefined),
    saveProduct: vi.fn().mockResolvedValue('new-prod-id'),
    deleteProduct: vi.fn().mockResolvedValue(undefined),
    getEventRegistrations: vi.fn().mockResolvedValue([]),
  };

  const mockDataManagerService = {
    getEvents: vi.fn().mockResolvedValue([]),
    getEventById: vi.fn().mockResolvedValue(undefined),
    saveProduct: vi.fn().mockResolvedValue('saved-product-123'),
    deleteProduct: vi.fn().mockResolvedValue(undefined),
    videos: {
      entries: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined),
    },
    getVideoSeriesList: vi.fn().mockReturnValue([]),
  };

  const mockRoutingService = {
    signals: {
      [Views.ManageEventRegistration]: {
        pathVars: {
          eventId: signal(''),
        },
        urlParams: {},
      },
      [Views.ManageEventRegistrationsEdit]: {
        pathVars: {
          eventId: signal(''),
        },
        urlParams: {},
      },
    },
    matchedPatternId: signal<Views | null>(null),
    hrefForView: vi.fn().mockImplementation((view, params) => {
      if (view === Views.ManageEventView) return `/manage-events/${params?.eventId || ''}`;
      if (view === Views.ManageEventRegistrations) return '/manage-event-registrations';
      return '/products/mock-id';
    }),
    navigateTo: vi.fn(),
  };

  const mockFirebaseState = {
    user: signal({
      email: 'admin@ilc.com',
      isAdmin: true,
      isFullMember: true,
      isInstructor: true,
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductEditComponent],
      providers: [
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductEditComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates directly in unified Rule-Based Pricing mode without legacy Matrix switcher', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component.isNew()).toBe(true);
    expect(fixture.nativeElement.querySelector('app-product-rules-edit')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Standard Matrix');
    expect(fixture.nativeElement.textContent).not.toContain('Pricing Configuration Mode');
  });

  it('does not render redundant header or back button, and hides Associated Calendar Event when embedded', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Create New Class / Workshop Product');
    expect(fixture.nativeElement.textContent).not.toContain('All Products');
    expect(fixture.nativeElement.textContent).toContain('Associated Calendar Event');

    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('Associated Calendar Event');
  });

  it('shows delivery resources dynamically when options or add-ons enable online or video modes', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('In-person attendance instructions');
    expect(fixture.nativeElement.textContent).not.toContain('Online Joining Link');
    expect(fixture.nativeElement.textContent).not.toContain('Video Recording for Attendees');

    const rules = initEventPricingRules();
    rules.registrationOptions.push(
      initEventRegistrationOption({
        id: 'online_opt',
        label: 'Online Zoom',
        attendanceType: AttendanceType.Online,
      }),
    );
    rules.addOns.push(
      initEventAddOn({
        id: 'rec_addon',
        label: 'Event Recording',
        spec: { kind: EventAddOnKind.EventRecording },
      }),
    );
    component.onPricingRulesChange(rules);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Online Joining Link');
    expect(fixture.nativeElement.textContent).toContain('Video Recording for Attendees');
  });

  it('links and unlinks calendar events via autocomplete', () => {
    const dummyEvent = {
      ...initEvent(),
      docId: 'ev-123',
      title: 'Spring Intensive',
      start: '2026-05-10T10:00:00Z',
      end: '2026-05-12T17:00:00Z',
      location: 'Boulder, CO',
    };

    component.eventsSearchableSet.setEntries([dummyEvent]);

    component.onEventSelected(dummyEvent);
    expect(component.productModel().eventDocId).toBe('ev-123');
    expect(component.linkedEvent()).toBe(dummyEvent);

    component.clearLinkedEvent();
    expect(component.productModel().eventDocId).toBe('');
    expect(component.linkedEvent()).toBeNull();
  });

  it('populates vodOptionsSet from series and videos and allows selecting/unlinking', async () => {
    const rules = initEventPricingRules();
    rules.addOns.push(
      initEventAddOn({
        id: 'rec_addon',
        label: 'Event Recording',
        spec: { kind: EventAddOnKind.EventRecording },
      }),
    );
    component.onPricingRulesChange(rules);
    fixture.detectChanges();

    component.onVodOptionSelected({
      id: 'series_spring_2026',
      type: 'series',
      title: 'Spring 2026 Workshop',
      displayName: '[Series (3 parts)] Spring 2026 Workshop',
    });

    expect(component.productModel().recordedVideoId).toBe('series_spring_2026');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('app-vod-preview')).toBeTruthy();

    component.updateRecordedVideoId('');
    expect(component.productModel().recordedVideoId).toBe('');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('app-vod-preview')).toBeNull();
  });

  it('calculates video access impact accurately for video-only vs included registrations', () => {
    const regVideoOnly = {
      ...initEventRegistration(),
      docId: 'reg-1',
      attendance: AttendanceType.VideoOnly,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    const regInPersonWithVideo = {
      ...initEventRegistration(),
      docId: 'reg-2',
      attendance: AttendanceType.InPerson,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    const regInPersonNoVideo = {
      ...initEventRegistration(),
      docId: 'reg-3',
      attendance: AttendanceType.InPerson,
      hasVideoAccess: false,
      status: EventRegistrationStatus.Paid,
    };
    const regCancelled = {
      ...initEventRegistration(),
      docId: 'reg-4',
      attendance: AttendanceType.VideoOnly,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Cancelled,
    };

    component.eventRegistrations.set([
      regVideoOnly,
      regInPersonWithVideo,
      regInPersonNoVideo,
      regCancelled,
    ]);

    expect(component.attendeesWithVideoAccess().length).toBe(2);
    expect(component.videoOnlyAttendeesCount()).toBe(1);
    expect(component.includedVideoAttendeesCount()).toBe(1);
  });

  it('prompts confirmation when saving with new or modified video and attendees have video access', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.initialRecordedVideoId.set('');

    const reg = {
      ...initEventRegistration(),
      docId: 'reg-1',
      attendance: AttendanceType.VideoOnly,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    component.eventRegistrations.set([reg]);

    component.productModel.update((m) => ({
      ...m,
      title: 'Spring Workshop 2026',
      recordedVideoId: 'series_123',
    }));

    await component.saveProduct();

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('1 attendee(s)'));
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 video-only pre-order attendee(s)'),
    );
    expect(mockDataManagerService.saveProduct).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('aborts saving if admin cancels the notification confirmation dialog', async () => {
    mockDataManagerService.saveProduct.mockClear();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    component.initialRecordedVideoId.set('');

    const reg = {
      ...initEventRegistration(),
      docId: 'reg-1',
      attendance: AttendanceType.InPerson,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    component.eventRegistrations.set([reg]);

    component.productModel.update((m) => ({
      ...m,
      title: 'Spring Workshop 2026',
      recordedVideoId: 'series_123',
    }));

    await component.saveProduct();

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDataManagerService.saveProduct).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('navigates back to ManageEventView on save from ManageEventRegistration, and ManageEventRegistrations from ManageEventRegistrationsEdit', async () => {
    mockRoutingService.navigateTo.mockClear();

    mockRoutingService.matchedPatternId.set(Views.ManageEventRegistration);
    mockRoutingService.signals[Views.ManageEventRegistration].pathVars.eventId.set('ev-99');
    component.productModel.update((m) => ({
      ...m,
      title: 'Event Reg Setup',
      eventDocId: 'ev-99',
    }));

    await component.saveProduct();
    expect(mockRoutingService.navigateTo).toHaveBeenCalledWith('/manage-events/ev-99');

    mockRoutingService.navigateTo.mockClear();
    component.isSaving.set(false);
    mockRoutingService.matchedPatternId.set(Views.ManageEventRegistrationsEdit);
    mockRoutingService.signals[Views.ManageEventRegistrationsEdit].pathVars.eventId.set('ev-99');

    await component.saveProduct();
    expect(mockRoutingService.navigateTo).toHaveBeenCalledWith('/manage-event-registrations');

    mockRoutingService.matchedPatternId.set(null);
    mockRoutingService.signals[Views.ManageEventRegistration].pathVars.eventId.set('');
    mockRoutingService.signals[Views.ManageEventRegistrationsEdit].pathVars.eventId.set('');
  });

  it('validates pricing rules (capacities, Early Bird deadline) and saves synced summary flags', async () => {
    mockDataManagerService.saveProduct.mockClear();
    component.updateTitle('Flushing NY 4-Day Intensive');

    // Validation error when a capacity limit has an empty label
    const unlabeledCapRules = initEventPricingRules();
    unlabeledCapRules.capacities = [initEventCapacity({ id: 'cap_1', label: '   ', limit: 25 })];
    component.onPricingRulesChange(unlabeledCapRules);
    await component.saveProduct();
    expect(component.errorMessage()).toContain('Every Capacity Limit must have a name');
    expect(mockDataManagerService.saveProduct).not.toHaveBeenCalled();

    // Validation error when Early Bird is enabled without a deadline date
    const invalidEarlyRules = initEventPricingRules();
    invalidEarlyRules.earlyBird = {
      kind: EarlyBirdPolicyKind.Enabled,
      deadlineDate: '',
    };
    component.onPricingRulesChange(invalidEarlyRules);
    await component.saveProduct();
    expect(component.errorMessage()).toContain('Early Bird cutoff date is required');

    // Valid rules with Main Hall capacity (30), Instructors-only In-Person option, and Members-only Recording Only option
    const validRules = initEventPricingRules();
    validRules.capacities = [initEventCapacity({ id: 'hall', label: 'Main Hall', limit: 30 })];
    validRules.earlyBird = {
      kind: EarlyBirdPolicyKind.Enabled,
      deadlineDate: '2026-12-31',
    };
    validRules.registrationOptions = [
      initEventRegistrationOption({
        id: 'full_event',
        label: 'Full Workshop',
        priceCents: 49000,
        attendanceType: AttendanceType.InPerson,
        conditions: initEventRuleConditions({
          who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Instructor },
        }),
        capacityUsage: { hall: 1 },
      }),
      initEventRegistrationOption({
        id: 'recording_only',
        label: 'Recording Pre-Order',
        priceCents: 6000,
        attendanceType: AttendanceType.VideoOnly,
        conditions: initEventRuleConditions({
          who: { kind: WhoConditionKind.Status, status: PersonStatusKind.Member },
        }),
        capacityUsage: {},
      }),
    ];
    component.onPricingRulesChange(validRules);
    fixture.detectChanges();

    await component.saveProduct();
    expect(component.errorMessage()).toBeNull();
    expect(mockDataManagerService.saveProduct).toHaveBeenCalledTimes(1);

    const saved = mockDataManagerService.saveProduct.mock.calls[0][0];
    expect(saved.allowInPerson).toBe(true);
    expect(saved.allowVideo).toBe(true);
    expect(saved.allowVideoOnly).toBe(true);
    expect(saved.allowNonMembers).toBe(false);
    expect(saved.allowMembers).toBe(true);
    expect(saved.allowInstructors).toBe(true);
    expect(saved.hasEarlyBird).toBe(true);
    expect(saved.earlyBirdDeadline).toBe('2026-12-31');
    expect(saved.maxInPersonAttendees).toBe(30);
  });

  it('validates Registration Form Questions (non-empty prompt and at least one choice for select/checkboxes)', async () => {
    mockDataManagerService.saveProduct.mockClear();
    component.updateTitle('Workshop With Questions');

    const emptyLabelRules = initEventPricingRules();
    emptyLabelRules.questions = [
      initEventRegistrationQuestion({
        id: 'q_1',
        label: '   ',
        spec: { kind: RegistrationQuestionKind.ShortText, placeholder: '' },
      }),
    ];
    component.onPricingRulesChange(emptyLabelRules);
    await component.saveProduct();
    expect(component.errorMessage()).toContain('Every Registration Form Question must have a prompt');
    expect(mockDataManagerService.saveProduct).not.toHaveBeenCalled();

    const emptyChoicesRules = initEventPricingRules();
    emptyChoicesRules.questions = [
      initEventRegistrationQuestion({
        id: 'q_2',
        label: 'Meal Choice',
        spec: { kind: RegistrationQuestionKind.Select, options: [] },
      }),
    ];
    component.onPricingRulesChange(emptyChoicesRules);
    await component.saveProduct();
    expect(component.errorMessage()).toContain('Form question "Meal Choice" must have at least one choice');
    expect(mockDataManagerService.saveProduct).not.toHaveBeenCalled();

    const validQuestionRules = initEventPricingRules();
    validQuestionRules.questions = [
      initEventRegistrationQuestion({
        id: 'q_2',
        label: 'Meal Choice',
        spec: { kind: RegistrationQuestionKind.Select, options: ['Standard', 'Vegetarian'] },
      }),
    ];
    component.onPricingRulesChange(validQuestionRules);
    await component.saveProduct();
    expect(component.errorMessage()).toBeNull();
    expect(mockDataManagerService.saveProduct).toHaveBeenCalledTimes(1);
  });

  it('validates rule conditions on save (Early Bird timing requires Early Bird Pricing enabled; Registration condition requires >= 1 option)', async () => {
    mockDataManagerService.saveProduct.mockClear();
    component.updateTitle('Workshop With Rule Conditions');

    // 1. Early Bird timing condition when Early Bird Pricing is disabled
    const ebCondWithoutPolicy = initEventPricingRules();
    ebCondWithoutPolicy.discounts = [
      initEventDiscount({
        id: 'd_eb',
        label: 'Early Bird $30 Off',
        discountCents: 3000,
        conditions: initEventRuleConditions({
          timing: {
            kind: TimingConditionKind.Window,
            window: TimingWindow.BeforeEarlyBird,
          },
        }),
      }),
    ];
    component.onPricingRulesChange(ebCondWithoutPolicy);
    await component.saveProduct();
    expect(component.errorMessage()).toContain('Enable Early Bird Pricing');
    expect(mockDataManagerService.saveProduct).not.toHaveBeenCalled();

    // 2. SpecificOptions with 0 selected options on an add-on
    const emptyRegCondRules = initEventPricingRules();
    emptyRegCondRules.addOns = [
      initEventAddOn({
        id: 'addon_1',
        label: 'Bonus Review',
        priceCents: 2500,
        conditions: initEventRuleConditions({
          registration: { kind: RegistrationConditionKind.SpecificOptions, optionIds: [] },
        }),
      }),
    ];
    component.onPricingRulesChange(emptyRegCondRules);
    await component.saveProduct();
    expect(component.errorMessage()).toContain(
      'Select at least one registration option in the Registration condition for "Bonus Review"',
    );
    expect(mockDataManagerService.saveProduct).not.toHaveBeenCalled();
  });
});
