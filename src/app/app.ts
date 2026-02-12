import { Component, computed, inject, signal } from '@angular/core';
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
import { ProfileMenuComponent } from './profile-menu/profile-menu';
import { SchoolListComponent } from './school-list/school-list';
import { DataManagerService, DataServiceState } from './data-manager.service';
import { SchoolMembersComponent } from './school-members/school-members';
import { FilteredMembersComponent } from './filtered-members/filtered-members';
import { MemberEditComponent } from './member-edit/member-edit';
import { FindSchoolComponent } from './find-school/find-school';

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
    ProfileMenuComponent,
    SchoolListComponent,
    SchoolMembersComponent,
    FilteredMembersComponent,
    MemberEditComponent,
    MemberEditComponent,
    FindSchoolComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected title = 'ilc-members-manager';
  public firebaseService = inject(FirebaseStateService);
  public dataService = inject(DataManagerService);
  public routingService: RoutingService<AppPathPatterns> =
    inject(RoutingService);
  public menuOpen = signal(false);
  public currentView = this.routingService.matchedPatternId;
  public Views = Views;
  public LoginStatus = LoginStatus;
  public DataServiceState = DataServiceState;
  public jumpToMemberInUrlParams = computed(() => {
    const patternId = this.routingService.matchedPatternId();
    if (
      patternId === Views.SchoolMembers ||
      patternId === Views.ManageMembers
    ) {
      return this.routingService.signals[patternId].urlParams.memberId();
    }
    return '';
  });

  currentViewTitle = computed(() => {
    return this.viewIdToTitle(
      this.routingService.matchedPatternId() as Views | '',
    );
  });

  constructor() {}

  viewIdToTitle(viewId: Views | ''): string {
    switch (viewId) {
      case Views.ManageMembers:
        return 'Manage Members';
      case Views.FindAnInstructor:
        return 'Find an Instructor';
      case Views.Schools:
        return 'Manage Schools';
      case Views.FindSchool:
        return 'Find a School';
      case Views.SchoolMembers:
        const schoolId =
          this.routingService.signals[viewId].pathVars.schoolId();
        return `School ${schoolId} Members`;
      case Views.ImportExport:
        return 'Import/Export';
      case Views.Home:
        return 'Members';
      case Views.MyProfile:
        return 'My Profile';
      case Views.MyStudents:
        return 'My Students';
      default:
        return 'Unknown View';
    }
  }

  // One error/success message signal for each user action
  public loginWithEmailError = signal<string | null>(null);
  public invalidLoginCredentials = signal<boolean>(false);
  public loginWithGoogleError = signal<string | null>(null);
  public signupError = signal<string | null>(null);
  public resetPasswordError = signal<string | null>(null);
  public resetPasswordSuccess = signal<string | null>(null);
  public logoutError = signal<string | null>(null);

  public async loginWithGoogle() {
    this.dismissMessages();
    const result = await this.firebaseService.loginWithGoogle();
    if (!result.success) {
      console.warn(result.errorCode);
      this.loginWithGoogleError.set(result.errorCode);
    }
  }

  public async loginWithEmail(email: string, pass: string) {
    this.dismissMessages();
    const result = await this.firebaseService.loginWithEmail(pass, email);
    if (!result.success) {
      console.warn(result.errorCode);
      this.loginWithEmailError.set(
        `${result.errorCode}: check you are online?`,
      );
      if (result.errorCode === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS) {
        this.invalidLoginCredentials.set(true);
      }
    }
  }

  public async signupWithEmail(email: string, pass: string) {
    this.dismissMessages();
    const result = await this.firebaseService.signupWithEmail(pass, email);
    if (!result.success) {
      console.warn(result.errorCode);
      this.signupError.set(`${result.errorCode}: check you are online?`);
    }
  }

  public async resetPassword(email: string) {
    this.dismissMessages();
    if (!email) {
      console.warn('resetPasswordError: no email provided');
      this.resetPasswordError.set(
        'Please enter your email address to reset your password.',
      );
      return;
    }
    const result = await this.firebaseService.resetPassword(email);
    if (result.success) {
      this.resetPasswordSuccess.set(
        'A password reset link has been sent to your email.',
      );
    } else {
      console.warn(result.errorMessage);
      this.resetPasswordError.set(result.errorMessage);
    }
  }

  public async logout() {
    this.dismissMessages();
    const result = await this.firebaseService.logout();
    if (!result.success) {
      console.warn(result.errorCode);
      this.logoutError.set(result.errorCode);
    }
  }

  public dismissMessages() {
    this.loginWithEmailError.set(null);
    this.invalidLoginCredentials.set(false);
    this.loginWithGoogleError.set(null);
    this.signupError.set(null);
    this.resetPasswordError.set(null);
    this.resetPasswordSuccess.set(null);
    this.logoutError.set(null);
    this.firebaseService.loginError.set(null);
  }
}
