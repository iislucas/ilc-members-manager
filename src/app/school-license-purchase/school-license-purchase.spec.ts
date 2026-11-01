/* school-license-purchase.spec.ts
 *
 * Unit tests for SchoolLicensePurchaseComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchoolLicensePurchaseComponent } from './school-license-purchase';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserDetails } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { StripeProductsService } from '../stripe-products.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { initMember, MembershipType, SubscriptionInterval, SubscriptionItemType, SubscriptionStatus } from '../../../functions/src/data-model/members';
import { initSchool, School } from '../../../functions/src/data-model/schools';
import { CountryCode } from '../country-codes';
import { SearchableSet } from '../searchable-set';
import {
  StripeProduct,
  StripePriceType,
  StripeRecurringInterval,
} from '../../../functions/src/stripe-types';

describe('SchoolLicensePurchaseComponent', () => {
  let fixture: ComponentFixture<SchoolLicensePurchaseComponent>;
  let component: SchoolLicensePurchaseComponent;
  let mockStripeService: {
    createCheckoutSession: ReturnType<typeof vi.fn>;
    getCheckoutSession: ReturnType<typeof vi.fn>;
    getManagedSchoolsBilling: ReturnType<typeof vi.fn>;
    cancelSubscriptionRenewal: ReturnType<typeof vi.fn>;
    resumeSubscriptionRenewal: ReturnType<typeof vi.fn>;
  };
  let userSignal: ReturnType<typeof signal<UserDetails | null>>;
  let schoolIdParam: ReturnType<typeof signal<string | null>>;
  let tabParam: ReturnType<typeof signal<string | null>>;
  let mockStripeProducts: {
    products: ReturnType<typeof signal<StripeProduct[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
  };
  let mockDataManager: {
    schools: { entries: ReturnType<typeof vi.fn> };
    myOrders: { entries: ReturnType<typeof vi.fn> };
    countries: SearchableSet<'name', CountryCode>;
  };

  const sampleProducts: StripeProduct[] = [
    {
      id: 'prod_license_school_yearly',
      name: 'LICENSE : School (YEARLY)',
      description: 'School yearly license',
      active: true,
      images: [],
      metadata: {},
      created: 1000,
      updated: 1000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_sch_yearly',
          active: true,
          currency: 'usd',
          unitAmount: 60000,
          type: StripePriceType.Recurring,
          recurringInterval: StripeRecurringInterval.Year,
          recurringIntervalCount: 1,
          nickname: 'LICENSE : School Yearly',
          created: 1001,
        },
      ],
    },
    {
      id: 'prod_license_school_monthly',
      name: 'LICENSE : School (MONTHLY)',
      description: 'School monthly license',
      active: true,
      images: [],
      metadata: {},
      created: 2000,
      updated: 2000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_sch_monthly',
          active: true,
          currency: 'usd',
          unitAmount: 6000,
          type: StripePriceType.Recurring,
          recurringInterval: StripeRecurringInterval.Month,
          recurringIntervalCount: 1,
          nickname: 'School Monthly',
          created: 2001,
        },
      ],
    },
  ];

  const sampleSchool: School = {
    ...initSchool(),
    docId: 'school_doc_1',
    schoolId: 'SCH-NY-01',
    schoolName: 'New York ILC Branch',
    ownerInstructorId: 'US-INS-01',
    schoolLicenseExpires: '2027-01-01',
    schoolLicenseRenewalDate: '2026-01-01',
    schoolCountry: 'United States',
    schoolCity: 'New York',
  };

  const sampleMember = {
    ...initMember(),
    docId: 'mem_owner_1',
    name: 'Bob Owner',
    country: 'United States',
    instructorId: 'US-INS-01',
    membershipType: MembershipType.Annual,
    currentMembershipExpires: '2028-01-01',
  };

  const sampleUser: UserDetails = {
    member: sampleMember,
    memberProfiles: [sampleMember],
    schoolsManaged: ['SCH-NY-01'],
    isAdmin: false,
    firebaseUser: { email: 'owner@example.com', uid: 'uid_owner_1' } as never,
  };

  beforeEach(async () => {
    mockStripeService = {
      createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_school',
        sessionId: 'cs_test_school',
      }),
      getCheckoutSession: vi.fn().mockResolvedValue({
        id: 'cs_test_school',
        paymentStatus: 'paid',
        status: 'complete',
        amountTotal: 60000,
        currency: 'usd',
        customerEmail: 'owner@example.com',
        lineItems: [{ description: 'School License Yearly' }],
      }),
      getManagedSchoolsBilling: vi.fn().mockResolvedValue({ schools: {} }),
      cancelSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_sch_1',
        cancelAtPeriodEnd: true,
        periodEnd: '2027-01-01',
      }),
      resumeSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_sch_1',
        cancelAtPeriodEnd: false,
        nextAutoRenewDate: '2027-01-01',
      }),
    };

    userSignal = signal<UserDetails | null>(sampleUser);
    schoolIdParam = signal<string | null>(null);
    tabParam = signal<string | null>(null);

    mockStripeProducts = {
      products: signal(sampleProducts),
      loading: signal(false),
      error: signal<string | null>(null),
    };

    mockDataManager = {
      schools: {
        entries: vi.fn().mockReturnValue([sampleSchool]),
      },
      myOrders: {
        entries: vi.fn().mockReturnValue([]),
      },
      countries: new SearchableSet<'name', CountryCode>(
        ['name', 'id'],
        'name',
        [
          { id: 'US', name: 'United States' },
          { id: 'FR', name: 'France' },
        ],
      ),
    };

    await TestBed.configureTestingModule({
      imports: [SchoolLicensePurchaseComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StripeService, useValue: mockStripeService },
        {
          provide: FirebaseStateService,
          useValue: {
            user: userSignal,
            loginError: signal<string | null>(null),
            completedEmailLinkSignIn: signal<string | null>(null),
            offerPasswordSetup: signal<boolean>(false),
            pendingEmailLink: signal<string | null>(null),
          },
        },
        { provide: DataManagerService, useValue: mockDataManager },
        {
          // The catalogue loads only for pages that sell something, so it
          // comes from StripeProductsService rather than DataManagerService.
          provide: StripeProductsService,
          useValue: mockStripeProducts,
        },
        {
          provide: RoutingService,
          useValue: {
            navigateToParts: vi.fn(),
            hrefForView: vi.fn().mockImplementation((view: Views) => {
              if (view === Views.FindSchool) return '/find-school';
              if (view === Views.BecomeAMember) return '/become-a-member';
              return '/mock-path';
            }),
            signals: {
              [Views.SchoolLicensePurchase]: {
                urlParams: {
                  session_id: signal(null),
                  schoolId: schoolIdParam,
                  tab: tabParam,
                },
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  async function createComponent(): Promise<void> {
    fixture = TestBed.createComponent(SchoolLicensePurchaseComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should list member managed schools and select first school for renewal', async () => {
    await createComponent();
    expect(component.isLoggedIn()).toBe(true);
    expect(component.isActiveMember()).toBe(true);
    expect(component.mySchools().length).toBe(1);
    expect(component.selectedSchoolDocId()).toBe('school_doc_1');
    expect(component.licenseAction()).toBe('renew');
  });

  it('isSchoolActive treats an empty expiry as a life license', async () => {
    await createComponent();
    expect(component.isSchoolActive({ ...sampleSchool, schoolLicenseExpires: '' })).toBe(true);
    expect(component.isSchoolActive({ ...sampleSchool, schoolLicenseExpires: '2000-01-01' })).toBe(false);
    expect(component.isSchoolActive({ ...sampleSchool, schoolLicenseExpires: '2999-01-01' })).toBe(true);
  });

  it('should pre-select the school named by the ?schoolId= URL param', async () => {
    const secondSchool: School = {
      ...sampleSchool,
      docId: 'school_doc_2',
      schoolId: 'SCH-NY-02',
      schoolName: 'Brooklyn ILC Branch',
    };
    mockDataManager.schools.entries.mockReturnValue([sampleSchool, secondSchool]);
    schoolIdParam.set('SCH-NY-02');
    await createComponent();
    expect(component.licenseAction()).toBe('renew');
    expect(component.selectedSchoolDocId()).toBe('school_doc_2');
  });

  it('should select the URL school once the schools list loads after init', async () => {
    mockDataManager.schools.entries.mockReturnValue([]);
    schoolIdParam.set('SCH-NY-01');
    await createComponent();
    expect(component.licenseAction()).toBe('new');
    expect(component.selectedSchoolDocId()).toBeNull();

    // Schools arrive later (e.g. the Firestore snapshot lands after a deep link).
    const schoolsSignal = signal<School[]>([sampleSchool]);
    mockDataManager.schools.entries.mockImplementation(() => schoolsSignal());
    userSignal.set({ ...sampleUser });
    expect(component.licenseAction()).toBe('renew');
    expect(component.selectedSchoolDocId()).toBe('school_doc_1');
  });

  it('should redirect to Stripe Checkout on purchase click with school metadata for renewal', async () => {
    await createComponent();
    const redirectSpy = vi.spyOn(component, 'redirectTo').mockImplementation(() => {});

    await component.onPurchaseSchoolLicense();

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_sch_yearly',
      window.location.origin,
      1,
      expect.objectContaining({
        successUrl: expect.stringContaining('/order-complete?session_id={CHECKOUT_SESSION_ID}'),
        cancelUrl: expect.stringContaining('/school-license'),
        metadata: {
          memberDocId: 'mem_owner_1',
          memberId: '',
          orderType: 'school',
          schoolDocId: 'school_doc_1',
          schoolId: 'SCH-NY-01',
        },
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_school',
    );
  });

  it('should support registering a new school and submitting new school metadata with memberDocId', async () => {
    await createComponent();
    const redirectSpy = vi.spyOn(component, 'redirectTo').mockImplementation(() => {});

    // Switch to new school registration
    component.licenseAction.set('new');
    component.newSchoolName.set('ILC Brooklyn Academy');
    component.newSchoolCountry.set('United States');
    component.newSchoolCity.set('Brooklyn');
    component.newSchoolCountyOrState.set('NY');
    component.newSchoolAddress.set('456 Atlantic Ave');
    component.newSchoolZipCode.set('11217');
    component.newSchoolWebsite.set('https://brooklynilc.example.com');

    await component.onPurchaseSchoolLicense();

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_sch_yearly',
      window.location.origin,
      1,
      expect.objectContaining({
        metadata: {
          memberDocId: 'mem_owner_1',
          memberId: '',
          orderType: 'school',
          isNewSchool: 'true',
          schoolName: 'ILC Brooklyn Academy',
          schoolCountry: 'United States',
          schoolCity: 'Brooklyn',
          schoolCountyOrState: 'NY',
          schoolAddress: '456 Atlantic Ave',
          schoolZipCode: '11217',
          schoolWebsite: 'https://brooklynilc.example.com',
        },
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_school',
    );
  });

  it('should validate required fields when registering a new school', async () => {
    await createComponent();
    component.licenseAction.set('new');
    component.newSchoolName.set('');

    await component.onPurchaseSchoolLicense();
    expect(component.checkoutError()).toContain('name for your new school');

    component.newSchoolName.set('Test School');
    component.newSchoolCountry.set('');
    await component.onPurchaseSchoolLicense();
    expect(component.checkoutError()).toContain('country for your new school');

    component.newSchoolCountry.set('United States');
    component.newSchoolCity.set('');
    await component.onPurchaseSchoolLicense();
    expect(component.checkoutError()).toContain('city for your new school');
  });

  it('should default to new school action when member has no existing schools', async () => {
    mockDataManager.schools.entries.mockReturnValue([]);
    userSignal.set({
      ...sampleUser,
      schoolsManaged: [],
    });

    await createComponent();
    expect(component.mySchools().length).toBe(0);
    expect(component.licenseAction()).toBe('new');
  });

  it('should render clarification note about school license authorization and instructor requirements', async () => {
    await createComponent();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain(
      'A School License authorizes the individual to open and operate a Licensed School, at one or more locations, in an area that is reserved for their use. They may hire Licensed Instructors to lead classes or events at any of their locations. The holder of a School License does not need to be a Licensed Instructor.',
    );
  });

  it('should render updated directory listing and grading benefit bullet points with link to find school', async () => {
    await createComponent();
    const element = fixture.nativeElement as HTMLElement;

    // Check directory listing text does not mention map
    expect(element.textContent).not.toContain('map');
    expect(element.textContent).toContain('Listed in the international I Liq Chuan school directory');

    // Check link to find a school
    const findSchoolLink = element.querySelector('a.inline-link-button[href="/find-school"]');
    expect(findSchoolLink).toBeTruthy();
    expect(findSchoolLink?.textContent).toContain('Find a School');

    // Check gradings clarification
    expect(element.textContent).toContain(
      'Host and advertise events for licensed instructors to conduct gradings.',
    );
  });

  it('should offer a way forward when the account step is reopened while signed in', async () => {
    await createComponent();
    expect(component.isLoggedIn()).toBe(true);

    // The user clicks back to step 1 from the track to check which account
    // they are on. Nothing has changed, so they must be able to go forward.
    component.flow.goTo(component.StepAccount);
    fixture.detectChanges();
    expect(component.flow.current()).toBe(component.StepAccount);

    const card = (fixture.nativeElement as HTMLElement).querySelector(
      'app-step-card .step-card.current',
    )!;
    const forward = card.querySelector<HTMLButtonElement>('.next-btn');
    // Previously a dead end: the only action was inline-auth's Log Out.
    expect(forward).toBeTruthy();
    expect(forward!.textContent).toContain('Continue');

    forward!.click();
    fixture.detectChanges();
    expect(component.flow.current()).not.toBe(component.StepAccount);
  });

  it('should match schools by docId in schoolsManaged and display payer attribution and Next auto-renewal payment', async () => {
    const managedByDocIdSchool: School = {
      ...initSchool(),
      docId: 'school_managed_by_docid',
      schoolId: 'SCH-MGR-02',
      schoolName: 'Managed By DocId School',
      ownerInstructorId: 'OTHER-INS',
      schoolLicenseExpires: '2027-06-15',
      schoolCountry: 'United States',
      schoolCity: 'Boston',
    };
    mockDataManager.schools.entries.mockReturnValue([managedByDocIdSchool]);
    mockStripeService.getManagedSchoolsBilling.mockResolvedValue({
      schools: {
        school_managed_by_docid: {
          schoolDocId: 'school_managed_by_docid',
          schoolId: 'SCH-MGR-02',
          payerMemberDocId: 'mem_other',
          payerMemberId: 'US555',
          payerName: 'Sifu Other',
          isAutoRenewing: true,
          nextAutoRenewDate: '2027-06-15',
          amount: 60000,
          currency: 'usd',
          lastPaymentDate: '2026-06-15',
        },
      },
    });
    userSignal.set({
      ...sampleUser,
      schoolsManaged: ['school_managed_by_docid'],
    });

    await createComponent();
    await component.loadManagedSchoolsBilling();
    fixture.detectChanges();

    expect(component.mySchools().length).toBe(1);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Payment linked to: Sifu Other (US555)');
    expect(element.textContent).toContain('2027-06-15 ($600.00 USD)');
    expect(element.textContent).toContain(
      'You will pay $600.00 USD and the expiration date will be extended to 2028-06-15.',
    );
  });

  it('should support inline non-blocking cancel auto-renewal on the school subscription card when current user owns the school subscription', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleMember,
        stripeSubscriptions: {
          sub_sch_1: {
            subscriptionId: 'sub_sch_1',
            type: SubscriptionItemType.SchoolLicense,
            status: SubscriptionStatus.Active,
            planName: 'LICENSE : School Yearly',
            amount: 60000,
            currency: 'usd',
            interval: SubscriptionInterval.Year,
            currentPeriodStart: '2026-01-01',
            currentPeriodEnd: '2027-01-01',
            nextAutoRenewDate: '2027-01-01',
            cancelAtPeriodEnd: false,
            schoolDocId: 'school_doc_1',
            schoolId: 'SCH-NY-01',
          },
        },
      },
    });

    await createComponent();
    fixture.detectChanges();

    const subCard = (fixture.nativeElement as HTMLElement).querySelector(
      'app-subscription-card',
    )!;
    expect(subCard).toBeTruthy();

    subCard
      .querySelector<HTMLButtonElement>('.sub-card-actions .cancel-btn')!
      .click();
    fixture.detectChanges();
    expect(confirmSpy).not.toHaveBeenCalled();

    subCard.querySelector<HTMLButtonElement>('.confirm-danger-btn')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockStripeService.cancelSubscriptionRenewal).toHaveBeenCalledWith(
      'sub_sch_1',
    );
    expect(subCard.textContent).toContain('cancelled');
  });

  it('uses accessible pill-tabs with tablist/tabpanel semantics, URL sync, and arrow-key navigation', async () => {
    await createComponent();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.school-mode-toggle')).toBeNull();
    expect(element.querySelector('input[type="radio"]')).toBeNull();

    const tablist = element.querySelector('[role="tablist"].pill-tabs');
    expect(tablist).toBeTruthy();

    const pillTabs = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.pill-tabs .pill-tab[role="tab"]'),
    );
    expect(pillTabs.length).toBe(2);
    expect(pillTabs[0].textContent?.trim()).toBe('Renew an Existing School');
    expect(pillTabs[0].getAttribute('data-label')).toBe('Renew an Existing School');
    expect(pillTabs[0].classList.contains('active')).toBe(true);
    expect(pillTabs[0].getAttribute('aria-selected')).toBe('true');
    expect(pillTabs[0].getAttribute('tabindex')).toBe('0');

    expect(pillTabs[1].textContent?.trim()).toBe('Register a New School');
    expect(pillTabs[1].getAttribute('data-label')).toBe('Register a New School');
    expect(pillTabs[1].classList.contains('active')).toBe(false);
    expect(pillTabs[1].getAttribute('aria-selected')).toBe('false');
    expect(pillTabs[1].getAttribute('tabindex')).toBe('-1');

    const renewPanel = element.querySelector('[role="tabpanel"]#school-license-panel-renew');
    expect(renewPanel).toBeTruthy();

    // Keyboard navigation: ArrowRight switches to Register a New School and moves focus
    pillTabs[0].focus();
    pillTabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(component.licenseAction()).toBe('new');
    expect(tabParam()).toBe('new');
    expect(document.activeElement).toBe(pillTabs[1]);
    expect(pillTabs[1].getAttribute('aria-selected')).toBe('true');
    expect(pillTabs[1].getAttribute('tabindex')).toBe('0');
    expect(pillTabs[0].getAttribute('tabindex')).toBe('-1');
    expect(element.querySelector('[role="tabpanel"]#school-license-panel-new')).toBeTruthy();
    expect(element.querySelector('.schools-grid')).toBeNull();

    // Home returns to Renew an Existing School
    pillTabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(component.licenseAction()).toBe('renew');
    expect(tabParam()).toBe('renew');
    expect(document.activeElement).toBe(pillTabs[0]);
    expect(element.querySelector('[role="tabpanel"]#school-license-panel-renew')).toBeTruthy();
  });

  it('respects ?tab=new URL parameter on initial load even when renewable schools exist', async () => {
    tabParam.set('new');
    await createComponent();
    fixture.detectChanges();

    expect(component.licenseAction()).toBe('new');
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#school-license-panel-new')).toBeTruthy();
    expect(element.querySelector('.schools-grid')).toBeNull();
  });

  it('excludes schools with a lifetime license from Renew an Existing School while keeping their top subscription card', async () => {
    const lifetimeSchool: School = {
      ...sampleSchool,
      docId: 'school_doc_life',
      schoolId: 'SCH-LIFE-01',
      schoolName: 'Lifetime Headquarters School',
      schoolLicenseExpires: '',
    };
    const annualSchool: School = {
      ...sampleSchool,
      docId: 'school_doc_annual',
      schoolId: 'SCH-ANN-02',
      schoolName: 'Annual Branch School',
      schoolLicenseExpires: '2027-05-01',
    };

    mockDataManager.schools.entries.mockReturnValue([lifetimeSchool, annualSchool]);
    userSignal.set({
      ...sampleUser,
      schoolsManaged: ['SCH-LIFE-01', 'SCH-ANN-02'],
    });
    // Even if URL points to the lifetime school, it must not be selected for renewal.
    schoolIdParam.set('SCH-LIFE-01');

    await createComponent();
    fixture.detectChanges();

    expect(component.mySchools().map((s) => s.docId)).toEqual([
      'school_doc_life',
      'school_doc_annual',
    ]);
    expect(component.renewableSchools().map((s) => s.docId)).toEqual([
      'school_doc_annual',
    ]);
    expect(component.licenseAction()).toBe('renew');
    expect(component.selectedSchoolDocId()).toBe('school_doc_annual');

    const element = fixture.nativeElement as HTMLElement;
    const topCards = element.querySelectorAll('app-subscription-card');
    expect(topCards.length).toBe(2);
    expect(topCards[0].textContent).toContain('Lifetime Headquarters School');
    expect(topCards[0].textContent).toContain('Lifetime Access');

    const renewalChoices = element.querySelectorAll('.schools-grid .school-card-choice');
    expect(renewalChoices.length).toBe(1);
    expect(renewalChoices[0].textContent).toContain('Annual Branch School');
    expect(renewalChoices[0].textContent).not.toContain('Lifetime Headquarters School');
  });

  it('defaults to Register a New School and hides Renew tab when all managed schools have lifetime licenses', async () => {
    const lifetimeSchool: School = {
      ...sampleSchool,
      docId: 'school_doc_life',
      schoolId: 'SCH-LIFE-01',
      schoolName: 'Lifetime Headquarters School',
      schoolLicenseExpires: '',
    };

    mockDataManager.schools.entries.mockReturnValue([lifetimeSchool]);
    userSignal.set({
      ...sampleUser,
      schoolsManaged: ['SCH-LIFE-01'],
    });

    await createComponent();
    fixture.detectChanges();

    expect(component.mySchools().length).toBe(1);
    expect(component.renewableSchools().length).toBe(0);
    expect(component.licenseAction()).toBe('new');
    expect(component.selectedSchoolDocId()).toBeNull();

    const element = fixture.nativeElement as HTMLElement;
    // Top subscription card still displays the lifetime school
    const topCards = element.querySelectorAll('app-subscription-card');
    expect(topCards.length).toBe(1);
    expect(topCards[0].textContent).toContain('Lifetime Headquarters School');
    expect(topCards[0].textContent).toContain('Lifetime Access');

    // Step 2 omits the Renew pill-tabs and shows the new-school registration form directly
    expect(element.querySelector('.pill-tabs')).toBeNull();
    expect(element.querySelector('.schools-grid')).toBeNull();
    expect(element.querySelector('.new-school-form')).toBeTruthy();
  });
});
