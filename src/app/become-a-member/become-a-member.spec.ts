/* become-a-member.spec.ts
 *
 * Unit tests for BecomeAMemberComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BecomeAMemberComponent } from './become-a-member';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserData } from '../firebase-state.service';
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
  let userSignal: ReturnType<typeof signal<UserData | null>>;
  let mockDataManager: {
    countries: SearchableSet<'name', CountryCode>;
    updateMember: ReturnType<typeof vi.fn>;
  };

  const sampleProducts: StripeProduct[] = [
    {
      id: 'prod_membership_annual',
      name: 'MEMBERSHIP : Annual',
      description: 'Annual membership',
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
      id: 'prod_membership_life',
      name: 'MEMBERSHIP : Life',
      description: 'Lifetime membership',
      active: true,
      images: [],
      metadata: {},
      created: 2000,
      updated: 2000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_life_ind',
          active: true,
          currency: 'usd',
          unitAmount: 150000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Life : Individual',
          created: 2001,
        },
        {
          id: 'price_life_spouse',
          active: true,
          currency: 'usd',
          unitAmount: 250000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Life : + Spouse',
          created: 2002,
        },
      ],
    },
  ];

  const sampleUser: UserData = {
    email: 'test@example.com',
    member: {
      ...initMember(),
      docId: 'mem_test_123',
      name: 'Jane Doe',
      dateOfBirth: '1990-01-01',
      country: 'United States',
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2027-01-01',
      membershipSubscriptionId: 'sub_123',
      membershipNextAutoRenewDate: '2027-01-01',
    },
    memberDocIds: ['mem_test_123'],
    schoolsManaged: [],
    isAdmin: false,
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

    userSignal = signal<UserData | null>(sampleUser);

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
    expect(component.selectedPriceId()).toBe('price_life_ind');

    component.selectedOption.set('life_spouse');
    await fixture.whenStable();
    expect(component.selectedPriceId()).toBe('price_life_spouse');
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
        successUrl: expect.stringContaining('/?welcome=membership&session_id={CHECKOUT_SESSION_ID}'),
        cancelUrl: expect.stringContaining('/become-a-member'),
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_123',
    );
  });

  it('should prevent life members from initiating another membership purchase', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        membershipType: MembershipType.Life,
      },
    });
    await createComponent();

    expect(component.isLifeMember()).toBe(true);
    await component.onProceedToPayment();

    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(component.checkoutError()).toContain('Lifetime Membership');
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

  it('should collapse basic information for existing active members with complete profile and allow toggling', async () => {
    await createComponent();
    expect(component.hasCompletedBasicInfo()).toBe(true);
    expect(component.isBasicInfoCollapsed()).toBe(true);

    component.toggleBasicInfoCollapse();
    expect(component.isBasicInfoCollapsed()).toBe(false);

    component.toggleBasicInfoCollapse();
    expect(component.isBasicInfoCollapsed()).toBe(true);
  });

  it('should not collapse basic information if profile info is missing', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        name: '',
      },
    });
    await createComponent();
    expect(component.hasCompletedBasicInfo()).toBe(false);
    expect(component.isBasicInfoCollapsed()).toBe(false);
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
