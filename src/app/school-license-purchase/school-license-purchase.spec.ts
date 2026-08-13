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
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import {
  initMember,
  initSchool,
  MembershipType,
  School,
} from '../../../functions/src/data-model';
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
    listProducts: ReturnType<typeof vi.fn>;
    createCheckoutSession: ReturnType<typeof vi.fn>;
    getCheckoutSession: ReturnType<typeof vi.fn>;
  };
  let userSignal: ReturnType<typeof signal<UserDetails | null>>;
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

    userSignal = signal<UserDetails | null>(sampleUser);

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
});
