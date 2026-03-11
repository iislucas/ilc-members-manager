import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginComponent, LoginStep } from './login';
import {
  AuthOperationResult,
  createFirebaseStateServiceMock,
  FirebaseStateService,
  LoginStatus,
  ResetPasswordResult,
} from '../firebase-state.service';
import { provideZonelessChangeDetection } from '@angular/core';
import { UserCredential, AuthErrorCodes } from 'firebase/auth';
import { CheckEmailStatusResult } from '../../../functions/src/data-model';

const CACHED_LOGIN_KEY = 'ilc-login-info';

// Helpers to read / write the same localStorage key the component uses.
function setCachedLoginInfo(info: {
  email: string;
  isGoogleManaged: boolean;
  hasAuthAccount: boolean;
}) {
  localStorage.setItem(CACHED_LOGIN_KEY, JSON.stringify(info));
}

function getCachedLoginInfo() {
  const raw = localStorage.getItem(CACHED_LOGIN_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let mockService: FirebaseStateService;

  beforeEach(async () => {
    localStorage.removeItem(CACHED_LOGIN_KEY);
    mockService = createFirebaseStateServiceMock();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: mockService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(CACHED_LOGIN_KEY);
  });

  // ---------------------------------------------------------------------------
  //  Initial state (no cache)
  // ---------------------------------------------------------------------------
  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start at the Email step when no cache exists', () => {
    expect(component.loginStep()).toBe(LoginStep.Email);
    expect(component.isReturningUser()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  //  checkEmail → step routing
  // ---------------------------------------------------------------------------

  it('should route to NoMember when email has no member record', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: false,
      hasAuthAccount: false,
      isGoogleManaged: false,
    });

    component.loginEmail.set('nobody@example.com');
    await component.checkEmail();

    expect(component.loginStep()).toBe(LoginStep.NoMember);
  });

  it('should route to GoogleSignin for Google-managed email with member record', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: true,
      hasAuthAccount: false,
      isGoogleManaged: true,
    });

    component.loginEmail.set('member@gmail.com');
    await component.checkEmail();

    expect(component.loginStep()).toBe(LoginStep.GoogleSignin);
  });

  it('should route to PasswordLogin for email with existing auth account', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: true,
      hasAuthAccount: true,
      isGoogleManaged: false,
    });

    component.loginEmail.set('member@example.org');
    await component.checkEmail();

    expect(component.loginStep()).toBe(LoginStep.PasswordLogin);
  });

  it('should route to CreateAccount for member without auth account', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: true,
      hasAuthAccount: false,
      isGoogleManaged: false,
    });

    component.loginEmail.set('new-member@example.org');
    await component.checkEmail();

    expect(component.loginStep()).toBe(LoginStep.CreateAccount);
  });

  it('should show error and return to Email step when checkEmailStatus fails', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockRejectedValue(
      new Error('network error'),
    );

    component.loginEmail.set('broken@example.com');
    await component.checkEmail();

    expect(component.loginStep()).toBe(LoginStep.Email);
    expect(component.checkEmailError()).toContain('Unable to check email status');
  });

  it('should do nothing if email is empty', async () => {
    component.loginEmail.set('  ');
    await component.checkEmail();

    expect(component.loginStep()).toBe(LoginStep.Email);
  });

  // ---------------------------------------------------------------------------
  //  localStorage caching
  // ---------------------------------------------------------------------------

  it('should cache login info after checkEmail finds a member record', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: true,
      hasAuthAccount: true,
      isGoogleManaged: false,
    });

    component.loginEmail.set('member@example.org');
    await component.checkEmail();

    const cached = getCachedLoginInfo();
    expect(cached).toEqual({
      email: 'member@example.org',
      hasAuthAccount: true,
      isGoogleManaged: false,
    });
  });

  it('should NOT cache login info when email has no member record', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: false,
      hasAuthAccount: false,
      isGoogleManaged: false,
    });

    component.loginEmail.set('nobody@example.com');
    await component.checkEmail();

    expect(getCachedLoginInfo()).toBeNull();
  });

  it('should clear cache when goBackToEmail is called', async () => {
    // Set up a cache entry first.
    setCachedLoginInfo({
      email: 'member@gmail.com',
      isGoogleManaged: true,
      hasAuthAccount: true,
    });
    expect(getCachedLoginInfo()).not.toBeNull();

    component.goBackToEmail();

    expect(getCachedLoginInfo()).toBeNull();
    expect(component.loginStep()).toBe(LoginStep.Email);
    expect(component.isReturningUser()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  //  Returning user (from cache) — requires re-creating the component
  // ---------------------------------------------------------------------------

  describe('with cached Google user', () => {
    beforeEach(async () => {
      setCachedLoginInfo({
        email: 'member@gmail.com',
        isGoogleManaged: true,
        hasAuthAccount: true,
      });

      // Re-create the component so the constructor reads the cache.
      fixture = TestBed.createComponent(LoginComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should skip to GoogleSignin step', () => {
      expect(component.loginStep()).toBe(LoginStep.GoogleSignin);
    });

    it('should set isReturningUser to true', () => {
      expect(component.isReturningUser()).toBe(true);
    });

    it('should pre-fill the email from cache', () => {
      expect(component.loginEmail()).toBe('member@gmail.com');
    });

    it('should set emailStatus from cache', () => {
      expect(component.emailStatus()).toEqual({
        hasMemberRecord: true,
        isGoogleManaged: true,
        hasAuthAccount: true,
      });
    });
  });

  describe('with cached password user', () => {
    beforeEach(async () => {
      setCachedLoginInfo({
        email: 'member@example.org',
        isGoogleManaged: false,
        hasAuthAccount: true,
      });

      fixture = TestBed.createComponent(LoginComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should skip to PasswordLogin step', () => {
      expect(component.loginStep()).toBe(LoginStep.PasswordLogin);
    });

    it('should set isReturningUser to true', () => {
      expect(component.isReturningUser()).toBe(true);
    });

    it('should pre-fill the email from cache', () => {
      expect(component.loginEmail()).toBe('member@example.org');
    });
  });

  describe('with cached new member (no auth account)', () => {
    beforeEach(async () => {
      setCachedLoginInfo({
        email: 'new-member@example.org',
        isGoogleManaged: false,
        hasAuthAccount: false,
      });

      fixture = TestBed.createComponent(LoginComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should skip to CreateAccount step', () => {
      expect(component.loginStep()).toBe(LoginStep.CreateAccount);
    });
  });

  // ---------------------------------------------------------------------------
  //  Cache updates after successful authentication
  // ---------------------------------------------------------------------------

  it('should update cache with hasAuthAccount after successful loginWithEmail', async () => {
    // Set up initial state (existing member, no auth account yet).
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: true,
      hasAuthAccount: false,
      isGoogleManaged: false,
    });
    component.loginEmail.set('member@example.org');
    await component.checkEmail();

    // Now simulate successful login.
    vi.spyOn(mockService, 'loginWithEmail').mockResolvedValue({
      success: true,
      userCredential: {} as UserCredential,
    });
    component.loginPassword.set('password123');
    await component.loginWithEmail();

    const cached = getCachedLoginInfo();
    expect(cached).toEqual({
      email: 'member@example.org',
      hasAuthAccount: true,
      isGoogleManaged: false,
    });
  });

  it('should update cache after successful signupWithEmail', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: true,
      hasAuthAccount: false,
      isGoogleManaged: false,
    });
    component.loginEmail.set('new@example.org');
    await component.checkEmail();

    vi.spyOn(mockService, 'signupWithEmail').mockResolvedValue({
      success: true,
      userCredential: {} as UserCredential,
    });
    component.loginPassword.set('newpass123');
    await component.signupWithEmail();

    const cached = getCachedLoginInfo();
    expect(cached?.hasAuthAccount).toBe(true);
  });

  it('should update cache after successful loginWithGoogle', async () => {
    vi.spyOn(mockService, 'loginWithGoogle').mockResolvedValue({
      success: true,
      userCredential: {} as UserCredential,
    });
    component.loginEmail.set('user@gmail.com');
    await component.loginWithGoogle();

    const cached = getCachedLoginInfo();
    expect(cached).toEqual({
      email: 'user@gmail.com',
      isGoogleManaged: true,
      hasAuthAccount: true,
    });
  });

  // ---------------------------------------------------------------------------
  //  loginWithEmail — error handling
  // ---------------------------------------------------------------------------

  it('should set invalidLoginCredentials on INVALID_LOGIN_CREDENTIALS error', async () => {
    vi.spyOn(mockService, 'loginWithEmail').mockResolvedValue({
      success: false,
      errorCode: AuthErrorCodes.INVALID_LOGIN_CREDENTIALS,
    });

    component.loginEmail.set('member@example.org');
    component.loginPassword.set('wrong');
    await component.loginWithEmail();

    expect(component.invalidLoginCredentials()).toBe(true);
    expect(component.loginError()).toBeNull();
  });

  it('should set loginError on non-credential auth error', async () => {
    vi.spyOn(mockService, 'loginWithEmail').mockResolvedValue({
      success: false,
      errorCode: 'auth/too-many-requests',
    });

    component.loginEmail.set('member@example.org');
    component.loginPassword.set('pass');
    await component.loginWithEmail();

    expect(component.invalidLoginCredentials()).toBe(false);
    expect(component.loginError()).toContain('auth/too-many-requests');
  });

  // ---------------------------------------------------------------------------
  //  signupWithEmail — error handling
  // ---------------------------------------------------------------------------

  it('should redirect to PasswordLogin when signup returns EMAIL_EXISTS', async () => {
    vi.spyOn(mockService, 'signupWithEmail').mockResolvedValue({
      success: false,
      errorCode: AuthErrorCodes.EMAIL_EXISTS,
    });

    component.loginEmail.set('existing@example.org');
    component.loginPassword.set('pass123');
    await component.signupWithEmail();

    expect(component.loginStep()).toBe(LoginStep.PasswordLogin);
    expect(component.loginError()).toContain('already exists');
  });

  it('should set signupError on non-duplicate signup error', async () => {
    vi.spyOn(mockService, 'signupWithEmail').mockResolvedValue({
      success: false,
      errorCode: 'auth/network-request-failed',
    });

    component.loginEmail.set('user@example.org');
    component.loginPassword.set('pass123');
    await component.signupWithEmail();

    expect(component.signupError()).toContain('auth/network-request-failed');
  });

  // ---------------------------------------------------------------------------
  //  loginWithGoogle — error handling
  // ---------------------------------------------------------------------------

  it('should set loginWithGoogleError on non-cancelled popup error', async () => {
    vi.spyOn(mockService, 'loginWithGoogle').mockResolvedValue({
      success: false,
      errorCode: 'auth/popup-blocked',
    });

    await component.loginWithGoogle();

    expect(component.loginWithGoogleError()).toBe('auth/popup-blocked');
  });

  it('should silently ignore cancelled popup requests', async () => {
    vi.spyOn(mockService, 'loginWithGoogle').mockResolvedValue({
      success: false,
      errorCode: 'auth/cancelled-popup-request',
    });

    await component.loginWithGoogle();

    expect(component.loginWithGoogleError()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  //  resetPassword
  // ---------------------------------------------------------------------------

  it('should set resetPasswordSuccess on successful password reset', async () => {
    vi.spyOn(mockService, 'resetPassword').mockResolvedValue({ success: true });

    component.loginEmail.set('member@example.org');
    await component.resetPassword();

    expect(component.resetPasswordSuccess()).toContain('member@example.org');
  });

  it('should set resetPasswordError when reset fails', async () => {
    vi.spyOn(mockService, 'resetPassword').mockResolvedValue({
      success: false,
      errorMessage: 'auth/user-not-found',
    });

    component.loginEmail.set('nobody@example.org');
    await component.resetPassword();

    expect(component.resetPasswordError()).toBe('auth/user-not-found');
  });

  it('should show error when resetPassword called with empty email', async () => {
    component.loginEmail.set('');
    await component.resetPassword();

    expect(component.resetPasswordError()).toContain('Please enter your email');
  });

  // ---------------------------------------------------------------------------
  //  usePasswordInstead
  // ---------------------------------------------------------------------------

  it('should route to PasswordLogin when user has an auth account', () => {
    component.emailStatus.set({
      hasMemberRecord: true,
      hasAuthAccount: true,
      isGoogleManaged: true,
    });

    component.usePasswordInstead();

    expect(component.loginStep()).toBe(LoginStep.PasswordLogin);
  });

  it('should route to CreateAccount when user has no auth account', () => {
    component.emailStatus.set({
      hasMemberRecord: true,
      hasAuthAccount: false,
      isGoogleManaged: true,
    });

    component.usePasswordInstead();

    expect(component.loginStep()).toBe(LoginStep.CreateAccount);
  });

  // ---------------------------------------------------------------------------
  //  goBackToEmail
  // ---------------------------------------------------------------------------

  it('should clear password and messages when going back', () => {
    component.loginPassword.set('secret');
    component.loginError.set('some error');
    component.invalidLoginCredentials.set(true);
    component.signupError.set('signup fail');

    component.goBackToEmail();

    expect(component.loginPassword()).toBe('');
    expect(component.loginStep()).toBe(LoginStep.Email);
    expect(component.loginError()).toBeNull();
    expect(component.invalidLoginCredentials()).toBe(false);
    expect(component.signupError()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  //  dismissMessages
  // ---------------------------------------------------------------------------

  it('should clear all error and success signals', () => {
    component.checkEmailError.set('err1');
    component.loginError.set('err2');
    component.invalidLoginCredentials.set(true);
    component.loginWithGoogleError.set('err3');
    component.signupError.set('err4');
    component.resetPasswordError.set('err5');
    component.resetPasswordSuccess.set('success');

    component.dismissMessages();

    expect(component.checkEmailError()).toBeNull();
    expect(component.loginError()).toBeNull();
    expect(component.invalidLoginCredentials()).toBe(false);
    expect(component.loginWithGoogleError()).toBeNull();
    expect(component.signupError()).toBeNull();
    expect(component.resetPasswordError()).toBeNull();
    expect(component.resetPasswordSuccess()).toBeNull();
  });
});
