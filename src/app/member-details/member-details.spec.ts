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
  InstructorPublicData,
} from '../../../functions/src/data-model/members';
import { InstructorLicenseType } from '../../../functions/src/data-model/curriculum';
import { School } from '../../../functions/src/data-model/schools';
import {
  VideoItem,
  VideoGrant,
  VideoSeries,
  VideoGrantKind,
  initVideoItem,
  initVideoGrant,
} from '../../../functions/src/data-model/vod';
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
      getMemberVideoGrants: vi.fn().mockResolvedValue([]),
      getVideoSeriesList: vi.fn().mockReturnValue([]),
      videos: new SearchableSet<'docId', VideoItem>(['title'], 'docId', []),
      loadingState: signal(DataServiceState.Loaded),
      members: new SearchableSet<'docId', Member>(['name'], 'docId', []),
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
        {
          provide: ROUTING_CONFIG,
          useValue: { validPathPatterns: initPathPatterns },
        },
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

  it('should not mark form dirty on load for an instructor with markdown bio editor', async () => {
    const member: Member = {
      ...initMember(),
      docId: 'g9lgrrknj0su9XdCMVAH',
      name: 'Yen Lee Chin',
      memberId: 'Family4',
      instructorId: '2',
      instructorLicenseType: InstructorLicenseType.Life,
      instructorLicenseExpires: '9999-12-31',
      country: 'United States',
      tags: ['Master'],
      publicBioMarkdown: '',
    };
    fixture.componentRef.setInput('member', member);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 600));
    fixture.detectChanges();

    expect(component.isDirty()).toBe(false);
    expect(component.form().dirty()).toBe(false);
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
    (dataManagerServiceMock.addMember as Mock).mockResolvedValue({
      id: 'new-id',
    });

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
        emails: [
          'first@example.com',
          'second@example.com',
          'third@example.com',
        ],
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
      expect(gradingsLink?.getAttribute('href')).toContain(
        'studentMemberDocId=m123',
      );

      const ordersLink = navButtons?.querySelector('a[href*="orders"]');
      expect(ordersLink).toBeTruthy();
      expect(ordersLink?.textContent).toContain('Orders');
      expect(ordersLink?.getAttribute('href')).toContain('searchField=email');
      expect(ordersLink?.getAttribute('href')).toContain(
        'q=john%40example.com',
      );

      const eventsLink = navButtons?.querySelector('a[href*="manage-events"]');
      expect(eventsLink).toBeTruthy();
      expect(eventsLink?.textContent).toContain('Events');
      expect(eventsLink?.getAttribute('href')).toContain(
        'searchField=leadingInstructorId',
      );
      expect(eventsLink?.getAttribute('href')).toContain('q=101');

      const materialsLink = navButtons?.querySelector(
        'a[href*="manage-materials"]',
      );
      expect(materialsLink).toBeTruthy();
      expect(materialsLink?.textContent).toContain('Materials');
      expect(materialsLink?.getAttribute('href')).toContain('instructorId=101');

      const studentsLink = navButtons?.querySelector('a[href*="students"]');
      expect(studentsLink).toBeTruthy();
      expect(studentsLink?.textContent).toContain('Students');

      const publicProfileLink = navButtons?.querySelector(
        'a[href="/instructors/101"]',
      );
      expect(publicProfileLink).toBeTruthy();
      expect(publicProfileLink?.textContent).toContain('Public Profile');

      const schoolLink = navButtons?.querySelector(
        'a[href*="school/SCH01/members"]',
      );
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

  describe('notes field permissions', () => {
    it('should enable notes editing for a school manager managing the member school via primarySchoolId', async () => {
      const studentMember: Member = {
        ...mockMember,
        primarySchoolId: 'SCH-01',
        primarySchoolDocId: 'school-doc-1',
      };
      firebaseStateServiceMock.user.set({
        isAdmin: false,
        member: mockMember,
        schoolsManaged: ['SCH-01'],
        firebaseUser: { email: 'manager@example.com' } as User,
        memberProfiles: [],
      } as UserDetails);

      fixture.componentRef.setInput('member', studentMember);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.userIsSchoolManagerOrAdmin()).toBe(true);
      expect(component.form.notes().disabled()).toBe(false);
    });

    it('should enable notes editing for a school manager managing the member school via primarySchoolDocId', async () => {
      const studentMember: Member = {
        ...mockMember,
        primarySchoolId: 'SCH-01',
        primarySchoolDocId: 'school-doc-1',
      };
      firebaseStateServiceMock.user.set({
        isAdmin: false,
        member: mockMember,
        schoolsManaged: ['school-doc-1'],
        firebaseUser: { email: 'manager@example.com' } as User,
        memberProfiles: [],
      } as UserDetails);

      fixture.componentRef.setInput('member', studentMember);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.userIsSchoolManagerOrAdmin()).toBe(true);
      expect(component.form.notes().disabled()).toBe(false);
    });

    it('should disable notes editing for a non-admin non-manager student viewing their own profile', async () => {
      const studentMember: Member = {
        ...mockMember,
        primarySchoolId: 'SCH-01',
        primarySchoolDocId: 'school-doc-1',
        emails: ['student@example.com'],
      };
      firebaseStateServiceMock.user.set({
        isAdmin: false,
        member: studentMember,
        schoolsManaged: [],
        firebaseUser: { email: 'student@example.com' } as User,
        memberProfiles: [],
      } as UserDetails);

      fixture.componentRef.setInput('member', studentMember);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.userIsSchoolManagerOrAdmin()).toBe(false);
      expect(component.form.notes().disabled()).toBe(true);
    });
  });

  describe('VOD Video & Series Grants grouping and unfolding', () => {
    const sampleVideo1: VideoItem = {
      ...initVideoItem(),
      docId: 'vid-1',
      title: 'Spinning Hands Part 1',
      seriesId: 'series-spin',
      seriesTitle: 'Spinning Hands Series',
      seriesPartIndex: 1,
      durationSeconds: 900, // 15 mins
      isPublished: true,
    };

    const sampleVideo2: VideoItem = {
      ...initVideoItem(),
      docId: 'vid-2',
      title: 'Spinning Hands Part 2',
      seriesId: 'series-spin',
      seriesTitle: 'Spinning Hands Series',
      seriesPartIndex: 2,
      durationSeconds: 1500, // 25 mins
      isPublished: true,
    };

    const sampleSeries: VideoSeries = {
      seriesId: 'series-spin',
      title: 'Spinning Hands Series',
      description: 'Master the art of spinning hands.',
      videoCount: 2,
      totalDurationSeconds: 2400,
      videos: [sampleVideo1, sampleVideo2],
    };

    const sampleStandaloneVideo: VideoItem = {
      ...initVideoItem(),
      docId: 'vid-standalone',
      title: 'Standalone Workshop',
      durationSeconds: 3600, // 1h
      isPublished: true,
    };

    beforeEach(() => {
      (dataManagerServiceMock.getVideoSeriesList as Mock).mockReturnValue([
        sampleSeries,
      ]);
      dataManagerServiceMock.videos.setEntries([
        sampleVideo1,
        sampleVideo2,
        sampleStandaloneVideo,
      ]);
    });

    it('should group full series grant and its constituent video grants into a single series row', () => {
      // Simulating what grantVideoAccess stores: 1 series grant + 2 video grants
      const grants: VideoGrant[] = [
        {
          ...initVideoGrant('series-spin', 'test-id'),
          grantKind: VideoGrantKind.AdminGrant,
          grantedAt: '2026-09-15T12:00:00.000Z',
          notes: 'Full series grant for student',
        },
        {
          ...initVideoGrant('vid-1', 'test-id'),
          grantKind: VideoGrantKind.AdminGrant,
          grantedAt: '2026-09-15T12:00:01.000Z',
        },
        {
          ...initVideoGrant('vid-2', 'test-id'),
          grantKind: VideoGrantKind.AdminGrant,
          grantedAt: '2026-09-15T12:00:02.000Z',
        },
      ];

      component.memberVideoGrants.set(grants);

      const grouped = component.groupedVideoGrants();
      expect(grouped.length).toBe(1);

      const seriesRow = grouped[0];
      expect(seriesRow.id).toBe('series-spin');
      expect(seriesRow.isSeries).toBe(true);
      expect(seriesRow.title).toBe('Spinning Hands Series');
      expect(seriesRow.description).toBe('Master the art of spinning hands.');
      expect(seriesRow.totalVideosCount).toBe(2);
      expect(seriesRow.grantedVideosCount).toBe(2);
      expect(seriesRow.isFullSeriesGranted).toBe(true);
      expect(seriesRow.subtitle).toBe('All 2 videos granted');
      expect(seriesRow.notes).toBe('Full series grant for student');
      expect(seriesRow.items.length).toBe(2);
      expect(seriesRow.items[0].videoId).toBe('vid-1');
      expect(seriesRow.items[0].isGranted).toBe(true);
      expect(seriesRow.items[0].partIndex).toBe(1);
      expect(seriesRow.items[1].videoId).toBe('vid-2');
      expect(seriesRow.items[1].isGranted).toBe(true);
      expect(seriesRow.items[1].partIndex).toBe(2);
    });

    it('should correctly reflect partial series grant when only one video is granted', () => {
      const grants: VideoGrant[] = [
        {
          ...initVideoGrant('vid-1', 'test-id'),
          grantKind: VideoGrantKind.AdminGrant,
          grantedAt: '2026-09-15T12:00:01.000Z',
        },
      ];

      component.memberVideoGrants.set(grants);

      const grouped = component.groupedVideoGrants();
      expect(grouped.length).toBe(1);

      const seriesRow = grouped[0];
      expect(seriesRow.id).toBe('series-spin');
      expect(seriesRow.isSeries).toBe(true);
      expect(seriesRow.totalVideosCount).toBe(2);
      expect(seriesRow.grantedVideosCount).toBe(1);
      expect(seriesRow.isFullSeriesGranted).toBe(false);
      expect(seriesRow.subtitle).toBe('1 of 2 videos granted');

      expect(seriesRow.items.length).toBe(2);
      const item1 = seriesRow.items.find((i) => i.videoId === 'vid-1');
      const item2 = seriesRow.items.find((i) => i.videoId === 'vid-2');
      expect(item1?.isGranted).toBe(true);
      expect(item2?.isGranted).toBe(false);
    });

    it('should list standalone video grant as an individual video row', () => {
      const grants: VideoGrant[] = [
        {
          ...initVideoGrant('vid-standalone', 'test-id'),
          grantKind: VideoGrantKind.StripePurchase,
          grantedAt: '2026-09-14T10:00:00.000Z',
        },
      ];

      component.memberVideoGrants.set(grants);

      const grouped = component.groupedVideoGrants();
      expect(grouped.length).toBe(1);

      const row = grouped[0];
      expect(row.id).toBe('vid-standalone');
      expect(row.isSeries).toBe(false);
      expect(row.title).toBe('Standalone Workshop');
      expect(row.totalVideosCount).toBe(1);
      expect(row.grantedVideosCount).toBe(1);
      expect(row.isFullSeriesGranted).toBe(true);
      expect(row.subtitle).toBe('Single Video');
    });

    it('should handle uncataloged target ID grants gracefully', () => {
      const grants: VideoGrant[] = [
        {
          ...initVideoGrant('unknown-id-123', 'test-id'),
          grantKind: VideoGrantKind.AdminGrant,
          grantedAt: '2026-09-10T00:00:00.000Z',
        },
      ];

      component.memberVideoGrants.set(grants);

      const grouped = component.groupedVideoGrants();
      expect(grouped.length).toBe(1);
      expect(grouped[0].id).toBe('unknown-id-123');
      expect(grouped[0].isSeries).toBe(false);
      expect(grouped[0].title).toBe('unknown-id-123');
      expect(grouped[0].subtitle).toBe('Target ID Grant');
    });

    it('should toggle series fold and support expandAll and collapseAll', () => {
      component.memberVideoGrants.set([
        initVideoGrant('series-spin', 'test-id'),
        initVideoGrant('vid-standalone', 'test-id'),
      ]);

      expect(component.isSeriesExpanded('series-spin')).toBe(false);

      component.toggleSeriesFold('series-spin');
      expect(component.isSeriesExpanded('series-spin')).toBe(true);

      component.toggleSeriesFold('series-spin');
      expect(component.isSeriesExpanded('series-spin')).toBe(false);

      component.expandAllSeries();
      expect(component.isSeriesExpanded('series-spin')).toBe(true);
      expect(component.isSeriesExpanded('vid-standalone')).toBe(true);

      component.collapseAllSeries();
      expect(component.isSeriesExpanded('series-spin')).toBe(false);
      expect(component.isSeriesExpanded('vid-standalone')).toBe(false);
    });

    it('should format durations correctly', () => {
      expect(component.formatDuration(0)).toBe('0 min');
      expect(component.formatDuration(45)).toBe('45s');
      expect(component.formatDuration(900)).toBe('15m');
      expect(component.formatDuration(3600)).toBe('1h');
      expect(component.formatDuration(5400)).toBe('1h 30m');
    });

    it('should render series row in DOM and unfold constituent videos on click', async () => {
      const grants: VideoGrant[] = [
        {
          ...initVideoGrant('series-spin', 'test-id'),
          grantKind: VideoGrantKind.AdminGrant,
          grantedAt: '2026-09-15T12:00:00.000Z',
          notes: 'Full series granted',
        },
        {
          ...initVideoGrant('vid-1', 'test-id'),
          grantKind: VideoGrantKind.AdminGrant,
          grantedAt: '2026-09-15T12:00:01.000Z',
        },
        {
          ...initVideoGrant('vid-2', 'test-id'),
          grantKind: VideoGrantKind.AdminGrant,
          grantedAt: '2026-09-15T12:00:02.000Z',
        },
      ];

      component.memberVideoGrants.set(grants);
      fixture.detectChanges();
      await fixture.whenStable();

      const el = fixture.nativeElement as HTMLElement;
      const seriesRow = el.querySelector('.series-row');
      expect(seriesRow).toBeTruthy();
      expect(seriesRow?.textContent).toContain('Spinning Hands Series');
      expect(seriesRow?.textContent).toContain('All 2 videos granted');

      // Before unfolding, nested table should not exist
      expect(el.querySelector('.nested-videos-table')).toBeNull();

      // Click row to unfold
      (seriesRow as HTMLElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      // Now nested table should exist and show both videos
      const nestedTable = el.querySelector('.nested-videos-table');
      expect(nestedTable).toBeTruthy();
      const videoRows = nestedTable?.querySelectorAll('.nested-video-row');
      expect(videoRows?.length).toBe(2);
      expect(nestedTable?.textContent).toContain('Spinning Hands Part 1');
      expect(nestedTable?.textContent).toContain('Spinning Hands Part 2');
      expect(nestedTable?.textContent).toContain('15m');
      expect(nestedTable?.textContent).toContain('25m');
    });
  });
});
