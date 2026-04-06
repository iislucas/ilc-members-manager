import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SchoolEditComponent } from './school-edit';
import { DataManagerService } from '../data-manager.service';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
  UserDetails,
} from '../firebase-state.service';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { initSchool, School, initMember, Member } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { User } from 'firebase/auth';
import { CountryCode } from '../country-codes';

describe('SchoolEditComponent', () => {
  let component: SchoolEditComponent;
  let fixture: ComponentFixture<SchoolEditComponent>;
  let dataManagerServiceMock: Partial<DataManagerService>;
  let firebaseStateServiceMock: ReturnType<typeof createFirebaseStateServiceMock>;

  const mockSchool: School = {
    ...initSchool(),
    docId: 'school-doc-id',
    schoolName: 'Test School',
    schoolId: 'S001',
    ownerInstructorId: 'instructor-1',
    managerInstructorIds: ['instructor-2'],
    schoolAddress: '123 Main St',
    schoolCity: 'Springfield',
    schoolZipCode: '62704',
    schoolCountyOrState: 'Illinois',
    schoolCountry: 'United States',
    schoolWebsite: 'https://test-school.com',
  };

  function createTestBed(userDetails: UserDetails) {
    dataManagerServiceMock = {
      setSchool: vi.fn().mockResolvedValue(undefined),
      createNextSchoolId: vi.fn(),
      countMembersWithSchoolId: vi.fn().mockResolvedValue(0),
      members: new SearchableSet<'docId', Member>(['name'], 'docId', []),
      instructors: new SearchableSet<'instructorId', any>(
        ['name'],
        'instructorId',
        [],
      ),
      schools: new SearchableSet<'schoolId', School>(
        ['schoolName'],
        'schoolId',
        [],
      ),
      counters: signal(null),
    };

    firebaseStateServiceMock = createFirebaseStateServiceMock();
    firebaseStateServiceMock.user.set(userDetails);

    return TestBed.configureTestingModule({
      imports: [SchoolEditComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: dataManagerServiceMock },
        { provide: FirebaseStateService, useValue: firebaseStateServiceMock },
        {
          provide: ROUTING_CONFIG,
          useValue: {
            validPathPatterns: initPathPatterns,
          },
        },
      ],
    }).compileComponents();
  }

  async function setupComponent(userDetails: UserDetails) {
    await createTestBed(userDetails);
    fixture = TestBed.createComponent(SchoolEditComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('school', structuredClone(mockSchool));
    fixture.componentRef.setInput('allSchools', [mockSchool]);
    await fixture.whenStable();
  }

  const adminUser: UserDetails = {
    isAdmin: true,
    member: {
      ...initMember(),
      docId: 'admin-doc',
      instructorId: 'instructor-admin',
    },
    schoolsManaged: [],
    firebaseUser: { email: 'admin@example.com' } as User,
    memberProfiles: [],
  };

  const schoolManagerUser: UserDetails = {
    isAdmin: false,
    member: {
      ...initMember(),
      docId: 'manager-doc',
      instructorId: 'instructor-2',
    },
    schoolsManaged: [mockSchool.schoolId],
    firebaseUser: { email: 'manager@example.com' } as User,
    memberProfiles: [],
  };

  describe('as admin', () => {
    beforeEach(async () => {
      await setupComponent(adminUser);
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should not be dirty initially', () => {
      expect(component.isDirty()).toBe(false);
    });

    it('should preserve dirty state when school input is re-set with same data', async () => {
      // Make a change to the form
      component.form.schoolAddress().value.set('New Address');
      component.form.schoolAddress().markAsDirty();
      expect(component.isDirty()).toBe(true);
      expect(component.form.schoolAddress().value()).toBe('New Address');

      // Simulate parent re-rendering with same data but new object reference
      // (e.g. when another school in the list is saved)
      fixture.componentRef.setInput('school', structuredClone(mockSchool));
      await fixture.whenStable();

      // The edit should NOT have been wiped
      expect(component.isDirty()).toBe(true);
      expect(component.form.schoolAddress().value()).toBe('New Address');
    });

    it('should be dirty after editing schoolName', () => {
      component.form.schoolName().value.set('New School Name');
      component.form.schoolName().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolAddress', () => {
      component.form.schoolAddress().value.set('456 New Address');
      component.form.schoolAddress().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolCity', () => {
      component.form.schoolCity().value.set('New City');
      component.form.schoolCity().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolZipCode', () => {
      component.form.schoolZipCode().value.set('99999');
      component.form.schoolZipCode().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolCountyOrState', () => {
      component.form.schoolCountyOrState().value.set('California');
      component.form.schoolCountyOrState().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolCountry', () => {
      component.form.schoolCountry().value.set('Canada');
      component.form.schoolCountry().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolWebsite', () => {
      component.form.schoolWebsite().value.set('https://new-site.com');
      component.form.schoolWebsite().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty when owner is changed', () => {
      expect(component.isDirty()).toBe(false);
      component.updateOwner('new-owner-id');
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty when manager is added or removed', () => {
      expect(component.isDirty()).toBe(false);
      component.addManager();
      expect(component.isDirty()).toBe(true);

      // Reset dirty state to test removal
      component.form().reset();
      expect(component.isDirty()).toBe(false);

      component.updateManagerId(0, 'manager-1');
      expect(component.isDirty()).toBe(true);

      component.form().reset();
      expect(component.isDirty()).toBe(false);

      component.removeManager(0);
      expect(component.isDirty()).toBe(true);
    });

    it('should contain edited values in saved data', async () => {
      component.form.schoolName().value.set('Updated School');
      component.form.schoolName().markAsDirty();
      component.form.schoolAddress().value.set('789 Oak Ave');
      component.form.schoolAddress().markAsDirty();

      const event = { preventDefault: vi.fn() } as unknown as Event;
      await component.saveSchool(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(dataManagerServiceMock.setSchool).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolName: 'Updated School',
          schoolAddress: '789 Oak Ave',
        }),
        // Admins skip the diff optimization (oldSchool is undefined) so that
        // all initSchool() defaults are written to Firestore.
        undefined,
      );
    });

    it('form should be valid for existing school with required fields', () => {
      expect(component.form().invalid()).toBe(false);
    });

    it('isManagerAlsoOwner should return true when manager ID matches owner', () => {
      // The mock school has ownerInstructorId = 'instructor-1'
      expect(component.isManagerAlsoOwner('instructor-1')).toBe(true);
    });

    it('isManagerAlsoOwner should return false when manager ID differs from owner', () => {
      expect(component.isManagerAlsoOwner('instructor-2')).toBe(false);
    });

    it('isManagerAlsoOwner should return false for empty IDs', () => {
      expect(component.isManagerAlsoOwner('')).toBe(false);
    });

    it('hasOwnerAsManager should detect when owner is also listed as manager', () => {
      // Initially, owner is 'instructor-1' and managers are ['instructor-2']
      expect(component.hasOwnerAsManager()).toBe(false);

      // Set a manager to the same ID as the owner
      component.updateManagerId(0, 'instructor-1');
      expect(component.hasOwnerAsManager()).toBe(true);
    });

    it('DOM: save button should be disabled when owner is also a manager', async () => {
      component.collapsed.set(false);
      await fixture.whenStable();
      fixture.detectChanges();

      // Make the form dirty by setting a manager to the same ID as the owner
      component.updateManagerId(0, 'instructor-1');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.isDirty()).toBe(true);
      expect(component.hasOwnerAsManager()).toBe(true);

      const saveButton: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('button[type="submit"]');
      expect(saveButton).toBeTruthy();
      expect(saveButton!.disabled).toBe(true);
    });
  });

  describe('as school manager (non-admin)', () => {
    beforeEach(async () => {
      await setupComponent(schoolManagerUser);
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should identify user as school manager', () => {
      expect(component.userIsSchoolManager()).toBe(true);
      expect(component.userIsAdmin()).toBe(false);
    });

    it('should not be dirty initially', () => {
      expect(component.isDirty()).toBe(false);
    });

    it('admin-only fields should be disabled', () => {
      expect(component.form.schoolId().disabled()).toBe(true);
      expect(component.form.ownerInstructorId().disabled()).toBe(true);
    });

    it('manager-editable fields should be enabled', () => {
      expect(component.form.schoolName().disabled()).toBe(false);
      expect(component.form.schoolAddress().disabled()).toBe(false);
      expect(component.form.schoolZipCode().disabled()).toBe(false);
      expect(component.form.schoolCountyOrState().disabled()).toBe(false);
      expect(component.form.schoolWebsite().disabled()).toBe(false);
      expect(component.form.schoolCity().disabled()).toBe(false);
      expect(component.form.schoolCountry().disabled()).toBe(false);
    });

    it('should be dirty after editing schoolAddress', () => {
      component.form.schoolAddress().value.set('New Address');
      component.form.schoolAddress().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolZipCode', () => {
      component.form.schoolZipCode().value.set('00000');
      component.form.schoolZipCode().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolCountyOrState', () => {
      component.form.schoolCountyOrState().value.set('New State');
      component.form.schoolCountyOrState().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty after editing schoolWebsite', () => {
      component.form.schoolWebsite().value.set('https://updated.com');
      component.form.schoolWebsite().markAsDirty();
      expect(component.isDirty()).toBe(true);
    });

    it('should be dirty when a manager is added', () => {
      component.addManager();
      expect(component.isDirty()).toBe(true);
    });

    it('form should be valid for existing school with required fields', () => {
      expect(component.form().invalid()).toBe(false);
    });

    it('save should include edited values', async () => {
      component.form.schoolAddress().value.set('Edited Address');
      component.form.schoolAddress().markAsDirty();
      component.form.schoolWebsite().value.set('https://edited.com');
      component.form.schoolWebsite().markAsDirty();

      const event = { preventDefault: vi.fn() } as unknown as Event;
      await component.saveSchool(event);

      expect(dataManagerServiceMock.setSchool).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolAddress: 'Edited Address',
          schoolWebsite: 'https://edited.com',
          // Existing fields should be preserved
          schoolName: 'Test School',
          schoolId: 'S001',
        }),
        expect.anything(),
      );
    });

    it('DOM: typing in schoolAddress input should make form dirty', async () => {
      // Expand the form first
      component.collapsed.set(false);
      await fixture.whenStable();
      fixture.detectChanges();

      const inputEl: HTMLInputElement | null =
        fixture.nativeElement.querySelector('#schoolAddress');
      expect(inputEl).toBeTruthy();
      expect(inputEl!.disabled).toBe(false);

      inputEl!.value = 'New Address Via DOM';
      inputEl!.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl!.dispatchEvent(new Event('change', { bubbles: true }));
      await fixture.whenStable();

      expect(component.isDirty()).toBe(true);
      expect(component.form.schoolAddress().value()).toBe(
        'New Address Via DOM',
      );
    });

    it('DOM: typing in schoolWebsite input should make form dirty', async () => {
      component.collapsed.set(false);
      await fixture.whenStable();
      fixture.detectChanges();

      const inputEl: HTMLInputElement | null =
        fixture.nativeElement.querySelector('#schoolWebsite');
      expect(inputEl).toBeTruthy();
      expect(inputEl!.disabled).toBe(false);

      inputEl!.value = 'https://dom-edited.com';
      inputEl!.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl!.dispatchEvent(new Event('change', { bubbles: true }));
      await fixture.whenStable();

      expect(component.isDirty()).toBe(true);
      expect(component.form.schoolWebsite().value()).toBe(
        'https://dom-edited.com',
      );
    });

    it('DOM: save button should appear and be enabled for manager after edit', async () => {
      component.collapsed.set(false);
      await fixture.whenStable();
      fixture.detectChanges();

      // Before editing, no save button should be visible
      let saveButton: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('button[type="submit"]');
      expect(saveButton).toBeFalsy();

      // Edit the address
      const inputEl: HTMLTextAreaElement | null =
        fixture.nativeElement.querySelector('#schoolAddress');
      expect(inputEl).toBeTruthy();
      inputEl!.value = 'Manager Edited Address';
      inputEl!.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl!.dispatchEvent(new Event('change', { bubbles: true }));
      await fixture.whenStable();
      fixture.detectChanges();

      // Now check that save button appears and is NOT disabled
      saveButton = fixture.nativeElement.querySelector('button[type="submit"]');
      expect(saveButton).toBeTruthy();
      expect(saveButton!.disabled).toBe(false);
    });

    it('DOM: schoolCity and schoolCountry inputs should be enabled in the DOM for manager', async () => {
      component.collapsed.set(false);
      await fixture.whenStable();
      fixture.detectChanges();

      const schoolCityInput: HTMLInputElement | null =
        fixture.nativeElement.querySelector('#schoolCity');
      expect(schoolCityInput).toBeTruthy();
      expect(schoolCityInput!.disabled).toBe(false);

      const schoolCountryInput: HTMLInputElement | null =
        fixture.nativeElement.querySelector('#schoolCountry');
      expect(schoolCountryInput).toBeTruthy();
      expect(schoolCountryInput!.disabled).toBe(false);
    });
  });

  describe('DOM interaction as admin', () => {
    beforeEach(async () => {
      await setupComponent(adminUser);
    });

    it('DOM: typing in schoolName input should make form dirty', async () => {
      component.collapsed.set(false);
      await fixture.whenStable();
      fixture.detectChanges();

      const inputEl: HTMLInputElement | null =
        fixture.nativeElement.querySelector('#schoolName');
      expect(inputEl).toBeTruthy();

      inputEl!.value = 'DOM Edited School';
      inputEl!.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl!.dispatchEvent(new Event('change', { bubbles: true }));
      await fixture.whenStable();

      expect(component.isDirty()).toBe(true);
      expect(component.form.schoolName().value()).toBe('DOM Edited School');
    });

    it('DOM: typing in schoolCity input should make form dirty', async () => {
      component.collapsed.set(false);
      await fixture.whenStable();
      fixture.detectChanges();

      const inputEl: HTMLInputElement | null =
        fixture.nativeElement.querySelector('#schoolCity');
      expect(inputEl).toBeTruthy();

      inputEl!.value = 'DOM City';
      inputEl!.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl!.dispatchEvent(new Event('change', { bubbles: true }));
      await fixture.whenStable();

      expect(component.isDirty()).toBe(true);
      expect(component.form.schoolCity().value()).toBe('DOM City');
    });

    it('DOM: admin-visible save button should be enabled after edit', async () => {
      component.collapsed.set(false);
      await fixture.whenStable();
      fixture.detectChanges();

      const inputEl: HTMLInputElement | null =
        fixture.nativeElement.querySelector('#schoolAddress');
      expect(inputEl).toBeTruthy();

      inputEl!.value = 'Edited address for save button test';
      inputEl!.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl!.dispatchEvent(new Event('change', { bubbles: true }));
      await fixture.whenStable();
      fixture.detectChanges();

      const saveButton: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('button[type="submit"]');
      expect(saveButton).toBeTruthy();
      expect(saveButton!.disabled).toBe(false);
    });
  });
});
