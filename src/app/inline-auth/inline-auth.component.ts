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
 * 3. The user is guided to Google Sign-In, a password login, or an email
 *    sign-in link, whichever actually applies.
 * 4. Once signed in, the user badge and Log Out action are rendered instead.
 *
 * Email first, password second: a new email account can only be created by
 * clicking a sign-in link sent to that address, so nobody can set a password
 * for an email they don't control (enforced server-side by
 * functions/src/auth-blocking.ts). Right after a link sign-in the user is
 * offered to choose a password for next time.
 *
 * The email is never a dead end: at every step past the first it is a button
 * that returns to email entry, so a wrong address is always one tap from being
 * corrected.
 */

import { Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthCredential } from 'firebase/auth';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import {
  googleSignInErrorMessage,
  isPasswordResettable,
  passwordResetErrorMessage,
  signInErrorMessage,
  emailLinkErrorMessage,
  PASSWORD_NOT_TRUSTED_MESSAGE,
} from './auth-error-messages';
import { AuthBlockReason, MIN_PASSWORD_LENGTH } from '../../../functions/src/data-model/auth';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { environment } from '../../environments/environment';
import { CheckEmailStatusResult } from '../../../functions/src/data-model/system';
import { isValidEmail, normalizeEmail } from '../../../functions/src/data-model/email';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';
import { SignInFlowService } from './sign-in-flow.service';

export enum InlineAuthStep {
  Email = 'email',
  Checking = 'checking',
  GoogleSignin = 'google-signin',
  PasswordLogin = 'password-login',
  // Ask for an email sign-in link: to create an account, to prove the email
  // of an unverified account, or simply to sign in without a password.
  EmailLink = 'email-link',
  // The same, for someone creating an account without a membership.
  GuestCreateAccount = 'guest-create-account',
  // A sign-in link has been sent; waiting for the user to click it.
  LinkSent = 'link-sent',
  NoMember = 'no-member',
}

export type LoginMethod = 'password' | 'google' | 'emailLink';
const LOGIN_METHODS: readonly string[] = ['password', 'google', 'emailLink'];

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
    if (!parsed.method || !LOGIN_METHODS.includes(parsed.method)) return null;
    return {
      email: parsed.email,
      method: parsed.method as LoginMethod,
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
  minPasswordLength = MIN_PASSWORD_LENGTH;
  adminEmail = environment.adminEmail;

  // Flow state
  step = signal<InlineAuthStep>(InlineAuthStep.Email);

  /** The result of a real lookup. Null until checkEmailStatus has run. */
  emailStatus = signal<CheckEmailStatusResult | null>(null);

  /** A previous successful sign-in restored from this browser, if any. */
  remembered = signal<RememberedLogin | null>(null);

  // Form state
  email = signal<string>('');
  isEmailValid = computed(() => isValidEmail(this.email()));
  password = signal<string>('');
  showPassword = signal<boolean>(false);
  authLoading = signal<boolean>(false);

  onEmailChange(value: string): void {
    this.email.set(value);
    if (this.checkEmailError()) {
      this.checkEmailError.set(null);
    }
  }

  /**
   * What the in-flight auth request is actually doing, so the progress message
   * matches it: "Signing in…" is wrong when the user is creating an account,
   * and doubly so when they are doing it through Google.
   */
  private pendingAuth = signal<{ creating: boolean; google: boolean } | null>(null);
  private googleAttemptId = 0;

  isGooglePopupPending = computed(() => this.pendingAuth()?.google === true);

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
      // For a known member this is the first login to an existing membership,
      // not a new account; saying "creating" is what made people think they
      // were starting a second, separate account.
      if (this.connectsExistingMembership()) {
        return pending.google
          ? 'Connecting Google to your membership…'
          : 'Setting up sign-in for your membership…';
      }
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
  emailLinkError = signal<string | null>(null);
  /** The address the last sign-in link was sent to (LinkSent step). */
  linkSentTo = signal<string>('');
  /** True while a sign-in link is being requested. */
  linkSending = signal<boolean>(false);
  /**
   * Whether the failure the user just hit is one an email link fixes (a
   * password that can't be used until the email is proven), so the link
   * offer on the password step is emphasised.
   */
  highlightEmailLink = signal<boolean>(false);

  // Optional password setup offered right after an email-link sign-in.
  newPassword = signal<string>('');
  passwordSaving = signal<boolean>(false);
  passwordSetupError = signal<string | null>(null);
  passwordSaved = signal<boolean>(false);
  resetPasswordError = signal<string | null>(null);
  resetPasswordSuccess = signal<string | null>(null);
  /** True while a reset email is being requested, so the link can say so. */
  resetPasswordSending = signal<boolean>(false);
  /**
   * Whether the failure the user just hit is one a password reset would fix.
   * The reset link is always on the password step; this only draws the eye to
   * it when it is the actual next step.
   */
  highlightPasswordReset = signal<boolean>(false);
  /**
   * Holds a pending Google credential when Google sign-in encounters an existing
   * account created with a password (auth/account-exists-with-different-credential).
   * Once the user confirms their password, this credential is automatically linked.
   */
  pendingGoogleCredential = signal<AuthCredential | null>(null);

  /**
   * Whether an auth account is known to exist: either a lookup said so, or the
   * user has signed in on this browser before.
   */
  hasKnownAuthAccount = computed(
    () => this.emailStatus()?.hasAuthAccount ?? this.remembered() !== null,
  );

  /**
   * Whether the lookup found a membership record for this email but no login
   * yet. Choosing Google or a password then sets up sign-in for that existing
   * membership; it does not create a new member. The steps say so up front,
   * because "Sign up" alone read as starting a second, separate account.
   */
  connectsExistingMembership = computed(() => {
    const status = this.emailStatus();
    return !!status?.hasMemberRecord && !status.hasAuthAccount;
  });

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
   * Whether the lookup found an account whose email address has not been
   * verified yet. A password sign-in to it lands on the "verify your email"
   * step, so the password step says so up front rather than surprising them.
   */
  accountNeedsVerification = computed(() => {
    const status = this.emailStatus();
    return !!status?.hasAuthAccount && status.emailVerified === false;
  });

  passwordResetEmailSender = environment.passwordResetEmailSender;

  /**
   * `loginError` is only set when authentication succeeded but loading the
   * user's profile then failed, leaving them signed out. That sign-in did not
   * really succeed, so it must not be offered again on the next visit.
   */
  private forgetFailedSignIn = effect(() => {
    if (this.firebaseService.loginError()) {
      forgetRememberedLogin();
    }
  });

  /** Remember an email-link sign-in so next time starts at the link step. */
  private rememberEmailLinkSignIn = effect(() => {
    const email = this.firebaseService.completedEmailLinkSignIn();
    if (email) {
      this.email.set(email);
      writeRememberedLogin({ email, method: 'emailLink', canUseGoogle: false });
    }
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
          : remembered.method === 'emailLink'
            ? InlineAuthStep.EmailLink
            : InlineAuthStep.PasswordLogin,
      );
    }
  }

  async checkEmail(): Promise<void> {
    const emailVal = this.email().trim();
    if (!emailVal) return;

    if (!this.isEmailValid()) {
      this.checkEmailError.set("That doesn't look like a valid email address. Please check it and try again.");
      return;
    }

    this.dismissMessages();
    // A fresh lookup supersedes anything remembered from a previous visit.
    this.remembered.set(null);
    this.emailStatus.set(null);
    this.step.set(InlineAuthStep.Checking);

    try {
      const normalizedEmail = normalizeEmail(emailVal);
      const result = await this.firebaseService.checkEmailStatus(normalizedEmail);
      this.emailStatus.set(result);
      this.signInFlow.record(normalizedEmail, result);
      this.step.set(this.stepForStatus(result));
    } catch (error) {
      console.error('checkEmailStatus failed:', error);
      const isInvalidArgument =
        (error as { code?: string })?.code === 'functions/invalid-argument' ||
        (error as { code?: string })?.code === 'invalid-argument' ||
        (error as { message?: string })?.message?.includes('valid email');
      if (isInvalidArgument) {
        this.checkEmailError.set(
          "That doesn't look like a valid email address. Please check it and try again.",
        );
      } else {
        this.checkEmailError.set(
          'Unable to check email status. Please check your connection and try again.',
        );
      }
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
      // An unverified account's password can't be used until the owner
      // proves the email, which is exactly what the sign-in link does.
      if (result.emailVerified === false) return InlineAuthStep.EmailLink;
      if (result.hasPasswordProvider) return InlineAuthStep.PasswordLogin;
      return result.isGoogleManaged
        ? InlineAuthStep.GoogleSignin
        : InlineAuthStep.PasswordLogin;
    }
    return result.isGoogleManaged
      ? InlineAuthStep.GoogleSignin
      : InlineAuthStep.EmailLink;
  }

  /**
   * Record a sign-in that actually succeeded, so this browser can offer the
   * same route next time.
   */
  private rememberSuccessfulLogin(method: LoginMethod): void {
    // The profile load may already have failed and signed the user out
    // (see forgetFailedSignIn); errors are cleared when each attempt starts.
    if (this.firebaseService.loginError()) return;
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
    const attemptId = ++this.googleAttemptId;
    this.pendingAuth.set({ creating: !this.hasKnownAuthAccount(), google: true });
    this.authLoading.set(true);
    try {
      const result = await this.firebaseService.loginWithGoogle();
      if (attemptId !== this.googleAttemptId) {
        return;
      }
      if (result.success) {
        this.rememberSuccessfulLogin('google');
      } else if (
        result.errorCode === 'auth/account-exists-with-different-credential' &&
        result.pendingCredential
      ) {
        this.pendingGoogleCredential.set(result.pendingCredential);
        this.step.set(InlineAuthStep.PasswordLogin);
      } else if (result.errorCode !== 'auth/cancelled-popup-request') {
        this.loginWithGoogleError.set(googleSignInErrorMessage(result.errorCode));
      }
    } finally {
      if (attemptId === this.googleAttemptId) {
        this.authLoading.set(false);
        this.pendingAuth.set(null);
      }
    }
  }

  // Abandons an in-flight Google popup wait so the sign-in buttons return
  // immediately (e.g. if the user closed the popup while COOP prevented
  // Firebase from observing `popup.closed`).
  cancelGoogleLogin(): void {
    if (!this.isGooglePopupPending()) return;
    this.googleAttemptId++;
    this.authLoading.set(false);
    this.pendingAuth.set(null);
    this.firebaseService.cancelPendingLogin();
  }

  async loginWithEmail(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    const passVal = this.password();
    if (!emailVal || !passVal) return;

    this.pendingAuth.set({ creating: false, google: false });
    this.authLoading.set(true);
    try {
      const pendingCredential = this.pendingGoogleCredential();
      const result = pendingCredential
        ? await this.firebaseService.loginWithEmailAndLink(passVal, emailVal, pendingCredential)
        : await this.firebaseService.loginWithEmail(passVal, emailVal);
      if (result.success) {
        this.rememberSuccessfulLogin(pendingCredential ? 'google' : 'password');
        this.pendingGoogleCredential.set(null);
      } else if (result.blockReason === AuthBlockReason.PasswordNotTrusted) {
        // The password is right but can't be used until the email is proven;
        // a reset wouldn't help, an email link does.
        this.loginError.set(PASSWORD_NOT_TRUSTED_MESSAGE);
        this.highlightEmailLink.set(true);
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

  /** Email a sign-in link to the entered address, then wait for the click. */
  async sendSignInLink(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    if (!emailVal) return;
    this.linkSending.set(true);
    try {
      const result = await this.firebaseService.sendSignInLink(normalizeEmail(emailVal));
      if (result.success) {
        this.linkSentTo.set(emailVal);
        this.step.set(InlineAuthStep.LinkSent);
      } else {
        this.emailLinkError.set(emailLinkErrorMessage(result.errorCode));
      }
    } finally {
      this.linkSending.set(false);
    }
  }

  /**
   * The current session's email isn't verified (an account from the old
   * password-first sign-up). Send a sign-in link to it and sign the session
   * out; clicking the link proves the address.
   */
  async sendLinkForUnverifiedSession(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.unverifiedEmail();
    this.linkSending.set(true);
    try {
      const result = await this.firebaseService.sendSignInLinkForUnverifiedUser();
      if (result.success) {
        this.email.set(emailVal);
        this.linkSentTo.set(emailVal);
        this.step.set(InlineAuthStep.LinkSent);
      } else {
        this.emailLinkError.set(emailLinkErrorMessage(result.errorCode));
      }
    } finally {
      this.linkSending.set(false);
    }
  }

  /**
   * Finish an email-link sign-in that was opened on another device or
   * browser, where we had to ask which address the link was sent to.
   */
  async finishEmailLinkSignIn(): Promise<void> {
    this.dismissMessages();
    const emailVal = this.email().trim();
    if (!emailVal) return;
    const result = await this.firebaseService.finishEmailLinkSignIn(normalizeEmail(emailVal));
    if (!result.success) {
      this.emailLinkError.set(emailLinkErrorMessage(result.errorCode));
    }
  }

  /** Save the password chosen right after an email-link sign-in. */
  async savePassword(): Promise<void> {
    const password = this.newPassword();
    if (password.length < MIN_PASSWORD_LENGTH) return;
    this.passwordSetupError.set(null);
    this.passwordSaving.set(true);
    try {
      const result = await this.firebaseService.setAccountPassword(password);
      if (result.success) {
        this.newPassword.set('');
        this.passwordSaved.set(true);
        this.rememberSuccessfulLogin('password');
      } else {
        this.passwordSetupError.set(result.message);
      }
    } finally {
      this.passwordSaving.set(false);
    }
  }

  skipPasswordSetup(): void {
    this.newPassword.set('');
    this.passwordSetupError.set(null);
    this.firebaseService.offerPasswordSetup.set(false);
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

  usePasswordInstead(): void {
    this.dismissMessages();
    this.step.set(
      this.hasKnownAuthAccount()
        ? InlineAuthStep.PasswordLogin
        : InlineAuthStep.EmailLink,
    );
  }

  useEmailLinkInstead(): void {
    this.dismissMessages();
    this.pendingGoogleCredential.set(null);
    this.step.set(InlineAuthStep.EmailLink);
  }

  useGoogleInstead(): void {
    this.dismissMessages();
    this.pendingGoogleCredential.set(null);
    this.step.set(InlineAuthStep.GoogleSignin);
  }

  cancelLinking(): void {
    this.pendingGoogleCredential.set(null);
  }

  /**
   * Return to email entry, keeping the current address in the field so a typo
   * can be corrected rather than retyped. Reached by tapping the email itself.
   */
  goBackToEmail(): void {
    this.cancelGoogleLogin();
    this.password.set('');
    this.emailStatus.set(null);
    this.pendingGoogleCredential.set(null);
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
    this.pendingGoogleCredential.set(null);
    this.remembered.set(null);
    this.signInFlow.clear();
    this.step.set(InlineAuthStep.Email);
    this.passwordSaved.set(false);
    this.dismissMessages();
    forgetRememberedLogin();
  }

  dismissMessages(): void {
    this.checkEmailError.set(null);
    this.loginError.set(null);
    this.highlightPasswordReset.set(false);
    this.loginWithGoogleError.set(null);
    this.emailLinkError.set(null);
    this.highlightEmailLink.set(false);
    this.resetPasswordError.set(null);
    this.resetPasswordSuccess.set(null);
    this.firebaseService.loginError.set(null);
  }
}
