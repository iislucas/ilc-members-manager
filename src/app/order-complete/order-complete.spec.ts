import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderCompleteComponent } from './order-complete';
import { StripeService } from '../stripe.service';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { Views } from '../app.config';
import {
  CheckoutSessionSummary,
  StripeCheckoutPaymentStatus,
  StripeCheckoutStatus,
} from '../../../functions/src/stripe-types';
import { initMember } from '../../../functions/src/data-model';

describe('OrderCompleteComponent', () => {
  let fixture: ComponentFixture<OrderCompleteComponent>;
  let component: OrderCompleteComponent;
  let mockStripeService: {
    getCheckoutSession: ReturnType<typeof vi.fn>;
  };
  let sessionIdSignal: ReturnType<typeof signal<string>>;
  let userSignal: ReturnType<typeof signal<any>>;
  let myGradingsSignal: ReturnType<typeof signal<any[]>>;

  const sampleMembershipSummary: CheckoutSessionSummary = {
    id: 'cs_test_mem_123',
    status: StripeCheckoutStatus.Complete,
    paymentStatus: StripeCheckoutPaymentStatus.Paid,
    customerEmail: 'member@example.com',
    amountTotal: 8500,
    currency: 'usd',
    lineItems: [
      {
        description: 'Annual Membership (Regular)',
        quantity: 1,
        amountTotal: 8500,
        currency: 'usd',
      },
    ],
    metadata: {
      orderType: 'membership',
    },
  };

  const sampleGradingSummary: CheckoutSessionSummary = {
    id: 'cs_test_grad_123',
    status: StripeCheckoutStatus.Complete,
    paymentStatus: StripeCheckoutPaymentStatus.Paid,
    customerEmail: 'student@example.com',
    amountTotal: 5000,
    currency: 'usd',
    lineItems: [
      {
        description: 'Grading Fee: Student Level 1',
        quantity: 1,
        amountTotal: 5000,
        currency: 'usd',
      },
    ],
    metadata: {
      gradingLevel: 'Student 1',
      orderType: 'grading',
    },
  };

  const sampleSchool = {
    docId: 'school_doc_1',
    schoolId: 'SCH-NY-01',
    schoolName: 'New York ILC Branch',
    ownerMemberDocId: 'mem_1',
    schoolLicenseExpires: '2027-01-01',
    lastUpdated: '2026-08-12',
  };

  const sampleSchoolLicenseSummary: CheckoutSessionSummary = {
    id: 'cs_test_sch_123',
    status: StripeCheckoutStatus.Complete,
    paymentStatus: StripeCheckoutPaymentStatus.Paid,
    customerEmail: 'owner@example.com',
    amountTotal: 60000,
    currency: 'usd',
    lineItems: [
      {
        description: '1-Year School Affiliation License',
        quantity: 1,
        amountTotal: 60000,
        currency: 'usd',
      },
    ],
    metadata: {
      orderType: 'school',
      schoolDocId: 'school_doc_1',
      schoolId: 'SCH-NY-01',
      memberDocId: 'mem_1',
    },
  };

  beforeEach(async () => {
    sessionIdSignal = signal('cs_test_mem_123');
    userSignal = signal({
      uid: 'user_1',
      email: 'student@example.com',
      member: {
        ...initMember(),
        docId: 'mem_1',
      },
    });
    myGradingsSignal = signal([
      {
        docId: 'grading_doc_123',
        level: 'Student 1',
        studentMemberDocId: 'mem_1',
        gradingPurchaseDate: '2026-08-12',
      },
    ]);

    mockStripeService = {
      getCheckoutSession: vi.fn().mockResolvedValue(sampleMembershipSummary),
    };

    const mockRoutingService = {
      signals: {
        [Views.OrderComplete]: {
          urlParams: {
            session_id: sessionIdSignal,
          },
        },
      },
      hrefForView: vi.fn((view: string, pathVars?: any, urlParams?: any) => {
        if (view === Views.GradingView && pathVars?.gradingId) {
          const fromParam = urlParams?.from ? `?from=${urlParams.from}` : '';
          return `/gradings/${pathVars.gradingId}${fromParam}`;
        }
        if (view === Views.SchoolView && pathVars?.schoolId) {
          return `/school-profile/${pathVars.schoolId}`;
        }
        if (view === Views.MySchoolEdit && pathVars?.schoolId) {
          return `/my-schools/${pathVars.schoolId}/edit`;
        }
        return `/${view}`;
      }),
      hrefWithParams: vi.fn((path: string) => path),
    };

    const mockDataManager = {
      myGradings: {
        entries: myGradingsSignal,
      },
      schools: {
        entries: signal([sampleSchool]),
      },
    };

    const mockFirebaseState = {
      user: userSignal,
    };

    await TestBed.configureTestingModule({
      imports: [OrderCompleteComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StripeService, useValue: mockStripeService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: DataManagerService, useValue: mockDataManager },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();
  });

  async function createComponent(): Promise<void> {
    fixture = TestBed.createComponent(OrderCompleteComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should load order summary and detect membership order', async () => {
    await createComponent();
    expect(component).toBeTruthy();
    expect(mockStripeService.getCheckoutSession).toHaveBeenCalledWith('cs_test_mem_123');

    const s = component['state']();
    expect(s.kind).toBe('loaded');
    expect(component.orderKind()).toBe('membership');
  });

  it('should detect grading order type and compute direct grading entry link', async () => {
    mockStripeService.getCheckoutSession.mockResolvedValueOnce(sampleGradingSummary);
    sessionIdSignal.set('cs_test_grad_123');
    await createComponent();

    expect(component.orderKind()).toBe('grading');
    expect(component.latestGrading()?.docId).toBe('grading_doc_123');
    expect(component.latestGradingHref()).toBe('/gradings/grading_doc_123?from=my-gradings');

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Grading Payment Received!');
    expect(compiled.querySelector('.benefit-link')?.getAttribute('href')).toBe(
      '/gradings/grading_doc_123?from=my-gradings',
    );
  });

  it('should handle missing session_id gracefully', async () => {
    sessionIdSignal.set('');
    await createComponent();

    const s = component['state']();
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.message).toContain('No checkout session');
    }
  });

  it('should display spouse notification banner when membership includes spouse', async () => {
    const spouseMembershipSummary: CheckoutSessionSummary = {
      ...sampleMembershipSummary,
      lineItems: [
        {
          description: 'Lifetime Membership (with Spouse)',
          quantity: 1,
          amountTotal: 90000,
          currency: 'usd',
        },
      ],
      metadata: {
        orderType: 'membership',
        membershipOption: 'life_spouse',
        spouseName: 'Jane Doe',
        spouseEmail: 'jane.doe@example.com',
      },
    };

    mockStripeService.getCheckoutSession.mockResolvedValueOnce(spouseMembershipSummary);
    await createComponent();

    expect(component.spouseInfo()).toEqual({
      name: 'Jane Doe',
      email: 'jane.doe@example.com',
    });

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const spouseCard = compiled.querySelector('.spouse-notice-card');
    expect(spouseCard).toBeTruthy();
    expect(spouseCard?.textContent).toContain('Spouse Membership Included');
    expect(spouseCard?.textContent).toContain('Jane Doe');
    expect(spouseCard?.textContent).toContain('jane.doe@example.com');
    expect(spouseCard?.textContent).toContain('They can now log in to the members portal');
  });

  it('should detect school license order and compute edit and profile links for renewed school', async () => {
    mockStripeService.getCheckoutSession.mockResolvedValueOnce(sampleSchoolLicenseSummary);
    sessionIdSignal.set('cs_test_sch_123');
    await createComponent();

    expect(component.orderKind()).toBe('school_license');
    expect(component.isNewSchoolOrder()).toBe(false);
    expect(component.targetSchool()?.schoolId).toBe('SCH-NY-01');
    expect(component.schoolEditHref()).toBe('/my-schools/SCH-NY-01/edit');
    expect(component.schoolProfileHref()).toBe('/school-profile/SCH-NY-01');

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('School License Renewed!');
    expect(compiled.textContent).toContain('New York ILC Branch');

    const links = Array.from(compiled.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/my-schools/SCH-NY-01/edit');
    expect(links).toContain('/school-profile/SCH-NY-01');
  });

  it('should detect new school registration order and provide link to the new school', async () => {
    const newSchoolSummary: CheckoutSessionSummary = {
      ...sampleSchoolLicenseSummary,
      metadata: {
        orderType: 'school',
        isNewSchool: 'true',
        schoolName: 'ILC London Branch',
        memberDocId: 'mem_1',
      },
    };

    mockStripeService.getCheckoutSession.mockResolvedValueOnce(newSchoolSummary);
    sessionIdSignal.set('cs_test_sch_new');
    await createComponent();

    expect(component.orderKind()).toBe('school_license');
    expect(component.isNewSchoolOrder()).toBe(true);
    expect(component.schoolNameFromOrder()).toBe('ILC London Branch');

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('New School Registration Confirmed!');
    expect(compiled.textContent).toContain('ILC London Branch');
  });
});
