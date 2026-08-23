/* inline-auth.component.ts
 *
 * The single guided sign-in flow for the whole app: the login page renders it,
 * and so does every purchase page (Become a Member, Class Video Library, Next
 * Grading, Licenses).
 *
 * Steps:
 * 1. The user enters their email.
 * 2. checkEmailStatus reports whether a member record and/or auth account
 *    exists, and which providers that account has.
 * 3. The user is guided to Google Sign-In, a password login, or account
 *    creation, whichever actually applies.
 * 4. Once signed in, the user badge and Log Out action are rendered instead.
 *
 * The email is never a dead end: at every step past the first it is a button
 * that returns to email entry, so a wrong address is always one tap from being
 * corrected.
 */

import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import {
  googleSignInErrorMessage,
  isPasswordResettable,
  passwordResetErrorMessage,
  signInErrorMessage,
  signUpErrorMessage,
} from './auth-error-messages';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { environment } from '../../environments/environment';
import { CheckEmailStatusResult } from '../../../functions/src/data-model';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';
import { SignInFlowService } from './sign-in-flow.service';

export enum InlineAuthStep {
  Email = 'email',
  Checking = 'checking',
  GoogleSignin = 'google-signin',
  PasswordLogin = 'password-login',
  CreateAccount = 'create-account',
  GuestCreateAccount = 'guest-create-account',
  NoMember = 'no-member',
}

export type LoginMethod = 'password' | 'google';

/**
 * A sign-in this browser has actually completed before.
 *
 * Written only after authentication succeeds, so every field records something
 * observed rather than assumed. (An earlier version cached the email as soon as
 * it was typed, which pinned typos forever and let a signed-out browser show
 * the previous person's address.)
 */
export type RememberedLogin = {
  email: string;
  /** The provider that actually worked last time. */
  method: LoginMethod;
  /** Whether Google sign-in was available for this email when last checked. */
  canUseGoogle: boolean;
};

export const REMEMBERED_LOGIN_KEY = 'ilc-remembered-login';

/** The pre-authentication cache this replaced; removed wherever it lingers. */
const LEGACY_LOGIN_KEY = 'ilc-login-info';

export function readRememberedLogin(): RememberedLogin | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_LOGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    // Anything not written by the current code is discarded rather than
    // half-trusted; the cost is one extra email entry.
    if (!parsed || typeof parsed.email !== 'string' || !parsed.email.trim()) {
      return null;
    }
    if (parsed.method !== 'password' && parsed.method !== 'google') return null;
    return {
      email: parsed.email,
      method: parsed.method,
      canUseGoogle: parsed.canUseGoogle === true,
    };
  } catch {
    return null;
  }
}

export function writeRememberedLogin(info: RememberedLogin): void {
  try {
    localStorage.setItem(REMEMBERED_LOGIN_KEY, JSON.stringify(info));
  } catch {
    // localStorage may be unavailable or full; remembering is best-effort.
  }
}

export function forgetRememberedLogin(): void {
  try {
    localStorage.removeItem(REMEMBERED_LOGIN_KEY);
  } catch {
    // ignore
  }
}

/** One-time cleanup of the cache this replaced. */
export function forgetLegacyLoginCache(): void {
  try {
    localStorage.removeItem(LEGACY_LOGIN_KEY);
  } catch {
    // ignore
  }
}

@Component({
  selector: 'app-inline-auth',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, IconComponent, SpinnerComponent],
  templateUrl: './inline-auth.component.html',
  styleUrl: './inline-auth.component.scss',
})
export class InlineAuthComponent implements OnInit {
  public firebaseService = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  private signInFlow = inject(SignInFlowService);
  public user = this.firebaseService.user;
  public isLoggedIn = computed(() => !!this.user());
  public unverifiedEmail = computed(
    () => this.firebaseService.unverifiedUser()?.email || this.email(),
  );
  public isNeedsVerification = computed(
    () => this.firebaseService.loginStatus() === LoginStatus.NeedsEmailVerification,
  );

  /**
   * Offer "Become a Member" / "create an account anyway" when an email matches
   * no member record. The login page wants this; the purchase pages do not,
   * because they are already the place where an account gets created.
   */
  showNoMemberOption = input<boolean>(false);

  InlineAuthStep = InlineAuthStep;
  LoginStatus = LoginStatus;
  adminEmail = environment.adminEmail;

  // Flow state
  step = signal<InlineAuthStep>(InlineAuthStep.Email);

  /** The result of a real lookup. Null until checkEmailStatus has run. */
  emailStatus = signal<CheckEmailStatusResult | null>(null);

  /** A previous successful sign-in restored from this browser, if any. */
  remembered = signal<RememberedLogin | null>(null);

  // Form state
  email = signal<string>('');
  password = signal<string>('');
  showPassword = signal<boolean>(false);
  authLoading = signal<boolean>(false);

  /**
   * What the in-flight auth request is actually doing, so the progress message
   * matches it: "Signing in…" is wrong when the user is creating an account,
   * and doubly so when they are doing it through Google.
   */
  private pendingAuth = signal<{ creating: boolean; google: boolean } | null>(null);

  /**
   * Whether an auth request is in flight — ours, or a session the service is
   * restoring. Only the messages and buttons of the current step give way to
   * the spinner: what the user typed stays on screen, and the component itself
   * is never torn down, so an error has somewhere to land afterwards.
   */
  busy = computed(
    () =>
      this.firebaseService.loginStatus() === LoginStatus.LoggingIn ||
      this.authLoading(),
  );

  progressMessage = computed(() => {
    const pending = this.pendingAuth();
    // No pending action of ours: the session is being restored on load.
    if (!pending) return 'Signing in…';
    if (pending.creating) {
      return pending.google
        ? 'Creating your account with Google…'
        : 'Creating your account…';
    }
    return pending.google ? 'Signing in with Google…' : 'Signing in…';
  });

  // Error & message signals
  checkEmailError = signal<string | null>(null);
  loginError = signal<string | null>(null);
  loginWithGoogleError = signal<string | null>(null);
  signupError = signal<string | null>(null);
  resetPasswordError = signal<string | null>(null);
  resetPasswordSuccess = signal<string | null>(null);
  resendSuccess = signal<string | null>(null);
  /** True while a reset email is being requested, so the link can say so. */
  resetPasswordSending = signal<boolean>(false);
  /**
   * Whether the failure the user just hit is one a password reset would fix.
   * The reset link is always on the password step; this only draws the eye to
   * it when it is the actual next step.
   */
  highlightPasswordReset = signal<boolean>(false);
  /**
   * Set when account creation reported that the account already exists — a
   * lookup that said otherwise is out of date, and the user needs signing in,
   * not signing up.
   */
  signupFoundExistingAccount = signal<boolean>(false);

  /**
   * Whether an auth account is known to exist: either a lookup said so, or the
   * user has signed in on this browser before.
   */
  hasKnownAuthAccount = computed(
    () => this.emailStatus()?.hasAuthAccount ?? this.remembered() !== null,
  );

  /**
   * Whether to offer Google as an alternative. A live lookup wins; otherwise
   * fall back to what was true at the last successful sign-in.
   */
  canUseGoogle = computed(() => {
    const status = this.emailStatus();
    if (status) return !!(status.isGoogleManaged || status.hasGoogleProvider);
    return this.remembered()?.canUseGoogle ?? false;
  });

  /**
   * Runs here rather than in the constructor because the opening step depends
   * on `showNoMemberOption`, and inputs are not set until after construction.
   */
  ngOnInit(): void {
    // Actively evict the old pre-authentication cache rather than just
    // ignoring it: it holds an email address that may not be this user's.
    forgetLegacyLoginCache();

    // An attempt in progress reflects what the user just did, so it takes
    // precedence over a sign-in remembered from an earlier visit.
    const inProgress = this.signInFlow.email();
    const inProgressStatus = this.signInFlow.status();
    if (inProgress && inProgressStatus) {
      this.email.set(inProgress);
      this.emailStatus.set(inProgressStatus);
      // Re-derived rather than carried over: the same lookup routes differently
      // per page, since only the login page offers the no-member guidance.
      this.step.set(this.stepForStatus(inProgressStatus));
      return;
    }

    const remembered = readRememberedLogin();
    if (remembered) {
      this.remembered.set(remembered);
      this.email.set(remembered.email);
      this.step.set(
        remembered.method === 'google'
          ? InlineAuthStep.GoogleSignin
          : InlineAuthStep.PasswordLogin,
      );
    }
  }

  async checkEmail(): Promise<void> {
    const emailVal = this.email().trim();
    if (!emailVal) return;

    this.dismissMessages();
    // A fresh lookup supersedes anything remembered from a previous visit.
    this.signupFoundExistingAccount.set(false);
    this.remembered.set(null);
    this.emailStatus.set(null);
    this.step.set(InlineAuthStep.Checking);

    try {
      const result = await this.firebaseService.checkEmailStatus(emailVal);
      this.emailStatus.set(result);
      this.signInFlow.record(emailVal, result);
      this.step.set(this.stepForStatus(result));
    } catch (error) {
      console.error('checkEmailStatus failed:', error);
      this.checkEmailError.set(
        'Unable to check email status. Please check your connection and try again.',
      );
      this.step.set(InlineAuthStep.Email);
    }
  }

  /** Which step a freshly looked-up email should land on. */
  private stepForStatus(result: CheckEmailStatusResult): InlineAuthStep {
    if (!result.hasMemberRecord && !result.hasAuthAccount && this.showNoMemberOption()) {
      return InlineAuthStep.NoMember;
    }
    if (result.hasAuthAccount) {
      // Google first whenever the account actually has it: it is one click
      // versus recalling a password. Someone who prefers a password can still
      // ask for one from the Google step. Only a confirmed google.com provider
      // counts here — isGoogleManaged is also true for any gmail.com address,
      // including ones whose account has nothing but a password.
      if (result.hasGoogleProvider) return InlineAuthStep.GoogleSignin;
      if (result.hasPasswordProvider) return InlineAuthStep.PasswordLogin;
      return result.isGoogleManaged
        ? InlineAuthStep.GoogleSignin
        : InlineAuthStep.PasswordLogin;
    }
    return result.isGoogleManaged
      ? InlineAuthStep.GoogleSignin
      : InlineAuthStep.CreateAccount;
  }

  /**
   * Record a sign-in that actually succeeded, so this browser can offer the
   * same route next time.
   */
  private rememberSuccessfulLogin(method: LoginMethod): void {
    const email =
      this.email().trim() || this.firebaseService.user()?.firebaseUser?.email || '';
    if (!email) return;
    writeRememberedLogin({
      email,
      method,
      canUseGoogle: method === 'google' || this.canUseGoogle(),
    });
  }

  async loginWithGoogle(): Promise<void> {
    this.dismissMessages();
    this.pendingAuth.set({ creating: !this.hasKnownAuthAccount(), google: true });
    this.authLoading.set(true);
    try {
      const result = await this.firebaseService.loginWithGoogle();
      if (result.success) {
        this.rememberSuccessfulLogin('google');
      } else if (result.errorCode !== 'auth/cancelled-popup-request') {
        this.loginWithGoogleError.set(googleSignInErrorMessage(result.errorCode));
      }
    } finally {
      this.authLoading.set(false);
      this.pendingAuth.set(null);
    }
  }

  async loginWithEmail(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    const passVal = this.password();
    if (!emailVal || !passVal) return;

    this.pendingAuth.set({ creating: false, google: false });
    this.authLoading.set(true);
    try {
      const result = await this.firebaseService.loginWithEmail(passVal, emailVal);
      if (result.success) {
        this.rememberSuccessfulLogin('password');
      } else {
        this.loginError.set(signInErrorMessage(result.errorCode));
        // A rejected password is the common case, and the reset link below is
        // the way out of it; make it unmissable rather than merely present.
        this.highlightPasswordReset.set(isPasswordResettable(result.errorCode));
      }
    } finally {
      this.authLoading.set(false);
      this.pendingAuth.set(null);
    }
  }

  async signupWithEmail(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    const passVal = this.password();
    if (!emailVal || !passVal) return;

    this.pendingAuth.set({ creating: true, google: false });
    this.authLoading.set(true);
    try {
      const result = await this.firebaseService.signupWithEmail(passVal, emailVal);
      if (result.success) {
        this.rememberSuccessfulLogin('password');
      } else {
        this.signupError.set(signUpErrorMessage(result.errorCode));
        this.signupFoundExistingAccount.set(
          result.errorCode === 'auth/email-already-in-use',
        );
      }
    } finally {
      this.authLoading.set(false);
      this.pendingAuth.set(null);
    }
  }

  async resetPassword(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    if (!emailVal) {
      this.resetPasswordError.set('Please enter your email address.');
      return;
    }
    this.resetPasswordSending.set(true);
    try {
      const result = await this.firebaseService.resetPassword(emailVal);
      if (result.success) {
        this.resetPasswordSuccess.set(
          `A password reset link has been sent to ${emailVal} from ` +
          `${environment.passwordResetEmailSender}. It can take a minute to ` +
          `arrive — please check your spam folder too.`,
        );
      } else {
        this.resetPasswordError.set(passwordResetErrorMessage(result.errorMessage));
      }
    } finally {
      this.resetPasswordSending.set(false);
    }
  }

  /**
   * Go to the password step after account creation found an existing account.
   * Unlike `usePasswordInstead` this does not consult the email lookup, which
   * we now know was out of date, and it keeps the typed password: it may well
   * be the account's real one.
   */
  signInInstead(): void {
    this.dismissMessages();
    this.signupFoundExistingAccount.set(false);
    this.step.set(InlineAuthStep.PasswordLogin);
  }

  usePasswordInstead(): void {
    this.dismissMessages();
    this.step.set(
      this.hasKnownAuthAccount()
        ? InlineAuthStep.PasswordLogin
        : InlineAuthStep.CreateAccount,
    );
  }

  useGoogleInstead(): void {
    this.dismissMessages();
    this.step.set(InlineAuthStep.GoogleSignin);
  }

  /**
   * Return to email entry, keeping the current address in the field so a typo
   * can be corrected rather than retyped. Reached by tapping the email itself.
   */
  goBackToEmail(): void {
    this.password.set('');
    this.emailStatus.set(null);
    this.signupFoundExistingAccount.set(false);
    this.remembered.set(null);
    this.signInFlow.clear();
    this.step.set(InlineAuthStep.Email);
    this.dismissMessages();
    forgetRememberedLogin();
  }

  /** Signing out leaves no trace of who was here: empty field, nothing stored. */
  async logout(): Promise<void> {
    await this.firebaseService.logout();
    this.email.set('');
    this.password.set('');
    this.emailStatus.set(null);
    this.signupFoundExistingAccount.set(false);
    this.remembered.set(null);
    this.signInFlow.clear();
    this.step.set(InlineAuthStep.Email);
    this.dismissMessages();
    forgetRememberedLogin();
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
        this.resendSuccess.set(
          'A new verification email has been sent! Please check your inbox.',
        );
      }
    } finally {
      this.authLoading.set(false);
    }
  }

  dismissMessages(): void {
    this.checkEmailError.set(null);
    this.loginError.set(null);
    this.highlightPasswordReset.set(false);
    this.loginWithGoogleError.set(null);
    this.signupError.set(null);
    this.resetPasswordError.set(null);
    this.resetPasswordSuccess.set(null);
    this.resendSuccess.set(null);
    this.firebaseService.loginError.set(null);
    this.firebaseService.verificationError.set(null);
  }
}
