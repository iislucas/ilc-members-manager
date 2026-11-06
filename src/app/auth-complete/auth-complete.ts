/* auth-complete.ts
 *
 * Minimal, distraction-free landing view (`/auth/complete`) for email sign-in
 * and password-reset links:
 *
 * 1. Shows a calm centered progress state while `signInWithEmailLink` and
 *    `getUserDetails` verify the link and load the member profile.
 * 2. Prompts for the email address if the link was opened on a different
 *    browser or device.
 * 3. When `intent=reset-password`, lets the signed-in user choose their new
 *    trusted password right here before continuing into the portal.
 * 4. Otherwise (or once password setup is saved/skipped), navigates via
 *    `replaceState` straight to the sanitized `returnTo` path (default `/`)
 *    without a second full-page reload.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isValidEmail, normalizeEmail } from '../../../functions/src/data-model/email';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import {
  EmailLinkIntent,
  sanitizeInternalReturnPath,
} from '../inline-auth/auth-link-return';
import { emailLinkErrorMessage } from '../inline-auth/auth-error-messages';
import { PasswordSetupComponent } from '../inline-auth/password-setup.component';
import { RoutingService } from '../routing.service';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-auth-complete',
  standalone: true,
  imports: [FormsModule, SpinnerComponent, PasswordSetupComponent],
  templateUrl: './auth-complete.html',
  styleUrl: './auth-complete.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCompleteComponent {
  public firebaseService = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  private destroyRef = inject(DestroyRef);

  private viewSignals = this.routingService.signals[Views.AuthComplete];

  readonly EmailLinkIntent = EmailLinkIntent;

  intent = computed<EmailLinkIntent>(() =>
    this.viewSignals.urlParams.intent() === EmailLinkIntent.ResetPassword
      ? EmailLinkIntent.ResetPassword
      : EmailLinkIntent.SignIn,
  );

  isResetIntent = computed(() => this.intent() === EmailLinkIntent.ResetPassword);

  destinationPath = computed(() =>
    sanitizeInternalReturnPath(this.viewSignals.urlParams.returnTo()),
  );

  loginHref = computed(() => {
    const dest = this.destinationPath();
    return dest
      ? this.routingService.hrefForView(Views.Login, { returnUrl: `/${dest}` })
      : this.routingService.hrefForView(Views.Login);
  });

  emailInput = signal<string>('');
  submittingEmail = signal<boolean>(false);
  localEmailError = signal<string | null>(null);
  resendSending = signal<boolean>(false);
  resendSentTo = signal<string | null>(null);
  private redirected = false;

  isSigningIn = computed(() => {
    if (this.submittingEmail() || this.firebaseService.isCompletingEmailLink()) {
      return true;
    }
    const status = this.firebaseService.loginStatus();
    if (status === LoginStatus.LoggingIn) {
      return true;
    }
    return status === LoginStatus.FirebaseLoadingStatus && !!this.firebaseService.pendingEmailLink();
  });

  needsEmailConfirmation = computed(
    () =>
      !this.firebaseService.user() &&
      !!this.firebaseService.pendingEmailLink() &&
      !this.isSigningIn(),
  );

  showResetPasswordPrompt = computed(
    () =>
      !!this.firebaseService.user() &&
      !this.isSigningIn() &&
      this.isResetIntent(),
  );

  errorMessage = computed<string | null>(() => {
    if (this.localEmailError()) return this.localEmailError();
    const linkErr = this.firebaseService.emailLinkSignInError();
    if (linkErr) return emailLinkErrorMessage(linkErr);
    return this.firebaseService.loginError();
  });

  retryEmailAddress = computed(
    () => this.firebaseService.failedEmailLinkAddress() || this.emailInput().trim(),
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('auth-preboot', 'auth-preboot-reset');
      }
    });

    // Automatically forward signed-in users once link verification settles,
    // except when `intent=reset-password` where they first set a new password.
    effect(() => {
      if (this.redirected) return;
      const user = this.firebaseService.user();
      if (!user || this.isSigningIn()) return;
      if (this.isResetIntent()) return;
      this.continueToDestination();
    });
  }

  onEmailInput(value: string): void {
    this.emailInput.set(value);
    if (this.localEmailError()) {
      this.localEmailError.set(null);
    }
    if (this.firebaseService.emailLinkSignInError()) {
      this.firebaseService.emailLinkSignInError.set(null);
    }
  }

  async confirmEmailAndSignIn(): Promise<void> {
    const raw = this.emailInput().trim();
    if (!raw || this.submittingEmail()) return;
    if (!isValidEmail(raw)) {
      this.localEmailError.set(
        "That doesn't look like a valid email address. Please check it and try again.",
      );
      return;
    }
    this.localEmailError.set(null);
    this.submittingEmail.set(true);
    try {
      const result = await this.firebaseService.finishEmailLinkSignIn(normalizeEmail(raw));
      if (!result.success) {
        this.localEmailError.set(emailLinkErrorMessage(result.errorCode));
      }
    } finally {
      this.submittingEmail.set(false);
    }
  }

  async sendFreshLink(): Promise<void> {
    const raw = this.retryEmailAddress();
    if (!raw || this.resendSending()) return;
    if (!isValidEmail(raw)) {
      this.localEmailError.set(
        "That doesn't look like a valid email address. Please check it and try again.",
      );
      return;
    }
    this.localEmailError.set(null);
    this.resendSending.set(true);
    try {
      const normalized = normalizeEmail(raw);
      const result = await this.firebaseService.sendSignInLink(normalized, {
        intent: this.intent(),
      });
      if (result.success) {
        this.firebaseService.emailLinkSignInError.set(null);
        this.firebaseService.loginError.set(null);
        this.resendSentTo.set(raw);
      } else {
        this.localEmailError.set(emailLinkErrorMessage(result.errorCode));
      }
    } finally {
      this.resendSending.set(false);
    }
  }

  continueToDestination(): void {
    if (this.redirected) return;
    this.redirected = true;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('auth-preboot', 'auth-preboot-reset');
    }
    const target = this.destinationPath();
    this.routingService.navigateTo(target, {
      clearUrlParams: true,
      replaceState: true,
    });
  }
}
