import { Component, inject, signal } from '@angular/core';
import { FirebaseStateService } from './firebase-state.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AuthErrorCodes } from 'firebase/auth';
import { CommonModule } from '@angular/common';
import { UnauthorizedComponent } from './unauthorized/unauthorized';
import { MemberListComponent } from './member-list/member-list';
import { FooterComponent } from './footer/footer';
import { MemberViewComponent } from './member-view/member-view';
import { IconComponent } from './icons/icon.component';
import { MemberImportExportComponent } from './member-import-export/member-import-export';
import { SpinnerComponent } from './spinner/spinner.component';
import { RoutingService } from './routing.service';
import { Views } from './app.config';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MemberListComponent,
    UnauthorizedComponent,
    FooterComponent,
    MemberViewComponent,
    IconComponent,
    MemberImportExportComponent,
    SpinnerComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected title = 'ilc-members-manager';
  public firebaseService = inject(FirebaseStateService);
  public routingService = inject(RoutingService);
  public menuOpen = signal(false);
  public currentView = this.routingService.signals['view'];
  public Views = Views;

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
      this.loginWithGoogleError.set(result.errorCode);
    }
  }

  public async loginWithEmail(email: string, pass: string) {
    this.dismissMessages();
    const result = await this.firebaseService.loginWithEmail(pass, email);
    if (!result.success) {
      this.loginWithEmailError.set(result.errorCode);
      if (result.errorCode === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS) {
        this.invalidLoginCredentials.set(true);
      }
    }
  }

  public async signupWithEmail(email: string, pass: string) {
    this.dismissMessages();
    const result = await this.firebaseService.signupWithEmail(pass, email);
    if (!result.success) {
      this.signupError.set(result.errorCode);
    }
  }

  public async resetPassword(email: string) {
    this.dismissMessages();
    if (!email) {
      this.resetPasswordError.set(
        'Please enter your email address to reset your password.'
      );
      return;
    }
    const result = await this.firebaseService.resetPassword(email);
    if (result.success) {
      this.resetPasswordSuccess.set(
        'A password reset link has been sent to your email.'
      );
    } else {
      this.resetPasswordError.set(result.errorMessage);
    }
  }

  public async logout() {
    this.dismissMessages();
    const result = await this.firebaseService.logout();
    if (!result.success) {
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
  }
}
