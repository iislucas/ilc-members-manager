/* school-license-purchase.spec.ts
 *
 * Unit tests for SchoolLicensePurchaseComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchoolLicensePurchaseComponent } from './school-license-purchase';
import { StripeService } from '../stripe.service';
import { FirebaseStateService, UserData } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import {
  initMember,
  initSchool,
  MembershipType,
  School,
} from '../../../functions/src/data-model';
import {
  StripeProduct,
  StripePriceType,
  StripeRecurringInterval,
} from '../../../functions/src/stripe-types';

describe('SchoolLicensePurchaseComponent', () => {
  let fixture: ComponentFixture<SchoolLicensePurchaseComponent>;
  let component: SchoolLicensePurchaseComponent;
  let mockStripeService: {
    listProducts: ReturnType<typeof vi.fn>;
    createCheckoutSession: ReturnType<typeof vi.fn>;
    getCheckoutSession: ReturnType<typeof vi.fn>;
  };
  let userSignal: ReturnType<typeof signal<UserData | null>>;
  let mockDataManager: {
    schools: { entries: ReturnType<typeof vi.fn> };
    myOrders: { entries: ReturnType<typeof vi.fn> };
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
    country: 'United States',
    city: 'New York',
  };

  const sampleUser: UserData = {
    email: 'owner@example.com',
    member: {
      ...initMember(),
      docId: 'mem_owner_1',
      name: 'Bob Owner',
      instructorId: 'US-INS-01',
      membershipType: MembershipType.Annual,
      currentMembershipExpires: '2028-01-01',
    },
    memberDocIds: ['mem_owner_1'],
    schoolsManaged: ['SCH-NY-01'],
    isAdmin: false,
  };

  beforeEach(async () => {
    mockStripeService = {
      listProducts: vi.fn().mockResolvedValue({ products: sampleProducts }),
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
    };

    userSignal = signal<UserData | null>(sampleUser);

    mockDataManager = {
      schools: {
        entries: vi.fn().mockReturnValue([sampleSchool]),
      },
      myOrders: {
        entries: vi.fn().mockReturnValue([]),
      },
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
          },
        },
        { provide: DataManagerService, useValue: mockDataManager },
        {
          provide: RoutingService,
          useValue: {
            navigateToParts: vi.fn(),
            signals: {
              [Views.SchoolLicensePurchase]: {
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

  it('should redirect to Stripe Checkout on purchase click with school metadata', async () => {
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
});
