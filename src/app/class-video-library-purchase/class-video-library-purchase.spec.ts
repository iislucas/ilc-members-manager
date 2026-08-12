/* class-video-library-purchase.spec.ts
 *
 * Unit tests for ClassVideoLibraryPurchaseComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassVideoLibraryPurchaseComponent } from './class-video-library-purchase';
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

describe('ClassVideoLibraryPurchaseComponent', () => {
  let fixture: ComponentFixture<ClassVideoLibraryPurchaseComponent>;
  let component: ClassVideoLibraryPurchaseComponent;
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
      id: 'prod_video_library',
      name: 'VIDEO : Class Video Library',
      description: 'Online class video archives',
      active: true,
      images: [],
      metadata: {},
      created: 1000,
      updated: 1000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_vid_monthly',
          active: true,
          currency: 'usd',
          unitAmount: 599,
          type: StripePriceType.Recurring,
          recurringInterval: StripeRecurringInterval.Month,
          recurringIntervalCount: 1,
          nickname: 'Monthly Access',
          created: 1001,
        },
      ],
    },
  ];

  const sampleUser: UserData = {
    email: 'user@example.com',
    member: {
      ...initMember(),
      docId: 'mem_vid_1',
      name: 'Charlie Member',
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2028-01-01',
      classVideoLibrarySubscription: true,
      classVideoLibraryExpirationDate: '2027-01-01',
      classVideoLibrarySubscriptionId: 'sub_vid_123',
      classVideoLibraryNextAutoRenewDate: '2027-01-01',
    },
    memberDocIds: ['mem_vid_1'],
    schoolsManaged: [],
    isAdmin: false,
  };

  beforeEach(async () => {
    mockStripeService = {
      listProducts: vi.fn().mockResolvedValue({ products: sampleProducts }),
      createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_video',
        sessionId: 'cs_test_video',
      }),
      getCheckoutSession: vi.fn().mockResolvedValue({
        id: 'cs_test_video',
        paymentStatus: 'paid',
        status: 'complete',
        amountTotal: 599,
        currency: 'usd',
        customerEmail: 'user@example.com',
        lineItems: [{ description: 'Class Video Library' }],
      }),
      cancelSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_vid_123',
        cancelAtPeriodEnd: true,
        periodEnd: '2027-01-01',
      }),
      resumeSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_vid_123',
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
      imports: [ClassVideoLibraryPurchaseComponent],
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
              [Views.ClassVideoLibraryPurchase]: {
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
    fixture = TestBed.createComponent(ClassVideoLibraryPurchaseComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should verify video subscription status and next renewal date', async () => {
    await createComponent();
    expect(component.isLoggedIn()).toBe(true);
    expect(component.hasVideoAccess()).toBe(true);
    expect(component.expirationDate()).toBe('2027-01-01');
    expect(component.hasActiveAutoRenew()).toBe(true);
  });

  it('should redirect to Stripe Checkout on subscribe click', async () => {
    await createComponent();
    const redirectSpy = vi.spyOn(component, 'redirectTo').mockImplementation(() => {});

    await component.onSubscribeVideoLibrary();

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_vid_monthly',
      window.location.origin,
      1,
      expect.objectContaining({
        successUrl: expect.stringContaining('/class-video-library-subscription?session_id={CHECKOUT_SESSION_ID}'),
        cancelUrl: expect.stringContaining('/class-video-library-subscription'),
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_video',
    );
  });

  it('should cancel subscription renewal', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await createComponent();

    await component.onCancelAutoRenew();
    expect(mockStripeService.cancelSubscriptionRenewal).toHaveBeenCalledWith(
      'sub_vid_123',
    );
    expect(component.cancelSuccessMessage()).toContain('cancelled');
  });
});
