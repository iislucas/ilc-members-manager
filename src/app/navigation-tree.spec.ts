/*
The navigation tree is what keeps the header breadcrumbs and the in-page "Back
to ..." links in step: the trail is the ancestors plus the current page, and the
back link is the last ancestor. These tests pin the shape of the tree, and the
invariant that the two views of it agree.
*/
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { NavigationTreeService } from './navigation-tree';
import { RoutingService } from './routing.service';
import { DataManagerService } from './data-manager.service';
import { FirebaseStateService, UserDetails } from './firebase-state.service';
import { FindInstructorsService } from './find-instructors.service';
import { ROUTING_CONFIG, Views, initPathPatterns, AppPathPatterns } from './app.config';

function searchableSetStub(entries: unknown[] = []) {
  return {
    entries: signal(entries),
    loading: signal(false),
    loaded: signal(true),
    get: (id: string) =>
      entries.find(
        (e) => (e as { docId?: string; schoolId?: string }).docId === id,
      ),
  };
}

describe('NavigationTreeService', () => {
  let navTree: NavigationTreeService;
  let routing: RoutingService<AppPathPatterns>;
  let user: ReturnType<typeof signal<Partial<UserDetails> | null>>;

  const school = { docId: 'schoolDoc1', schoolId: 'PARIS', schoolName: 'Paris ILC' };
  const instructor = { instructorId: 'I7', name: 'Sifu Chin', memberId: 'M9' };
  const episode = { docId: 'vid_ep1', title: 'Spacing Part 1', seriesId: 'series_spacing' };
  const standaloneVideo = { docId: 'vid_solo', title: 'Solo Drill' };
  const spacingSeries = {
    seriesId: 'series_spacing',
    title: 'Understanding Spacing',
    videos: [episode, { docId: 'vid_ep2', title: 'Spacing Part 2', seriesId: 'series_spacing' }],
  };

  beforeEach(async () => {
    window.history.replaceState(null, '', '/');
    user = signal<Partial<UserDetails> | null>({
      isAdmin: true,
      schoolsManaged: [],
      memberProfiles: [],
      member: { memberId: 'M1', name: 'Test Member' },
    } as unknown as Partial<UserDetails>);

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        {
          provide: DataManagerService,
          useValue: {
            schools: searchableSetStub([school]),
            members: searchableSetStub(),
            instructors: {
              ...searchableSetStub([instructor]),
              get: (id: string) => (id === instructor.instructorId ? instructor : undefined),
            },
            myStudents: searchableSetStub(),
            gradings: searchableSetStub(),
            myGradings: searchableSetStub(),
            myGradingsAssessed: searchableSetStub(),
            getMember: () => undefined,
            getMyStudent: () => undefined,
            videos: searchableSetStub([episode, standaloneVideo]),
            getVideoSeriesList: () => [spacingSeries],
          },
        },
        { provide: FirebaseStateService, useValue: { user } },
        { provide: FindInstructorsService, useValue: { instructors: searchableSetStub() } },
      ],
    }).compileComponents();

    routing = TestBed.inject(RoutingService);
    navTree = TestBed.inject(NavigationTreeService);
  });

  /** Point the router at `view`, with the given path variables. */
  function goTo(view: Views, pathVars: { [key: string]: string } = {}) {
    routing.matchedPatternId.set(view);
    const signals = routing.signals[view] as unknown as {
      pathVars: { [key: string]: { set(v: string): void } };
    };
    for (const [key, value] of Object.entries(pathVars)) {
      signals.pathVars[key].set(value);
    }
  }

  function ancestorLabels(): string[] {
    return navTree.ancestors().map((a) => a.label);
  }

  function breadcrumbLabels(): string[] {
    return navTree.breadcrumbs().map((c) => c.label);
  }

  it('gives a top-level page its area node as parent', () => {
    goTo(Views.ManageMembers);
    expect(navTree.ancestors()).toEqual([{ label: 'Admin', url: '/?tab=admin' }]);
    expect(navTree.parent()?.url).toBe('/?tab=admin');
  });

  it('puts an event under its list, and the event editor under the event', () => {
    goTo(Views.EventView, { eventId: 'E1' });
    expect(ancestorLabels()).toEqual(['Train', 'Events & Workshops']);

    navTree.loadedEventTitle.set('Summer Camp');
    goTo(Views.EventEdit, { eventId: 'E1' });
    expect(ancestorLabels()).toEqual(['Train', 'Events & Workshops', 'Summer Camp']);
    expect(navTree.parent()?.url).toBe('/events/E1');
  });

  it('keeps each events subtree separate', () => {
    navTree.loadedEventTitle.set('Summer Camp');
    goTo(Views.ManageEventEdit, { eventId: 'E1' });
    expect(ancestorLabels()).toEqual(['Admin', 'Events', 'Summer Camp']);
    expect(navTree.parent()?.url).toBe('/manage-events/E1');

    goTo(Views.MyEventEdit, { eventId: 'E1' });
    expect(ancestorLabels()).toEqual(['Me', 'Events', 'Summer Camp']);
    expect(navTree.parent()?.url).toBe('/my-events/E1');
  });

  it('puts a class calendar under the instructor whose calendar it is', () => {
    goTo(Views.ClassCalendarView, { instructorId: 'I7' });
    expect(navTree.parent()?.url).toBe('/instructors/I7');
    expect(ancestorLabels()).toEqual(['Train', 'Instructors', 'I7']);
  });

  it('puts notification settings under Me in the navigation tree', () => {
    goTo(Views.UserNotificationSettings);
    expect(ancestorLabels()).toEqual(['Me']);
    expect(navTree.parent()?.url).toBe('/?tab=me');
    expect(breadcrumbLabels()).toEqual(['ILC Portal', 'Me', 'Notification Settings']);
  });

  it('puts app notification settings under Admin in the navigation tree', () => {
    goTo(Views.AppNotificationSettings);
    expect(ancestorLabels()).toEqual(['Admin']);
    expect(navTree.parent()?.url).toBe('/?tab=admin');
    expect(breadcrumbLabels()).toEqual(['ILC Portal', 'Admin', 'App Notification Settings']);
  });

  it('puts notifications under Me in the navigation tree', () => {
    goTo(Views.Notifications);
    expect(ancestorLabels()).toEqual(['Me']);
    expect(navTree.parent()?.url).toBe('/?tab=me');
    expect(breadcrumbLabels()).toEqual(['ILC Portal', 'Me', 'Notifications']);
  });

  it('puts Manage VOD Upload under Admin and Manage VOD in the navigation tree', () => {
    goTo(Views.ManageVodUpload);
    expect(ancestorLabels()).toEqual(['Admin', 'Manage VOD']);
    expect(navTree.parent()?.url).toBe('/manage-vod');
    expect(breadcrumbLabels()).toEqual(['ILC Portal', 'Admin', 'Manage VOD', 'Upload VOD & Series']);
    expect(navTree.currentTitle()).toBe('Upload VOD & Series');
  });

  it('titles a series admin page with the series title, under Manage VOD', () => {
    goTo(Views.ManageVodSeries, { seriesId: 'series_spacing' });
    expect(ancestorLabels()).toEqual(['Admin', 'Manage VOD']);
    expect(navTree.currentTitle()).toBe('Understanding Spacing');
  });

  it('puts an episode admin page under its series page', () => {
    goTo(Views.ManageVodVideo, { videoId: 'vid_ep1' });
    expect(ancestorLabels()).toEqual(['Admin', 'Manage VOD', 'Understanding Spacing']);
    expect(navTree.parent()?.url).toContain('/manage-vod/series/series_spacing');
    expect(navTree.currentTitle()).toBe('Spacing Part 1');
  });

  it('puts a standalone video admin page directly under Manage VOD', () => {
    goTo(Views.ManageVodVideo, { videoId: 'vid_solo' });
    expect(ancestorLabels()).toEqual(['Admin', 'Manage VOD']);
    expect(navTree.currentTitle()).toBe('Solo Drill');
  });

  it('falls back to generic titles when the video or series is not loaded', () => {
    goTo(Views.ManageVodVideo, { videoId: 'unknown' });
    expect(navTree.currentTitle()).toBe('Video');
    goTo(Views.ManageVodSeries, { seriesId: 'unknown' });
    expect(navTree.currentTitle()).toBe('Series');
  });

  it('links a member back to their list, scrolled to their row', () => {
    goTo(Views.ManageMemberView, { memberId: 'M42' });
    expect(navTree.parent()?.url).toBe('/members?jumpTo=M42');
  });

  it('builds the school chain for a school member list', () => {
    goTo(Views.SchoolMembers, { schoolId: 'PARIS' });
    expect(ancestorLabels()).toEqual(['Admin', 'Schools', 'Paris ILC (PARIS)']);
    expect(navTree.parent()?.url).toBe('/schools/schoolDoc1/edit');
  });

  it('routes a school manager through Schools rather than Manage Schools', () => {
    user.set({
      isAdmin: false,
      schoolsManaged: ['PARIS'],
      memberProfiles: [],
      member: { memberId: 'M1', name: 'Test Member' },
    } as unknown as Partial<UserDetails>);
    goTo(Views.SchoolMembers, { schoolId: 'PARIS' });
    expect(ancestorLabels()).toEqual(['Me', 'Schools', 'Paris ILC (PARIS)']);
    expect(navTree.parent()?.url).toBe('/my-schools/schoolDoc1/edit');
  });

  it('builds the instructor chain for a student list', () => {
    goTo(Views.InstructorStudents, { instructorId: 'I7' });
    expect(ancestorLabels()).toEqual(['Admin', 'Members', 'Sifu Chin [I7]']);
    expect(navTree.parent()?.url).toBe('/members/M9');
  });

  it('sends a non-admin viewing a grading back to Gradings', () => {
    user.set({
      isAdmin: false,
      schoolsManaged: [],
      memberProfiles: [],
      member: { memberId: 'M1', name: 'Test Member' },
    } as unknown as Partial<UserDetails>);
    goTo(Views.GradingView, { gradingId: 'G1' });
    expect(navTree.parent()?.url).toBe('/my-gradings');
  });

  it('sends an admin browsing the global list back to Gradings', () => {
    goTo(Views.GradingView, { gradingId: 'G1' });
    expect(navTree.parent()?.url).toBe('/gradings');
  });

  it('honours ?from=my-gradings for an admin', () => {
    goTo(Views.GradingView, { gradingId: 'G1' });
    routing.signals[Views.GradingView].urlParams.from.set('my-gradings');
    expect(navTree.parent()?.url).toBe('/my-gradings');
  });

  it('carries the parent list state into the link back up', () => {
    routing.signals[Views.ManageMembers].urlParams.q.set('chin');
    goTo(Views.ManageMemberView, { memberId: 'M42' });
    const url = navTree.parent()!.url;
    expect(url).toContain('q=chin');
    expect(url).toContain('jumpTo=M42');
  });

  it('ends the breadcrumb trail with the current page, after the ancestors', () => {
    navTree.loadedEventTitle.set('Summer Camp');
    goTo(Views.EventEdit, { eventId: 'E1' });
    const crumbs = navTree.breadcrumbs();
    expect(crumbs.map((c) => c.label)).toEqual([
      'ILC Portal',
      'Train',
      'Events & Workshops',
      'Summer Camp',
      'Edit: Summer Camp',
    ]);
    // The back link is the crumb just before the current page — the invariant
    // this whole service exists to hold.
    expect(navTree.parent()!.label).toBe(crumbs[crumbs.length - 2].label);
  });

  it('updates breadcrumbs and title for tab-paths on Home', () => {
    goTo(Views.Home);
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Read & Watch',
    ]);
    expect(navTree.currentTitle()).toBe('Read & Watch');

    routing.signals[Views.Home].urlParams.tab.set('practice');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Train',
    ]);
    expect(navTree.currentTitle()).toBe('Train');

    routing.signals[Views.Home].urlParams.tab.set('me');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Me',
    ]);
    expect(navTree.currentTitle()).toBe('Me');

    routing.signals[Views.Home].urlParams.tab.set('admin');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Admin',
    ]);
    expect(navTree.currentTitle()).toBe('Admin');
  });

  it('updates breadcrumbs and title for tab-paths on Settings', () => {
    goTo(Views.Settings);
    expect(breadcrumbLabels()).toEqual(['ILC Portal', 'Admin', 'Settings']);
    expect(navTree.currentTitle()).toBe('Settings');

    routing.signals[Views.Settings].urlParams.tab.set('backups');
    expect(breadcrumbLabels()).toEqual(['ILC Portal', 'Admin', 'Settings', 'Backups']);
    expect(navTree.currentTitle()).toBe('Backups');
    expect(navTree.parent()?.url).toBe('/settings');
  });

  it('updates breadcrumbs and title for tab-paths on Import/Export', () => {
    goTo(Views.ImportExport);
    expect(breadcrumbLabels()).toEqual(['ILC Portal', 'Admin', 'Import/Export']);

    routing.signals[Views.ImportExport].urlParams.tab.set('schools');
    expect(breadcrumbLabels()).toEqual(['ILC Portal', 'Admin', 'Import/Export', 'Schools']);
    expect(navTree.currentTitle()).toBe('Schools');
    expect(navTree.parent()?.url).toBe('/import-export');
  });

  it('identifies Home view as isHome, and sub-pages as not isHome', () => {
    goTo(Views.Home);
    expect(navTree.isHome()).toBe(true);
    expect(navTree.upNode()).toBeNull();

    goTo(Views.ManageMembers);
    expect(navTree.isHome()).toBe(false);
    expect(navTree.upNode()).toEqual({ label: 'Admin', url: '/?tab=admin' });

    navTree.loadedEventTitle.set('Summer Camp');
    goTo(Views.EventEdit, { eventId: 'E1' });
    expect(navTree.isHome()).toBe(false);
    expect(navTree.upNode()).toEqual({ label: 'Summer Camp', url: '/events/E1' });
  });

  it('shows Page Not Found breadcrumb and title when route does not match any view', () => {
    routing.matchedPatternId.set(null);
    expect(navTree.currentTitle()).toBe('Page Not Found');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Page Not Found',
    ]);
  });

  it('puts Organise or List an Event under Events in the navigation tree', () => {
    goTo(Views.ProposeEvent);
    expect(navTree.currentTitle()).toBe('Organise or List an Event');
    expect(ancestorLabels()).toEqual(['Me', 'Events']);
    expect(navTree.parent()?.url).toBe('/my-events');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Me',
      'Events',
      'Organise or List an Event',
    ]);
  });

  it('does not set currentTitleIsLoading to true on restricted pages when user is logged out', () => {
    // User is logged out
    user.set(null);
    goTo(Views.MySchoolEdit, { schoolId: 'schoolDoc1' });

    // Before login, restricted page title should not be in loading state
    expect(navTree.currentTitleIsLoading()).toBe(false);
    expect(navTree.currentTitle()).toBe('School');
    const crumbs = navTree.breadcrumbs();
    const lastCrumb = crumbs[crumbs.length - 1];
    expect(lastCrumb.label).toBe('School');
    expect(lastCrumb.isLoading).toBe(false);
  });

  it('sets currentTitleIsLoading to true on restricted pages only after user logs in, until title arrives', () => {
    // 1. Logged out: not loading, shows generic title
    user.set(null);
    goTo(Views.MySchoolEdit, { schoolId: 'schoolDoc1' });
    expect(navTree.currentTitleIsLoading()).toBe(false);

    // 2. User logs in: now it enters loading state while school record is being fetched
    user.set({
      isAdmin: true,
      schoolsManaged: [],
      memberProfiles: [],
      member: { memberId: 'M1', name: 'Test Member' },
    } as unknown as Partial<UserDetails>);
    expect(navTree.currentTitleIsLoading()).toBe(true);
    let crumbs = navTree.breadcrumbs();
    expect(crumbs[crumbs.length - 1].isLoading).toBe(true);

    // 3. Title arrives: loading state finishes and title is displayed
    navTree.loadedSchoolTitle.set('Paris ILC');
    expect(navTree.currentTitleIsLoading()).toBe(false);
    expect(navTree.currentTitle()).toBe('Paris ILC');
    crumbs = navTree.breadcrumbs();
    expect(crumbs[crumbs.length - 1].label).toBe('Paris ILC');
    expect(crumbs[crumbs.length - 1].isLoading).toBe(false);
  });

  it('sets currentTitleIsLoading to true on public pages even when logged out', () => {
    // User is logged out, but page is public (EventView)
    user.set(null);
    goTo(Views.EventView, { eventId: 'E1' });

    expect(navTree.currentTitleIsLoading()).toBe(true);
    let crumbs = navTree.breadcrumbs();
    expect(crumbs[crumbs.length - 1].isLoading).toBe(true);

    // Title arrives
    navTree.loadedEventTitle.set('Summer Camp');
    expect(navTree.currentTitleIsLoading()).toBe(false);
    expect(navTree.currentTitle()).toBe('Summer Camp');
    crumbs = navTree.breadcrumbs();
    expect(crumbs[crumbs.length - 1].label).toBe('Summer Camp');
    expect(crumbs[crumbs.length - 1].isLoading).toBe(false);
  });

  it('updates VideoView breadcrumb and title when video title loads', () => {
    user.set(null);
    goTo(Views.VideoView, { videoId: 'v100' });

    expect(navTree.currentTitleIsLoading()).toBe(true);
    expect(navTree.currentTitle()).toBe('Watch Video');

    navTree.loadedVideoTitle.set('Mastering Zhong Xin Dao');
    expect(navTree.currentTitleIsLoading()).toBe(false);
    expect(navTree.currentTitle()).toBe('Mastering Zhong Xin Dao');
    const crumbs = navTree.breadcrumbs();
    expect(crumbs[crumbs.length - 1].label).toBe('Mastering Zhong Xin Dao');
  });

  it('titles Home and Login as Welcome when logged out', () => {
    user.set(null);
    const appRoot = {
      label: 'ILC Portal',
      shortLabel: 'ILC Portal',
      url: '/',
    };
    goTo(Views.Home);
    expect(navTree.currentTitle()).toBe('Welcome');
    expect(navTree.breadcrumbs()).toEqual([appRoot, { label: 'Welcome' }]);

    goTo(Views.Login);
    expect(navTree.currentTitle()).toBe('Welcome');
    expect(navTree.breadcrumbs()).toEqual([appRoot, { label: 'Welcome' }]);
  });

  it('places subscription and order pages under Me > Orders in the navigation tree', () => {
    // 1. Class Video Library Subscription
    goTo(Views.ClassVideoLibraryPurchase);
    expect(navTree.currentTitle()).toBe('Class Video Library Subscription');
    expect(ancestorLabels()).toEqual(['Me', 'Orders']);
    expect(navTree.parent()?.url).toBe('/my-orders');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Me',
      'Orders',
      'Class Video Library Subscription',
    ]);

    // 2. Become a Member
    goTo(Views.BecomeAMember);
    expect(navTree.currentTitle()).toBe('Become a Member');
    expect(ancestorLabels()).toEqual(['Me', 'Orders']);
    expect(navTree.parent()?.url).toBe('/my-orders');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Me',
      'Orders',
      'Become a Member',
    ]);

    // 3. Instructor & Group Leader License
    goTo(Views.InstructorLicensePurchase);
    expect(navTree.currentTitle()).toBe('Instructor & Group Leader License');
    expect(ancestorLabels()).toEqual(['Me', 'Orders']);
    expect(navTree.parent()?.url).toBe('/my-orders');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Me',
      'Orders',
      'Instructor & Group Leader License',
    ]);

    // 4. School License
    goTo(Views.SchoolLicensePurchase);
    expect(navTree.currentTitle()).toBe('School License');
    expect(ancestorLabels()).toEqual(['Me', 'Orders']);
    expect(navTree.parent()?.url).toBe('/my-orders');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Me',
      'Orders',
      'School License',
    ]);

    // 5. Purchase Next Grading
    goTo(Views.NextGrading);
    expect(navTree.currentTitle()).toBe('Purchase Next Grading');
    expect(ancestorLabels()).toEqual(['Me', 'Orders']);
    expect(navTree.parent()?.url).toBe('/my-orders');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Me',
      'Orders',
      'Purchase Next Grading',
    ]);

    // 6. Order Complete
    goTo(Views.OrderComplete);
    expect(navTree.currentTitle()).toBe('Order Complete');
    expect(ancestorLabels()).toEqual(['Me', 'Orders']);
    expect(navTree.parent()?.url).toBe('/my-orders');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'ILC Portal',
      'Me',
      'Orders',
      'Order Complete',
    ]);
  });
});
