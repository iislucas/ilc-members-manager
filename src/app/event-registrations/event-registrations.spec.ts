/* event-registrations.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventRegistrationsComponent } from './event-registrations';
import { ProductService } from '../product.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { initEvent, initEventRegistration } from '../../../functions/src/data-model/events';
import { StripeService } from '../stripe.service';
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
      paymentMethod: 'stripe' as const,
      pricingTierType: 'standard' as const,
      registeredAt: '2026-09-01T10:00:00.000Z',
      studentLevel: '1',
      applicationLevel: '',
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
      paymentMethod: 'stripe' as const,
      pricingTierType: 'early_bird' as const,
      registeredAt: '2026-09-02T10:00:00.000Z',
      memberId: 'US402',
      studentLevel: '4',
      applicationLevel: '2',
    },
    {
      ...initEventRegistration(),
      docId: 'reg-3',
      eventDocId: 'event-1',
      name: 'Bob Door',
      email: 'bob@example.com',
      role: 'instructor' as const,
      attendance: 'in_person' as const,
      hasVideoAccess: false,
      amountPaidCents: 0,
      amountDueCents: 5500,
      currency: 'usd',
      status: 'pending_in_person' as const,
      paymentMethod: 'in_person' as const,
      pricingTierType: 'in_person' as const,
      registeredAt: '2026-09-03T10:00:00.000Z',
      studentLevel: 'Entry',
      applicationLevel: '',
    },
  ];

  const mockProductService = {
    getEventRegistrations: vi.fn().mockResolvedValue(mockRegistrations),
  };

  const mockDataManagerService = {
    members: {
      entries: () => [],
      get: vi.fn(),
    },
    getEventById: vi.fn().mockResolvedValue(mockEvent),
    getMemberByDocId: vi.fn().mockImplementation((docId: string) => {
      if (docId === 'fallback-member-doc') {
        return {
          docId: 'fallback-member-doc',
          name: 'Fallback Member',
          studentLevel: '3',
          applicationLevel: '1',
        };
      }
      return undefined;
    }),
    getMemberByMemberId: vi.fn(),
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

  const mockStripeService = {
    markEventRegistrationPaid: vi.fn().mockResolvedValue({ success: true }),
    unmarkEventRegistrationPaid: vi.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(async () => {
    mockFirebaseState.user.set({
      email: 'admin@ilc.com',
      isAdmin: true,
      isFullMember: true,
      isInstructor: true,
      member: { docId: 'admin-doc-id' },
    });

    await TestBed.configureTestingModule({
      imports: [EventRegistrationsComponent],
      providers: [
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: StripeService, useValue: mockStripeService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventRegistrationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load data with payment statistics', async () => {
    expect(component).toBeTruthy();
    await component.loadData();
    expect(component.registrations().length).toBe(3);
    expect(component.totalAttendeesCount()).toBe(3);
    expect(component.inPersonCount()).toBe(2);
    expect(component.onlineCount()).toBe(1);
    expect(component.videoCount()).toBe(1);
    expect(component.totalRevenue()).toBe(110);
    expect(component.paidOnlineCount()).toBe(2);
    expect(component.pendingInPersonCount()).toBe(1);
    expect(component.totalPendingRevenue()).toBe(55);
  });

  it('should filter by attendance mode, payment status, and search term', async () => {
    await component.loadData();

    component.selectedFilter.set('in_person');
    expect(component.filteredRegistrations().length).toBe(2);

    component.selectedFilter.set('online');
    expect(component.filteredRegistrations().length).toBe(1);
    expect(component.filteredRegistrations()[0].name).toBe('Jane Smith');

    component.selectedFilter.set('paid_online');
    expect(component.filteredRegistrations().length).toBe(2);
    expect(component.filteredRegistrations().map(r => r.name)).toEqual(['Jane Smith', 'John Doe']);

    component.selectedFilter.set('pay_in_person');
    expect(component.filteredRegistrations().length).toBe(1);
    expect(component.filteredRegistrations()[0].name).toBe('Bob Door');

    component.selectedFilter.set('all');
    component.searchTerm.set('Jane');
    expect(component.filteredRegistrations().length).toBe(1);
    expect(component.filteredRegistrations()[0].email).toBe('jane@example.com');
  });

  it('should format pricing tiers and attendance correctly', async () => {
    await component.loadData();
    expect(component.formatPricingTier(mockRegistrations[0].pricingTierType as any)).toBe('');
    expect(component.formatPricingTier(mockRegistrations[1].pricingTierType as any)).toBe('Early-Bird');
    expect(component.formatPricingTier(mockRegistrations[2].pricingTierType as any)).toBe('At Door');

    expect(component.formatAttendance('in_person' as any)).toBe('In-Person');
    expect(component.formatAttendance('online' as any)).toBe('Online');
    expect(component.formatAttendance('video_only' as any)).toBe('Video Pre-Order');
  });

  it('should identify pending in-person registrations and allow marking them as paid', async () => {
    await component.loadData();
    const pendingReg = component.registrations().find(r => r.docId === 'reg-3')!;
    expect(component.isPendingInPerson(pendingReg)).toBe(true);
    expect(component.isPendingInPerson(component.registrations()[0])).toBe(false);

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await component.markPaid(pendingReg);

    expect(mockStripeService.markEventRegistrationPaid).toHaveBeenCalledWith({
      eventId: 'event-1',
      registrationId: 'reg-3',
    });
    const updatedReg = component.registrations().find(r => r.docId === 'reg-3')!;
    expect(updatedReg.status).toBe('paid');
    expect(updatedReg.amountPaidCents).toBe(5500);
    expect(updatedReg.amountDueCents).toBe(0);
    expect(updatedReg.paidAt).toBeDefined();
    expect(component.pendingInPersonCount()).toBe(0);
    expect(component.totalRevenue()).toBe(165);
  });

  it('should allow unmarking paid in-person registrations to revert them to pending at the door', async () => {
    await component.loadData();
    const paidReg = component.registrations().find(r => r.docId === 'reg-3')!;
    // First simulate it being marked paid
    paidReg.status = 'paid' as const;
    paidReg.amountPaidCents = 5500;
    paidReg.amountDueCents = 0;
    paidReg.paidAt = '2026-09-08T12:00:00.000Z';

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await component.unmarkPaid(paidReg);

    expect(mockStripeService.unmarkEventRegistrationPaid).toHaveBeenCalledWith({
      eventId: 'event-1',
      registrationId: 'reg-3',
    });
    const updatedReg = component.registrations().find(r => r.docId === 'reg-3')!;
    expect(updatedReg.status).toBe('pending_in_person');
    expect(updatedReg.amountPaidCents).toBe(0);
    expect(updatedReg.amountDueCents).toBe(5500);
    expect(updatedReg.paidAt).toBeUndefined();
    expect(component.pendingInPersonCount()).toBe(1);
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

  it('should resolve member levels from registration doc and fallback to DataManagerService', async () => {
    await component.loadData();
    const reg1 = component.registrations().find((r) => r.docId === 'reg-1')!;
    const reg2 = component.registrations().find((r) => r.docId === 'reg-2')!;

    expect(component.getMemberId(reg2)).toBe('US402');
    expect(component.getMemberLevels(reg1)).toEqual({
      studentLevel: '1',
      applicationLevel: '',
    });
    expect(component.getMemberLevels(reg2)).toEqual({
      studentLevel: '4',
      applicationLevel: '2',
    });

    // Fallback lookup via DataManagerService
    const fallbackReg = {
      ...initEventRegistration(),
      docId: 'reg-fallback',
      studentLevel: undefined,
      applicationLevel: undefined,
      memberDocId: 'fallback-member-doc',
    };
    expect(component.getMemberLevels(fallbackReg)).toEqual({
      studentLevel: '3',
      applicationLevel: '1',
    });

    // Formatting helpers
    expect(component.formatStudentLevel('1')).toBe('Student 1');
    expect(component.formatStudentLevel('Student 2')).toBe('Student 2');
    expect(component.formatStudentLevel('')).toBe('');
    expect(component.formatApplicationLevel('2')).toBe('App 2');
    expect(component.formatApplicationLevel('App 3')).toBe('App 3');
    expect(component.formatApplicationLevel('')).toBe('');
  });

  it('should search by Member ID', async () => {
    await component.loadData();
    component.searchTerm.set('US402');
    expect(component.filteredRegistrations().length).toBe(1);
    expect(component.filteredRegistrations()[0].name).toBe('Jane Smith');
  });

  it('should sort attendees by various fields (Attendee, Role, Levels, Payment, RegisteredAt)', async () => {
    await component.loadData();

    // Default sort: RegisteredAt Desc
    // reg-3: Sep 3, reg-2: Sep 2, reg-1: Sep 1
    expect(component.filteredRegistrations().map((r) => r.docId)).toEqual(['reg-3', 'reg-2', 'reg-1']);

    // Sort by Attendee Asc (Bob Door, Jane Smith, John Doe)
    component.sortField.set(component.RegistrationSortField.Attendee);
    component.sortDirection.set(component.SortDirection.Asc);
    expect(component.filteredRegistrations().map((r) => r.name)).toEqual(['Bob Door', 'Jane Smith', 'John Doe']);

    // Sort by Attendee Desc
    component.sortDirection.set(component.SortDirection.Desc);
    expect(component.filteredRegistrations().map((r) => r.name)).toEqual(['John Doe', 'Jane Smith', 'Bob Door']);

    // Sort by Role Asc (NonMember=1, Member=2, Instructor=3)
    component.sortField.set(component.RegistrationSortField.Role);
    component.sortDirection.set(component.SortDirection.Asc);
    expect(component.filteredRegistrations().map((r) => r.role)).toEqual(['non_member', 'member', 'instructor']);

    // Sort by Role Desc (Instructor=3, Member=2, NonMember=1)
    component.sortDirection.set(component.SortDirection.Desc);
    expect(component.filteredRegistrations().map((r) => r.role)).toEqual(['instructor', 'member', 'non_member']);

    // Sort by Levels Asc (Entry < 1 < 4)
    // reg-3 (Entry) -> rank 1, reg-1 (1) -> rank 2, reg-2 (4) -> rank 5
    component.sortField.set(component.RegistrationSortField.Levels);
    component.sortDirection.set(component.SortDirection.Asc);
    expect(component.filteredRegistrations().map((r) => r.docId)).toEqual(['reg-3', 'reg-1', 'reg-2']);

    // Sort by Levels Desc (4 > 1 > Entry)
    component.sortDirection.set(component.SortDirection.Desc);
    expect(component.filteredRegistrations().map((r) => r.docId)).toEqual(['reg-2', 'reg-1', 'reg-3']);

    // Sort by Payment Asc (reg-1: 5000, reg-3: 5500 due, reg-2: 6000)
    component.sortField.set(component.RegistrationSortField.Payment);
    component.sortDirection.set(component.SortDirection.Asc);
    expect(component.filteredRegistrations().map((r) => r.docId)).toEqual(['reg-1', 'reg-3', 'reg-2']);

    // Sort by Payment Desc (reg-2: 6000, reg-3: 5500 due, reg-1: 5000)
    component.sortDirection.set(component.SortDirection.Desc);
    expect(component.filteredRegistrations().map((r) => r.docId)).toEqual(['reg-2', 'reg-3', 'reg-1']);
  });

  it('should toggle sort direction when clicking headers and set appropriate defaults', async () => {
    await component.loadData();

    // Currently RegisteredAt Desc. Clicking Attendee should set Attendee Asc.
    component.toggleSort(component.RegistrationSortField.Attendee);
    expect(component.sortField()).toBe(component.RegistrationSortField.Attendee);
    expect(component.sortDirection()).toBe(component.SortDirection.Asc);

    // Clicking Attendee again should toggle to Desc.
    component.toggleSort(component.RegistrationSortField.Attendee);
    expect(component.sortDirection()).toBe(component.SortDirection.Desc);

    // Clicking RegisteredAt should default to Desc.
    component.toggleSort(component.RegistrationSortField.RegisteredAt);
    expect(component.sortField()).toBe(component.RegistrationSortField.RegisteredAt);
    expect(component.sortDirection()).toBe(component.SortDirection.Desc);
  });

  it('should export CSV containing Member ID, Student Level, and Application Level', async () => {
    await component.loadData();

    let createdContent = '';
    const originalBlob = globalThis.Blob;
    globalThis.Blob = class MockBlob extends originalBlob {
      constructor(parts: any[], options?: any) {
        super(parts, options);
        createdContent = parts.join('');
      }
    };

    const linkClickSpy = vi.fn();
    const createElSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      setAttribute: vi.fn(),
      click: linkClickSpy,
    } as any);
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('mock-blob-url');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    try {
      component.exportCsv();

      expect(createdContent).toContain('Member ID,Student Level,Application Level');
      expect(createdContent).toContain('"US402","4","2"');
      expect(createdContent).toContain('"","Entry",""');
    } finally {
      createElSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
      createUrlSpy.mockRestore();
      revokeUrlSpy.mockRestore();
      globalThis.Blob = originalBlob;
    }
  });

  it('should render table headers with Member & Level, Fee & Status, and Date as the last column', async () => {
    await component.loadData();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const ths = Array.from(compiled.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    expect(ths).toEqual(['Attendee', 'Member & Level', 'Attendance', 'Video', 'Fee & Status', 'Date']);

    expect(ths).not.toContain('Contact');
    expect(ths).not.toContain('Role');
    expect(ths).not.toContain('Status / Actions');
    expect(ths).not.toContain('Payment & Tier');
    expect(ths).not.toContain('Registration Date');

    // Verify Member ID badge is rendered
    const memberIdBadge = compiled.querySelector('.member-id-badge');
    expect(memberIdBadge?.textContent?.trim()).toBe('US402');

    // Verify Fee & Status cells contain fee and status badge
    const feeStatusCells = compiled.querySelectorAll('.cell-fee-status');
    expect(feeStatusCells.length).toBe(3);
    expect(feeStatusCells[0]?.textContent).toContain('PAID');
    expect(feeStatusCells[1]?.textContent).toContain('$60.00');

    // Make sure Standard Advance text is not in table rows
    const tableText = compiled.querySelector('.roster-table')?.textContent || '';
    expect(tableText).not.toContain('Standard Advance');
  });
});
