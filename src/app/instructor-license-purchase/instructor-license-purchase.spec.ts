/* instructor-license-purchase.spec.ts
 *
 * Unit tests for InstructorLicensePurchaseComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstructorLicensePurchaseComponent } from './instructor-license-purchase';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserDetails } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import {
  initMember,
  MembershipType,
  StudentLevel,
  ApplicationLevel,
} from '../../../functions/src/data-model';
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
  let userSignal: ReturnType<typeof signal<UserDetails | null>>;
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

  const sampleMember = {
    ...initMember(),
    docId: 'mem_ins_1',
    name: 'Bob Instructor',
    studentLevel: StudentLevel.Level6,
    applicationLevel: ApplicationLevel.Level1,
    instructorId: 'US-INS-01',
    membershipType: MembershipType.Annual,
    currentMembershipExpires: '2028-01-01',
    instructorLicenseExpires: '2027-01-01',
    instructorLicenseRenewalDate: '2026-01-01',
    instructorLicenseSubscriptionId: 'sub_lic_123',
    instructorLicenseNextAutoRenewDate: '2027-01-01',
  };

  const sampleUser: UserDetails = {
    member: sampleMember,
    memberProfiles: [sampleMember],
    schoolsManaged: [],
    isAdmin: false,
    firebaseUser: { email: 'instructor@example.com', uid: 'uid_ins_1' } as never,
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

    userSignal = signal<UserDetails | null>(sampleUser);

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
            hrefForView: vi.fn().mockReturnValue('/mock-path'),
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
    expect(component.isInstructorTier()).toBe(true);
    expect(component.isGroupLeaderTier()).toBe(false);
    expect(component.isEligibleForLicense()).toBe(true);
    expect(component.productOptionTitle()).toBe('1-Year Certified Instructor License');
    expect(component.hasActiveSubscription()).toBe(true);
  });

  it('should identify Group Leader tier for Student Level 2/3 without Application Level 1', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleMember,
        instructorId: '',
        studentLevel: StudentLevel.Level2,
        applicationLevel: ApplicationLevel.None,
        instructorLicenseExpires: '',
      },
    });
    await createComponent();

    expect(component.isLoggedIn()).toBe(true);
    expect(component.isActiveMember()).toBe(true);
    expect(component.hasAppLevel1()).toBe(false);
    expect(component.hasStudentLevel2()).toBe(true);
    expect(component.isGroupLeaderTier()).toBe(true);
    expect(component.isInstructorTier()).toBe(false);
    expect(component.isEligibleForLicense()).toBe(true);
    expect(component.productOptionTitle()).toBe('1-Year Group Leader License');
    expect(component.checkoutButtonText()).toBe('Get Group Leader License');

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Group Leader License');
    expect(element.textContent).toContain('automatically upgraded to a full Instructor License');
  });

  it('should identify Below Prerequisites when member is Student Level 1', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleMember,
        instructorId: '',
        studentLevel: StudentLevel.Level1,
        applicationLevel: ApplicationLevel.None,
        instructorLicenseExpires: '',
      },
    });
    await createComponent();

    expect(component.isGroupLeaderTier()).toBe(false);
    expect(component.isInstructorTier()).toBe(false);
    expect(component.isEligibleForLicense()).toBe(false);
    expect(component.isBelowLevelPrerequisites()).toBe(true);

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Student Level 2 Required');
  });

  it('should render the clarification text regarding events, gradings, and schools', async () => {
    await createComponent();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain(
      'Our Instructor License authorizes the individual to lead events and gradings. In addition, Licensed Instructors may be hired to lead classes at an existing Licensed School. There is no requirement for a Licensed Instructor to have their own School License.',
    );
    expect(element.textContent).toContain(
      'Holding an active license grants the right to use the Chin Family I Liq Chuan trademarks to promote approved events. (Note that, without a license, you may not represent yourself as an I Liq Chuan instructor or group leader, or use branding.)',
    );
    expect(element.textContent).toContain('searchable database of instructors');
    const findLink = element.querySelector('a.inline-link-button');
    expect(findLink).toBeTruthy();
    expect(findLink?.textContent).toContain('Find an Instructor');
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

  it('should display active lifetime instructor license banner and skip buying stages in DOM', async () => {
    userSignal.set({
      ...sampleUser,
      member: {
        ...sampleMember,
        instructorLicenseType: 'Life' as any,
        instructorLicenseExpires: '9999-12-31',
      },
    });
    await createComponent();

    expect(component.isLifeInstructor()).toBe(true);

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Active Lifetime Instructor License');
    expect(element.textContent).toContain('Our Instructor License authorizes the individual to lead events and gradings');
    expect(element.textContent).not.toContain('1. Your Account');
    expect(element.textContent).not.toContain('2. License Qualifications & Status');
    expect(element.textContent).not.toContain('3. Annual');
    expect(element.querySelector('.pay-btn')).toBeNull();
  });
});
