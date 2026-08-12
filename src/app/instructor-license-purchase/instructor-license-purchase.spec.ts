/* instructor-license-purchase.spec.ts
 *
 * Unit tests for InstructorLicensePurchaseComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstructorLicensePurchaseComponent } from './instructor-license-purchase';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserData } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { initMember, MembershipType } from '../../../functions/src/data-model';
import {
  StripeProduct,
  StripePriceType,
  StripeRecurringInterval,
} from '../../../functions/src/stripe-types';

describe('InstructorLicensePurchaseComponent', () => {
  let fixture: ComponentFixture<InstructorLicensePurchaseComponent>;
  let component: InstructorLicensePurchaseComponent;
  let mockStripeService: {
    listProducts: ReturnType<typeof vi.fn>;
    createCheckoutSession: ReturnType<typeof vi.fn>;
    getCheckoutSession: ReturnType<typeof vi.fn>;
    cancelSubscriptionRenewal: ReturnType<typeof vi.fn>;
    resumeSubscriptionRenewal: ReturnType<typeof vi.fn>;
  };
  let userSignal: ReturnType<typeof signal<UserData | null>>;
  let mockDataManager: {
    myOrders: { entries: ReturnType<typeof vi.fn> };
  };

  const sampleProducts: StripeProduct[] = [
    {
      id: 'prod_license_instructor',
      name: 'LICENSE : Instructor + Group Leader',
      description: 'Instructor yearly license',
      active: true,
      images: [],
      metadata: {},
      created: 1000,
      updated: 1000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_ins_yearly',
          active: true,
          currency: 'usd',
          unitAmount: 15000,
          type: StripePriceType.Recurring,
          recurringInterval: StripeRecurringInterval.Year,
          recurringIntervalCount: 1,
          nickname: 'Instructor : $150 Yearly',
          created: 1001,
        },
      ],
    },
  ];

  const sampleUser: UserData = {
    email: 'instructor@example.com',
    member: {
      ...initMember(),
      docId: 'mem_ins_1',
      name: 'Bob Instructor',
      studentLevel: '6',
      applicationLevel: '1',
      instructorId: 'US-INS-01',
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2028-01-01',
      instructorLicenseExpires: '2027-01-01',
      instructorLicenseRenewalDate: '2026-01-01',
      instructorLicenseSubscriptionId: 'sub_lic_123',
      instructorLicenseNextAutoRenewDate: '2027-01-01',
    },
    memberDocIds: ['mem_ins_1'],
    schoolsManaged: [],
    isAdmin: false,
  };

  beforeEach(async () => {
    mockStripeService = {
      listProducts: vi.fn().mockResolvedValue({ products: sampleProducts }),
      createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_license',
        sessionId: 'cs_test_license',
      }),
      getCheckoutSession: vi.fn().mockResolvedValue({
        id: 'cs_test_license',
        paymentStatus: 'paid',
        status: 'complete',
        amountTotal: 15000,
        currency: 'usd',
        customerEmail: 'instructor@example.com',
        lineItems: [{ description: 'Instructor License' }],
      }),
      cancelSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_lic_123',
        cancelAtPeriodEnd: true,
        periodEnd: '2027-01-01',
      }),
      resumeSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_lic_123',
        cancelAtPeriodEnd: false,
        nextAutoRenewDate: '2027-01-01',
      }),
    };

    userSignal = signal<UserData | null>(sampleUser);

    mockDataManager = {
      myOrders: {
        entries: vi.fn().mockReturnValue([]),
      },
    };

    await TestBed.configureTestingModule({
      imports: [InstructorLicensePurchaseComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StripeService, useValue: mockStripeService },
        {
          provide: FirebaseStateService,
          useValue: {
            user: userSignal,
          },
        },
        { provide: DataManagerService, useValue: mockDataManager },
        {
          provide: RoutingService,
          useValue: {
            navigateToParts: vi.fn(),
            signals: {
              [Views.InstructorLicensePurchase]: {
                urlParams: {
                  session_id: signal(null),
                },
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  async function createComponent(): Promise<void> {
    fixture = TestBed.createComponent(InstructorLicensePurchaseComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should verify eligibility and instructor license dates', async () => {
    await createComponent();
    expect(component.isLoggedIn()).toBe(true);
    expect(component.isActiveMember()).toBe(true);
    expect(component.hasAppLevel1()).toBe(true);
    expect(component.hasInstructorId()).toBe(true);
    expect(component.instructorId()).toBe('US-INS-01');
    expect(component.hasActiveSubscription()).toBe(true);
  });

  it('should redirect to Stripe Checkout on license purchase', async () => {
    await createComponent();
    const redirectSpy = vi.spyOn(component, 'redirectTo').mockImplementation(() => {});

    await component.onPurchaseInstructorLicense();

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_ins_yearly',
      window.location.origin,
      1,
      expect.objectContaining({
        successUrl: expect.stringContaining('/order-complete?session_id={CHECKOUT_SESSION_ID}'),
        cancelUrl: expect.stringContaining('/instructor-license'),
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_license',
    );
  });

  it('should handle cancel auto-renewal', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await createComponent();

    await component.onCancelAutoRenew();
    expect(mockStripeService.cancelSubscriptionRenewal).toHaveBeenCalledWith(
      'sub_lic_123',
    );
    expect(component.cancelSuccessMessage()).toContain('cancelled');
  });
});
