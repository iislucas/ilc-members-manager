/* event-view.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventViewComponent } from './event-view';
import { ProductService } from '../../product.service';
import { DataManagerService } from '../../data-manager.service';
import { RoutingService } from '../../routing.service';
import { FirebaseStateService } from '../../firebase-state.service';
import { FIREBASE_APP, Views } from '../../app.config';
import { initEvent, initEventRegistration, initProduct } from '../../../../functions/src/data-model/events';
import { signal } from '@angular/core';

describe('EventViewComponent', () => {
  let component: EventViewComponent;
  let fixture: ComponentFixture<EventViewComponent>;

  const mockProduct = {
    ...initProduct(),
    docId: 'prod-1',
    title: 'Aikido Seminar Pass',
    currency: 'usd',
    allowInPerson: true,
    allowOnline: true,
    allowVideo: true,
  };

  const mockEvent = {
    ...initEvent(),
    docId: 'event-1',
    title: 'Spring Aikido Seminar',
    productId: 'prod-1',
    onlineJoiningLink: 'https://zoom.us/j/123456789',
    recordedVideoId: 'video-123',
    ownerDocId: 'member-owner-id',
  };

  const mockRegistration = {
    ...initEventRegistration(),
    docId: 'reg-1',
    eventDocId: 'event-1',
    attendance: 'online' as const,
    hasVideoAccess: true,
    amountPaidCents: 5000,
    currency: 'usd',
    status: 'paid' as const,
  };

  const mockProductService = {
    getProduct: vi.fn().mockResolvedValue(mockProduct),
    getUserRegistrationForEvent: vi.fn().mockResolvedValue(mockRegistration),
    getEventRegistrations: vi.fn().mockResolvedValue([mockRegistration]),
  };

  const mockDataManagerService = {
    getEventById: vi.fn().mockResolvedValue(mockEvent),
    instructors: {
      get: vi.fn().mockReturnValue(undefined),
    },
  };

  const mockRoutingService = {
    matchedPatternId: signal(Views.EventView),
    hrefForView: vi.fn().mockImplementation((view, params) => {
      if (view === Views.ProductView) return `/products/${params?.productId || ''}`;
      if (view === Views.EventRegistrations) return `/events/${params?.eventId || ''}/registrations`;
      if (view === Views.VideoView) return `/videos/${params?.videoId || ''}`;
      return `/mock/${view}`;
    }),
  };

  const mockFirebaseState = {
    user: signal({
      email: 'user@example.com',
      isAdmin: false,
      isFullMember: true,
      isInstructor: false,
      member: { docId: 'member-user-id' },
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventViewComponent],
      providers: [
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: FIREBASE_APP, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventViewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.detectChanges();
  });

  it('should create and load event and registration', async () => {
    expect(component).toBeTruthy();
    await component.loadEvent();
    expect(component.event()?.title).toBe('Spring Aikido Seminar');
    expect(component.registration()?.attendance).toBe('online');
    expect(component.hasPaidRegistration()).toBe(true);
    expect(component.canAccessOnline()).toBe(true);
    expect(component.canAccessVideo()).toBe(true);
  });

  it('should generate product and video URLs correctly', async () => {
    await component.loadEvent();
    expect(component.registerUrl()).toBe('/products/prod-1');
    expect(component.videoWatchUrl()).toBe('/videos/video-123');
    expect(component.registrationsUrl()).toBe('/events/event-1/registrations');
  });

  it('should allow owner and manager to manage event registrations', async () => {
    // Owner
    mockFirebaseState.user.set({
      email: 'owner@ilc.com',
      isAdmin: false,
      isFullMember: true,
      isInstructor: true,
      member: { docId: 'member-owner-id' },
    });
    await component.loadEvent();
    expect(component.canManage()).toBe(true);

    // Manager
    component.event.set({
      ...mockEvent,
      managerDocIds: ['manager-doc-id'],
    });
    mockFirebaseState.user.set({
      email: 'manager@ilc.com',
      isAdmin: false,
      isFullMember: true,
      isInstructor: true,
      member: { docId: 'manager-doc-id' },
    });
    expect(component.canManage()).toBe(true);

    // Regular attendee (not owner/manager/admin)
    mockFirebaseState.user.set({
      email: 'attendee@ilc.com',
      isAdmin: false,
      isFullMember: true,
      isInstructor: false,
      member: { docId: 'regular-id' },
    });
    expect(component.canManage()).toBe(false);
  });
});
