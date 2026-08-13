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

import { Component, computed, inject, signal } from '@angular/core';
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
  GuestCreateAccount = 'guest-create-account',
}

// Cached login info persisted to localStorage.
type CachedLoginInfo = {
  email: string;
  isGoogleManaged?: boolean;
  hasAuthAccount?: boolean;
  preferredMethod?: 'password' | 'google';
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

import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent {
  firebaseService = inject(FirebaseStateService);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
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
  verificationError = signal<string | null>(null);
  resendSuccess = signal<string | null>(null);
  authLoading = signal<boolean>(false);

  unverifiedEmail = computed(
    () => this.firebaseService.unverifiedUser()?.email || this.loginEmail(),
  );

  constructor() {
    // Check for cached login info from a previous session.
    const cached = getCachedLoginInfo();
    if (cached) {
      this.loginEmail.set(cached.email);
      this.emailStatus.set({
        hasMemberRecord: true, // only cached when this is true
        hasAuthAccount: cached.hasAuthAccount ?? true,
        isGoogleManaged: cached.isGoogleManaged ?? false,
      });
      this.isReturningUser.set(true);

      if (cached.preferredMethod === 'password') {
        this.loginStep.set(LoginStep.PasswordLogin);
      } else if (cached.preferredMethod === 'google') {
        this.loginStep.set(LoginStep.GoogleSignin);
      } else if (cached.isGoogleManaged) {
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

      if (!result.hasMemberRecord && !result.hasAuthAccount) {
        this.loginStep.set(LoginStep.NoMember);
      } else {
        // Determine default step:
        // 1. If account exists with password, default to PasswordLogin.
        // 2. If account exists with Google only, default to GoogleSignin.
        // 3. If no auth account yet: if Google-managed domain, default to GoogleSignin, else CreateAccount.
        let defaultStep: LoginStep;
        let preferredMethod: 'password' | 'google' = 'password';

        if (result.hasAuthAccount) {
          if (result.hasPasswordProvider) {
            defaultStep = LoginStep.PasswordLogin;
            preferredMethod = 'password';
          } else if (result.hasGoogleProvider) {
            defaultStep = LoginStep.GoogleSignin;
            preferredMethod = 'google';
          } else {
            defaultStep = result.isGoogleManaged ? LoginStep.GoogleSignin : LoginStep.PasswordLogin;
            preferredMethod = result.isGoogleManaged ? 'google' : 'password';
          }
        } else {
          defaultStep = result.isGoogleManaged ? LoginStep.GoogleSignin : LoginStep.CreateAccount;
          preferredMethod = result.isGoogleManaged ? 'google' : 'password';
        }

        // Cache for returning-user experience next time.
        setCachedLoginInfo({
          email,
          isGoogleManaged: result.isGoogleManaged,
          hasAuthAccount: result.hasAuthAccount,
          preferredMethod,
        });

        this.loginStep.set(defaultStep);
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
      const email = this.loginEmail().trim() || this.firebaseService.user()?.firebaseUser?.email || '';
      if (email) {
        setCachedLoginInfo({
          email,
          isGoogleManaged: true,
          hasAuthAccount: true,
          preferredMethod: 'google',
        });
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
        preferredMethod: 'password',
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
        preferredMethod: 'password',
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
        this.signupError.set(result.errorCode);
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
    this.dismissMessages();
    const status = this.emailStatus();
    if (status?.hasAuthAccount) {
      this.loginStep.set(LoginStep.PasswordLogin);
    } else {
      this.loginStep.set(LoginStep.CreateAccount);
    }
  }

  // From the PasswordLogin step, switch to Google signin.
  useGoogleInstead() {
    this.dismissMessages();
    this.loginStep.set(LoginStep.GoogleSignin);
  }

  goBackToEmail() {
    this.loginPassword.set('');
    this.isReturningUser.set(false);
    this.loginStep.set(LoginStep.Email);
    this.dismissMessages();
    clearCachedLoginInfo();
  }

  async checkEmailVerified() {
    this.dismissMessages();
    this.authLoading.set(true);
    try {
      const res = await this.firebaseService.checkEmailVerification();
      if (!res.verified && res.message) {
        this.verificationError.set(res.message);
      }
    } finally {
      this.authLoading.set(false);
    }
  }

  async resendVerificationEmail() {
    this.dismissMessages();
    this.authLoading.set(true);
    try {
      const res = await this.firebaseService.resendVerificationEmail();
      if (res.success) {
        this.resendSuccess.set('A new verification email has been sent! Please check your inbox.');
      }
    } finally {
      this.authLoading.set(false);
    }
  }

  async logout() {
    await this.firebaseService.logout();
    this.loginStep.set(LoginStep.Email);
  }

  dismissMessages() {
    this.checkEmailError.set(null);
    this.loginError.set(null);
    this.invalidLoginCredentials.set(false);
    this.loginWithGoogleError.set(null);
    this.signupError.set(null);
    this.resetPasswordError.set(null);
    this.resetPasswordSuccess.set(null);
    this.verificationError.set(null);
    this.resendSuccess.set(null);
    this.firebaseService.loginError.set(null);
  }
}
