/* next-grading.spec.ts
 *
 * Unit tests for NextGradingComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextGradingComponent } from './next-grading';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserData } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { initMember, MembershipType, GradingStatus } from '../../../functions/src/data-model';
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
  let userSignal: ReturnType<typeof signal<UserData | null>>;
  let mockDataManager: {
    myGradings: { entries: ReturnType<typeof vi.fn> };
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
      ],
    },
  ];

  const sampleUser: UserData = {
    email: 'student@example.com',
    member: {
      ...initMember(),
      docId: 'mem_student_1',
      name: 'Alice Student',
      studentLevel: '1',
      applicationLevel: '',
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2028-01-01',
    },
    memberDocIds: ['mem_student_1'],
    schoolsManaged: [],
    isAdmin: false,
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

    userSignal = signal<UserData | null>(sampleUser);

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
