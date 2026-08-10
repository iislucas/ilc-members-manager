import { Component, computed, inject, signal, effect, HostListener, Signal } from '@angular/core';
import { FirebaseStateService, LoginStatus } from './firebase-state.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FooterComponent } from './footer/footer';
import { IconComponent } from './icons/icon.component';
import { ImportExportComponent } from './import-export/import-export';
import { SpinnerComponent } from './spinner/spinner.component';
import { RoutingService } from './routing.service';
import { AppPathPatterns, Views, PUBLIC_VIEWS } from './app.config';
import { FindAnInstructorComponent } from './find-an-instructor/find-an-instructor';
import { InstructorViewComponent } from './instructor-view/instructor-view';
import { FindInstructorsService } from './find-instructors.service';
import { SchoolListComponent } from './school-list/school-list';
import { SchoolEditComponent } from './school-edit/school-edit';
import { DataManagerService, DataServiceState } from './data-manager.service';
import { SchoolMembersComponent } from './school-members/school-members';
import { InstructorStudentsComponent } from './instructor-students/instructor-students';
import { FilteredMembersComponent } from './filtered-members/filtered-members';
import { MemberDetailsComponent } from './member-details/member-details';
import { FindSchoolComponent } from './find-school/find-school';
import { SchoolViewComponent } from './school-view/school-view';
import { HomeComponent } from './home/home';
import { ClassCalendarComponent } from './class-calendar/class-calendar';
import { SquarespaceContentComponent } from './squarespace/squarespace-content.component';
import { SquarespaceArticleComponent } from './squarespace/squarespace-article.component';
import { GradingListComponent } from './grading-list/grading-list';
import { GradingViewComponent } from './grading-view/grading-view';
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
import { DownloadResourceComponent } from './download-resource/download-resource';
import { NotificationSettingsComponent } from './settings/notification-settings/notification-settings.component';
import { NotificationsViewComponent } from './notifications-view/notifications-view';
import { ProductsComponent } from './products/products';
import { OrderCompleteComponent } from './order-complete/order-complete';
import { MyMaterialsComponent } from './my-materials/my-materials';
import { ManageMaterialsComponent } from './manage-materials/manage-materials';
import { NotFoundComponent } from './not-found/not-found';
import { MembershipType } from '../../functions/src/data-model';
import { APP_VERSION } from './version';
import { NavigationTreeService } from './navigation-tree';

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
    InstructorViewComponent,
    SchoolListComponent,
    SchoolEditComponent,
    SchoolMembersComponent,
    InstructorStudentsComponent,
    FilteredMembersComponent,
    MemberDetailsComponent,
    FindSchoolComponent,
    SchoolViewComponent,
    HomeComponent,
    ClassCalendarComponent,
    SquarespaceContentComponent,
    SquarespaceArticleComponent,
    GradingListComponent,
    GradingViewComponent,
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
    DownloadResourceComponent,
    NotificationSettingsComponent,
    NotificationsViewComponent,
    ProductsComponent,
    OrderCompleteComponent,
    MyMaterialsComponent,
    ManageMaterialsComponent,
    NotFoundComponent,
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
  public navTree = inject(NavigationTreeService);
  public menuOpen = signal(false);

  public isNotFound = computed(() => this.currentView() === null);

  public isPublicPage = computed(() => {
    const view = this.currentView();
    return !!view && PUBLIC_VIEWS.has(view);
  });

  onEventTitleLoaded(title: string) {
    this.navTree.loadedEventTitle.set(title);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    // Legacy hash-routing links (`/#/resources/...`, `#/notifications`) name an
    // app route, not an in-page anchor — they still turn up in older emails and
    // notifications. main.ts rewrites them to their path equivalent, but only on
    // a cold load; a click from inside the app is handled here and never
    // reloads, so without the same rewrite we would `preventDefault` and push
    // `/#/resources/...`, leaving the user on Home with the fragment stuck in
    // the URL.
    const linkPath = href.startsWith('/#/')
      ? href.substring(2)
      : href.startsWith('#/')
        ? href.substring(1)
        : href;

    if (
      !linkPath.startsWith('http') &&
      !linkPath.startsWith('//') &&
      !linkPath.startsWith('#') &&
      !linkPath.startsWith('mailto:') &&
      !linkPath.startsWith('tel:') &&
      !anchor.hasAttribute('download') &&
      anchor.getAttribute('target') !== '_blank' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.button === 0
    ) {
      event.preventDefault();
      let path = linkPath;
      if (path.startsWith('/')) {
        path = path.substring(1);
      }
      this.routingService.navigateTo(path);
    }
  }

  onOrderTitleLoaded(title: string) {
    this.navTree.loadedOrderTitle.set(title);
  }

  onSchoolTitleLoaded(title: string) {
    this.navTree.loadedSchoolTitle.set(title);
  }
  onGradingTitleLoaded(title: string) {
    this.navTree.loadedGradingTitle.set(title);
  }
  onInstructorTitleLoaded(title: string) {
    this.navTree.loadedInstructorTitle.set(title);
  }
  // Breadcrumbs, the current view and its title all come from the navigation
  // tree, which the in-page back links are derived from too — see
  // NavigationTreeService. That is what keeps the two in step.
  public breadcrumbs: Signal<Breadcrumb[]> = this.navTree.breadcrumbs;
  public currentView = this.navTree.currentView;
  public currentViewTitle = this.navTree.currentTitle;


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

  constructor() {
    effect(() => {
      const isLoggedOut =
        this.firebaseService.loginStatus() === LoginStatus.SignedOut;
      const isLoggedIn =
        this.firebaseService.loginStatus() === LoginStatus.SignedIn;
      const view = this.routingService.matchedPatternId();

      const isOnPublicPage = !!view && PUBLIC_VIEWS.has(view);
      if (isLoggedOut && view === Views.Home) {
        this.routingService.navigateToParts(['login']);
      } else if (isLoggedOut && view === Views.Login) {
        // Stay on login page
      } else if (isLoggedOut && (isOnPublicPage || !view)) {
        // Stay on public page or not found page — login is available in header
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

    effect(() => {
      const title = this.currentViewTitle();
      document.title = title ? `${title} | I Liq Chuan Members Portal App` : 'I Liq Chuan Members Portal App';
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
