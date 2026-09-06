import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { ProposeEventComponent } from './organise-event';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../../firebase-state.service';
import { RoutingService } from '../../routing.service';
import { DataManagerService } from '../../data-manager.service';
import { FIREBASE_APP } from '../../app.config';
import { SearchableSet } from '../../searchable-set';

import { ProductService } from '../../product.service';
import { Product } from '../../../../functions/src/data-model';

describe('ProposeEventComponent', () => {
  let component: ProposeEventComponent;
  let fixture: ComponentFixture<ProposeEventComponent>;
  let mockProductService: {
    getAllProducts: ReturnType<typeof vi.fn>;
    getProduct: ReturnType<typeof vi.fn>;
    saveProduct: ReturnType<typeof vi.fn>;
    deleteProduct: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    localStorage.clear();
    mockProductService = {
      getAllProducts: vi.fn().mockResolvedValue([]),
      getProduct: vi.fn().mockResolvedValue(undefined),
      saveProduct: vi.fn().mockResolvedValue('test-product-id'),
      deleteProduct: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ProposeEventComponent],
      providers: [
        { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
        { provide: RoutingService, useValue: { navigateToParts: () => {}, hrefForView: () => '' } },
        { provide: FIREBASE_APP, useValue: {} },
        { provide: ProductService, useValue: mockProductService },
        {
          provide: DataManagerService,
          useValue: {
            instructors: new SearchableSet(['instructorId'], 'instructorId', []),
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProposeEventComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have submit button disabled when form is invalid', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(true);
  });

  it('should enable submit button when form is valid', async () => {
    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      member: { docId: 'member-1', name: 'Alice Organiser', memberId: 'FR1', instructorId: 'FR1' },
    });
    component.eventModel.update(m => ({
      ...m,
      title: 'Test Event',
      start: '2026-04-04',
      end: '2026-04-05',
      leadingInstructorId: 'FR102',
      ownerDocId: 'member-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(false);
  });

  it('lists Instructor among the missing required fields when unset', async () => {
    component.eventModel.update(m => ({ ...m, leadingInstructorId: '' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.missingFields()).toContain('Instructor required.');
  });

  it('defaults the owner to the signed-in submitter without pinning them in managers', async () => {
    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      member: { docId: 'member-1', name: 'Alice Organiser', memberId: 'FR1' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    // Owner (main contact) defaults to the submitter's member doc.
    expect(component.eventModel().ownerDocId).toBe('member-1');
    // Managers list defaults to empty (creator is not forced into managers).
    expect(component.eventModel().managerDocIds).toEqual([]);
  });

  it('requires a contact name and email for a non-instructor owner', async () => {
    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      member: {
        docId: 'member-1', name: 'Non Instructor', memberId: 'FR9',
        instructorId: '', emails: [], publicEmail: '',
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    // Prefill fills the contact name but there is no email to prefill → invalid.
    expect(component.submitterIsInstructor()).toBe(false);
    expect(component.ownerContactValid()).toBe(false);
    expect(component.missingFields()).toContain(
      'Contact name and email for the main contact.',
    );

    component.eventModel.update((m) => ({ ...m, ownerContactEmail: 'contact@example.com' }));
    expect(component.ownerContactValid()).toBe(true);
  });

  it('lets an instructor submitter reassign the owner', async () => {
    const dataService = TestBed.inject(DataManagerService);
    (dataService.instructors as unknown as SearchableSet<'instructorId', { instructorId: string; docId: string; name: string }>)
      .setEntries([{ docId: 'other-doc', instructorId: 'FR200', name: 'Other Instructor' }]);
    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      member: { docId: 'member-1', name: 'Instructor Submitter', memberId: 'FR1', instructorId: 'FR1' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    component.updateOwnerInstructor('FR200');

    expect(component.eventModel().ownerDocId).toBe('other-doc');
    expect(component.ownerInstructorId()).toBe('FR200');
    expect(component.ownerValid()).toBe(true);
  });

  it('shows custom contact info card and hides autocomplete when instructor ticks provide different primary contact info', async () => {
    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      member: { docId: 'member-1', name: 'Instructor Submitter', memberId: 'FR1', instructorId: 'FR1' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showCustomContactCard()).toBe(false);
    expect(fixture.nativeElement.querySelector('.owner-selector-row app-instructor-selector')).toBeTruthy();

    component.setHasCustomContactInfo(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showCustomContactCard()).toBe(true);
    expect(component.eventModel().ownerContactName).toBe('Instructor Submitter');
    expect(fixture.nativeElement.querySelector('.owner-selector-row app-instructor-selector')).toBeFalsy();

    component.setHasCustomContactInfo(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showCustomContactCard()).toBe(false);
    expect(fixture.nativeElement.querySelector('.owner-selector-row app-instructor-selector')).toBeTruthy();
  });

  it('renders status selector and Save button for admins, hiding proposal intro text', async () => {
    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      isAdmin: true,
      member: { docId: 'admin-1', name: 'Admin User', memberId: 'FR99' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.userIsAdmin()).toBe(true);

    const statusSelect = fixture.nativeElement.querySelector('select#status');
    expect(statusSelect).toBeTruthy();

    const introText = fixture.nativeElement.querySelector('.organise-event-container > .intro-text');
    // Top proposal intro text is hidden for admins
    expect(introText).toBeFalsy();

    const submitBtn = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitBtn.textContent.trim()).toBe('Save');

    // Updating status works
    component.updateStatus('unlisted');
    expect(component.eventModel().status).toBe('unlisted');
  });

  it('renders proposal intro text and Submit Proposal button for non-admins without status select', async () => {
    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      isAdmin: false,
      member: { docId: 'member-1', name: 'Regular Member', memberId: 'FR1' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.userIsAdmin()).toBe(false);

    const statusSelect = fixture.nativeElement.querySelector('select#status');
    expect(statusSelect).toBeFalsy();

    const introText = fixture.nativeElement.querySelector('.organise-event-container > .intro-text');
    expect(introText).toBeTruthy();

    const submitBtn = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitBtn.textContent.trim()).toBe('Submit Proposal');
  });

  it('renders online registration section for admins but not for regular members', async () => {
    const firebaseState = TestBed.inject(FirebaseStateService);

    // Regular member
    (firebaseState.user as WritableSignal<unknown>).set({
      isAdmin: false,
      member: { docId: 'member-1', name: 'Regular Member', memberId: 'FR1' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    let regSection = fixture.nativeElement.querySelector('.product-section-content');
    expect(regSection).toBeFalsy();

    // Admin member
    (firebaseState.user as WritableSignal<unknown>).set({
      isAdmin: true,
      member: { docId: 'admin-1', name: 'Admin Member', memberId: 'FR99' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    regSection = fixture.nativeElement.querySelector('.product-section-content');
    expect(regSection).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.no-product-banner')).toBeTruthy();
  });

  it('supports linking and removing an online registration product for admins', async () => {
    const sampleProduct: Product = {
      docId: 'prod-123',
      title: 'HQ Workshop Registration',
      currency: 'eur',
      tiers: {
        standard: { id: 'standard', name: 'Standard', price: 50, enabled: true },
      },
      allowInPerson: true,
      allowOnline: true,
      allowVideo: false,
      onlineJoiningLink: 'https://zoom.us/j/12345',
    };

    mockProductService.getAllProducts.mockResolvedValue([sampleProduct]);
    mockProductService.getProduct.mockResolvedValue(sampleProduct);

    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      isAdmin: true,
      member: { docId: 'admin-1', name: 'Admin Member', memberId: 'FR99' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    // Call onInlineProductCreated
    await component.onInlineProductCreated('prod-123');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.eventModel().productId).toBe('prod-123');
    expect(component.eventModel().onlineJoiningLink).toBe('https://zoom.us/j/12345');
    expect(component.linkedProduct()?.docId).toBe('prod-123');

    const linkedCard = fixture.nativeElement.querySelector('.linked-product-card');
    expect(linkedCard).toBeTruthy();
    expect(linkedCard.textContent).toContain('HQ Workshop Registration');
    expect(linkedCard.textContent).toContain('50.00 EUR');

    // Remove registration
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await component.removeRegistration();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockProductService.deleteProduct).toHaveBeenCalledWith('prod-123');
    expect(component.eventModel().productId).toBe('');
    expect(component.linkedProduct()).toBeNull();
  });
});

