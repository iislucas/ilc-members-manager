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

  it('gives a top-level page no parent, so it shows no back link', () => {
    goTo(Views.ManageMembers);
    expect(navTree.ancestors()).toEqual([]);
    expect(navTree.parent()).toBeNull();
  });

  it('puts an event under its list, and the event editor under the event', () => {
    goTo(Views.EventView, { eventId: 'E1' });
    expect(ancestorLabels()).toEqual(['Events & Workshops']);

    navTree.loadedEventTitle.set('Summer Camp');
    goTo(Views.EventEdit, { eventId: 'E1' });
    expect(ancestorLabels()).toEqual(['Events & Workshops', 'Summer Camp']);
    expect(navTree.parent()?.url).toBe('/events/E1');
  });

  it('keeps each events subtree separate', () => {
    navTree.loadedEventTitle.set('Summer Camp');
    goTo(Views.ManageEventEdit, { eventId: 'E1' });
    expect(ancestorLabels()).toEqual(['Manage Events', 'Summer Camp']);
    expect(navTree.parent()?.url).toBe('/manage-events/E1');

    goTo(Views.MyEventEdit, { eventId: 'E1' });
    expect(ancestorLabels()).toEqual(['My Events', 'Summer Camp']);
    expect(navTree.parent()?.url).toBe('/my-events/E1');
  });

  it('puts a class calendar under the instructor whose calendar it is', () => {
    goTo(Views.ClassCalendarView, { instructorId: 'I7' });
    expect(navTree.parent()?.url).toBe('/instructors/I7');
    expect(ancestorLabels()[0]).toBe('Find an Instructor');
  });

  it('puts settings sub-pages under Settings', () => {
    goTo(Views.NotificationSettings);
    expect(navTree.parent()?.url).toBe('/settings');
  });

  it('links a member back to their list, scrolled to their row', () => {
    goTo(Views.ManageMemberView, { memberId: 'M42' });
    expect(navTree.parent()?.url).toBe('/members?jumpTo=M42');
  });

  it('builds the school chain for a school member list', () => {
    goTo(Views.SchoolMembers, { schoolId: 'PARIS' });
    expect(ancestorLabels()).toEqual(['Manage Schools', 'Paris ILC (PARIS)']);
    expect(navTree.parent()?.url).toBe('/schools/schoolDoc1/edit');
  });

  it('routes a school manager through My Schools rather than Manage Schools', () => {
    user.set({
      isAdmin: false,
      schoolsManaged: ['PARIS'],
      memberProfiles: [],
      member: { memberId: 'M1', name: 'Test Member' },
    } as unknown as Partial<UserDetails>);
    goTo(Views.SchoolMembers, { schoolId: 'PARIS' });
    expect(ancestorLabels()).toEqual(['My Schools', 'Paris ILC (PARIS)']);
    expect(navTree.parent()?.url).toBe('/my-schools/schoolDoc1/edit');
  });

  it('builds the instructor chain for a student list', () => {
    goTo(Views.InstructorStudents, { instructorId: 'I7' });
    expect(ancestorLabels()).toEqual(['Manage Members', 'Sifu Chin [I7]']);
    expect(navTree.parent()?.url).toBe('/members/M9');
  });

  it('sends a non-admin viewing a grading back to My Gradings', () => {
    user.set({
      isAdmin: false,
      schoolsManaged: [],
      memberProfiles: [],
      member: { memberId: 'M1', name: 'Test Member' },
    } as unknown as Partial<UserDetails>);
    goTo(Views.GradingView, { gradingId: 'G1' });
    expect(navTree.parent()?.url).toBe('/my-gradings');
  });

  it('sends an admin browsing the global list back to Manage Gradings', () => {
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
      'I Liq Chuan',
      'Members Portal App',
      'Events & Workshops',
      'Summer Camp',
      'Edit: Summer Camp',
    ]);
    // The back link is the crumb just before the current page — the invariant
    // this whole service exists to hold.
    expect(navTree.parent()!.label).toBe(crumbs[crumbs.length - 2].label);
  });

  it('shows only the two root crumbs on Home', () => {
    goTo(Views.Home);
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'I Liq Chuan',
      'Members Portal App',
    ]);
  });

  it('shows Page Not Found breadcrumb and title when route does not match any view', () => {
    routing.matchedPatternId.set(null);
    expect(navTree.currentTitle()).toBe('Page Not Found');
    expect(navTree.breadcrumbs().map((c) => c.label)).toEqual([
      'I Liq Chuan',
      'Members Portal App',
      'Page Not Found',
    ]);
  });
});
