/* product-edit.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductEditComponent } from './product-edit';
import { ProductService } from '../product.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { initProduct } from '../../../functions/src/data-model/events';
import { signal } from '@angular/core';

describe('ProductEditComponent', () => {
  let component: ProductEditComponent;
  let fixture: ComponentFixture<ProductEditComponent>;

  const mockProductService = {
    getProduct: vi.fn().mockResolvedValue(initProduct()),
    saveProduct: vi.fn().mockResolvedValue('new-prod-id'),
    deleteProduct: vi.fn().mockResolvedValue(undefined),
  };

  const mockDataManagerService = {
    getEvents: vi.fn().mockResolvedValue([]),
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
    expect(component.visibleRows().length).toBe(1);

    // Toggle allowOnline -> 2 rows (In-Person, Online)
    component.toggleAttendanceMode('online');
    expect(component.productModel().allowOnline).toBe(true);
    expect(component.visibleRows().length).toBe(2);

    // Toggle allowVideo -> 4 rows (In-Person, In-Person + Video, Online, Online + Video)
    component.toggleAttendanceMode('video');
    expect(component.productModel().allowVideo).toBe(true);
    expect(component.visibleRows().length).toBe(4);

    // Toggle off allowInPerson -> 2 rows (Online, Online + Video)
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
});
