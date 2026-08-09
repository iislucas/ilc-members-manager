/*
NavigationTreeService: the single source of truth for "where am I, and what is
above me?".

The app is a tree: every page has at most one parent page, and the URL path
mirrors that shape (`/events/:id/edit` sits under `/events/:id`, which sits
under `/events`). Two things have to agree with that tree:

  - the breadcrumbs in the header, which show the whole trail from the root, and
  - the in-page "Back to ..." link, which goes exactly one level up.

They used to be derived separately — breadcrumbs centrally in `App`, back links
hand-rolled in each page component — and drifted apart. Now both come from
`ancestors()` here: the breadcrumb trail is the ancestors plus the current page,
and the back link is simply the last ancestor. They cannot disagree.

Ancestor URLs are built with the routing service, so a parent's list state
(search text, sort order, tag filter) is preserved when you go back up.
*/
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { RoutingService } from './routing.service';
import { AppPathPatterns, Views } from './app.config';
import { DataManagerService } from './data-manager.service';
import { FirebaseStateService } from './firebase-state.service';
import { FindInstructorsService } from './find-instructors.service';

/** One page in the tree, as linked to from a descendant. */
export interface NavNode {
  /** Shown as a breadcrumb, and after "Back to " in a back link. */
  label: string;
  /** Absolute href, with the target page's own URL params preserved. */
  url: string;
}

/** The two fixed crumbs above every page: the main site, then this app. */
const SITE_ROOT: NavNode & { shortLabel: string } = {
  label: 'I Liq Chuan',
  shortLabel: 'ILC',
  url: 'https://iliqchuan.com',
};

@Injectable({ providedIn: 'root' })
export class NavigationTreeService {
  private routing: RoutingService<AppPathPatterns> = inject(RoutingService);
  private dataService = inject(DataManagerService);
  private firebaseState = inject(FirebaseStateService);
  private findInstructors = inject(FindInstructorsService);

  /*
  Titles that are only known once the page has fetched its record. Pages report
  them via their `titleLoaded` output; they live here because an ancestor node
  needs them too (the parent of `/events/:id/edit` is the event itself), and
  because the trailing breadcrumb shows a loading bar until they arrive.
  */
  public loadedEventTitle = signal<string | null>(null);
  public loadedOrderTitle = signal<string | null>(null);
  public loadedSchoolTitle = signal<string | null>(null);
  public loadedGradingTitle = signal<string | null>(null);
  public loadedInstructorTitle = signal<string | null>(null);

  /** The matched route, with the two "index" routes mapped to what they render. */
  public currentView = computed(() => {
    const view = this.routing.matchedPatternId() as Views | null;
    if (view === Views.MembersArea) return Views.MembersAreaCategory;
    if (view === Views.InstructorsArea) return Views.InstructorsAreaCategory;
    return view;
  });

  constructor() {
    // Drop a loaded title as soon as we leave the pages that can show it, so a
    // stale name never appears in the breadcrumb of the next page.
    effect(() => {
      const view = this.currentView();
      if (!view || !EVENT_VIEWS.has(view)) this.loadedEventTitle.set(null);
      if (view !== Views.OrderView) this.loadedOrderTitle.set(null);
      if (!view || !SCHOOL_TITLE_VIEWS.has(view)) this.loadedSchoolTitle.set(null);
      if (view !== Views.GradingView) this.loadedGradingTitle.set(null);
      if (view !== Views.InstructorView) this.loadedInstructorTitle.set(null);
    });
  }

  /** Title of the page being viewed, also used as the document title. */
  public currentTitle = computed(() => this.titleOf(this.currentView()));

  /**
   * The pages above the current one, root-first, excluding the site root and
   * Home. Empty for a top-level page — those are reached from the menu and have
   * no "up".
   */
  public ancestors = computed<NavNode[]>(() => this.ancestorsOf(this.currentView()));

  /**
   * The page one level up, or null at the top level. This is what a back link
   * points at.
   */
  public parent = computed<NavNode | null>(() => {
    const chain = this.ancestors();
    return chain.length > 0 ? chain[chain.length - 1] : null;
  });

  /** True while the current page is still fetching the record it is named after. */
  public currentTitleIsLoading = computed(() => {
    const view = this.currentView();
    if (!view) return false;
    if (EVENT_VIEWS.has(view)) return !this.loadedEventTitle();
    if (view === Views.OrderView) return !this.loadedOrderTitle();
    if (view === Views.ManageSchoolEdit || view === Views.MySchoolEdit) {
      return !this.loadedSchoolTitle();
    }
    if (view === Views.GradingView) return !this.loadedGradingTitle();
    return false;
  });

  /** Full breadcrumb trail: site root, app root, ancestors, current page. */
  public breadcrumbs = computed(() => {
    const view = this.currentView();
    const appRoot = { label: 'Members Portal App', shortLabel: 'App', url: '/' };
    if (view === Views.Home) {
      return [SITE_ROOT, appRoot];
    }
    if (!view) {
      return [
        SITE_ROOT,
        appRoot,
        { label: 'Page Not Found', isLoading: false },
      ];
    }
    return [
      SITE_ROOT,
      appRoot,
      ...this.ancestors(),
      { label: this.currentTitle(), isLoading: this.currentTitleIsLoading() },
    ];
  });

  // ---------------------------------------------------------------------------
  // The tree itself.
  // ---------------------------------------------------------------------------

  private ancestorsOf(view: Views | null): NavNode[] {
    if (!view) return [];
    switch (view) {
      // --- Public: instructors and schools ---
      case Views.InstructorView:
        return [this.node(Views.FindAnInstructor, 'Find an Instructor')];
      case Views.ClassCalendarView: {
        const instructorId =
          this.routing.signals[Views.ClassCalendarView].pathVars.instructorId();
        const instructor = this.findInstructors.instructors.get(instructorId);
        return [
          this.node(Views.FindAnInstructor, 'Find an Instructor'),
          this.node(Views.InstructorView, instructor?.name || instructorId, {
            instructorId,
          }),
        ];
      }
      case Views.SchoolView:
        return [this.node(Views.FindSchool, 'Find a School')];
      case Views.SchoolCalendarView: {
        const schoolId =
          this.routing.signals[Views.SchoolCalendarView].pathVars.schoolId();
        const school = this.dataService.schools.get(schoolId);
        return [
          this.node(Views.FindSchool, 'Find a School'),
          this.node(Views.SchoolView, school?.schoolName || schoolId, { schoolId }),
        ];
      }

      // --- Events. Three parallel subtrees: public, mine, and admin. ---
      case Views.ProposeEvent:
      case Views.EventView:
        return [this.node(Views.EventsCalendar, 'Events & Workshops')];
      case Views.MyEventView:
        return [this.node(Views.MyEvents, 'My Events')];
      case Views.ManageEventView:
        return [this.node(Views.ManageEvents, 'Manage Events')];
      case Views.EventEdit:
      case Views.MyEventEdit:
      case Views.ManageEventEdit: {
        // An edit page hangs off the event it edits, not off the list.
        const parentView = EVENT_EDIT_PARENT[view];
        const eventId = this.routing.signals[view].pathVars.eventId();
        return [
          ...this.ancestorsOf(parentView),
          this.node(parentView, this.loadedEventTitle() || 'Event Details', {
            eventId,
          }),
        ];
      }

      // --- Members, students and schools ---
      case Views.ManageMemberView:
        return this.memberListChain(
          'members',
          this.routing.signals[Views.ManageMemberView].pathVars.memberId(),
        );
      case Views.MyStudentView:
        return this.memberListChain(
          'my-students',
          this.routing.signals[Views.MyStudentView].pathVars.memberId(),
        );
      case Views.SchoolMemberView: {
        const s = this.routing.signals[Views.SchoolMemberView];
        return this.memberListChain(
          `school/${s.pathVars.schoolId()}/members`,
          s.pathVars.memberId(),
        );
      }
      case Views.InstructorStudentView: {
        const s = this.routing.signals[Views.InstructorStudentView];
        return this.memberListChain(
          `instructor/${s.pathVars.instructorId()}/students`,
          s.pathVars.memberId(),
        );
      }
      case Views.NewMember:
        return this.memberListChain(
          this.routing.signals[Views.NewMember].urlParams.basePath() || 'members',
        );
      case Views.SchoolMembers:
        return this.schoolChain(
          this.routing.signals[Views.SchoolMembers].pathVars.schoolId(),
        );
      case Views.InstructorStudents:
        return this.instructorChain(
          this.routing.signals[Views.InstructorStudents].pathVars.instructorId(),
        );
      case Views.ManageSchoolEdit:
        return [this.node(Views.ManageSchools, 'Manage Schools')];
      case Views.MySchoolEdit:
        return [this.node(Views.MySchools, 'My Schools')];

      // --- Gradings ---
      case Views.GradingView:
        return this.gradingReturnsToMyGradings()
          ? [this.node(Views.MemberGradings, 'My Gradings')]
          : [this.node(Views.ManageGradings, 'Manage Gradings')];

      // --- Orders, articles, settings ---
      case Views.OrderView:
        return [this.node(Views.ManageOrders, 'Manage Orders')];
      case Views.MembersAreaPost:
        return [{ label: 'Members Area', url: this.routing.hrefWithParams('/members-area') }];
      case Views.InstructorsAreaPost:
        return [
          { label: 'Instructors Area', url: this.routing.hrefWithParams('/instructors-area') },
        ];
      case Views.NotificationSettings:
        return [this.node(Views.Settings, 'Settings')];

      default:
        return [];
    }
  }

  /**
   * The chain down to (and including) a member list, given the list's base path
   * — the same `basePath` the member pages are rendered with. When `jumpToId`
   * is given, the list link scrolls to that member on arrival.
   */
  private memberListChain(basePath: string, jumpToId?: string): NavNode[] {
    const chain = this.memberListChainWithoutJump(basePath);
    const last = chain[chain.length - 1];
    if (jumpToId && last) {
      chain[chain.length - 1] = { ...last, url: withParam(last.url, 'jumpTo', jumpToId) };
    }
    return chain;
  }

  private memberListChainWithoutJump(basePath: string): NavNode[] {
    if (basePath === 'my-students') {
      return [this.node(Views.MyStudents, 'My Students')];
    }
    const schoolMatch = /^school\/([^/]+)\/members$/.exec(basePath);
    if (schoolMatch) {
      const schoolId = decodeURIComponent(schoolMatch[1]);
      const school = this.dataService.schools
        .entries()
        .find((s) => s.schoolId === schoolId);
      return [
        ...this.schoolChain(schoolId),
        this.node(
          Views.SchoolMembers,
          school ? `Members of ${school.schoolName}` : `School ${schoolId} Members`,
          { schoolId },
        ),
      ];
    }
    const instructorMatch = /^instructor\/([^/]+)\/students$/.exec(basePath);
    if (instructorMatch) {
      const instructorId = decodeURIComponent(instructorMatch[1]);
      const instructor = this.dataService.instructors.get(instructorId);
      return [
        ...this.instructorChain(instructorId),
        this.node(
          Views.InstructorStudents,
          instructor
            ? `Students of ${instructor.name} [${instructorId}]`
            : `Students of ${instructorId}`,
          { instructorId },
        ),
      ];
    }
    return [this.node(Views.ManageMembers, 'Manage Members')];
  }

  /**
   * The chain above a school's member list: the schools list the viewer can
   * actually use, then that school's edit page (which is where the members link
   * lives).
   */
  private schoolChain(schoolId: string): NavNode[] {
    const school = this.dataService.schools
      .entries()
      .find((s) => s.schoolId === schoolId);
    const user = this.firebaseState.user();
    const isMine =
      !user?.isAdmin && !!school && (user?.schoolsManaged ?? []).includes(schoolId);
    const listNode = isMine
      ? this.node(Views.MySchools, 'My Schools')
      : this.node(Views.ManageSchools, 'Manage Schools');
    if (!school) return [listNode];
    const editView = isMine ? Views.MySchoolEdit : Views.ManageSchoolEdit;
    return [
      listNode,
      this.node(editView, `${school.schoolName} (${schoolId})`, {
        schoolId: school.docId || schoolId,
      }),
    ];
  }

  /** The chain above an instructor's student list: their member record. */
  private instructorChain(instructorId: string): NavNode[] {
    const membersNode = this.node(Views.ManageMembers, 'Manage Members');
    const instructor = this.dataService.instructors.get(instructorId);
    if (!instructor) return [membersNode];
    return [
      membersNode,
      this.node(Views.ManageMemberView, `${instructor.name} [${instructorId}]`, {
        memberId: instructor.memberId,
      }),
    ];
  }

  /**
   * Whether a grading detail page belongs to the member-facing "My Gradings"
   * subtree rather than the admin "Manage Gradings" one: when it was opened
   * from there (tagged with `?from=my-gradings`), when it is the viewer's own
   * grading, or when the viewer is not an admin and so has no other list.
   */
  public gradingReturnsToMyGradings = computed(() => {
    if (this.routing.signals[Views.GradingView].urlParams.from() === 'my-gradings') {
      return true;
    }
    if (!this.firebaseState.user()?.isAdmin) return true;
    const gradingId = this.routing.signals[Views.GradingView].pathVars.gradingId();
    if (!gradingId) return false;
    const grading =
      this.dataService.gradings.get(gradingId) ??
      this.dataService.myGradings.get(gradingId) ??
      this.dataService.myGradingsAssessed.get(gradingId);
    if (!grading) return false;
    const profiles = this.firebaseState.user()?.memberProfiles ?? [];
    return profiles.some((p) => p.docId === grading.studentMemberDocId);
  });

  /** An ancestor link, with the target's own URL params carried forward. */
  private node(view: Views, label: string, pathVars: PathVars = {}): NavNode {
    return { label, url: this.hrefFor(view, pathVars) };
  }

  private hrefFor(view: Views, pathVars: PathVars): string {
    // `hrefForView` is precisely typed per view; this service dispatches over
    // all views at once, so the path variables are only known dynamically.
    // Called on the service (not via a detached reference) so `this` binds.
    const routing = this.routing as unknown as {
      hrefForView(view: string, pathVars?: PathVars): string;
    };
    return routing.hrefForView(view, pathVars);
  }

  public titleOf(viewId: Views | null): string {
    switch (viewId) {
      case Views.ManageMembers:
        return 'Manage Members';
      case Views.FindAnInstructor:
        return 'Find an Instructor';
      case Views.InstructorView:
        return this.loadedInstructorTitle() || 'Instructor';
      case Views.ManageSchools:
        return 'Manage Schools';
      case Views.ManageSchoolEdit:
        return this.loadedSchoolTitle()
          ? `Edit: ${this.loadedSchoolTitle()}`
          : 'Edit School';
      case Views.MySchoolEdit:
        return this.loadedSchoolTitle() || 'My School';
      case Views.FindSchool:
        return 'Find a School';
      case Views.SchoolView:
        return this.loadedSchoolTitle() || 'School';
      case Views.ClassCalendarView: {
        const calInstructorId =
          this.routing.signals[Views.ClassCalendarView].pathVars.instructorId();
        const calInstructor = calInstructorId
          ? this.findInstructors.instructors.get(calInstructorId)
          : undefined;
        return calInstructor
          ? `${calInstructor.name} (${calInstructorId})'s Class Calendar`
          : 'Class Calendar';
      }
      case Views.SchoolCalendarView: {
        const calSchoolId =
          this.routing.signals[Views.SchoolCalendarView].pathVars.schoolId();
        const calSchool = calSchoolId
          ? this.dataService.schools.get(calSchoolId)
          : undefined;
        return calSchool ? `${calSchool.schoolName}'s Calendar` : 'School Calendar';
      }
      case Views.SchoolMembers: {
        const schoolId = this.routing.signals[viewId].pathVars.schoolId();
        const school = this.dataService.schools
          .entries()
          .find((s) => s.schoolId === schoolId);
        return school
          ? `Members of ${school.schoolName}`
          : `School ${schoolId} Members`;
      }
      case Views.InstructorStudents: {
        const instructorId = this.routing.signals[viewId].pathVars.instructorId();
        const instructor = this.dataService.instructors.get(instructorId);
        return instructor
          ? `Students of ${instructor.name} [${instructorId}]`
          : `Students of ${instructorId}`;
      }
      case Views.ImportExport:
        return 'Import/Export';
      case Views.Home:
        return 'Home';
      case Views.MyProfile:
        return 'My Profile';
      case Views.MyStudents:
        return 'My Students';
      case Views.MyEvents:
        return 'My Events';
      case Views.MySchools:
        return 'My Schools';
      case Views.MembersArea:
      case Views.MembersAreaCategory:
        return 'Members Area';
      case Views.InstructorsArea:
      case Views.InstructorsAreaCategory:
        return 'Instructors Area';
      case Views.ManageGradings:
        return 'Manage Gradings';
      case Views.MemberGradings: {
        const member = this.firebaseState.user()?.member;
        if (member) {
          return `My Gradings: (${member.memberId || 'No ID'}) ${member.name}`;
        }
        return 'My Gradings';
      }
      case Views.GradingView:
        return this.loadedGradingTitle() || 'Grading Details';
      case Views.Settings:
        return 'Settings';
      case Views.NotificationSettings:
        return 'Notification Settings';
      case Views.Notifications:
        return 'Notifications';
      case Views.Statistics:
        return 'Statistics';
      case Views.EventsCalendar:
        return 'Events & Workshops';
      case Views.EventView:
      case Views.MyEventView:
      case Views.ManageEventView:
        return this.loadedEventTitle() || 'Event Details';
      case Views.EventEdit:
      case Views.MyEventEdit:
      case Views.ManageEventEdit:
        return this.loadedEventTitle()
          ? `Edit: ${this.loadedEventTitle()}`
          : 'Edit Event';
      case Views.ProposeEvent:
        return 'Organise Event';
      case Views.ManageEvents:
        return 'Manage Events';
      case Views.ClassVideoLibrary:
        return 'Class Video Library';
      case Views.ManageOrders:
        return 'Manage Orders';
      case Views.OrderView:
        return this.loadedOrderTitle() || 'Order Details';
      case Views.MembersAreaPost:
      case Views.InstructorsAreaPost:
        return 'Article';
      case Views.DownloadResource:
        return 'Download Resource';
      case Views.Products:
        return 'Products';
      case Views.OrderComplete:
        return 'Order Complete';
      case Views.MyMaterials:
        return 'My Materials';
      case Views.ManageMaterials:
        return 'Manage Materials';
      case Views.Login:
        return 'Login';
      case Views.NewMember:
        return 'New Member';
      case Views.MyStudentView: {
        const mIdOrDocId = this.routing.signals[viewId].pathVars.memberId();
        const m = this.dataService.getMyStudent(mIdOrDocId);
        if (!m) {
          return `Unknown student of yours (${mIdOrDocId})`;
        }
        if (m.name?.trim() && m.memberId) {
          return `${m.name} (${m.memberId})`;
        }
        if (m.name?.trim()) {
          return `${m.name} (Not yet a Member)`;
        }
        return `Unknown student of yours (doc:${m.docId})`;
      }
      case Views.ManageMemberView:
      case Views.SchoolMemberView:
      case Views.InstructorStudentView: {
        const mIdOrDocId = this.routing.signals[viewId].pathVars.memberId();
        const m = this.dataService.getMember(mIdOrDocId);
        if (!m) {
          return `Unknown (${mIdOrDocId})`;
        }
        if (m.name.trim() && m.memberId) {
          return `${m.name} (${m.memberId})`;
        }
        if (m.name.trim() && !m.memberId) {
          return `${m.name} (Not yet a Member)`;
        }
        return `Unnamed and not yet a Member (doc:${m.docId})`;
      }
      default:
        return 'Page Not Found';
    }
  }
}

type PathVars = { [key: string]: string };

/** Every page whose title is the event it shows. */
const EVENT_VIEWS: ReadonlySet<Views> = new Set([
  Views.EventView,
  Views.MyEventView,
  Views.ManageEventView,
  Views.EventEdit,
  Views.MyEventEdit,
  Views.ManageEventEdit,
]);

/** Every page whose title is the school it shows. */
const SCHOOL_TITLE_VIEWS: ReadonlySet<Views> = new Set([
  Views.ManageSchoolEdit,
  Views.MySchoolEdit,
  Views.SchoolView,
]);

/** The event page each edit page hangs off, staying within the same subtree. */
const EVENT_EDIT_PARENT: {
  [key in Views.EventEdit | Views.MyEventEdit | Views.ManageEventEdit]: Views;
} = {
  [Views.EventEdit]: Views.EventView,
  [Views.MyEventEdit]: Views.MyEventView,
  [Views.ManageEventEdit]: Views.ManageEventView,
};

/** Add (or replace) one query parameter on an already-built href. */
function withParam(href: string, key: string, value: string): string {
  const [path, query] = href.split('?');
  const params = new URLSearchParams(query ?? '');
  params.set(key, value);
  return `${path}?${params.toString()}`;
}
