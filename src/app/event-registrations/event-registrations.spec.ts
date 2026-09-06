/* event-registrations.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventRegistrationsComponent } from './event-registrations';
import { ProductService } from '../product.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { initEvent, initEventRegistration } from '../../../functions/src/data-model';
import { signal } from '@angular/core';

describe('EventRegistrationsComponent', () => {
  let component: EventRegistrationsComponent;
  let fixture: ComponentFixture<EventRegistrationsComponent>;

  const mockEvent = {
    ...initEvent(),
    docId: 'event-1',
    title: 'Spring Aikido Seminar',
    ownerDocId: 'member-1',
  };

  const mockRegistrations = [
    {
      ...initEventRegistration(),
      docId: 'reg-1',
      eventDocId: 'event-1',
      name: 'John Doe',
      email: 'john@example.com',
      role: 'non_member' as const,
      attendance: 'in_person' as const,
      hasVideoAccess: false,
      amountPaidCents: 5000,
      currency: 'usd',
      status: 'paid' as const,
    },
    {
      ...initEventRegistration(),
      docId: 'reg-2',
      eventDocId: 'event-1',
      name: 'Jane Smith',
      email: 'jane@example.com',
      role: 'member' as const,
      attendance: 'online' as const,
      hasVideoAccess: true,
      amountPaidCents: 6000,
      currency: 'usd',
      status: 'paid' as const,
    },
  ];

  const mockProductService = {
    getEventRegistrations: vi.fn().mockResolvedValue(mockRegistrations),
  };

  const mockDataManagerService = {
    getEventById: vi.fn().mockResolvedValue(mockEvent),
  };

  const mockRoutingService = {
    signals: {
      eventRegistrations: {
        pathVars: {
          eventId: signal('event-1'),
        },
      },
    },
    hrefForView: vi.fn().mockReturnValue('/events/event-1'),
  };

  const mockFirebaseState = {
    user: signal({
      email: 'admin@ilc.com',
      isAdmin: true,
      isFullMember: true,
      isInstructor: true,
      member: { docId: 'admin-doc-id' },
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventRegistrationsComponent],
      providers: [
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventRegistrationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load data', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(component.registrations().length).toBe(2);
    expect(component.totalAttendeesCount()).toBe(2);
    expect(component.inPersonCount()).toBe(1);
    expect(component.onlineCount()).toBe(1);
    expect(component.videoCount()).toBe(1);
    expect(component.totalRevenue()).toBe(110);
  });

  it('should filter by attendance mode and search term', async () => {
    await component.loadData();

    component.selectedFilter.set('in_person');
    expect(component.filteredRegistrations().length).toBe(1);
    expect(component.filteredRegistrations()[0].name).toBe('John Doe');

    component.selectedFilter.set('online');
    expect(component.filteredRegistrations().length).toBe(1);
    expect(component.filteredRegistrations()[0].name).toBe('Jane Smith');

    component.selectedFilter.set('all');
    component.searchTerm.set('Jane');
    expect(component.filteredRegistrations().length).toBe(1);
    expect(component.filteredRegistrations()[0].email).toBe('jane@example.com');
  });

  it('should allow admin, owner, or manager to view, but deny others', async () => {
    // Admin
    mockFirebaseState.user.set({
      email: 'admin@ilc.com',
      isAdmin: true,
      isFullMember: true,
      isInstructor: true,
      member: { docId: 'admin-doc-id' },
    });
    await component.loadData();
    expect(component.canView()).toBe(true);

    // Event Owner (not admin)
    mockFirebaseState.user.set({
      email: 'owner@ilc.com',
      isAdmin: false,
      isFullMember: true,
      isInstructor: true,
      member: { docId: 'member-1' }, // matches mockEvent.ownerDocId
    });
    expect(component.canView()).toBe(true);

    // Event Manager (not owner, not admin)
    component.event.set({
      ...mockEvent,
      ownerDocId: 'member-1',
      managerDocIds: ['manager-doc-id'],
    });
    mockFirebaseState.user.set({
      email: 'manager@ilc.com',
      isAdmin: false,
      isFullMember: true,
      isInstructor: true,
      member: { docId: 'manager-doc-id' },
    });
    expect(component.canView()).toBe(true);

    // Stranger (regular member, not owner or manager)
    mockFirebaseState.user.set({
      email: 'stranger@ilc.com',
      isAdmin: false,
      isFullMember: true,
      isInstructor: false,
      member: { docId: 'stranger-doc-id' },
    });
    expect(component.canView()).toBe(false);
  });
});
