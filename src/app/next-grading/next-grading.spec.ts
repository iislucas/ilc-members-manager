/* next-grading.spec.ts
 *
 * Unit tests for NextGradingComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextGradingComponent } from './next-grading';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserDetails } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import {
  initMember,
  MembershipType,
  GradingStatus,
  PaymentStatus,
  StudentLevel,
  ApplicationLevel,
} from '../../../functions/src/data-model';
import {
  StripeProduct,
  StripePriceType,
} from '../../../functions/src/stripe-types';

describe('NextGradingComponent', () => {
  let fixture: ComponentFixture<NextGradingComponent>;
  let component: NextGradingComponent;
  let mockStripeService: {
    listProducts: ReturnType<typeof vi.fn>;
    createCheckoutSession: ReturnType<typeof vi.fn>;
    getCheckoutSession: ReturnType<typeof vi.fn>;
  };
  let userSignal: ReturnType<typeof signal<UserDetails | null>>;
  let mockDataManager: {
    myGradings: { entries: ReturnType<typeof vi.fn> };
    requestGradingRetake: ReturnType<typeof vi.fn>;
  };

  const sampleProducts: StripeProduct[] = [
    {
      id: 'prod_grading_student',
      name: 'GRADING : Student Levels',
      description: 'Student grading fee',
      active: true,
      images: [],
      metadata: {},
      created: 1000,
      updated: 1000,
      defaultPrice: null,
      prices: [
        {
          id: 'price_stu_entry',
          active: true,
          currency: 'usd',
          unitAmount: 6000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Entry Level',
          created: 1001,
        },
        {
          id: 'price_stu_1',
          active: true,
          currency: 'usd',
          unitAmount: 8000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Student Level 1',
          created: 1002,
        },
        {
          id: 'price_stu_2',
          active: true,
          currency: 'usd',
          unitAmount: 8000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Student Level 2',
          created: 1003,
        },
        {
          id: 'price_stu_4',
          active: true,
          currency: 'usd',
          unitAmount: 9000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Student Level 4',
          created: 1004,
        },
        {
          id: 'price_app_1',
          active: true,
          currency: 'usd',
          unitAmount: 12000,
          type: StripePriceType.OneTime,
          recurringInterval: null,
          recurringIntervalCount: null,
          nickname: 'Application Level 1',
          created: 1005,
        },
      ],
    },
  ];

  const sampleMember = {
    ...initMember(),
    docId: 'mem_student_1',
    name: 'Alice Student',
    studentLevel: StudentLevel.Level1,
    applicationLevel: ApplicationLevel.None,
    membershipType: MembershipType.Annual,
    currentMembershipExpires: '2028-01-01',
  };

  const sampleUser: UserDetails = {
    member: sampleMember,
    memberProfiles: [sampleMember],
    schoolsManaged: [],
    isAdmin: false,
    firebaseUser: { email: 'student@example.com', uid: 'uid_stu_1' } as never,
  };

  beforeEach(async () => {
    mockStripeService = {
      listProducts: vi.fn().mockResolvedValue({ products: sampleProducts }),
      createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_grading',
        sessionId: 'cs_test_grading',
      }),
      getCheckoutSession: vi.fn().mockResolvedValue({
        id: 'cs_test_grading',
        paymentStatus: 'paid',
        status: 'complete',
        amountTotal: 8000,
        currency: 'usd',
        customerEmail: 'student@example.com',
        lineItems: [{ description: 'Student Level 2' }],
      }),
    };

    userSignal = signal<UserDetails | null>(sampleUser);

    mockDataManager = {
      myGradings: {
        entries: vi.fn().mockReturnValue([]),
      },
      requestGradingRetake: vi.fn().mockResolvedValue('new_retake_g_id'),
    };

    await TestBed.configureTestingModule({
      imports: [NextGradingComponent],
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
            hrefForView: vi.fn().mockImplementation((v: string) => `#/${v}`),
            signals: {
              [Views.NextGrading]: {
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
    fixture = TestBed.createComponent(NextGradingComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should compute next grading level and match stripe price', async () => {
    await createComponent();
    expect(component.isLoggedIn()).toBe(true);
    expect(component.isActiveMember()).toBe(true);
    expect(component.currentStudentLevel()).toBe('1');
    expect(component.targetLevel()).toBe('Student 2');

    const match = component.matchingGradingPrice();
    expect(match).toBeTruthy();
    expect(match?.price.id).toBe('price_stu_2');
    expect(match?.price.unitAmount).toBe(8000);
  });

  it('should offer subsequent level when member has an existing pending grading and disallow buying pending level', async () => {
    mockDataManager.myGradings.entries.mockReturnValue([
      {
        docId: 'existing_g1',
        level: 'Student 2',
        status: GradingStatus.AwaitingRequest,
      },
    ]);
    await createComponent();

    expect(component.pendingGradings().length).toBe(1);
    expect(component.nextPurchasableLevel()).toBe('Student 3');
    expect(component.targetLevel()).toBe('Student 3');

    // Selectable levels only includes unowned, unpending, unachieved levels
    const options = component.selectableLevels();
    expect(options.length).toBe(1);
    expect(options[0].level).toBe('Student 3');
    expect(options.some((o) => o.level === 'Student 2')).toBe(false);
  });

  it('should consolidate multiple pending gradings into a single note and link only to the active next level', async () => {
    mockDataManager.myGradings.entries.mockReturnValue([
      {
        docId: 'g_stu_3',
        level: 'Student 3',
        status: GradingStatus.AwaitingRequest,
      },
      {
        docId: 'g_stu_2',
        level: 'Student 2',
        status: GradingStatus.AwaitingRequest,
      },
    ]);
    await createComponent();

    expect(component.pendingGradings().length).toBe(2);
    expect(component.pendingLevelsList()).toBe('Student 2, Student 3');
    expect(component.activeNextPendingGrading()?.level).toBe('Student 2');
    expect(component.activeNextPendingGrading()?.docId).toBe('g_stu_2');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('You have existing gradings for Student 2, Student 3');
    expect(el.textContent).toContain('Your next active grading is Student 2');
    expect(el.querySelector('.open-grading-banner .link-btn')?.textContent).toContain('Go to Student 2 Grading');
    expect(el.textContent).toContain('Next level to purchase');
  });

  describe('student level 3 progression (Application 1 comes after Student 3)', () => {
    beforeEach(() => {
      userSignal.set({
        ...sampleUser,
        member: { ...sampleMember, studentLevel: StudentLevel.Level3 },
      });
    });

    it('offers Application 1 after Student 3 when there are no other gradings', async () => {
      await createComponent();
      expect(component.immediateNextLevel()).toBe('Application 1');
      expect(component.targetLevel()).toBe('Application 1');
      expect(component.matchingGradingPrice()?.price.id).toBe('price_app_1');
    });

    it('still offers Application 1 when the member holds an unpaid Application 1 grading', async () => {
      mockDataManager.myGradings.entries.mockReturnValue([
        {
          docId: 'g_app_1_unpaid',
          level: 'Application 1',
          status: GradingStatus.AwaitingRequest,
          paymentStatus: PaymentStatus.NotYetPaid,
        },
      ]);
      await createComponent();

      expect(component.unpaidPendingLevel()).toBe('Application 1');
      expect(component.nextPurchasableLevel()).toBe('Application 1');
      expect(component.targetLevel()).toBe('Application 1');
      expect(component.isPayingForExistingGrading()).toBe(true);
      expect(component.selectableLevels()[0].description).toContain(
        'Outstanding fee for your existing Application 1 grading',
      );
    });

    it('moves on to Student 4 only once the Application 1 grading is paid for', async () => {
      mockDataManager.myGradings.entries.mockReturnValue([
        {
          docId: 'g_app_1_paid',
          level: 'Application 1',
          status: GradingStatus.AwaitingRequest,
          paymentStatus: PaymentStatus.PaidByStripe,
        },
      ]);
      await createComponent();

      expect(component.nextPurchasableLevel()).toBe('Student 4');
      expect(component.targetLevel()).toBe('Student 4');
      expect(component.isPayingForExistingGrading()).toBe(false);
    });

    it('offers Student 4 once Application 1 has been achieved', async () => {
      userSignal.set({
        ...sampleUser,
        member: {
          ...sampleMember,
          studentLevel: StudentLevel.Level3,
          applicationLevel: ApplicationLevel.Level1,
        },
      });
      await createComponent();
      expect(component.targetLevel()).toBe('Student 4');
    });
  });

  it('should identify free retake eligibility when member only has NotPassed grading and initiate retake', async () => {
    mockDataManager.myGradings.entries.mockReturnValue([
      {
        docId: 'failed_g1',
        level: 'Student 2',
        status: GradingStatus.NotPassed,
      },
    ]);
    await createComponent();

    expect(component.retakeEligible()).toBe(true);
    expect(component.retakeEligibleLevel()).toBe('Student 2');
    expect(component.targetLevel()).toBe('Student 2');
    expect(component.matchingGradingPrice()).toBeNull();

    await component.onStartRetake();
    expect(mockDataManager.requestGradingRetake).toHaveBeenCalledWith(
      'mem_student_1',
      'Student 2',
    );
  });

  it('should redirect to Stripe Checkout on purchase click', async () => {
    await createComponent();
    const redirectSpy = vi.spyOn(component, 'redirectTo').mockImplementation(() => {});

    await component.onPurchaseNextGrading();

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      'price_stu_2',
      window.location.origin,
      1,
      expect.objectContaining({
        successUrl: expect.stringContaining('/order-complete?session_id={CHECKOUT_SESSION_ID}'),
        cancelUrl: expect.stringContaining('/next-grading'),
        metadata: {
          memberDocId: 'mem_student_1',
          memberId: '',
          gradingLevel: 'Student 2',
          orderType: 'grading',
        },
      }),
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/pay/cs_test_grading',
    );
  });
});
