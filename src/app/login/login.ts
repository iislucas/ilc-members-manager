/* Guided login component.
 *
 * Presents a step-based login flow:
 * 1. User enters their email.
 * 2. A server-side check determines whether the email has a member record,
 *    an existing Firebase Auth account, and whether it's Google-managed.
 * 3. Based on the result the user is guided to:
 *    - Sign in with Google (for Google-managed emails with a member record),
 *    - Enter their password (for existing auth accounts),
 *    - Create a new password (for known members without an auth account), or
 *    - An informational message (if no member record exists).
 */

import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import { AuthErrorCodes } from 'firebase/auth';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { environment } from '../../environments/environment.local';
import { CheckEmailStatusResult } from '../../../functions/src/data-model';

// Steps in the guided login flow.
export enum LoginStep {
  Email = 'email',
  Checking = 'checking',
  GoogleSuggested = 'google-suggested',
  PasswordLogin = 'password-login',
  CreateAccount = 'create-account',
  NoMember = 'no-member',
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent {
  firebaseService = inject(FirebaseStateService);
  LoginStatus = LoginStatus;
  LoginStep = LoginStep;
  adminEmail = environment.adminEmail;

  // Flow state
  loginStep = signal<LoginStep>(LoginStep.Email);
  emailStatus = signal<CheckEmailStatusResult | null>(null);

  // Form state
  loginEmail = signal<string>('');
  loginPassword = signal<string>('');
  showPassword = signal<boolean>(false);

  // Error / success message signals
  checkEmailError = signal<string | null>(null);
  loginError = signal<string | null>(null);
  invalidLoginCredentials = signal<boolean>(false);
  loginWithGoogleError = signal<string | null>(null);
  signupError = signal<string | null>(null);
  resetPasswordError = signal<string | null>(null);
  resetPasswordSuccess = signal<string | null>(null);

  // Step 1 → 2: check the email and decide which step to show next.
  async checkEmail() {
    const email = this.loginEmail().trim();
    if (!email) return;

    this.dismissMessages();
    this.loginStep.set(LoginStep.Checking);

    try {
      const result = await this.firebaseService.checkEmailStatus(email);
      this.emailStatus.set(result);

      if (!result.hasMemberRecord) {
        this.loginStep.set(LoginStep.NoMember);
      } else if (result.isGoogleManaged) {
        this.loginStep.set(LoginStep.GoogleSuggested);
      } else if (result.hasAuthAccount) {
        this.loginStep.set(LoginStep.PasswordLogin);
      } else {
        this.loginStep.set(LoginStep.CreateAccount);
      }
    } catch (error: unknown) {
      console.error('checkEmailStatus failed:', error);
      this.checkEmailError.set(
        'Unable to check email status. Please check your connection and try again.',
      );
      this.loginStep.set(LoginStep.Email);
    }
  }

  async loginWithGoogle() {
    this.dismissMessages();
    const result = await this.firebaseService.loginWithGoogle();
    if (!result.success) {
      console.warn(result.errorCode);
      if (result.errorCode !== 'auth/cancelled-popup-request') {
        this.loginWithGoogleError.set(result.errorCode);
      }
    }
  }

  async loginWithEmail() {
    this.dismissMessages();
    const email = this.loginEmail().trim();
    const pass = this.loginPassword();
    const result = await this.firebaseService.loginWithEmail(pass, email);
    if (!result.success) {
      console.warn(result.errorCode);
      if (result.errorCode === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS) {
        this.invalidLoginCredentials.set(true);
      } else {
        this.loginError.set(`${result.errorCode}: check you are online?`);
      }
    }
  }

  async signupWithEmail() {
    this.dismissMessages();
    const email = this.loginEmail().trim();
    const pass = this.loginPassword();
    const result = await this.firebaseService.signupWithEmail(pass, email);
    if (!result.success) {
      console.warn(result.errorCode);
      if (result.errorCode === AuthErrorCodes.EMAIL_EXISTS) {
        // Account already exists (e.g. created via Google) — redirect to password step.
        this.loginStep.set(LoginStep.PasswordLogin);
        this.loginError.set(
          'An account already exists for this email. Please sign in with your password, or reset it below.',
        );
      } else {
        this.signupError.set(`${result.errorCode}: check you are online?`);
      }
    }
  }

  async resetPassword() {
    this.dismissMessages();
    const email = this.loginEmail().trim();
    if (!email) {
      this.resetPasswordError.set('Please enter your email address.');
      return;
    }
    const result = await this.firebaseService.resetPassword(email);
    if (result.success) {
      this.resetPasswordSuccess.set(
        `A password reset link has been sent to ${email}` +
        ` from ${environment.passwordResetEmailSender}.`,
      );
    } else {
      console.warn(result.errorMessage);
      this.resetPasswordError.set(result.errorMessage);
    }
  }

  // From the GoogleSuggested step, go to the appropriate password step.
  usePasswordInstead() {
    const status = this.emailStatus();
    if (status?.hasAuthAccount) {
      this.loginStep.set(LoginStep.PasswordLogin);
    } else {
      this.loginStep.set(LoginStep.CreateAccount);
    }
  }

  goBackToEmail() {
    this.loginPassword.set('');
    this.loginStep.set(LoginStep.Email);
    this.dismissMessages();
  }

  dismissMessages() {
    this.checkEmailError.set(null);
    this.loginError.set(null);
    this.invalidLoginCredentials.set(false);
    this.loginWithGoogleError.set(null);
    this.signupError.set(null);
    this.resetPasswordError.set(null);
    this.resetPasswordSuccess.set(null);
    this.firebaseService.loginError.set(null);
  }
}
