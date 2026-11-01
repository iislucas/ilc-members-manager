import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { vi } from 'vitest';
import { SchoolViewComponent } from './school-view';
import { DataManagerService } from '../data-manager.service';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
  UserDetails,
} from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, AppPathPatterns, Views } from '../app.config';
import { SearchableSet } from '../searchable-set';
import { provideNavigationTreeStub } from '../navigation-tree.testing';
import { IlcEvent, initEvent, EventStatus } from '../../../functions/src/data-model/events';
import { InstructorPublicData, initInstructor, initMember } from '../../../functions/src/data-model/members';
import { School, initSchool } from '../../../functions/src/data-model/schools';
import { User } from 'firebase/auth';

// Mock firebase/firestore so the direct-fetch fallback and getFirestore are inert.
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ empty: true }),
}));

describe('SchoolViewComponent', () => {
  let component: SchoolViewComponent;
  let fixture: ComponentFixture<SchoolViewComponent>;
  let mockGetEventsForSchool: ReturnType<typeof vi.fn>;
  let firebaseStateMock: ReturnType<typeof createFirebaseStateServiceMock>;
  let mockHrefForView: ReturnType<typeof vi.fn>;

  const owner: InstructorPublicData = {
    ...initInstructor(),
    docId: 'member-doc-1',
    instructorId: 'I-101',
    name: 'Owner Person',
  };
  const manager: InstructorPublicData = {
    ...initInstructor(),
    docId: 'member-doc-2',
    instructorId: 'I-202',
    name: 'Manager Person',
  };
  const school: School = {
    ...initSchool(),
    docId: 's-1',
    schoolId: 'SCH-1',
    schoolName: 'Test School',
    schoolCity: 'Kuala Lumpur',
    schoolCountry: 'Malaysia',
    ownerInstructorId: 'I-101',
    managerInstructorIds: ['I-202'],
    publicBioMarkdown: 'A great school.',
  };

  beforeEach(async () => {
    mockGetEventsForSchool = vi.fn().mockResolvedValue({ upcoming: [], past: [], pastTotal: 0 });
    const mockDataManagerService: Partial<DataManagerService> = {
      schools: new SearchableSet(['schoolId'], 'schoolId', [school]),
      instructors: new SearchableSet(['instructorId'], 'instructorId', [owner, manager]),
      getEventsForSchool: mockGetEventsForSchool as never,
    };

    firebaseStateMock = createFirebaseStateServiceMock();
    mockHrefForView = vi.fn((view: Views, pathVars?: Record<string, string>) => {
      if (view === Views.MySchoolEdit) {
        return `/my-schools/${pathVars?.['schoolId']}/edit`;
      }
      if (view === Views.ManageSchoolEdit) {
        return `/schools/${pathVars?.['schoolId']}/edit`;
      }
      return '#';
    });

    await TestBed.configureTestingModule({
      imports: [SchoolViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNavigationTreeStub(),
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: FirebaseStateService, useValue: firebaseStateMock },
        { provide: FIREBASE_APP, useValue: {} },
        {
          provide: RoutingService,
          useValue: {
            hrefForView: mockHrefForView,
          } as unknown as RoutingService<AppPathPatterns>,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SchoolViewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('schoolId', 'SCH-1');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load the school and emit the title', async () => {
    const titleSpy = vi.spyOn(component.titleLoaded, 'emit');
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    expect(component.school()?.schoolName).toBe('Test School');
    expect(titleSpy).toHaveBeenCalledWith('Test School');
  });

  it('should build a location line from the school location fields', async () => {
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    expect(component.locationLine()).toBe('Kuala Lumpur, Malaysia');
  });

  it('should resolve the owner to their public instructor data', async () => {
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    expect(component.owner()?.name).toBe('Owner Person');
  });

  it('should resolve managers, excluding the owner', async () => {
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    const managers = component.managers();
    expect(managers.length).toBe(1);
    expect(managers[0].instructor?.name).toBe('Manager Person');
  });

  it('should surface upcoming and past events for the school', async () => {
    const upcoming: IlcEvent = { ...initEvent(), docId: 'ev-up', title: 'Future Workshop', status: EventStatus.Listed };
    const past: IlcEvent = { ...initEvent(), docId: 'ev-past', title: 'Old Workshop', status: EventStatus.Listed };
    (mockGetEventsForSchool).mockResolvedValue({ upcoming: [upcoming], past: [past], pastTotal: 7 });
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    expect(mockGetEventsForSchool).toHaveBeenCalledWith('SCH-1');
    expect(component.upcomingEvents().length).toBe(1);
    expect(component.pastEvents().length).toBe(1);
    expect(component.pastEventsTotal()).toBe(7);
    expect(component.allEventsHref()).toBe('/events?schoolId=SCH-1');

    fixture.detectChanges();
    const showMoreLinks: HTMLAnchorElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('a.show-more-link'),
    );
    const seeAllLink = showMoreLinks.find((a) =>
      a.textContent?.includes('See all events'),
    );
    expect(seeAllLink).toBeTruthy();
    expect(seeAllLink?.getAttribute('href')).toBe('/events?schoolId=SCH-1');
  });

  it('renders Class Calendar link when schoolClassGoogleCalendarId is configured and omits it when empty', async () => {
    await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
    fixture.detectChanges();
    expect(component.classCalendarHref()).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('Class Calendar');

    component.school.set({
      ...school,
      schoolClassGoogleCalendarId: 'school-cal@group.calendar.google.com',
    });
    fixture.detectChanges();

    expect(component.classCalendarHref()).toBe('/calendar/school/SCH-1');
    const calendarLink: HTMLAnchorElement | undefined = Array.from<HTMLAnchorElement>(
      fixture.nativeElement.querySelectorAll('a.contact-link'),
    ).find((a) => a.textContent?.includes('Class Calendar'));
    expect(calendarLink).toBeTruthy();
    expect(calendarLink?.getAttribute('href')).toBe('/calendar/school/SCH-1');
  });

  describe('profile options menu', () => {
    function makeUser(overrides: Partial<UserDetails> & { docId?: string; instructorId?: string }): UserDetails {
      const member = {
        ...initMember(),
        docId: overrides.docId ?? 'member-other',
        instructorId: overrides.instructorId ?? '',
      };
      return {
        isAdmin: overrides.isAdmin ?? false,
        member,
        schoolsManaged: overrides.schoolsManaged ?? [],
        firebaseUser: { email: 'user@example.com' } as User,
        memberProfiles: overrides.memberProfiles ?? [member],
      };
    }

    it('hides the 3-dots menu for logged-out visitors and unrelated members', async () => {
      await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.profile-menu-trigger')).toBeNull();

      firebaseStateMock.user.set(makeUser({ docId: 'member-other', instructorId: 'I-999' }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.profile-menu-trigger')).toBeNull();
    });

    it('shows the 3-dots menu for the school owner and links to MySchoolEdit', async () => {
      await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
      firebaseStateMock.user.set(makeUser({ docId: 'member-doc-1', instructorId: 'I-101' }));
      fixture.detectChanges();

      const trigger: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('.profile-menu-trigger');
      expect(trigger).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.profile-actions-menu')).toBeNull();

      trigger!.click();
      fixture.detectChanges();

      const editLink: HTMLAnchorElement | null =
        fixture.nativeElement.querySelector('.profile-actions-menu a.menu-item');
      expect(editLink).toBeTruthy();
      expect(editLink!.textContent).toContain('Edit school profile');
      expect(editLink!.getAttribute('href')).toBe('/my-schools/SCH-1/edit');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.profile-actions-menu')).toBeNull();
    });

    it('shows the 3-dots menu when owned via ownerMemberDocId without instructorId', async () => {
      await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
      component.school.set({
        ...school,
        ownerInstructorId: '',
        ownerMemberDocId: 'buyer-doc-1',
      });
      firebaseStateMock.user.set(makeUser({ docId: 'buyer-doc-1', instructorId: '' }));
      fixture.detectChanges();

      expect(component.editSchoolHref()).toBe('/my-schools/SCH-1/edit');
      expect(fixture.nativeElement.querySelector('.profile-menu-trigger')).toBeTruthy();
    });

    it('shows the 3-dots menu for an admin and links to ManageSchoolEdit', async () => {
      await (component as unknown as { loadSchool: () => Promise<void> }).loadSchool();
      firebaseStateMock.user.set(makeUser({ isAdmin: true, docId: 'admin-doc', instructorId: '' }));
      fixture.detectChanges();

      const trigger: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('.profile-menu-trigger');
      expect(trigger).toBeTruthy();

      trigger!.click();
      fixture.detectChanges();

      const editLink: HTMLAnchorElement | null =
        fixture.nativeElement.querySelector('.profile-actions-menu a.menu-item');
      expect(editLink).toBeTruthy();
      expect(editLink!.getAttribute('href')).toBe('/schools/SCH-1/edit');
    });
  });
});
