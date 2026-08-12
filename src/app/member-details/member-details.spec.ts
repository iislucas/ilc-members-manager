import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Mock } from 'vitest';
import { MemberDetailsComponent } from './member-details';
import { DataManagerService, DataServiceState } from '../data-manager.service';
import {
  FirebaseStateService,
  UserDetails,
  createFirebaseStateServiceMock,
} from '../firebase-state.service';
import { ROUTING_CONFIG, initPathPatterns, FIREBASE_APP } from '../app.config';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  initMember,
  Member,
  MembershipType,
  School,
  InstructorPublicData,
} from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { CountryCode } from '../country-codes';
import { User } from 'firebase/auth';

describe('MemberDetailsComponent', () => {
  let component: MemberDetailsComponent;
  let fixture: ComponentFixture<MemberDetailsComponent>;
  let dataManagerServiceMock: DataManagerService;
  let firebaseStateServiceMock: FirebaseStateService;

  const mockMember: Member = {
    ...initMember(),
    docId: 'test-id',
    name: 'Test Member',
    emails: ['test@example.com'],
    memberId: 'US001',
    country: 'United States',
    membershipType: MembershipType.Annual,
  };

  beforeEach(async () => {
    dataManagerServiceMock = {
      updateMember: vi.fn(),
      addMember: vi.fn(),
      createNextMemberId: vi.fn(),
      createNextInstructorId: vi.fn(),
      loadingState: signal(DataServiceState.Loaded),
      members: new SearchableSet<'docId', Member>(
        ['name'],
        'docId',
        [],
      ),
      instructors: new SearchableSet<'instructorId', InstructorPublicData>(
        ['name'],
        'instructorId',
        [],
      ),
      schools: new SearchableSet<'schoolId', School>(
        ['schoolName'],
        'schoolId',
        [],
      ),
      countries: new SearchableSet<'id', CountryCode>(['name'], 'id', []),
      counters: signal(null),
    } as Partial<DataManagerService> as DataManagerService;

    dataManagerServiceMock.countries.setEntries([
      { id: 'US', name: 'United States' },
    ]);

    firebaseStateServiceMock = createFirebaseStateServiceMock();
    firebaseStateServiceMock.user.set({
      isAdmin: true,
      member: mockMember,
      schoolsManaged: [],
      firebaseUser: { email: 'admin@example.com' } as User,
      memberProfiles: [],
    } as UserDetails);

    await TestBed.configureTestingModule({
      imports: [MemberDetailsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: dataManagerServiceMock },
        { provide: FirebaseStateService, useValue: firebaseStateServiceMock },
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        { provide: FIREBASE_APP, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MemberDetailsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('member', mockMember);
    fixture.componentRef.setInput('allMembers', [mockMember]);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call preventDefault and updateMember on save', async () => {
    const event = { preventDefault: vi.fn() } as unknown as Event;
    (dataManagerServiceMock.updateMember as Mock).mockResolvedValue(undefined);

    await component.saveMember(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dataManagerServiceMock.updateMember).toHaveBeenCalledWith(
      mockMember.docId,
      expect.any(Object),
      // Admins skip the diff optimization (oldMember is undefined) so that
      // all initMember() defaults are written to Firestore.
      undefined,
    );
  });

  it('should call addMember if member email is not present', async () => {
    const newMember = {
      ...initMember(),
      name: 'New Member',
      country: 'United States',
    };
    fixture.componentRef.setInput('member', newMember);
    await fixture.whenStable();

    const event = { preventDefault: vi.fn() } as unknown as Event;
    (dataManagerServiceMock.addMember as Mock).mockResolvedValue({ id: 'new-id' });

    await component.saveMember(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dataManagerServiceMock.addMember).toHaveBeenCalled();
  });

  it('should show membership status fields for admin editing a member without ID', async () => {
    const emptyIdMember: Member = {
      ...initMember(),
      docId: 'empty-id-member',
      name: 'No ID Member',
      emails: ['noid@example.com'],
      memberId: '',
      country: 'United States',
      membershipType: MembershipType.Annual,
    };

    firebaseStateServiceMock.user.set({
      isAdmin: true,
      member: emptyIdMember,
      schoolsManaged: [],
      firebaseUser: { email: 'admin@example.com' } as User,
      memberProfiles: [],
    } as UserDetails);

    fixture.componentRef.setInput('member', emptyIdMember);
    fixture.componentRef.setInput('allMembers', [emptyIdMember]);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const idAssignment = compiled.querySelector('app-id-assignment');
    expect(idAssignment).toBeTruthy();

    const purchaseLink = compiled.querySelector('a[href*="membership"]');
    expect(purchaseLink).toBeNull();
  });

  it('should show purchase membership section for non-admin editing themselves without ID', async () => {
    const emptyIdMember: Member = {
      ...initMember(),
      docId: 'empty-id-member',
      name: 'No ID Member',
      emails: ['noid@example.com'],
      memberId: '',
      country: 'United States',
      membershipType: MembershipType.Annual,
    };

    firebaseStateServiceMock.user.set({
      isAdmin: false,
      member: emptyIdMember,
      schoolsManaged: [],
      firebaseUser: { email: 'noid@example.com' } as User,
      memberProfiles: [],
    } as UserDetails);

    fixture.componentRef.setInput('member', emptyIdMember);
    fixture.componentRef.setInput('allMembers', [emptyIdMember]);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const idAssignment = compiled.querySelector('app-id-assignment');
    expect(idAssignment).toBeNull();

    const purchaseLink = compiled.querySelector('a[href*="member"]');
    expect(purchaseLink).toBeTruthy();
  });

  describe('email list and ordering', () => {
    it('should display note under the first email indicating association with in-app orders and subscriptions', async () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const note = compiled.querySelector('.email-note');
      expect(note).toBeTruthy();
      expect(note?.textContent).toContain(
        'This email is used for in-app orders and subscriptions.',
      );
    });

    it('should toggle email menu on three dots button click', () => {
      expect(component.openEmailMenuIndex()).toBeNull();

      component.toggleEmailMenu(0);
      expect(component.openEmailMenuIndex()).toBe(0);

      component.toggleEmailMenu(0);
      expect(component.openEmailMenuIndex()).toBeNull();

      component.toggleEmailMenu(1);
      expect(component.openEmailMenuIndex()).toBe(1);
    });

    it('should not show "Use this email for future orders" in menu for first email', async () => {
      const multiEmailMember: Member = {
        ...mockMember,
        emails: ['first@example.com', 'second@example.com'],
      };
      fixture.componentRef.setInput('member', multiEmailMember);
      fixture.detectChanges();
      await fixture.whenStable();

      component.toggleEmailMenu(0);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const emailMenu = compiled.querySelector('.email-menu');
      expect(emailMenu).toBeTruthy();
      expect(emailMenu?.textContent).not.toContain(
        'Use this email for future orders',
      );
      expect(emailMenu?.textContent).toContain('Remove this address');
    });

    it('should show "Use this email for future orders" in menu for second email', async () => {
      const multiEmailMember: Member = {
        ...mockMember,
        emails: ['first@example.com', 'second@example.com'],
      };
      fixture.componentRef.setInput('member', multiEmailMember);
      fixture.detectChanges();
      await fixture.whenStable();

      component.toggleEmailMenu(1);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const emailMenu = compiled.querySelector('.email-menu');
      expect(emailMenu).toBeTruthy();
      expect(emailMenu?.textContent).toContain(
        'Use this email for future orders',
      );
      expect(emailMenu?.textContent).toContain('Remove this address');
    });

    it('should re-order emails and mark form dirty when makePrimaryEmail is called', async () => {
      const multiEmailMember: Member = {
        ...mockMember,
        emails: ['first@example.com', 'second@example.com', 'third@example.com'],
      };
      fixture.componentRef.setInput('member', multiEmailMember);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.form.emails().value()).toEqual([
        'first@example.com',
        'second@example.com',
        'third@example.com',
      ]);

      component.makePrimaryEmail(1);

      expect(component.form.emails().value()).toEqual([
        'second@example.com',
        'first@example.com',
        'third@example.com',
      ]);
      expect(component.emailsChanged()).toBe(true);
      expect(component.isDirty()).toBe(true);
      expect(component.openEmailMenuIndex()).toBeNull();
    });

    it('should remove email and mark form dirty when removeEmail is called', async () => {
      const multiEmailMember: Member = {
        ...mockMember,
        emails: ['first@example.com', 'second@example.com'],
      };
      fixture.componentRef.setInput('member', multiEmailMember);
      fixture.detectChanges();
      await fixture.whenStable();

      component.removeEmail(0);

      expect(component.form.emails().value()).toEqual(['second@example.com']);
      expect(component.emailsChanged()).toBe(true);
      expect(component.isDirty()).toBe(true);
      expect(component.openEmailMenuIndex()).toBeNull();
    });
  });

  describe('navigation buttons', () => {
    it('should show aspect management links for admin viewing an existing member', async () => {
      const memberWithDetails: Member = {
        ...mockMember,
        docId: 'm123',
        memberId: 'US001',
        name: 'John Doe',
        emails: ['john@example.com'],
        instructorId: '101',
        primarySchoolId: 'SCH01',
      };
      fixture.componentRef.setInput('member', memberWithDetails);
      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const navButtons = compiled.querySelector('.nav-buttons');
      expect(navButtons).toBeTruthy();

      const gradingsLink = navButtons?.querySelector('a[href*="gradings"]');
      expect(gradingsLink).toBeTruthy();
      expect(gradingsLink?.textContent).toContain('Gradings');
      expect(gradingsLink?.getAttribute('href')).toContain('studentMemberDocId=m123');

      const ordersLink = navButtons?.querySelector('a[href*="orders"]');
      expect(ordersLink).toBeTruthy();
      expect(ordersLink?.textContent).toContain('Orders');
      expect(ordersLink?.getAttribute('href')).toContain('searchField=email');
      expect(ordersLink?.getAttribute('href')).toContain('q=john%40example.com');

      const eventsLink = navButtons?.querySelector('a[href*="manage-events"]');
      expect(eventsLink).toBeTruthy();
      expect(eventsLink?.textContent).toContain('Events');
      expect(eventsLink?.getAttribute('href')).toContain('searchField=leadingInstructorId');
      expect(eventsLink?.getAttribute('href')).toContain('q=101');

      const materialsLink = navButtons?.querySelector('a[href*="manage-materials"]');
      expect(materialsLink).toBeTruthy();
      expect(materialsLink?.textContent).toContain('Materials');
      expect(materialsLink?.getAttribute('href')).toContain('instructorId=101');

      const studentsLink = navButtons?.querySelector('a[href*="students"]');
      expect(studentsLink).toBeTruthy();
      expect(studentsLink?.textContent).toContain('Students');

      const publicProfileLink = navButtons?.querySelector('a[href="/instructors/101"]');
      expect(publicProfileLink).toBeTruthy();
      expect(publicProfileLink?.textContent).toContain('Public Profile');

      const schoolLink = navButtons?.querySelector('a[href*="school/SCH01/members"]');
      expect(schoolLink).toBeTruthy();
      expect(schoolLink?.textContent).toContain('School');
    });

    it('should not show admin aspect links for non-admin viewing own profile', async () => {
      firebaseStateServiceMock.user.set({
        isAdmin: false,
        member: mockMember,
        schoolsManaged: [],
        firebaseUser: { email: 'test@example.com' } as User,
        memberProfiles: [],
      } as UserDetails);

      fixture.componentRef.setInput('member', mockMember);
      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const navButtons = compiled.querySelector('.nav-buttons');
      expect(navButtons).toBeNull();
    });

    it('should not show nav buttons for new member without docId', async () => {
      const newMember: Member = {
        ...initMember(),
        docId: '',
        name: 'Unsaved Member',
      };
      fixture.componentRef.setInput('member', newMember);
      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const navButtons = compiled.querySelector('.nav-buttons');
      expect(navButtons).toBeNull();
    });
  });
});
