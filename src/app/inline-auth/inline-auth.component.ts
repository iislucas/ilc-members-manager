/* inline-auth.component.ts
 *
 * Reusable guided authentication component for login and dedicated purchase pages
 * (e.g. Become a Member, Class Video Library, Next Grading, Licenses).
 *
 * Presents a smart step-based flow:
 * 1. User enters their email (or reads cached info).
 * 2. Checks email status via checkEmailStatus.
 * 3. Guides the user to Google Sign-In (if Google-managed), Password Login (if auth account exists),
 *    or Account Creation (if no auth account).
 * 4. When signed in, renders the user details badge and Log Out action.
 */

import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import { AuthErrorCodes } from 'firebase/auth';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { environment } from '../../environments/environment.local';
import { CheckEmailStatusResult } from '../../../functions/src/data-model';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';

export enum InlineAuthStep {
  Email = 'email',
  Checking = 'checking',
  GoogleSignin = 'google-signin',
  PasswordLogin = 'password-login',
  CreateAccount = 'create-account',
  GuestCreateAccount = 'guest-create-account',
  NoMember = 'no-member',
}

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
    // ignore
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
  selector: 'app-inline-auth',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './inline-auth.component.html',
  styleUrl: './inline-auth.component.scss',
})
export class InlineAuthComponent {
  public firebaseService = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  public user = this.firebaseService.user;
  public isLoggedIn = computed(() => !!this.user());
  public unverifiedEmail = computed(
    () => this.firebaseService.unverifiedUser()?.email || this.email(),
  );
  public isNeedsVerification = computed(
    () => this.firebaseService.loginStatus() === LoginStatus.NeedsEmailVerification,
  );

  showNoMemberOption = input<boolean>(false);

  InlineAuthStep = InlineAuthStep;
  LoginStatus = LoginStatus;
  adminEmail = environment.adminEmail;

  // Flow state
  step = signal<InlineAuthStep>(InlineAuthStep.Email);
  emailStatus = signal<CheckEmailStatusResult | null>(null);
  isReturningUser = signal<boolean>(false);

  // Form state
  email = signal<string>('');
  password = signal<string>('');
  showPassword = signal<boolean>(false);
  authLoading = signal<boolean>(false);

  // Error & message signals
  checkEmailError = signal<string | null>(null);
  loginError = signal<string | null>(null);
  invalidLoginCredentials = signal<boolean>(false);
  loginWithGoogleError = signal<string | null>(null);
  signupError = signal<string | null>(null);
  resetPasswordError = signal<string | null>(null);
  resetPasswordSuccess = signal<string | null>(null);
  resendSuccess = signal<string | null>(null);
  optionsMenuOpen = signal<boolean>(false);

  constructor() {
    const cached = getCachedLoginInfo();
    if (cached) {
      this.email.set(cached.email);
      this.emailStatus.set({
        hasMemberRecord: true,
        hasAuthAccount: cached.hasAuthAccount ?? true,
        isGoogleManaged: cached.isGoogleManaged ?? false,
      });
      this.isReturningUser.set(true);

      if (cached.preferredMethod === 'password') {
        this.step.set(InlineAuthStep.PasswordLogin);
      } else if (cached.preferredMethod === 'google') {
        this.step.set(InlineAuthStep.GoogleSignin);
      } else if (cached.isGoogleManaged) {
        this.step.set(InlineAuthStep.GoogleSignin);
      } else if (cached.hasAuthAccount) {
        this.step.set(InlineAuthStep.PasswordLogin);
      } else {
        this.step.set(InlineAuthStep.CreateAccount);
      }
    }
  }

  async checkEmail(): Promise<void> {
    const emailVal = this.email().trim();
    if (!emailVal) return;

    this.dismissMessages();
    this.isReturningUser.set(false);
    this.step.set(InlineAuthStep.Checking);

    try {
      const result = await this.firebaseService.checkEmailStatus(emailVal);
      this.emailStatus.set(result);

      if (!result.hasMemberRecord && !result.hasAuthAccount && this.showNoMemberOption()) {
        this.step.set(InlineAuthStep.NoMember);
      } else {
        let defaultStep: InlineAuthStep;
        let preferredMethod: 'password' | 'google' = 'password';

        if (result.hasAuthAccount) {
          if (result.hasPasswordProvider) {
            defaultStep = InlineAuthStep.PasswordLogin;
            preferredMethod = 'password';
          } else if (result.hasGoogleProvider) {
            defaultStep = InlineAuthStep.GoogleSignin;
            preferredMethod = 'google';
          } else {
            defaultStep = result.isGoogleManaged ? InlineAuthStep.GoogleSignin : InlineAuthStep.PasswordLogin;
            preferredMethod = result.isGoogleManaged ? 'google' : 'password';
          }
        } else {
          defaultStep = result.isGoogleManaged ? InlineAuthStep.GoogleSignin : InlineAuthStep.CreateAccount;
          preferredMethod = result.isGoogleManaged ? 'google' : 'password';
        }

        setCachedLoginInfo({
          email: emailVal,
          isGoogleManaged: result.isGoogleManaged,
          hasAuthAccount: result.hasAuthAccount,
          preferredMethod,
        });

        this.step.set(defaultStep);
      }
    } catch (error) {
      console.error('checkEmailStatus failed:', error);
      this.checkEmailError.set(
        'Unable to check email status. Please check your connection and try again.',
      );
      this.step.set(InlineAuthStep.Email);
    }
  }

  async loginWithGoogle(): Promise<void> {
    this.dismissMessages();
    this.authLoading.set(true);
    try {
      const result = await this.firebaseService.loginWithGoogle();
      if (result.success) {
        const emailVal = this.email().trim() || this.firebaseService.user()?.firebaseUser?.email || '';
        if (emailVal) {
          setCachedLoginInfo({
            email: emailVal,
            isGoogleManaged: true,
            hasAuthAccount: true,
            preferredMethod: 'google',
          });
        }
      } else {
        if (result.errorCode !== 'auth/cancelled-popup-request') {
          this.loginWithGoogleError.set(result.errorCode);
        }
      }
    } finally {
      this.authLoading.set(false);
    }
  }

  async loginWithEmail(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    const passVal = this.password();
    if (!emailVal || !passVal) return;

    this.authLoading.set(true);
    try {
      const result = await this.firebaseService.loginWithEmail(passVal, emailVal);
      if (result.success) {
        setCachedLoginInfo({
          email: emailVal,
          isGoogleManaged: this.emailStatus()?.isGoogleManaged ?? false,
          hasAuthAccount: true,
          preferredMethod: 'password',
        });
      } else {
        if (result.errorCode === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS) {
          this.invalidLoginCredentials.set(true);
        } else {
          this.loginError.set(`${result.errorCode}: please check your connection and credentials.`);
        }
      }
    } finally {
      this.authLoading.set(false);
    }
  }

  async signupWithEmail(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    const passVal = this.password();
    if (!emailVal || !passVal) return;

    this.authLoading.set(true);
    try {
      const result = await this.firebaseService.signupWithEmail(passVal, emailVal);
      if (result.success) {
        setCachedLoginInfo({
          email: emailVal,
          isGoogleManaged: this.emailStatus()?.isGoogleManaged ?? false,
          hasAuthAccount: true,
          preferredMethod: 'password',
        });
      } else {
        if (result.errorCode === 'auth/email-already-in-use') {
          this.signupError.set(
            'An account already exists for this email. Please sign in with your password, or reset it below.',
          );
        } else {
          this.signupError.set(result.errorCode);
        }
      }
    } finally {
      this.authLoading.set(false);
    }
  }

  async resetPassword(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    if (!emailVal) {
      this.resetPasswordError.set('Please enter your email address.');
      return;
    }
    const result = await this.firebaseService.resetPassword(emailVal);
    if (result.success) {
      this.resetPasswordSuccess.set(
        `A password reset link has been sent to ${emailVal} from ${environment.passwordResetEmailSender}.`,
      );
    } else {
      this.resetPasswordError.set(result.errorMessage);
    }
  }

  usePasswordInstead(): void {
    this.dismissMessages();
    const status = this.emailStatus();
    if (status?.hasAuthAccount) {
      this.step.set(InlineAuthStep.PasswordLogin);
    } else {
      this.step.set(InlineAuthStep.CreateAccount);
    }
  }

  useGoogleInstead(): void {
    this.dismissMessages();
    this.step.set(InlineAuthStep.GoogleSignin);
  }

  goBackToEmail(): void {
    this.password.set('');
    this.isReturningUser.set(false);
    this.step.set(InlineAuthStep.Email);
    this.dismissMessages();
    clearCachedLoginInfo();
  }

  async logout(): Promise<void> {
    await this.firebaseService.logout();
    this.step.set(InlineAuthStep.Email);
  }

  async checkEmailVerified(): Promise<void> {
    this.dismissMessages();
    this.authLoading.set(true);
    try {
      await this.firebaseService.checkEmailVerification();
    } finally {
      this.authLoading.set(false);
    }
  }

  async resendVerificationEmail(): Promise<void> {
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

  dismissMessages(): void {
    this.checkEmailError.set(null);
    this.loginError.set(null);
    this.invalidLoginCredentials.set(false);
    this.loginWithGoogleError.set(null);
    this.signupError.set(null);
    this.resetPasswordError.set(null);
    this.resetPasswordSuccess.set(null);
    this.resendSuccess.set(null);
    this.optionsMenuOpen.set(false);
    this.firebaseService.loginError.set(null);
    this.firebaseService.verificationError.set(null);
  }
}
