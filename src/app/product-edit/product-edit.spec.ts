/* product-edit.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductEditComponent } from './product-edit';
import { ProductService } from '../product.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AttendanceType, EventRegistrationStatus, initEventRegistration, initProduct } from '../../../functions/src/data-model/events';
import { signal } from '@angular/core';

describe('ProductEditComponent', () => {
  let component: ProductEditComponent;
  let fixture: ComponentFixture<ProductEditComponent>;

  const mockProductService = {
    getProduct: vi.fn().mockResolvedValue(initProduct()),
    saveProduct: vi.fn().mockResolvedValue('new-prod-id'),
    deleteProduct: vi.fn().mockResolvedValue(undefined),
    getEventRegistrations: vi.fn().mockResolvedValue([]),
  };

  const mockDataManagerService = {
    getEvents: vi.fn().mockResolvedValue([]),
    saveProduct: vi.fn().mockResolvedValue('saved-product-123'),
    deleteProduct: vi.fn().mockResolvedValue(undefined),
    videos: {
      entries: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined),
    },
    getVideoSeriesList: vi.fn().mockReturnValue([]),
  };

  const mockRoutingService = {
    signals: {
      manageProductEdit: {
        pathVars: {
          productId: signal(''),
        },
      },
    },
    matchedPatternId: {
      set: vi.fn(),
    },
    hrefForView: vi.fn().mockReturnValue('/products/mock-id'),
    navigateTo: vi.fn(),
  };

  const mockFirebaseState = {
    user: signal({
      email: 'admin@ilc.com',
      isAdmin: true,
      isFullMember: true,
      isInstructor: true,
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductEditComponent],
      providers: [
        { provide: ProductService, useValue: mockProductService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductEditComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create in new product mode', () => {
    expect(component).toBeTruthy();
    expect(component.isNew()).toBe(true);
  });

  it('should update tier price in pricing matrix', () => {
    component.setTierPrice('member', 'in_person', false, '99.50');
    const tier = component.getTier('member', 'in_person', false);
    expect(tier.price).toBe(99.50);
  });

  it('should default to single standard price column and allow adding special prices for members and instructors', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    // Default: hasMemberPrice and hasInstructorPrice are false
    expect(component.hasMemberPrice()).toBe(false);
    expect(component.hasInstructorPrice()).toBe(false);

    // Only 1 row visible by default (In-Person Attendance)
    expect(component.visibleRows().length).toBe(1);
    expect(component.visibleRows()[0].getLabel(component.productModel())).toBe('In-Person Attendance');

    // UI contains buttons to add special prices
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Standard Price');
    expect(text).toContain('Add special price for members');
    expect(text).toContain('Add special price for instructors');
    expect(text).not.toContain('Member Price');

    // Add special price for members
    component.addMemberPrice();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.hasMemberPrice()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Member Price');

    // Remove member special price
    component.removeMemberPrice();
    fixture.detectChanges();
    expect(component.hasMemberPrice()).toBe(false);
  });

  it('should not render redundant header or back button, and hide Associated Calendar Event when embedded', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    // In standalone new mode: no redundant header text or backlink
    expect(fixture.nativeElement.textContent).not.toContain('Create New Class / Workshop Product');
    expect(fixture.nativeElement.textContent).not.toContain('All Products');
    expect(fixture.nativeElement.textContent).toContain('Associated Calendar Event');

    // In embedded mode: Associated Calendar Event is hidden
    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('Associated Calendar Event');
  });

  it('should show delivery resources when online or video modes are enabled', async () => {
    expect(fixture.nativeElement.textContent).not.toContain('Online Joining Link');
    expect(fixture.nativeElement.textContent).not.toContain('Video Recording for Attendees');

    component.toggleAttendanceMode('online');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Online Joining Link');

    component.toggleAttendanceMode('video');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Video Recording for Attendees');
  });

  it('should handle registration audience changes correctly', () => {
    // Default audience is 'anyone'
    expect(component.registrationAudience()).toBe('anyone');
    expect(component.standardRole()).toBe('non_member');
    expect(component.standardRoleLabel()).toBe('Standard Price');

    // Change to 'members'
    component.setRegistrationAudience('members');
    expect(component.registrationAudience()).toBe('members');
    expect(component.productModel().allowNonMembers).toBe(false);
    expect(component.productModel().allowMembers).toBe(true);
    expect(component.productModel().allowInstructors).toBe(true);
    expect(component.standardRole()).toBe('member');
    expect(component.standardRoleLabel()).toBe('Member Price');

    // Change to 'instructors'
    component.setRegistrationAudience('instructors');
    expect(component.registrationAudience()).toBe('instructors');
    expect(component.productModel().allowNonMembers).toBe(false);
    expect(component.productModel().allowMembers).toBe(false);
    expect(component.productModel().allowInstructors).toBe(true);
    expect(component.standardRole()).toBe('instructor');
    expect(component.standardRoleLabel()).toBe('Instructor Price');
  });

  it('should dynamically update visible rows when forms of participation are toggled', () => {
    // Initial state: only allowInPerson is true -> 1 row
    expect(component.productModel().allowInPerson).toBe(true);
    expect(component.productModel().allowOnline).toBe(false);
    expect(component.productModel().allowVideo).toBe(false);
    expect(component.productModel().allowVideoOnly).toBe(false);
    expect(component.visibleRows().length).toBe(1);

    // Toggle allowOnline -> 2 rows (In-Person, Online)
    component.toggleAttendanceMode('online');
    expect(component.productModel().allowOnline).toBe(true);
    expect(component.visibleRows().length).toBe(2);

    // Toggle allowVideoOnly -> 3 rows (In-Person, Online, Video Only)
    component.toggleAttendanceMode('video_only');
    expect(component.productModel().allowVideoOnly).toBe(true);
    expect(component.visibleRows().length).toBe(3);

    // Toggle off allowInPerson -> 2 rows (Online, Video Only)
    component.toggleAttendanceMode('in_person');
    expect(component.productModel().allowInPerson).toBe(false);
    expect(component.visibleRows().length).toBe(2);
  });

  it('should link and unlink calendar events via autocomplete', () => {
    const dummyEvent = {
      docId: 'ev-123',
      title: 'Spring Intensive',
      start: '2026-05-10T10:00:00Z',
      end: '2026-05-12T17:00:00Z',
      location: 'Boulder, CO',
    } as any;

    component.eventsSearchableSet.setEntries([dummyEvent]);

    component.onEventSelected(dummyEvent);
    expect(component.productModel().eventDocId).toBe('ev-123');
    expect(component.linkedEvent()).toBe(dummyEvent);

    component.clearLinkedEvent();
    expect(component.productModel().eventDocId).toBe('');
    expect(component.linkedEvent()).toBeNull();
  });

  it('should support early-bird and pay-in-person toggles and delta calculations', () => {
    // Initially false
    expect(component.productModel().hasEarlyBird).toBe(false);
    expect(component.productModel().allowPayInPerson).toBe(false);
    expect(component.visibleRows().length).toBe(1);

    // Set standard base price
    component.setBasePrice('non_member' as any, 'in_person' as any, '100.00');
    expect(component.getTier('non_member' as any, 'in_person' as any, false, 'standard' as any).price).toBe(100);

    // Toggle early bird
    component.toggleEarlyBird();
    expect(component.productModel().hasEarlyBird).toBe(true);
    component.updateEarlyBirdDeadline('2026-10-01T23:59:59');
    expect(component.productModel().earlyBirdDeadline).toBe('2026-10-01T23:59:59');
    component.updateLateDeltaPrice('25.00');
    expect(component.lateDeltaPrice()).toBe(25);

    // Base price in table now acts as early bird base price
    component.setBasePrice('non_member' as any, 'in_person' as any, '80.00');
    expect(component.getTier('non_member' as any, 'in_person' as any, false, 'early_bird' as any).price).toBe(80);
    // Standard price is early bird + lateDeltaPrice (80 + 25 = 105)
    expect(component.getTier('non_member' as any, 'in_person' as any, false, 'standard' as any).price).toBe(105);

    // Toggle pay in person
    component.togglePayInPerson();
    expect(component.productModel().allowPayInPerson).toBe(true);
    component.updateMaxInPersonAttendees('35');
    expect(component.productModel().maxInPersonAttendees).toBe(35);
    // Door price matches standard price by default when hasDoorDelta is false
    expect(component.getTier('non_member' as any, 'in_person' as any, false, 'in_person' as any).price).toBe(105);

    // Enable door delta
    component.toggleDoorDelta();
    expect(component.hasDoorDelta()).toBe(true);
    component.updateDoorDeltaPrice('10.00');
    expect(component.doorDeltaPrice()).toBe(10);
    // Door price is standard price + doorDeltaPrice (105 + 10 = 115)
    expect(component.getTier('non_member' as any, 'in_person' as any, false, 'in_person' as any).price).toBe(115);

    // Video delta
    component.updateVideoDeltaPrice('15.00');
    expect(component.getTier('non_member' as any, 'in_person' as any, true, 'standard' as any).price).toBe(120);
  });

  it('should populate vodOptionsSet from series and videos and allow selecting/unlinking', async () => {
    component.productModel.update((m) => ({ ...m, allowVideo: true }));
    fixture.detectChanges();

    // Select an option
    component.onVodOptionSelected({
      id: 'series_spring_2026',
      type: 'series',
      title: 'Spring 2026 Workshop',
      displayName: '[Series (3 parts)] Spring 2026 Workshop',
    });

    expect(component.productModel().recordedVideoId).toBe('series_spring_2026');
    fixture.detectChanges();
    await fixture.whenStable();

    // Preview component should be rendered
    const previewEl = fixture.nativeElement.querySelector('app-vod-preview');
    expect(previewEl).toBeTruthy();

    // Unlinking clears the recordedVideoId
    component.updateRecordedVideoId('');
    expect(component.productModel().recordedVideoId).toBe('');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('app-vod-preview')).toBeNull();
  });

  it('should calculate video access impact correctly for video-only vs included registrations', () => {
    const regVideoOnly = {
      ...initEventRegistration(),
      docId: 'reg-1',
      attendance: AttendanceType.VideoOnly,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    const regInPersonWithVideo = {
      ...initEventRegistration(),
      docId: 'reg-2',
      attendance: AttendanceType.InPerson,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    const regInPersonNoVideo = {
      ...initEventRegistration(),
      docId: 'reg-3',
      attendance: AttendanceType.InPerson,
      hasVideoAccess: false,
      status: EventRegistrationStatus.Paid,
    };
    const regCancelled = {
      ...initEventRegistration(),
      docId: 'reg-4',
      attendance: AttendanceType.VideoOnly,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Cancelled,
    };

    component.eventRegistrations.set([regVideoOnly, regInPersonWithVideo, regInPersonNoVideo, regCancelled]);

    expect(component.attendeesWithVideoAccess().length).toBe(2);
    expect(component.videoOnlyAttendeesCount()).toBe(1);
    expect(component.includedVideoAttendeesCount()).toBe(1);
  });

  it('should prompt confirmation when saving with new or modified video and attendees have video access', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.initialRecordedVideoId.set('');

    const reg = {
      ...initEventRegistration(),
      docId: 'reg-1',
      attendance: AttendanceType.VideoOnly,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    component.eventRegistrations.set([reg]);

    component.productModel.update((m) => ({
      ...m,
      title: 'Spring Workshop 2026',
      recordedVideoId: 'series_123',
    }));

    await component.saveProduct();

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 attendee(s)'),
    );
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 video-only pre-order attendee(s)'),
    );
    expect(mockDataManagerService.saveProduct).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('should abort saving if admin cancels the notification confirmation dialog', async () => {
    mockDataManagerService.saveProduct.mockClear();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    component.initialRecordedVideoId.set('');

    const reg = {
      ...initEventRegistration(),
      docId: 'reg-1',
      attendance: AttendanceType.InPerson,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    component.eventRegistrations.set([reg]);

    component.productModel.update((m) => ({
      ...m,
      title: 'Spring Workshop 2026',
      recordedVideoId: 'series_123',
    }));

    await component.saveProduct();

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDataManagerService.saveProduct).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('should not prompt confirmation when video recording is unchanged on save', async () => {
    mockDataManagerService.saveProduct.mockClear();
    const confirmSpy = vi.spyOn(window, 'confirm');
    component.initialRecordedVideoId.set('series_123');

    const reg = {
      ...initEventRegistration(),
      docId: 'reg-1',
      attendance: AttendanceType.VideoOnly,
      hasVideoAccess: true,
      status: EventRegistrationStatus.Paid,
    };
    component.eventRegistrations.set([reg]);

    component.productModel.update((m) => ({
      ...m,
      title: 'Spring Workshop 2026',
      recordedVideoId: 'series_123', // unchanged
    }));

    await component.saveProduct();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockDataManagerService.saveProduct).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});
