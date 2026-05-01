import { Component, computed, inject, signal, effect } from '@angular/core';
import { FirebaseStateService, LoginStatus } from './firebase-state.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FooterComponent } from './footer/footer';
import { IconComponent } from './icons/icon.component';
import { ImportExportComponent } from './import-export/import-export';
import { SpinnerComponent } from './spinner/spinner.component';
import { RoutingService } from './routing.service';
import { AppPathPatterns, Views } from './app.config';
import { FindAnInstructorComponent } from './find-an-instructor/find-an-instructor';
import { FindInstructorsService } from './find-instructors.service';
import { SchoolListComponent } from './school-list/school-list';
import { SchoolEditComponent } from './school-edit/school-edit';
import { DataManagerService, DataServiceState } from './data-manager.service';
import { SchoolMembersComponent } from './school-members/school-members';
import { InstructorStudentsComponent } from './instructor-students/instructor-students';
import { FilteredMembersComponent } from './filtered-members/filtered-members';
import { MemberDetailsComponent } from './member-details/member-details';
import { FindSchoolComponent } from './find-school/find-school';
import { HomeComponent } from './home/home';
import { ClassCalendarComponent } from './class-calendar/class-calendar';
import { SquarespaceContentComponent } from './squarespace/squarespace-content.component';
import { SquarespaceArticleComponent } from './squarespace/squarespace-article.component';
import { GradingListComponent } from './grading-list/grading-list';
import { SettingsComponent } from './settings/settings.component';
import { LoginComponent } from './login/login';
import { NavigationMenuComponent } from './navigation-menu/navigation-menu.component';
import { MemberGradingsComponent } from './member-gradings/member-gradings';
import { ClassVideoLibraryComponent } from './class-video-library/class-video-library';
import { OrderList } from './order-list/order-list';
import { OrderView } from './order-view/order-view';
import { HeaderComponent, Breadcrumb } from './header/header.component';
import { MemberViewComponent } from './member-view/member-view';
import { MemberCreateComponent } from './member-create/member-create';
import { StatisticsComponent } from './statistics/statistics';
import { EventListComponent } from './events-calendar/event-list/event-list';
import { EventViewComponent } from './events-calendar/event-view/event-view';
import { ManageEventsComponent } from './manage-events/manage-events';
import { EventEditComponent } from './event-edit/event-edit';
import { ProposeEventComponent } from './organise-events/organise-event/organise-event';
import { CompleteProfileComponent } from './complete-profile/complete-profile';
import { MembershipType } from '../../functions/src/data-model';
import { APP_VERSION } from './version';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    FooterComponent,
    IconComponent,
    ImportExportComponent,
    SpinnerComponent,
    FindAnInstructorComponent,
    SchoolListComponent,
    SchoolEditComponent,
    SchoolMembersComponent,
    InstructorStudentsComponent,
    FilteredMembersComponent,
    MemberDetailsComponent,
    FindSchoolComponent,
    HomeComponent,
    ClassCalendarComponent,
    SquarespaceContentComponent,
    SquarespaceArticleComponent,
    GradingListComponent,
    SettingsComponent,
    LoginComponent,
    ClassVideoLibraryComponent,
    MemberGradingsComponent,
    OrderList,
    OrderView,
    HeaderComponent,
    MemberViewComponent,
    MemberCreateComponent,
    StatisticsComponent,
    EventListComponent,
    EventViewComponent,
    ManageEventsComponent,
    EventEditComponent,
    ProposeEventComponent,
    CompleteProfileComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected title = 'ilc-members-manager';
  protected readonly appVersion = APP_VERSION;
  public firebaseService = inject(FirebaseStateService);
  public dataService = inject(DataManagerService);
  public findInstructorsService = inject(FindInstructorsService);
  public routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);
  public menuOpen = signal(false);
  public loadedEventTitle = signal<string | null>(null);
  public loadedOrderTitle = signal<string | null>(null);
  public loadedSchoolTitle = signal<string | null>(null);

  // Views that are accessible without login.
  private static readonly PUBLIC_VIEWS: ReadonlySet<Views> = new Set([
    Views.FindAnInstructor,
    Views.FindSchool,
    Views.EventsCalendar,
    Views.EventView,
    Views.ClassCalendarView,
    Views.SchoolCalendarView,
  ]);

  public isPublicPage = computed(() => {
    const view = this.currentView();
    return !!view && App.PUBLIC_VIEWS.has(view);
  });

  onEventTitleLoaded(title: string) {
    this.loadedEventTitle.set(title);
  }

  onOrderTitleLoaded(title: string) {
    this.loadedOrderTitle.set(title);
  }

  onSchoolTitleLoaded(title: string) {
    this.loadedSchoolTitle.set(title);
  }
  public breadcrumbs = computed<Breadcrumb[]>(() => {
    const baseBreadcrumbs: Breadcrumb[] = [
      { label: 'I Liq Chuan', shortLabel: 'ILC', url: 'https://iliqchuan.com' },
      { label: 'Members Portal App', shortLabel: 'App', url: '#/' },
    ];
    const view = this.currentView();
    if (view !== Views.Home && view) {
      if (view === Views.OrderView) {
        baseBreadcrumbs.push({ label: 'Orders', url: '#/orders' });
      } else if (view === Views.MembersAreaPost) {
        baseBreadcrumbs.push({ label: 'Members Area', url: '#/members-area' });
      } else if (view === Views.InstructorsAreaPost) {
        baseBreadcrumbs.push({ label: 'Instructors Area', url: '#/instructors-area' });
      } else if (view === Views.ManageMemberView) {
        baseBreadcrumbs.push({ label: 'Manage Members', url: '#/members' });
      } else if (view === Views.SchoolMemberView) {
        const schoolId = this.routingService.signals[Views.SchoolMemberView].pathVars.schoolId();
        baseBreadcrumbs.push({ label: `School ${schoolId} Members`, url: `#/school/${schoolId}/members` });
      } else if (view === Views.InstructorStudents || view === Views.InstructorStudentView) {
        const instructorId = view === Views.InstructorStudents
          ? this.routingService.signals[Views.InstructorStudents].pathVars.instructorId()
          : this.routingService.signals[Views.InstructorStudentView].pathVars.instructorId();
        const instructor = this.dataService.instructors.get(instructorId);
        if (!instructor) {
          baseBreadcrumbs.push({ label: `Instructor Not Found (${instructorId})`, url: `#/instructor/${instructorId}/students` });
          return baseBreadcrumbs;
        }
        baseBreadcrumbs.push({ label: `Manage Members`, url: `#/members` });
        baseBreadcrumbs.push({ label: `${instructor.name} (${instructorId})`, url: `#/members/${instructor.memberId}` });
        baseBreadcrumbs.push({ label: `Students of ${instructor.name} (${instructorId})`, url: `#/instructor/${instructorId}/students` });
        if (view === Views.InstructorStudentView) {
          const studentId = this.routingService.signals[Views.InstructorStudentView].pathVars.memberId();
          const student = this.dataService.getMember(studentId);
          if (!student) {
            baseBreadcrumbs.push({ label: `Student Not Found (${studentId})`, url: `#/instructor/${instructorId}/students` });
            return baseBreadcrumbs;
          }
          baseBreadcrumbs.push({ label: `${student.name} (${studentId})`, url: `#/instructor/${instructorId}/students` });
        }
        return baseBreadcrumbs;
      } else if (view === Views.MyStudentView) {
        baseBreadcrumbs.push({ label: 'My Students', url: '#/my-students' });
      } else if (view === Views.NewMember) {
        const basePath = this.routingService.signals[Views.NewMember].urlParams.basePath();
        if (basePath === 'members') {
          baseBreadcrumbs.push({ label: 'Manage Members', url: '#/members' });
        } else if (basePath?.startsWith('school/')) {
          baseBreadcrumbs.push({ label: 'School Members', url: `#/${basePath}` });
        } else if (basePath?.startsWith('instructor/')) {
          baseBreadcrumbs.push({ label: 'Students', url: `#/${basePath}` });
        } else if (basePath === 'my-students') {
          baseBreadcrumbs.push({ label: 'My Students', url: '#/my-students' });
        }
      } else if (view === Views.ClassCalendarView) {
        baseBreadcrumbs.push({ label: 'Find an Instructor', url: '#/find-an-instructor' });
      } else if (view === Views.SchoolCalendarView) {
        baseBreadcrumbs.push({ label: 'Find a School', url: '#/find-school' });
      } else if (view === Views.EventsCalendar) {
        // No parent breadcrumb needed for events
      } else if (view === Views.EventView) {
        baseBreadcrumbs.push({ label: 'Events', url: '#/events' });
      } else if (view === Views.MyEventView) {
        baseBreadcrumbs.push({ label: 'My Events', url: '#/my-events' });
      } else if (view === Views.ManageEventView) {
        baseBreadcrumbs.push({ label: 'Manage Events', url: '#/manage-events' });
      } else if (view === Views.EventEdit || view === Views.ManageEventEdit) {
        baseBreadcrumbs.push({ label: 'Manage Events', url: '#/manage-events' });
      } else if (view === Views.MyEventEdit) {
        baseBreadcrumbs.push({ label: 'My Events', url: '#/my-events' });
      } else if (view === Views.ProposeEvent) {
        baseBreadcrumbs.push({ label: 'Events', url: '#/events' });
      } else if (view === Views.ManageEvents) {
        // No parent breadcrumb needed for manage events
      } else if (view === Views.ManageSchoolEdit) {
        baseBreadcrumbs.push({ label: 'Manage Schools', url: '#/schools' });
      } else if (view === Views.MySchoolEdit) {
        baseBreadcrumbs.push({ label: 'My Schools', url: '#/my-schools' });
      }
      const isEventView = view === Views.EventView || view === Views.MyEventView || view === Views.ManageEventView;
      const isEventEdit = view === Views.EventEdit || view === Views.MyEventEdit || view === Views.ManageEventEdit;
      const isOrderView = view === Views.OrderView;
      const isSchoolEdit = view === Views.ManageSchoolEdit || view === Views.MySchoolEdit;
      const isLoading = ((isEventView || isEventEdit) && !this.loadedEventTitle()) || (isOrderView && !this.loadedOrderTitle()) || (isSchoolEdit && !this.loadedSchoolTitle());
      baseBreadcrumbs.push({ label: this.currentViewTitle(), isLoading });
    }
    return baseBreadcrumbs;
  });
  public currentView = computed(() => {
    const view = this.routingService.matchedPatternId() as Views | null;
    if (view === Views.MembersArea) return Views.MembersAreaCategory;
    if (view === Views.InstructorsArea) return Views.InstructorsAreaCategory;
    return view;
  });

  /** Resolved calendar ID for instructor calendar view. */
  instructorCalendarId = computed(() => {
    const instructorId = this.routingService.signals[Views.ClassCalendarView].pathVars.instructorId();
    if (!instructorId) return '';
    const instructor = this.findInstructorsService.instructors.get(instructorId);
    return instructor?.publicClassGoogleCalendarId || '';
  });

  /** Resolved instructor name for the calendar view title. */
  instructorCalendarOwnerName = computed(() => {
    const instructorId = this.routingService.signals[Views.ClassCalendarView].pathVars.instructorId();
    if (!instructorId) return '';
    const instructor = this.findInstructorsService.instructors.get(instructorId);
    return instructor?.name || '';
  });

  /** Resolved calendar ID for school calendar view. */
  schoolCalendarId = computed(() => {
    const schoolId = this.routingService.signals[Views.SchoolCalendarView].pathVars.schoolId();
    if (!schoolId) return '';
    const school = this.dataService.schools.get(schoolId);
    return school?.schoolClassGoogleCalendarId || '';
  });

  /** Resolved school name for the calendar view title. */
  schoolCalendarOwnerName = computed(() => {
    const schoolId = this.routingService.signals[Views.SchoolCalendarView].pathVars.schoolId();
    if (!schoolId) return '';
    const school = this.dataService.schools.get(schoolId);
    return school?.schoolName || '';
  });
  public Views = Views;
  public LoginStatus = LoginStatus;
  public DataServiceState = DataServiceState;
  public jumpToMemberInUrlParams = computed(() => {
    const patternId = this.routingService.matchedPatternId();
    if (
      patternId === Views.SchoolMembers ||
      patternId === Views.ManageMembers ||
      patternId === Views.InstructorStudents ||
      patternId === Views.MyStudents
    ) {
      return this.routingService.signals[patternId].urlParams.jumpTo();
    }
    return '';
  });

  currentViewTitle = computed(() => {
    return this.viewIdToTitle(
      this.routingService.matchedPatternId() as Views | '',
    );
  });

  constructor() {
    effect(() => {
      const isLoggedOut =
        this.firebaseService.loginStatus() === LoginStatus.SignedOut;
      const isLoggedIn =
        this.firebaseService.loginStatus() === LoginStatus.SignedIn;
      const view = this.routingService.matchedPatternId();

      const isEventView = view === Views.EventView || view === Views.MyEventView || view === Views.ManageEventView;
      const isEventEdit = view === Views.EventEdit || view === Views.MyEventEdit || view === Views.ManageEventEdit;
      const isSchoolEdit = view === Views.ManageSchoolEdit || view === Views.MySchoolEdit;
      if (!isEventView && !isEventEdit) {
        this.loadedEventTitle.set(null);
      }
      if (view !== Views.OrderView) {
        this.loadedOrderTitle.set(null);
      }
      if (!isSchoolEdit) {
        this.loadedSchoolTitle.set(null);
      }

      const isOnPublicPage = !!view && App.PUBLIC_VIEWS.has(view);
      if (isLoggedOut && (!view || view === Views.Home)) {
        this.routingService.navigateToParts(['login']);
      } else if (isLoggedOut && view === Views.Login) {
        // Stay on login page
      } else if (isLoggedOut && isOnPublicPage) {
        // Stay on public page — login is in the nav bar
      } else if (isLoggedIn) {
        if (view === Views.Login) {
          // After login, redirect to the returnUrl if one was provided
          // (e.g., the user came from a public page), otherwise go Home.
          // Note: we do NOT clear returnUrl here — mutating a signal inside
          // an effect would re-trigger it before the hash navigation completes,
          // causing a fallthrough to the Home redirect. The signal is naturally
          // overwritten from the URL the next time the login route is visited.
          const returnUrl = this.routingService.signals[Views.Login].urlParams.returnUrl();
          if (returnUrl) {
            this.routingService.navigateTo(returnUrl, { clearUrlParams: true });
          } else {
            this.routingService.navigateToParts(['']);
          }
        } else if (view === Views.MembersArea) {
          this.routingService.navigateToParts(['members-area', 'category', 'All']);
        } else if (view === Views.InstructorsArea) {
          this.routingService.navigateToParts(['instructors-area', 'category', 'All']);
        }
      }
    });
  }

  public incompleteProfile = computed(() => {
    const user = this.firebaseService.user();
    if (!user || !user.member) return false;
    return (
      (!user.member.name ||
        !user.member.dateOfBirth ||
        !user.member.country)
    );
  });

  viewIdToTitle(viewId: Views | ''): string {
    switch (viewId) {
      case Views.ManageMembers:
        return 'Manage Members';
      case Views.FindAnInstructor:
        return 'Find an Instructor';
      case Views.ManageSchools:
        return 'Manage Schools';
      case Views.ManageSchoolEdit:
        return this.loadedSchoolTitle() ? `Edit: ${this.loadedSchoolTitle()}` : 'Edit School';
      case Views.MySchoolEdit:
        return this.loadedSchoolTitle() || 'My School';
      case Views.FindSchool:
        return 'Find a School';
      case Views.ClassCalendarView:
        const calInstructorId = this.routingService.signals[Views.ClassCalendarView].pathVars.instructorId();
        const calInstructor = calInstructorId
          ? this.findInstructorsService.instructors.get(calInstructorId)
          : undefined;
        return calInstructor
          ? `${calInstructor.name} (${calInstructorId})'s Class Calendar`
          : 'Class Calendar';
      case Views.SchoolCalendarView:
        const calSchoolId = this.routingService.signals[Views.SchoolCalendarView].pathVars.schoolId();
        const calSchool = calSchoolId
          ? this.dataService.schools.get(calSchoolId)
          : undefined;
        return calSchool
          ? `${calSchool.schoolName}'s Calendar`
          : 'School Calendar';
      case Views.SchoolMembers:
        const schoolId =
          this.routingService.signals[viewId].pathVars.schoolId();
        return `School ${schoolId} Members`;
      case Views.InstructorStudents:
        return 'Students';
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
      case Views.MemberGradings:
        return 'Gradings';
      case Views.Settings:
        return 'Settings';
      case Views.Statistics:
        return 'Statistics';
      case Views.EventsCalendar:
        return 'Events & Workshops';
      case Views.EventView:
        return this.loadedEventTitle() || 'Event Details';
      case Views.EventEdit:
        return this.loadedEventTitle() ? `Edit: ${this.loadedEventTitle()}` : 'Edit Event';
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
      case Views.Login:
        return 'Login';
      case Views.NewMember:
        return 'New Member';
      case Views.MyStudentView: {
        const mIdOrDocId = this.routingService.signals[viewId].pathVars.memberId();
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
        const mIdOrDocId = this.routingService.signals[viewId].pathVars.memberId();
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
        return 'Unknown View';
    }
  }

  public logoutError = signal<string | null>(null);

  public async logout() {
    this.dismissMessages();
    const result = await this.firebaseService.logout();
    if (!result.success) {
      console.warn(result.errorCode);
      this.logoutError.set(result.errorCode);
    }
  }

  public dismissMessages() {
    this.logoutError.set(null);
    this.firebaseService.loginError.set(null);
  }
}
