/* inline-auth.component.spec.ts
 *
 * Covers the guided sign-in flow shared by the login page and every purchase
 * page, against the in-memory FirebaseStateService mock.
 *
 * The cases worth pinning down are mostly about *what the flow is allowed to
 * believe*: it may only remember an email after a sign-in has actually
 * succeeded, it must forget it on logout, and it must never present a guess
 * (a membership record, an available provider) as though it were looked up.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthErrorCodes, UserCredential } from 'firebase/auth';
import {
  InlineAuthComponent,
  InlineAuthStep,
  RememberedLogin,
  REMEMBERED_LOGIN_KEY,
} from './inline-auth.component';
import {
  AuthOperationResult,
  createFirebaseStateServiceMock,
  FirebaseStateService,
  LoginStatus,
} from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { SignInFlowService } from './sign-in-flow.service';
import { CheckEmailStatusResult } from '../../../functions/src/data-model';

const LEGACY_LOGIN_KEY = 'ilc-login-info';

describe('InlineAuthComponent', () => {
  let fixture: ComponentFixture<InlineAuthComponent>;
  let component: InlineAuthComponent;
  let mockService: FirebaseStateService;
  let navigateToParts: ReturnType<typeof vi.fn>;

  /** Status result with everything false unless the test says otherwise. */
  function status(overrides: Partial<CheckEmailStatusResult> = {}): CheckEmailStatusResult {
    return {
      hasMemberRecord: false,
      hasAuthAccount: false,
      isGoogleManaged: false,
      ...overrides,
    };
  }

  function remember(info: Partial<RememberedLogin>): void {
    localStorage.setItem(
      REMEMBERED_LOGIN_KEY,
      JSON.stringify({
        email: 'jane@example.com',
        method: 'password',
        canUseGoogle: false,
        ...info,
      }),
    );
  }

  function readRemembered(): RememberedLogin | null {
    const raw = localStorage.getItem(REMEMBERED_LOGIN_KEY);
    return raw ? (JSON.parse(raw) as RememberedLogin) : null;
  }

  /**
   * Built per test rather than in beforeEach: the component reads localStorage
   * in its constructor, so each test seeds storage first.
   */
  async function createComponent(showNoMemberOption = false) {
    fixture = TestBed.createComponent(InlineAuthComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('showNoMemberOption', showNoMemberOption);
    fixture.detectChanges();
    await fixture.whenStable();
    return component;
  }

  function html(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    localStorage.clear();
    mockService = createFirebaseStateServiceMock();
    navigateToParts = vi.fn();

    await TestBed.configureTestingModule({
      imports: [InlineAuthComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: mockService },
        { provide: RoutingService, useValue: { navigateToParts, hrefForView: vi.fn() } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ---------------------------------------------------------------------------
  //  Startup: what the flow may assume before anyone has typed anything
  // ---------------------------------------------------------------------------
  describe('startup', () => {
    it('should start empty at the email step for a browser with no history', async () => {
      await createComponent();
      expect(component.step()).toBe(InlineAuthStep.Email);
      expect(component.email()).toBe('');
      expect(component.emailStatus()).toBeNull();
      expect(component.remembered()).toBeNull();
    });

    it('should resume a remembered password sign-in', async () => {
      remember({ email: 'jane@example.com', method: 'password' });
      await createComponent();
      expect(component.step()).toBe(InlineAuthStep.PasswordLogin);
      expect(component.email()).toBe('jane@example.com');
    });

    it('should resume a remembered Google sign-in', async () => {
      remember({ email: 'jane@gmail.com', method: 'google', canUseGoogle: true });
      await createComponent();
      expect(component.step()).toBe(InlineAuthStep.GoogleSignin);
      expect(component.email()).toBe('jane@gmail.com');
    });

    it('should not invent a lookup result for a remembered sign-in', async () => {
      remember({ method: 'password' });
      await createComponent();
      // The old code fabricated `hasMemberRecord: true` here, which made the
      // create-account step claim a membership record that was never checked.
      expect(component.emailStatus()).toBeNull();
      // An auth account is still known to exist: one was used here before.
      expect(component.hasKnownAuthAccount()).toBe(true);
    });

    it('should discard the pre-authentication cache this replaced', async () => {
      localStorage.setItem(
        LEGACY_LOGIN_KEY,
        JSON.stringify({ email: 'stale@example.com', hasAuthAccount: true }),
      );
      await createComponent();
      expect(component.step()).toBe(InlineAuthStep.Email);
      expect(component.email()).toBe('');
      // Evicted, not merely ignored: it may hold someone else's address.
      expect(localStorage.getItem(LEGACY_LOGIN_KEY)).toBeNull();
    });

    it.each([
      ['malformed JSON', 'not json at all'],
      ['a missing email', JSON.stringify({ method: 'password' })],
      ['a blank email', JSON.stringify({ email: '   ', method: 'password' })],
      ['an unknown method', JSON.stringify({ email: 'a@b.com', method: 'carrier-pigeon' })],
    ])('should ignore a stored entry with %s', async (_label, raw) => {
      localStorage.setItem(REMEMBERED_LOGIN_KEY, raw);
      await createComponent();
      expect(component.step()).toBe(InlineAuthStep.Email);
      expect(component.email()).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  //  Carrying an attempt across an in-app navigation
  //
  //  Creating a second component against the same TestBed injector stands in
  //  for navigating to another page: a fresh component, the same root-provided
  //  SignInFlowService.
  // ---------------------------------------------------------------------------
  describe('carrying an in-progress attempt between pages', () => {
    /** The login page's dead end: a real address with no membership behind it. */
    async function reachNoMemberOnLoginPage() {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(status({}));
      await createComponent(true);
      component.email.set('stranger@example.com');
      await component.checkEmail();
      expect(component.step()).toBe(InlineAuthStep.NoMember);
    }

    it('should carry the email on to Become a Member', async () => {
      await reachNoMemberOnLoginPage();

      // "Become a Member" navigates; the purchase page mounts its own flow.
      await createComponent(false);

      expect(component.email()).toBe('stranger@example.com');
      expect(component.step()).not.toBe(InlineAuthStep.Email);
    });

    it('should not repeat the lookup that was already done', async () => {
      await reachNoMemberOnLoginPage();
      const check = vi.spyOn(mockService, 'checkEmailStatus').mockClear();

      await createComponent(false);

      expect(check).not.toHaveBeenCalled();
      expect(component.emailStatus()).toEqual(status({}));
    });

    it('should re-derive the step for the page it lands on', async () => {
      await reachNoMemberOnLoginPage();
      await createComponent(false);

      // The same lookup that is a dead end on the login page is an invitation
      // to sign up here, because this page is where accounts get created.
      expect(component.step()).toBe(InlineAuthStep.CreateAccount);
    });

    it('should keep an attempt out of persistent storage', async () => {
      await reachNoMemberOnLoginPage();
      // Carrying it between pages must not resurrect the pre-auth caching this
      // replaced: nothing is stored until a sign-in succeeds.
      expect(localStorage.getItem(REMEMBERED_LOGIN_KEY)).toBeNull();
    });

    it('should take precedence over a sign-in remembered from a past visit', async () => {
      remember({ email: 'old@example.com', method: 'password' });
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: false }),
      );
      await createComponent(true);
      component.goBackToEmail();
      component.email.set('new@example.com');
      await component.checkEmail();

      await createComponent(false);

      expect(component.email()).toBe('new@example.com');
      expect(component.step()).toBe(InlineAuthStep.CreateAccount);
    });

    it('should abandon the attempt when the user changes the email', async () => {
      await reachNoMemberOnLoginPage();
      component.goBackToEmail();

      await createComponent(false);

      expect(component.email()).toBe('');
      expect(component.step()).toBe(InlineAuthStep.Email);
    });

    it('should abandon the attempt on logout', async () => {
      await reachNoMemberOnLoginPage();
      await component.logout();

      await createComponent(false);

      expect(component.email()).toBe('');
      expect(component.step()).toBe(InlineAuthStep.Email);
    });

    it('should start clean when nothing is in progress', async () => {
      TestBed.inject(SignInFlowService).clear();
      await createComponent(false);
      expect(component.email()).toBe('');
      expect(component.step()).toBe(InlineAuthStep.Email);
    });
  });

  // ---------------------------------------------------------------------------
  //  checkEmail → which step the user is sent to
  // ---------------------------------------------------------------------------
  describe('email lookup routing', () => {
    async function lookup(
      result: Partial<CheckEmailStatusResult>,
      showNoMemberOption = false,
    ) {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(status(result));
      await createComponent(showNoMemberOption);
      component.email.set('jane@example.com');
      await component.checkEmail();
      return component.step();
    }

    it('should use a password login when that is all the account has', async () => {
      expect(
        await lookup({ hasAuthAccount: true, hasPasswordProvider: true, hasMemberRecord: true }),
      ).toBe(InlineAuthStep.PasswordLogin);
    });

    it('should send a Google-only account to Google sign-in', async () => {
      expect(
        await lookup({ hasAuthAccount: true, hasGoogleProvider: true, hasMemberRecord: true }),
      ).toBe(InlineAuthStep.GoogleSignin);
    });

    it('should prefer Google when the account has both providers', async () => {
      // One click beats recalling a password; the password route stays
      // reachable from the Google step's menu.
      expect(
        await lookup({
          hasAuthAccount: true,
          hasGoogleProvider: true,
          hasPasswordProvider: true,
          hasMemberRecord: true,
        }),
      ).toBe(InlineAuthStep.GoogleSignin);
    });

    it('should not send a password-only gmail address to Google sign-in', async () => {
      // isGoogleManaged is true for any gmail.com address, so it must not on
      // its own outrank a provider list that says "password, no Google".
      expect(
        await lookup({
          hasAuthAccount: true,
          hasPasswordProvider: true,
          isGoogleManaged: true,
          hasMemberRecord: true,
        }),
      ).toBe(InlineAuthStep.PasswordLogin);
    });

    it('should fall back to the managed-domain hint when providers are unknown', async () => {
      expect(await lookup({ hasAuthAccount: true, isGoogleManaged: true })).toBe(
        InlineAuthStep.GoogleSignin,
      );
      expect(await lookup({ hasAuthAccount: true, isGoogleManaged: false })).toBe(
        InlineAuthStep.PasswordLogin,
      );
    });

    it('should offer account creation to a known member with no auth account', async () => {
      expect(await lookup({ hasMemberRecord: true, hasAuthAccount: false })).toBe(
        InlineAuthStep.CreateAccount,
      );
    });

    it('should send an unregistered Google address to Google sign-in', async () => {
      expect(await lookup({ hasAuthAccount: false, isGoogleManaged: true })).toBe(
        InlineAuthStep.GoogleSignin,
      );
    });

    it('should explain the dead end on the login page when nothing matches', async () => {
      expect(await lookup({}, true)).toBe(InlineAuthStep.NoMember);
    });

    it('should let a stranger sign up where no-member guidance is switched off', async () => {
      // The purchase pages are where an account gets created, so sending
      // someone to "Become a Member" from there would be circular.
      expect(await lookup({}, false)).toBe(InlineAuthStep.CreateAccount);
    });

    it('should return to the email step with an error when the lookup fails', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockRejectedValue(new Error('offline'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await createComponent();
      component.email.set('jane@example.com');
      await component.checkEmail();

      expect(component.step()).toBe(InlineAuthStep.Email);
      expect(component.checkEmailError()).toContain('Unable to check email status');
    });

    it('should ignore an empty email', async () => {
      const check = vi.spyOn(mockService, 'checkEmailStatus');
      await createComponent();
      component.email.set('   ');
      await component.checkEmail();
      expect(check).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  //  Remembering: only ever after a sign-in that actually worked
  // ---------------------------------------------------------------------------
  describe('remembering a sign-in', () => {
    it('should remember nothing from merely looking an email up', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: true, hasPasswordProvider: true }),
      );
      await createComponent();
      component.email.set('typo@example.com');
      await component.checkEmail();

      // The old code cached here, which pinned a typo'd address forever.
      expect(readRemembered()).toBeNull();
    });

    it('should remember nothing when the password is rejected', async () => {
      vi.spyOn(mockService, 'loginWithEmail').mockResolvedValue({
        success: false,
        errorCode: AuthErrorCodes.INVALID_LOGIN_CREDENTIALS,
      });
      await createComponent();
      component.email.set('jane@example.com');
      component.password.set('wrong');
      await component.loginWithEmail();

      expect(readRemembered()).toBeNull();
      expect(component.invalidLoginCredentials()).toBe(true);
    });

    it('should remember a successful password sign-in', async () => {
      await createComponent();
      component.email.set('jane@example.com');
      component.password.set('correct-horse');
      await component.loginWithEmail();

      expect(readRemembered()).toEqual({
        email: 'jane@example.com',
        method: 'password',
        canUseGoogle: false,
      });
    });

    it('should remember a successful Google sign-in', async () => {
      await createComponent();
      component.email.set('jane@gmail.com');
      await component.loginWithGoogle();

      expect(readRemembered()).toEqual({
        email: 'jane@gmail.com',
        method: 'google',
        canUseGoogle: true,
      });
    });

    it('should remember a successful account creation', async () => {
      await createComponent();
      component.email.set('new@example.com');
      component.password.set('abcdef');
      await component.signupWithEmail();

      expect(readRemembered()?.method).toBe('password');
      expect(readRemembered()?.email).toBe('new@example.com');
    });

    it('should carry a looked-up Google option into what it remembers', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: true, hasPasswordProvider: true, hasGoogleProvider: true }),
      );
      await createComponent();
      component.email.set('both@example.com');
      await component.checkEmail();
      // Google is offered first, but this user picks their password.
      component.usePasswordInstead();
      component.password.set('correct-horse');
      await component.loginWithEmail();

      expect(readRemembered()).toEqual({
        email: 'both@example.com',
        method: 'password',
        canUseGoogle: true,
      });
    });

    it('should remember nothing when a cancelled Google popup leaves no session', async () => {
      vi.spyOn(mockService, 'loginWithGoogle').mockResolvedValue({
        success: false,
        errorCode: 'auth/cancelled-popup-request',
      });
      await createComponent();
      component.email.set('jane@gmail.com');
      await component.loginWithGoogle();

      expect(readRemembered()).toBeNull();
      // A cancelled popup is the user's own doing, not an error to report.
      expect(component.loginWithGoogleError()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  //  Signing out
  // ---------------------------------------------------------------------------
  describe('logout', () => {
    it('should leave no trace of who was signed in', async () => {
      remember({ email: 'jane@example.com', method: 'password' });
      await createComponent();
      expect(component.email()).toBe('jane@example.com');

      await component.logout();

      expect(readRemembered()).toBeNull();
      expect(component.email()).toBe('');
      expect(component.step()).toBe(InlineAuthStep.Email);
      expect(component.remembered()).toBeNull();
    });

    it('should start the next visit clean after a logout', async () => {
      remember({ method: 'password' });
      await createComponent();
      await component.logout();

      // A second visit in the same browser, e.g. the next person to use it.
      await createComponent();
      expect(component.step()).toBe(InlineAuthStep.Email);
      expect(component.email()).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  //  Correcting the email
  // ---------------------------------------------------------------------------
  describe('changing the email', () => {
    it('should keep the address for editing but drop everything derived from it', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: true, hasPasswordProvider: true }),
      );
      await createComponent();
      component.email.set('jane@example.com');
      await component.checkEmail();
      component.password.set('half-typed');

      component.goBackToEmail();

      expect(component.step()).toBe(InlineAuthStep.Email);
      // Kept so a typo can be fixed rather than retyped.
      expect(component.email()).toBe('jane@example.com');
      expect(component.password()).toBe('');
      expect(component.emailStatus()).toBeNull();
      expect(readRemembered()).toBeNull();
    });

    it.each([
      ['password login', { hasAuthAccount: true, hasPasswordProvider: true }],
      ['Google sign-in', { hasAuthAccount: true, hasGoogleProvider: true }],
      ['account creation', { hasMemberRecord: true, hasAuthAccount: false }],
    ])('should render the email as a control on the %s step', async (_label, result) => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(status(result));
      await createComponent();
      component.email.set('jane@example.com');
      await component.checkEmail();
      fixture.detectChanges();

      const chip = html().querySelector<HTMLButtonElement>('#change-email-btn');
      expect(chip).toBeTruthy();
      expect(chip!.textContent).toContain('jane@example.com');
    });

    it('should return to email entry when the address is clicked', async () => {
      remember({ email: 'jane@example.com', method: 'password' });
      await createComponent();
      fixture.detectChanges();

      html().querySelector<HTMLButtonElement>('#change-email-btn')!.click();
      fixture.detectChanges();

      expect(component.step()).toBe(InlineAuthStep.Email);
      expect(html().querySelector('#email-input')).toBeTruthy();
    });

    it('should let a fresh lookup override what was remembered', async () => {
      remember({ email: 'old@example.com', method: 'google', canUseGoogle: true });
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: true, hasPasswordProvider: true }),
      );
      await createComponent();

      component.goBackToEmail();
      component.email.set('new@example.com');
      await component.checkEmail();

      expect(component.remembered()).toBeNull();
      expect(component.step()).toBe(InlineAuthStep.PasswordLogin);
      expect(component.canUseGoogle()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  //  Offering the alternative provider
  // ---------------------------------------------------------------------------
  describe('switching provider', () => {
    it('should offer Google only when it is actually available', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasAuthAccount: true, hasPasswordProvider: true, hasMemberRecord: true }),
      );
      await createComponent();
      component.email.set('jane@example.com');
      await component.checkEmail();
      fixture.detectChanges();

      expect(component.canUseGoogle()).toBe(false);
      expect(html().querySelector('#use-google-btn')).toBeNull();
    });

    it('should present the alternative as a button, not a hidden menu', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasAuthAccount: true, hasGoogleProvider: true, hasMemberRecord: true }),
      );
      await createComponent();
      component.email.set('jane@example.com');
      await component.checkEmail();
      fixture.detectChanges();

      // Both routes are visible without opening anything.
      expect(html().querySelector('#google-signin-btn')).toBeTruthy();
      expect(html().querySelector('#use-password-btn')).toBeTruthy();
      expect(html().querySelector('.more-options-btn')).toBeNull();
    });

    it('should word both buttons as signing up when there is no account yet', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: false, isGoogleManaged: true }),
      );
      await createComponent();
      component.email.set('jane@gmail.com');
      await component.checkEmail();
      fixture.detectChanges();

      // Nothing exists to sign in to yet, and "use" would imply a password
      // the user does not have.
      expect(html().querySelector('#google-signin-btn')!.textContent!.trim()).toBe(
        'Sign up with Google',
      );
      expect(html().querySelector('#use-password-btn')!.textContent!.trim()).toBe(
        'Set a password',
      );
    });

    it('should word both buttons as signing in for an existing account', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: true, hasGoogleProvider: true }),
      );
      await createComponent();
      component.email.set('jane@gmail.com');
      await component.checkEmail();
      fixture.detectChanges();

      expect(html().querySelector('#google-signin-btn')!.textContent!.trim()).toBe(
        'Sign in with Google',
      );
      expect(html().querySelector('#use-password-btn')!.textContent!.trim()).toBe(
        'Use a password',
      );
    });

    it('should let a both-providers account fall back to its password', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({
          hasAuthAccount: true,
          hasPasswordProvider: true,
          hasGoogleProvider: true,
          hasMemberRecord: true,
        }),
      );
      await createComponent();
      component.email.set('jane@example.com');
      await component.checkEmail();
      fixture.detectChanges();

      expect(component.step()).toBe(InlineAuthStep.GoogleSignin);
      expect(component.canUseGoogle()).toBe(true);

      html().querySelector<HTMLButtonElement>('#use-password-btn')!.click();
      fixture.detectChanges();

      expect(component.step()).toBe(InlineAuthStep.PasswordLogin);
      expect(html().querySelector('#password-input')).toBeTruthy();

      // And back again, so neither choice is a trap.
      html().querySelector<HTMLButtonElement>('#use-google-btn')!.click();
      fixture.detectChanges();
      expect(component.step()).toBe(InlineAuthStep.GoogleSignin);
    });

    it('should remember whether Google was available across visits', async () => {
      remember({ method: 'password', canUseGoogle: true });
      await createComponent();
      expect(component.canUseGoogle()).toBe(true);

      localStorage.clear();
      remember({ method: 'password', canUseGoogle: false });
      await createComponent();
      expect(component.canUseGoogle()).toBe(false);
    });

    it('should send someone with no account to create one rather than sign in', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: false, isGoogleManaged: true }),
      );
      await createComponent();
      component.email.set('jane@gmail.com');
      await component.checkEmail();
      expect(component.step()).toBe(InlineAuthStep.GoogleSignin);

      component.usePasswordInstead();
      expect(component.step()).toBe(InlineAuthStep.CreateAccount);
    });

    it('should send someone with an account to the password step', async () => {
      remember({ method: 'google', canUseGoogle: true });
      await createComponent();
      component.usePasswordInstead();
      expect(component.step()).toBe(InlineAuthStep.PasswordLogin);
    });
  });

  // ---------------------------------------------------------------------------
  //  Progress wording while a request is in flight
  // ---------------------------------------------------------------------------
  describe('progress message', () => {
    /**
     * Holds an auth call open so the in-flight UI can be inspected, and hands
     * back the release function to finish it.
     */
    function suspend(method: 'loginWithGoogle' | 'loginWithEmail' | 'signupWithEmail') {
      let release!: (result: AuthOperationResult) => void;
      const pending = new Promise<AuthOperationResult>((resolve) => {
        release = resolve;
      });
      vi.spyOn(mockService, method).mockReturnValue(pending);
      return {
        finish: async (inFlight: Promise<void>) => {
          release({ success: false, errorCode: 'auth/cancelled-popup-request' });
          await inFlight;
        },
      };
    }

    async function messageDuring(
      method: 'loginWithGoogle' | 'loginWithEmail' | 'signupWithEmail',
      start: () => Promise<void>,
    ) {
      const held = suspend(method);
      const inFlight = start();
      fixture.detectChanges();
      const text = html().textContent ?? '';
      await held.finish(inFlight);
      return text;
    }

    it('should say it is signing in for a password login', async () => {
      await createComponent();
      component.email.set('jane@example.com');
      component.password.set('correct-horse');

      const text = await messageDuring('loginWithEmail', () => component.loginWithEmail());
      expect(text).toContain('Signing in…');
    });

    it('should name Google while its popup is open', async () => {
      remember({ email: 'jane@gmail.com', method: 'google', canUseGoogle: true });
      await createComponent();

      const text = await messageDuring('loginWithGoogle', () => component.loginWithGoogle());
      expect(text).toContain('Signing in with Google…');
    });

    it('should say it is creating an account for a password sign-up', async () => {
      await createComponent();
      component.email.set('new@example.com');
      component.password.set('abcdef');

      const text = await messageDuring('signupWithEmail', () => component.signupWithEmail());
      expect(text).toContain('Creating your account…');
      expect(text).not.toContain('Signing in');
    });

    it('should say it is creating an account for a Google sign-up', async () => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(
        status({ hasMemberRecord: true, hasAuthAccount: false, isGoogleManaged: true }),
      );
      await createComponent();
      component.email.set('brand-new@gmail.com');
      await component.checkEmail();

      const text = await messageDuring('loginWithGoogle', () => component.loginWithGoogle());
      // No account exists yet, so this is a sign-up however Google frames it.
      expect(text).toContain('Creating your account with Google…');
    });

    it('should fall back to signing in while a session is restored on load', async () => {
      await createComponent();
      (mockService.loginStatus as unknown as { set: (v: LoginStatus) => void }).set(
        LoginStatus.LoggingIn,
      );
      fixture.detectChanges();
      // Nothing the component started; the service is resuming a session.
      expect(html().textContent).toContain('Signing in…');
    });
  });

  // ---------------------------------------------------------------------------
  //  Errors surfaced to the user
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('should offer a password reset after a rejected password', async () => {
      vi.spyOn(mockService, 'loginWithEmail').mockResolvedValue({
        success: false,
        errorCode: AuthErrorCodes.INVALID_LOGIN_CREDENTIALS,
      });
      await createComponent();
      component.email.set('jane@example.com');
      component.password.set('nope');
      await component.loginWithEmail();

      expect(component.invalidLoginCredentials()).toBe(true);
      expect(component.loginError()).toBeNull();
    });

    it('should report other sign-in failures verbatim', async () => {
      vi.spyOn(mockService, 'loginWithEmail').mockResolvedValue({
        success: false,
        errorCode: 'auth/network-request-failed',
      });
      await createComponent();
      component.email.set('jane@example.com');
      component.password.set('whatever');
      await component.loginWithEmail();

      expect(component.loginError()).toContain('auth/network-request-failed');
      expect(component.invalidLoginCredentials()).toBe(false);
    });

    it('should point an existing account at signing in instead', async () => {
      vi.spyOn(mockService, 'signupWithEmail').mockResolvedValue({
        success: false,
        errorCode: 'auth/email-already-in-use',
      });
      await createComponent();
      component.email.set('jane@example.com');
      component.password.set('abcdef');
      await component.signupWithEmail();

      expect(component.signupError()).toContain('An account already exists');
    });

    it('should confirm where a reset link was sent', async () => {
      await createComponent();
      component.email.set('jane@example.com');
      await component.resetPassword();
      expect(component.resetPasswordSuccess()).toContain('jane@example.com');
    });

    it('should ask for an email before sending a reset link', async () => {
      const reset = vi.spyOn(mockService, 'resetPassword');
      await createComponent();
      component.email.set('');
      await component.resetPassword();

      expect(reset).not.toHaveBeenCalled();
      expect(component.resetPasswordError()).toContain('Please enter your email');
    });
  });

  // ---------------------------------------------------------------------------
  //  No-member dead end (login page only)
  // ---------------------------------------------------------------------------
  describe('no member record', () => {
    beforeEach(() => {
      vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue(status({}));
    });

    it('should route to becoming a member', async () => {
      await createComponent(true);
      component.email.set('stranger@example.com');
      await component.checkEmail();
      fixture.detectChanges();

      html().querySelector<HTMLButtonElement>('#become-member-btn')!.click();
      expect(navigateToParts).toHaveBeenCalledWith(['become-a-member']);
    });

    it('should put the "already a member?" note after the actions', async () => {
      await createComponent(true);
      component.email.set('stranger@example.com');
      await component.checkEmail();
      fixture.detectChanges();

      const actions = html().querySelector('.step-actions')!;
      const note = html().querySelector('.step-footnote')!;
      expect(note.textContent).toContain('If you think you already have an account');
      expect(note.textContent).toContain('picture of your passbook');
      // The note is a fallback, not the lead-in to the buttons.
      expect(actions.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('should allow an account without a membership', async () => {
      await createComponent(true);
      component.email.set('stranger@example.com');
      await component.checkEmail();
      fixture.detectChanges();

      html().querySelector<HTMLButtonElement>('#create-guest-account-btn')!.click();
      fixture.detectChanges();

      expect(component.step()).toBe(InlineAuthStep.GuestCreateAccount);
      expect(html().querySelector('#guest-password-input')).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  //  Signed-in and verification states
  // ---------------------------------------------------------------------------
  describe('session states', () => {
    it('should show the signed-in badge instead of the form', async () => {
      (mockService.user as unknown as { set: (v: unknown) => void }).set({
        firebaseUser: { email: 'jane@example.com' } as never,
        member: { emails: ['jane@example.com'], memberId: 'ILC-1' },
      });
      await createComponent();
      fixture.detectChanges();

      expect(html().querySelector('.logged-in-box')).toBeTruthy();
      expect(html().querySelector('#email-input')).toBeNull();
      expect(html().textContent).toContain('ILC-1');
    });

    it('should prompt for verification when the address is unconfirmed', async () => {
      (mockService.loginStatus as unknown as { set: (v: LoginStatus) => void }).set(
        LoginStatus.NeedsEmailVerification,
      );
      (mockService.unverifiedUser as unknown as { set: (v: unknown) => void }).set({
        email: 'jane@example.com',
      });
      await createComponent();
      fixture.detectChanges();

      expect(html().querySelector('#check-verified-btn')).toBeTruthy();
      expect(html().textContent).toContain('jane@example.com');
    });

    it('should confirm that a new verification email went out', async () => {
      (mockService.loginStatus as unknown as { set: (v: LoginStatus) => void }).set(
        LoginStatus.NeedsEmailVerification,
      );
      await createComponent();
      await component.resendVerificationEmail();
      expect(component.resendSuccess()).toContain('verification email has been sent');
    });
  });
});
