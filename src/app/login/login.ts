/* Guided login component.
 *
 * Presents a step-based login flow:
 * 1. User enters their email (skipped for returning users via localStorage cache).
 * 2. A server-side check determines whether the email has a member record,
 *    an existing Firebase Auth account, and whether it's Google-managed.
 * 3. Based on the result the user is guided to:
 *    - Sign in with Google (for Google-managed emails with a member record),
 *    - Enter their password (for existing auth accounts),
 *    - Create a new password (for known members without an auth account), or
 *    - An informational message (if no member record exists).
 *
 * The last known email and login method are cached in localStorage so
 * returning users can skip the email entry step entirely.
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
  GoogleSignin = 'google-signin',
  PasswordLogin = 'password-login',
  CreateAccount = 'create-account',
  NoMember = 'no-member',
}

// Cached login info persisted to localStorage.
type CachedLoginInfo = {
  email: string;
  isGoogleManaged: boolean;
  hasAuthAccount: boolean;
};

const CACHED_LOGIN_KEY = 'ilc-login-info';

function getCachedLoginInfo(): CachedLoginInfo | null {
  try {
    const raw = localStorage.getItem(CACHED_LOGIN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedLoginInfo;
  } catch {
    return null;
  }
}

function setCachedLoginInfo(info: CachedLoginInfo): void {
  try {
    localStorage.setItem(CACHED_LOGIN_KEY, JSON.stringify(info));
  } catch {
    // localStorage might be unavailable or full
  }
}

function clearCachedLoginInfo(): void {
  try {
    localStorage.removeItem(CACHED_LOGIN_KEY);
  } catch {
    // ignore
  }
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
  // True when the flow was initialised from a localStorage cache (skip email step).
  isReturningUser = signal(false);

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

  constructor() {
    // Check for cached login info from a previous session.
    const cached = getCachedLoginInfo();
    if (cached) {
      this.loginEmail.set(cached.email);
      this.emailStatus.set({
        hasMemberRecord: true, // only cached when this is true
        hasAuthAccount: cached.hasAuthAccount,
        isGoogleManaged: cached.isGoogleManaged,
      });
      this.isReturningUser.set(true);

      if (cached.isGoogleManaged) {
        this.loginStep.set(LoginStep.GoogleSignin);
      } else if (cached.hasAuthAccount) {
        this.loginStep.set(LoginStep.PasswordLogin);
      } else {
        this.loginStep.set(LoginStep.CreateAccount);
      }
    }
  }

  // Step 1 → 2: check the email and decide which step to show next.
  async checkEmail() {
    const email = this.loginEmail().trim();
    if (!email) return;

    this.dismissMessages();
    this.isReturningUser.set(false);
    this.loginStep.set(LoginStep.Checking);

    try {
      const result = await this.firebaseService.checkEmailStatus(email);
      this.emailStatus.set(result);

      if (!result.hasMemberRecord) {
        this.loginStep.set(LoginStep.NoMember);
      } else {
        // Cache for returning-user experience next time.
        setCachedLoginInfo({
          email,
          isGoogleManaged: result.isGoogleManaged,
          hasAuthAccount: result.hasAuthAccount,
        });

        if (result.isGoogleManaged) {
          this.loginStep.set(LoginStep.GoogleSignin);
        } else if (result.hasAuthAccount) {
          this.loginStep.set(LoginStep.PasswordLogin);
        } else {
          this.loginStep.set(LoginStep.CreateAccount);
        }
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
    if (result.success) {
      // Update cache: they now definitely have an auth account.
      const email = this.loginEmail().trim();
      if (email) {
        setCachedLoginInfo({ email, isGoogleManaged: true, hasAuthAccount: true });
      }
    } else {
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
    if (result.success) {
      // Update cache: they have a working auth account.
      setCachedLoginInfo({
        email,
        isGoogleManaged: this.emailStatus()?.isGoogleManaged ?? false,
        hasAuthAccount: true,
      });
    } else {
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
    if (result.success) {
      // Update cache: they now have an auth account.
      setCachedLoginInfo({
        email,
        isGoogleManaged: this.emailStatus()?.isGoogleManaged ?? false,
        hasAuthAccount: true,
      });
    } else {
      console.warn(result.errorCode);
      if (result.errorCode === AuthErrorCodes.EMAIL_EXISTS) {
        // Account already exists — redirect to password step.
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

  // From the GoogleSignin step, go to the appropriate password step.
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
    this.isReturningUser.set(false);
    this.loginStep.set(LoginStep.Email);
    this.dismissMessages();
    clearCachedLoginInfo();
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
