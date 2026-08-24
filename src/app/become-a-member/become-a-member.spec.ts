/* become-a-member.spec.ts
 *
 * Unit tests for BecomeAMemberComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BecomeAMemberComponent } from './become-a-member';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserDetails } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { initMember, MembershipType } from '../../../functions/src/data-model';
import {
  StripeProduct,
  StripePriceType,
  StripeRecurringInterval,
} from '../../../functions/src/stripe-types';

import { SearchableSet } from '../searchable-set';
import { CountryCode } from '../country-codes';

describe('BecomeAMemberComponent', () => {
  let fixture: ComponentFixture<BecomeAMemberComponent>;
  let component: BecomeAMemberComponent;
  let mockStripeService: {
    listProducts: ReturnType<typeof vi.fn>;
    createCheckoutSession: ReturnType<typeof vi.fn>;
    cancelSubscriptionRenewal: ReturnType<typeof vi.fn>;
    resumeSubscriptionRenewal: ReturnType<typeof vi.fn>;
  };
  let userSignal: ReturnType<typeof signal<UserDetails | null>>;
  let mockDataManager: {
    countries: SearchableSet<'name', CountryCode>;
    updateMember: ReturnType<typeof vi.fn>;
  };

  const sampleProducts: StripeProduct[] = [
    {
      id: 'prod_mem_annual',
      name: 'ILC Annual Membership',
      description: 'Annual membership fee',
      active: true,
      images: [],
      metadata: {},
      created: 1000,
      updated: 1000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_annual_reg',
          active: true,
          currency: 'usd',
          unitAmount: 8500,
          type: StripePriceType.Recurring,
          recurringInterval: StripeRecurringInterval.Year,
          recurringIntervalCount: 1,
          nickname: 'Annual : Regular',
          created: 1001,
        },
        {
          id: 'price_annual_sen',
          active: true,
          currency: 'usd',
          unitAmount: 5500,
          type: StripePriceType.Recurring,
          recurringInterval: StripeRecurringInterval.Year,
          recurringIntervalCount: 1,
          nickname: 'Annual : 65+ Senior',
          created: 1002,
        },
        {
          id: 'price_annual_u21',
          active: true,
          currency: 'usd',
          unitAmount: 5500,
          type: StripePriceType.Recurring,
          recurringInterval: StripeRecurringInterval.Year,
          recurringIntervalCount: 1,
          nickname: 'Annual : Under 21',
          created: 1003,
        },
      ],
    },
    {
      id: 'prod_mem_life',
      name: 'ILC Lifetime Membership',
      description: 'Lifetime membership',
      active: true,
      images: [],
      metadata: {},
      created: 2000,
      updated: 2000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_life_sen',
          active: true,
          currency: 'usd',
          unitAmount: 55000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Life : Senior',
          created: 2001,
        },
        {
          id: 'price_life_reg',
          active: true,
          currency: 'usd',
          unitAmount: 85000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Life : Regular',
          created: 2002,
        },
        {
          id: 'price_life_spouse_sen',
          active: true,
          currency: 'usd',
          unitAmount: 60000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Life + Spouse : Senior',
          created: 2003,
        },
        {
          id: 'price_life_spouse_reg',
          active: true,
          currency: 'usd',
          unitAmount: 90000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Life + Spouse : Regular',
          created: 2004,
        },
      ],
    },
  ];

  const sampleMember = {
    ...initMember(),
    docId: 'mem_test_123',
    name: 'Jane Doe',
    dateOfBirth: '1990-01-01',
    country: 'United States',
    membershipType: MembershipType.Annual,
    currentMembershipExpires: '2027-01-01',
    membershipSubscriptionId: 'sub_123',
    membershipNextAutoRenewDate: '2027-01-01',
  };

  const sampleUser: UserDetails = {
    member: sampleMember,
    memberProfiles: [sampleMember],
    schoolsManaged: [],
    isAdmin: false,
    firebaseUser: { email: 'test@example.com', uid: 'uid_test_123' } as never,
  };

  let mockFirebaseService: {
    user: typeof userSignal;
    loginWithEmail: ReturnType<typeof vi.fn>;
    signupWithEmail: ReturnType<typeof vi.fn>;
    loginWithGoogle: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockStripeService = {
      listProducts: vi.fn().mockResolvedValue({ products: sampleProducts }),
      createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        sessionId: 'cs_test_123',
      }),
      cancelSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_123',
        cancelAtPeriodEnd: true,
        periodEnd: '2027-01-01',
      }),
      resumeSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_123',
        cancelAtPeriodEnd: false,
        nextAutoRenewDate: '2027-01-01',
      }),
    };

    userSignal = signal<UserDetails | null>(sampleUser);

    mockFirebaseService = {
      user: userSignal,
      loginWithEmail: vi.fn(),
      signupWithEmail: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn().mockResolvedValue({ success: true }),
    };

    mockDataManager = {
      countries: new SearchableSet<'name', CountryCode>(
        ['name', 'id'],
        'name',
        [
          { id: 'US', name: 'United States' },
          { id: 'GB', name: 'United Kingdom' },
        ],
      ),
      updateMember: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [BecomeAMemberComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StripeService, useValue: mockStripeService },
        {
          provide: FirebaseStateService,
          useValue: mockFirebaseService,
        },
        { provide: DataManagerService, useValue: mockDataManager },
        {
          provide: RoutingService,
          useValue: {
            navigateToParts: vi.fn(),
            hrefForView: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  async function createComponent(): Promise<void> {
    fixture = TestBed.createComponent(BecomeAMemberComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should create and load membership products', async () => {
    await createComponent();
    expect(component).toBeTruthy();
    expect(component.membershipProducts().length).toBe(2);
    expect(component.selectedPriceId()).toBe('price_annual_reg');
    expect(component.applicableAnnualTier().badge).toBe('Standard Rate');
  });

  it('should recognize active membership and subscription status', async () => {
    await createComponent();
    expect(component.isLoggedIn()).toBe(true);
    expect(component.hasActiveSubscription()).toBe(true);
    expect(component.isExistingActiveMember()).toBe(true);
  });

  it('should automatically select youth annual rate for age under 21', async () => {
    await createComponent();
    component.dateOfBirth.set('2010-06-15');
    await fixture.whenStable();

    expect(component.age()).toBeLessThan(21);
    expect(component.applicableAnnualTier().price?.id).toBe('price_annual_u21');
    expect(component.applicableAnnualTier().badge).toContain('Youth');
    expect(component.selectedPriceId()).toBe('price_annual_u21');
  });

  it('should automatically select senior annual rate for age 65 and over', async () => {
    await createComponent();
    component.dateOfBirth.set('1950-01-01');
    await fixture.whenStable();

    expect(component.age()).toBeGreaterThanOrEqual(65);
    expect(component.applicableAnnualTier().price?.id).toBe('price_annual_sen');
    expect(component.applicableAnnualTier().badge).toContain('Senior');
    expect(component.selectedPriceId()).toBe('price_annual_sen');
  });

  it('should allow switching between annual, life individual, and life with spouse options', async () => {
    await createComponent();
    expect(component.selectedOption()).toBe('annual');
    expect(component.selectedPriceId()).toBe('price_annual_reg');

    component.selectedOption.set('life_individual');
    await fixture.whenStable();
    expect(component.selectedPriceId()).toBe('price_life_reg');

    component.selectedOption.set('life_spouse');
    await fixture.whenStable();
    expect(component.selectedPriceId()).toBe('price_life_spouse_reg');
  });

  it('should select standard regular rate for lifetime options when member is not senior (e.g. 28 years old)', async () => {
    await createComponent();
    component.dateOfBirth.set('1998-05-10');
    await fixture.whenStable();

    expect(component.age()).toBe(28);

    // Life individual -> should select regular price (price_life_reg), not senior
    component.selectedOption.set('life_individual');
    await fixture.whenStable();
    expect(component.lifeIndividualOption().price?.id).toBe('price_life_reg');
    expect(component.lifeIndividualOption().badge).toBe('Standard Rate');
    expect(component.selectedPriceId()).toBe('price_life_reg');

    // Life with spouse -> should select regular price (price_life_spouse_reg), not senior
    component.selectedOption.set('life_spouse');
    await fixture.whenStable();
    expect(component.lifeSpouseOption().price?.id).toBe('price_life_spouse_reg');
    expect(component.lifeSpouseOption().badge).toBe('Standard Rate');
    expect(component.selectedPriceId()).toBe('price_life_spouse_reg');
  });

  it('should select senior rate for lifetime options when member is senior (65+)', async () => {
    await createComponent();
    component.dateOfBirth.set('1955-01-01');
    await fixture.whenStable();

    expect(component.age()).toBeGreaterThanOrEqual(65);

    // Life individual -> should select senior price
    component.selectedOption.set('life_individual');
    await fixture.whenStable();
    expect(component.lifeIndividualOption().price?.id).toBe('price_life_sen');
    expect(component.lifeIndividualOption().badge).toContain('Senior');
    expect(component.selectedPriceId()).toBe('price_life_sen');

    // Life with spouse -> should select senior price
    component.selectedOption.set('life_spouse');
    await fixture.whenStable();
    expect(component.lifeSpouseOption().price?.id).toBe('price_life_spouse_sen');
    expect(component.lifeSpouseOption().badge).toContain('Senior');
    expect(component.selectedPriceId()).toBe('price_life_spouse_sen');
  });

  it('should select senior rate for life with spouse when member is under 65 (e.g. 28) but spouse is senior (65+)', async () => {
    await createComponent();
    component.dateOfBirth.set('1998-05-10'); // 28 years old
    component.spouseDateOfBirth.set('1955-03-20'); // 71 years old
    await fixture.whenStable();

    expect(component.age()).toBe(28);
    expect(component.spouseAge()).toBeGreaterThanOrEqual(65);

    component.selectedOption.set('life_spouse');
    await fixture.whenStable();

    expect(component.lifeSpouseOption().price?.id).toBe('price_life_spouse_sen');
    expect(component.lifeSpouseOption().badge).toBe('Senior Rate (65+)');
    expect(component.lifeSpouseOption().note).toContain('spouse’s date of birth');
    expect(component.selectedPriceId()).toBe('price_life_spouse_sen');
  });

  it('should handle logout click', async () => {
    await createComponent();
    await component.onLogout();
    expect(mockFirebaseService.logout).toHaveBeenCalled();
  });

  it('should update member profile and initiate stripe checkout on proceed', async () => {
    await createComponent();
    const redirectSpy = vi.spyOn(component, 'redirectTo').mockImplementation(() => {});

    await component.onProceedToPayment();

    expect(mockDataManager.updateMember).toHaveBeenCalledWith(
      'mem_test_123',
      expect.objectContaining({
        name: 'Jane Doe',
        dateOfBirth: '1990-01-01',
        country: 'United States',
      }),
      expect.anything(),
    );

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_annual_reg',
      window.location.origin,
      1,
      expect.objectContaining({
        successUrl: expect.stringContaining('/order-complete?session_id={CHECKOUT_SESSION_ID}'),
        cancelUrl: expect.stringContaining('/become-a-member'),
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_123',
    );
  });

  it('should prevent life members from initiating another membership purchase and skip buying steps in DOM', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        membershipType: MembershipType.Life,
      },
    });
    await createComponent();

    expect(component.isLifeMember()).toBe(true);

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Active Lifetime Membership');
    expect(element.textContent).toContain('An official I Liq Chuan Membership provides');
    expect(element.textContent).not.toContain('1. Your Account');
    expect(element.textContent).not.toContain('2. Basic Information');
    expect(element.textContent).not.toContain('3. Choose Membership Option');
    expect(element.querySelector('.pay-btn')).toBeNull();

    await component.onProceedToPayment();
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(component.checkoutError()).toContain('Lifetime Membership');
  });

  it('should validate and pass spouse details in stripe metadata for life with spouse option', async () => {
    await createComponent();
    const redirectSpy = vi.spyOn(component, 'redirectTo').mockImplementation(() => {});

    component.selectedOption.set('life_spouse');
    await fixture.whenStable();
    expect(component.isSpouseOptionSelected()).toBe(true);

    // Missing spouse info -> should set error and not call stripe
    await component.onProceedToPayment();
    expect(component.checkoutError()).toContain('spouse');
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();

    // Populate spouse info
    component.spouseName.set('John Doe');
    component.spouseEmail.set('john@example.com');
    component.spouseDateOfBirth.set('1988-03-15');
    await fixture.whenStable();

    await component.onProceedToPayment();

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_life_spouse_reg',
      window.location.origin,
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          memberDocId: 'mem_test_123',
          spouseName: 'John Doe',
          spouseEmail: 'john@example.com',
          spouseDob: '1988-03-15',
          spouseCountry: 'United States',
        }),
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_123',
    );
  });

  it('should correctly report active annual and expired membership statuses', async () => {
    // Active annual
    await createComponent();
    expect(component.hasActiveAnnualMembership()).toBe(true);
    expect(component.hasExpiredMembership()).toBe(false);

    // Expired annual
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2020-01-01',
      },
    });
    await fixture.whenStable();
    expect(component.hasActiveAnnualMembership()).toBe(false);
    expect(component.hasExpiredMembership()).toBe(true);
  });

  it('should skip the completed account and details steps for a returning member', async () => {
    await createComponent();
    expect(component.hasCompletedBasicInfo()).toBe(true);

    expect(component.flow.current()).toBe(component.StepMembership);
    expect(component.flow.stateOf(component.StepAccount)).toBe('done');
    expect(component.flow.stateOf(component.StepDetails)).toBe('done');
    expect(component.flow.stateOf(component.StepMembership)).toBe('current');
  });

  it('should reopen an earlier step on request and step forward again', async () => {
    await createComponent();

    component.flow.goTo(component.StepDetails);
    expect(component.flow.current()).toBe(component.StepDetails);
    expect(component.flow.stateOf(component.StepDetails)).toBe('current');
    // The membership step is still outstanding, just not the expanded one.
    expect(component.flow.stateOf(component.StepMembership)).toBe('todo');

    component.flow.next();
    expect(component.flow.current()).toBe(component.StepMembership);
  });

  it('should stop on the details step while required profile info is missing', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        name: '',
      },
    });
    await createComponent();
    expect(component.hasCompletedBasicInfo()).toBe(false);
    expect(component.flow.current()).toBe(component.StepDetails);
    expect(component.flow.stateOf(component.StepAccount)).toBe('done');
    expect(component.flow.stateOf(component.StepMembership)).toBe('todo');
  });

  it('should pull the user back when an earlier step stops being complete', async () => {
    await createComponent();
    expect(component.flow.current()).toBe(component.StepMembership);

    // Clearing a required field must not strand the user further along.
    component.name.set('');
    expect(component.flow.current()).toBe(component.StepDetails);
  });

  it('should handle cancel auto renewal', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await createComponent();

    await component.onCancelAutoRenew();
    expect(mockStripeService.cancelSubscriptionRenewal).toHaveBeenCalledWith(
      'sub_123',
    );
    expect(component.cancelSuccessMessage()).toContain('cancelled');
  });
});
