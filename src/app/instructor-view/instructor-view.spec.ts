import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { vi } from 'vitest';
import { InstructorViewComponent } from './instructor-view';
import { FindInstructorsService } from '../find-instructors.service';
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

describe('InstructorViewComponent', () => {
  let component: InstructorViewComponent;
  let fixture: ComponentFixture<InstructorViewComponent>;
  let mockFindInstructorsService: { instructors: SearchableSet<'instructorId', InstructorPublicData> };
  let mockDataManagerService: Partial<DataManagerService>;
  let firebaseStateMock: ReturnType<typeof createFirebaseStateServiceMock>;
  let mockHrefForView: ReturnType<typeof vi.fn>;

  const instructor: InstructorPublicData = {
    ...initInstructor(),
    docId: 'member-doc-1',
    memberId: 'MEM-101',
    instructorId: 'I-101',
    name: 'Test Instructor',
    publicBioMarkdown: 'I train for **health**.',
    country: 'Malaysia',
  };

  beforeEach(async () => {
    mockFindInstructorsService = {
      instructors: new SearchableSet(['instructorId'], 'instructorId', [instructor]),
    };

    mockDataManagerService = {
      getUpcomingEventsForInstructor: vi.fn().mockResolvedValue([]),
      getSchoolsForInstructor: vi.fn().mockResolvedValue([]),
    };

    firebaseStateMock = createFirebaseStateServiceMock();
    mockHrefForView = vi.fn((view: Views, pathVars?: Record<string, string>) => {
      if (view === Views.MyProfile) {
        return '/myProfile';
      }
      if (view === Views.ManageMemberView) {
        return `/members/${pathVars?.['memberId']}`;
      }
      return '#';
    });

    await TestBed.configureTestingModule({
      imports: [InstructorViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNavigationTreeStub(),
        { provide: FindInstructorsService, useValue: mockFindInstructorsService },
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

    fixture = TestBed.createComponent(InstructorViewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('instructorId', 'I-101');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load the instructor from the find service and emit the title', async () => {
    const titleSpy = vi.spyOn(component.titleLoaded, 'emit');
    await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
    expect(component.instructor()?.name).toBe('Test Instructor');
    expect(titleSpy).toHaveBeenCalledWith('Test Instructor');
    expect(mockDataManagerService.getUpcomingEventsForInstructor).toHaveBeenCalledWith('I-101', 'member-doc-1');
  });

  it('should build a location line from public location fields', async () => {
    await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
    expect(component.locationLine()).toBe('Malaysia');
  });

  it('should surface upcoming events returned by the data service', async () => {
    const event: IlcEvent = { ...initEvent(), docId: 'ev-1', title: 'Workshop', status: EventStatus.Listed };
    (mockDataManagerService.getUpcomingEventsForInstructor as ReturnType<typeof vi.fn>).mockResolvedValue([event]);
    await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
    expect(component.upcomingEvents().length).toBe(1);
    expect(component.upcomingEvents()[0].title).toBe('Workshop');
  });

  it('should surface schools the instructor owns or manages', async () => {
    const school: School = { ...initSchool(), docId: 's-1', schoolId: 'SCH-1', schoolName: 'Test School' };
    (mockDataManagerService.getSchoolsForInstructor as ReturnType<typeof vi.fn>).mockResolvedValue([school]);
    await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
    expect(mockDataManagerService.getSchoolsForInstructor).toHaveBeenCalledWith('I-101');
    expect(component.schools().length).toBe(1);
    expect(component.schools()[0].schoolName).toBe('Test School');
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

    it('hides the 3-dots menu for logged-out visitors and other instructors', async () => {
      await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.profile-menu-trigger')).toBeNull();

      firebaseStateMock.user.set(makeUser({ docId: 'member-other', instructorId: 'I-999' }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.profile-menu-trigger')).toBeNull();
    });

    it('shows the 3-dots menu when viewing own instructor profile and links to MyProfile', async () => {
      await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
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
      expect(editLink!.textContent).toContain('Edit instructor profile');
      expect(editLink!.getAttribute('href')).toBe('/myProfile');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.profile-actions-menu')).toBeNull();
    });

    it('shows the 3-dots menu for an admin viewing another instructor and links to ManageMemberView', async () => {
      await (component as unknown as { loadInstructor: () => Promise<void> }).loadInstructor();
      firebaseStateMock.user.set(makeUser({ isAdmin: true, docId: 'admin-doc', instructorId: 'I-999' }));
      fixture.detectChanges();

      const trigger: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('.profile-menu-trigger');
      expect(trigger).toBeTruthy();

      trigger!.click();
      fixture.detectChanges();

      const editLink: HTMLAnchorElement | null =
        fixture.nativeElement.querySelector('.profile-actions-menu a.menu-item');
      expect(editLink).toBeTruthy();
      expect(editLink!.getAttribute('href')).toBe('/members/MEM-101');
    });
  });
});
