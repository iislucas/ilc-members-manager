/* password-setup.component.ts
 *
 * Reusable verified-account password setup & change control.
 *
 * Modes:
 * - 'prompt' (default): Shown right after an email-link sign-in when
 *   `firebaseService.offerPasswordSetup()` is true (both inside <app-inline-auth>
 *   on checkout pages and at the top of <main> on portal views where <app-login>
 *   unmounts as soon as the user is signed in).
 * - 'profile': Shown on a member's own profile so any verified user can set or
 *   change their password at any time via `setAccountPassword`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MIN_PASSWORD_LENGTH } from '../../../functions/src/data-model/auth';
import { FirebaseStateService } from '../firebase-state.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { readRememberedLogin, writeRememberedLogin } from './remembered-login';

@Component({
  selector: 'app-password-setup',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './password-setup.component.html',
  styleUrl: './password-setup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.inactive]': '!isVisible()',
    '[class.banner-mode]': "mode() === 'prompt'",
  },
})
export class PasswordSetupComponent {
  public firebaseService = inject(FirebaseStateService);

  /**
   * - 'prompt': Shown after email-link sign-in when `offerPasswordSetup()` is true.
   * - 'reset': Shown on `/auth/complete?intent=reset-password` before redirecting.
   * - 'profile': Shown on a member's own profile as an on-demand action.
   */
  mode = input<'prompt' | 'profile' | 'reset'>('prompt');

  /** Optional visual framing ('card' for top-level portal banner, 'inline' inside auth/profile). */
  framed = input<boolean>(false);

  /** Emitted once a new password has been saved. */
  saved = output<void>();

  /** Emitted when the user skips optional/reset password setup. */
  skipped = output<void>();

  minPasswordLength = MIN_PASSWORD_LENGTH;
  newPassword = signal<string>('');
  showPassword = signal<boolean>(false);
  passwordSaving = signal<boolean>(false);
  passwordSetupError = signal<string | null>(null);
  passwordSaved = signal<boolean>(false);
  profileEditorOpen = signal<boolean>(false);

  signedInEmail = computed(
    () =>
      this.firebaseService.user()?.firebaseUser?.email ||
      this.firebaseService.completedEmailLinkSignIn() ||
      '',
  );

  inputId = computed(() =>
    this.mode() === 'profile' ? 'profile-password-input' : 'setup-password-input',
  );

  isFormExpanded = computed(() => {
    const m = this.mode();
    if (m === 'profile') return this.profileEditorOpen();
    if (m === 'reset') return true;
    return this.firebaseService.offerPasswordSetup();
  });

  showSavedBanner = computed(
    () =>
      this.passwordSaved() ||
      (this.mode() === 'prompt' && this.firebaseService.passwordSavedNotice()),
  );

  isVisible = computed(() => {
    const m = this.mode();
    if (m === 'profile') return !!this.signedInEmail();
    if (m === 'reset') return true;
    return this.firebaseService.offerPasswordSetup() || this.showSavedBanner();
  });

  private clearOnSignOut = effect(() => {
    if (!this.firebaseService.user()) {
      this.passwordSaved.set(false);
      this.profileEditorOpen.set(false);
      this.passwordSetupError.set(null);
      this.newPassword.set('');
    }
  });

  onPasswordInput(value: string): void {
    this.newPassword.set(value);
    if (this.passwordSetupError()) {
      this.passwordSetupError.set(null);
    }
  }

  openProfileEditor(): void {
    this.passwordSaved.set(false);
    this.passwordSetupError.set(null);
    this.newPassword.set('');
    this.showPassword.set(false);
    this.profileEditorOpen.set(true);
  }

  cancelProfileEditor(): void {
    this.profileEditorOpen.set(false);
    this.passwordSetupError.set(null);
    this.newPassword.set('');
    this.showPassword.set(false);
  }

  async savePassword(): Promise<void> {
    const password = this.newPassword();
    if (password.length < MIN_PASSWORD_LENGTH || this.passwordSaving()) return;
    this.passwordSetupError.set(null);
    this.passwordSaving.set(true);
    try {
      const result = await this.firebaseService.setAccountPassword(password);
      if (result.success) {
        const email = this.signedInEmail();
        if (email) {
          const prev = readRememberedLogin();
          const hasGoogleProvider =
            this.firebaseService
              .user()
              ?.firebaseUser?.providerData?.some((p) => p.providerId === 'google.com') ?? false;
          writeRememberedLogin({
            email,
            method: 'password',
            canUseGoogle: (prev?.email === email && prev.canUseGoogle) || hasGoogleProvider,
          });
        }
        this.newPassword.set('');
        this.showPassword.set(false);
        this.profileEditorOpen.set(false);
        if (this.mode() === 'reset') {
          this.firebaseService.passwordSavedNotice.set(true);
        } else {
          this.passwordSaved.set(true);
        }
        this.saved.emit();
      } else {
        this.passwordSetupError.set(result.message);
      }
    } finally {
      this.passwordSaving.set(false);
    }
  }

  skipPasswordSetup(): void {
    this.newPassword.set('');
    this.showPassword.set(false);
    this.passwordSetupError.set(null);
    this.firebaseService.offerPasswordSetup.set(false);
    this.skipped.emit();
  }

  dismissSavedNotice(): void {
    this.passwordSaved.set(false);
    this.firebaseService.passwordSavedNotice.set(false);
  }
}
