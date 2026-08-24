/* class-video-library-purchase.spec.ts
 *
 * Unit tests for ClassVideoLibraryPurchaseComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassVideoLibraryPurchaseComponent } from './class-video-library-purchase';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserDetails } from '../firebase-state.service';
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
  let userSignal: ReturnType<typeof signal<UserDetails | null>>;
  let mockDataManager: {
    myOrders: { entries: ReturnType<typeof vi.fn> };
    stripeProducts: ReturnType<typeof signal<StripeProduct[]>>;
    stripeProductsLoading: ReturnType<typeof signal<boolean>>;
    stripeProductsError: ReturnType<typeof signal<string | null>>;
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

  const sampleMember = {
    ...initMember(),
    docId: 'mem_vid_1',
    name: 'Charlie Member',
    membershipType: MembershipType.Annual,
    currentMembershipExpires: '2028-01-01',
    classVideoLibrarySubscription: true,
    classVideoLibraryExpirationDate: '2027-01-01',
    classVideoLibrarySubscriptionId: 'sub_vid_123',
    classVideoLibraryNextAutoRenewDate: '2027-01-01',
  };

  const sampleUser: UserDetails = {
    member: sampleMember,
    memberProfiles: [sampleMember],
    schoolsManaged: [],
    isAdmin: false,
    firebaseUser: { email: 'user@example.com', uid: 'uid_vid_1' } as never,
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

    userSignal = signal<UserDetails | null>(sampleUser);

    mockDataManager = {
      // The catalogue now reaches the page through DataManagerService's
      // cached copy rather than a per-page Stripe call.
      stripeProducts: signal(sampleProducts),
      stripeProductsLoading: signal(false),
      stripeProductsError: signal<string | null>(null),
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
            hrefForView: vi.fn().mockImplementation((view) =>
              view === Views.ClassVideoLibrary ? '/class-video-library' : `/${view}`,
            ),
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
        successUrl: expect.stringContaining('/order-complete?session_id={CHECKOUT_SESSION_ID}'),
        cancelUrl: expect.stringContaining('/class-video-library-subscription'),
        metadata: {
          memberDocId: 'mem_vid_1',
          memberId: '',
          orderType: 'video',
        },
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

  it('should show link to video library and hide subscription form when user has active Stripe subscription', async () => {
    await createComponent();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    // Active banner should be present with the link to class-video-library
    const banner = compiled.querySelector('.current-membership-banner');
    expect(banner).toBeTruthy();
    const linkBtn = banner?.querySelector<HTMLAnchorElement>('.video-library-link-btn');
    expect(linkBtn).toBeTruthy();
    expect(linkBtn?.getAttribute('href')).toContain('class-video-library');
    expect(linkBtn?.textContent).toContain('Open Class Video Library');

    // Since sampleUser has classVideoLibrarySubscriptionId: 'sub_vid_123', the subscription form below should be hidden
    expect(component.hasActiveStripeSubscription()).toBe(true);
    expect(compiled.querySelector('.subscribe-fold-card')).toBeNull();
    expect(compiled.querySelector('.checkout-section')).toBeNull();
  });

  it('should show link to video library and provide fold header when user has active non-Stripe subscription', async () => {
    // Modify user to have active access without a Stripe subscription ID
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        classVideoLibrarySubscription: true,
        classVideoLibraryExpirationDate: '2027-01-01',
        classVideoLibrarySubscriptionId: '',
        classVideoLibraryNextAutoRenewDate: '',
      },
    });

    await createComponent();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    // Active banner should be present with the link to class-video-library
    const banner = compiled.querySelector('.current-membership-banner');
    expect(banner).toBeTruthy();
    const linkBtn = banner?.querySelector<HTMLAnchorElement>('.video-library-link-btn');
    expect(linkBtn).toBeTruthy();
    expect(linkBtn?.getAttribute('href')).toContain('class-video-library');

    // Fold card should be present and closed by default
    expect(component.hasActiveStripeSubscription()).toBe(false);
    expect(component.hasVideoAccess()).toBe(true);

    const foldCard = compiled.querySelector('.subscribe-fold-card');
    expect(foldCard).toBeTruthy();
    const foldHeader = foldCard?.querySelector('.fold-toggle-header');
    expect(foldHeader).toBeTruthy();
    expect(foldHeader?.textContent).toContain('Subscribe via the members portal');
    expect(foldCard?.querySelector('.fold-body')).toBeNull();

    // Click fold header to unfold
    foldHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(component.isSubscribeFoldOpen()).toBe(true);
    expect(foldCard?.querySelector('.fold-body')).toBeTruthy();
  });

  it('should show subscription form directly when user has no active video library access', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        classVideoLibrarySubscription: false,
        classVideoLibraryExpirationDate: '2020-01-01',
        classVideoLibrarySubscriptionId: '',
        classVideoLibraryNextAutoRenewDate: '',
      },
    });

    await createComponent();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    // Active banner should NOT be present
    expect(compiled.querySelector('.current-membership-banner')).toBeNull();

    // Fold should NOT be present; intro info section and form cards should be rendered directly
    expect(compiled.querySelector('.subscribe-fold-card')).toBeNull();
    expect(compiled.querySelector('.intro-info-section')).toBeTruthy();
    const stepCards = compiled.querySelectorAll('app-step-card');
    expect(stepCards.length).toBe(2); // Step 1 + Step 2
    expect(compiled.querySelector('.checkout-section')).toBeTruthy();
  });

  it('should deny video access when classVideoLibrarySubscription boolean is false even if expiration date is in future', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        classVideoLibrarySubscription: false,
        classVideoLibraryExpirationDate: '2099-12-31',
        classVideoLibrarySubscriptionId: '',
        classVideoLibraryNextAutoRenewDate: '',
      },
    });

    await createComponent();
    expect(component.hasVideoAccess()).toBe(false);
  });

  it('should deny video access when classVideoLibrarySubscription is true but expiration date has passed', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        classVideoLibrarySubscription: true,
        classVideoLibraryExpirationDate: '2020-01-01',
        classVideoLibrarySubscriptionId: '',
        classVideoLibraryNextAutoRenewDate: '',
      },
    });

    await createComponent();
    expect(component.hasVideoAccess()).toBe(false);
  });

  it('should allow video access when classVideoLibrarySubscription is true and expiration date is empty (never expires)', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleUser.member,
        classVideoLibrarySubscription: true,
        classVideoLibraryExpirationDate: '',
        classVideoLibrarySubscriptionId: '',
        classVideoLibraryNextAutoRenewDate: '',
      },
    });

    await createComponent();
    expect(component.hasVideoAccess()).toBe(true);
  });
});
