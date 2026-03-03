import { Component, computed, inject, signal, effect } from '@angular/core';
import { FirebaseStateService, LoginStatus } from './firebase-state.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AuthErrorCodes } from 'firebase/auth';
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
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected title = 'ilc-members-manager';
  public firebaseService = inject(FirebaseStateService);
  public dataService = inject(DataManagerService);
  public findInstructorsService = inject(FindInstructorsService);
  public routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);
  public menuOpen = signal(false);
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
      } else if (view === Views.InstructorStudentView) {
        const instructorId = this.routingService.signals[Views.InstructorStudentView].pathVars.instructorId();
        baseBreadcrumbs.push({ label: `Instructor ${instructorId}'s Students`, url: `#/instructor/${instructorId}/students` });
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
      }
      baseBreadcrumbs.push({ label: this.currentViewTitle() });
    }
    return baseBreadcrumbs;
  });
  public currentView = computed(() => {
    const view = this.routingService.matchedPatternId() as Views | null;
    if (view === Views.MembersArea) return Views.MembersAreaCategory;
    if (view === Views.InstructorsArea) return Views.InstructorsAreaCategory;
    return view;
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

      if (isLoggedOut && (!view || view === Views.Home)) {
        this.routingService.navigateToParts(['login']);
      } else if (isLoggedIn) {
        if (view === Views.Login) {
          // Redirect to Home
          this.routingService.navigateToParts(['']);
        } else if (view === Views.MembersArea) {
          this.routingService.navigateToParts(['members-area', 'category', 'All']);
        } else if (view === Views.InstructorsArea) {
          this.routingService.navigateToParts(['instructors-area', 'category', 'All']);
        }
      }
    });
  }

  viewIdToTitle(viewId: Views | ''): string {
    switch (viewId) {
      case Views.ManageMembers:
        return 'Manage Members';
      case Views.FindAnInstructor:
        return 'Find an Instructor';
      case Views.ManageSchools:
        return 'Manage Schools';
      case Views.FindSchool:
        return 'Find a School';
      case Views.ClassCalendarView:
        const calInstructorId = this.routingService.signals[Views.ClassCalendarView].urlParams.instructorId();
        const calInstructor = calInstructorId
          ? this.findInstructorsService.instructors.entriesMap().get(calInstructorId)
          : undefined;
        return calInstructor
          ? `${calInstructor.name} (${calInstructorId})'s Class Calendar`
          : 'Class Calendar';
      case Views.SchoolMembers:
        const schoolId =
          this.routingService.signals[viewId].pathVars.schoolId();
        return `School ${schoolId} Members`;
      case Views.InstructorStudents:
        const instructorId =
          this.routingService.signals[viewId].pathVars.instructorId();
        return `Instructor ${instructorId}'s Students`;
      case Views.ImportExport:
        return 'Import/Export';
      case Views.Home:
        return 'Home';
      case Views.MyProfile:
        return 'My Profile';
      case Views.MyStudents:
        return 'My Students';
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
      case Views.ClassVideoLibrary:
        return 'Class Video Library';
      case Views.ManageOrders:
        return 'Manage Orders';
      case Views.OrderView:
        const orderId =
          this.routingService.signals[viewId].pathVars['orderId']();
        return `Order ${orderId}`;
      case Views.MembersAreaPost:
      case Views.InstructorsAreaPost:
        return 'Article';
      case Views.Login:
        return 'Login';
      case Views.NewMember:
        return 'New Member';
      case Views.ManageMemberView:
      case Views.SchoolMemberView:
      case Views.InstructorStudentView:
      case Views.MyStudentView:
        const memberIdToName = (memberId: string) => {
          const m = this.dataService.members.entries().find(m => m.memberId === memberId || m.docId === memberId);
          return m ? m.name : 'Unknown Member';
        };
        const mId = (this.routingService.signals as any)[viewId].pathVars.memberId();
        return `${mId}: ${memberIdToName(mId)}`;
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
