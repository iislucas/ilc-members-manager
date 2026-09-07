/* product-view.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductViewComponent } from './product-view';
import { ProductService } from '../product.service';
import { StripeService } from '../stripe.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { initProduct, Product } from '../../../functions/src/data-model/events';
import { signal } from '@angular/core';

describe('ProductViewComponent', () => {
  let component: ProductViewComponent;
  let fixture: ComponentFixture<ProductViewComponent>;

  const mockProduct: Product = {
    ...initProduct(),
    docId: 'test-prod-1',
    title: 'Autumn Kung Fu Workshop',
    description: 'An intensive 2-day workshop.',
    currency: 'usd',
    allowNonMembers: true,
    allowMembers: true,
    allowInstructors: true,
    allowInPerson: true,
    allowOnline: true,
    allowVideo: true,
    tiers: {
      'non_member_in_person_novideo': { enabled: true, price: 100 },
      'non_member_in_person_video': { enabled: true, price: 120 },
      'member_in_person_novideo': { enabled: true, price: 80 },
      'member_in_person_video': { enabled: true, price: 100 },
      'instructor_in_person_novideo': { enabled: true, price: 60 },
      'instructor_in_person_video': { enabled: true, price: 80 },
      'non_member_online_novideo': { enabled: true, price: 50 },
      'non_member_online_video': { enabled: true, price: 70 },
      'member_online_novideo': { enabled: true, price: 40 },
      'member_online_video': { enabled: true, price: 60 },
      'instructor_online_novideo': { enabled: true, price: 30 },
      'instructor_online_video': { enabled: true, price: 50 },
      'non_member_video_only': { enabled: false, price: 0 },
      'member_video_only': { enabled: false, price: 0 },
      'instructor_video_only': { enabled: false, price: 0 },
    },
  };

  const mockProductService = {
    getProduct: vi.fn().mockResolvedValue(mockProduct),
    getProductByEventId: vi.fn().mockResolvedValue(mockProduct),
  };

  const mockDataManagerService = {
    getEventById: vi.fn().mockResolvedValue({
      docId: 'event-1',
      title: 'Autumn Kung Fu Workshop',
      productId: 'test-prod-1',
      start: '2026-10-01T10:00:00Z',
      end: '2026-10-02T16:00:00Z',
    }),
  };

  const mockStripeService = {
    createProductCheckoutSession: vi.fn(),
  };

  const mockRoutingService = {
    signals: {
      eventRegister: {
        pathVars: {
          eventId: signal('event-1'),
        },
      },
    },
    hrefForView: vi.fn().mockReturnValue('/mock-link'),
  };

  const mockFirebaseState = {
    user: signal({
      email: 'member@example.com',
      isAdmin: false,
      isFullMember: true,
      isInstructor: false,
      member: {
        docId: 'mem-1',
        memberId: 'US100',
        name: 'Test Member',
        emails: ['member@example.com'],
      },
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductViewComponent],
      providers: [
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: StripeService, useValue: mockStripeService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load product', async () => {
    expect(component).toBeTruthy();
    await component.loadProduct();
    expect(component.product()?.title).toBe('Autumn Kung Fu Workshop');
  });

  it('should calculate member in-person price correctly', async () => {
    await component.loadProduct();
    component.selectedRole.set('member');
    component.selectedAttendance.set('in_person');
    component.includeVideo.set(false);

    expect(component.currentTierKey()).toBe('member_in_person_novideo');
    expect(component.currentTier()?.price).toBe(80);
  });

  it('should add video add-on correctly', async () => {
    await component.loadProduct();
    component.selectedRole.set('member');
    component.selectedAttendance.set('in_person');
    component.includeVideo.set(true);

    expect(component.currentTierKey()).toBe('member_in_person_video');
    expect(component.currentTier()?.price).toBe(100);
  });
});
