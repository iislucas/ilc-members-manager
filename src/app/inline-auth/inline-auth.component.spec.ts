/* inline-auth.component.spec.ts
 *
 * Unit tests for InlineAuthComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InlineAuthComponent, InlineAuthStep } from './inline-auth.component';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { initMember } from '../../../functions/src/data-model';

describe('InlineAuthComponent', () => {
  let fixture: ComponentFixture<InlineAuthComponent>;
  let component: InlineAuthComponent;
  let userSignal: ReturnType<typeof signal<any>>;
  let loginStatusSignal: ReturnType<typeof signal<LoginStatus>>;
  let loginErrorSignal: ReturnType<typeof signal<string | null>>;

  let mockFirebaseService: {
    user: typeof userSignal;
    loginStatus: typeof loginStatusSignal;
    loginError: typeof loginErrorSignal;
    unverifiedUser: ReturnType<typeof signal<any>>;
    verificationEmailSent: ReturnType<typeof signal<boolean>>;
    verificationError: ReturnType<typeof signal<string | null>>;
    resendVerificationEmail: ReturnType<typeof vi.fn>;
    checkEmailVerification: ReturnType<typeof vi.fn>;
    checkEmailStatus: ReturnType<typeof vi.fn>;
    loginWithGoogle: ReturnType<typeof vi.fn>;
    loginWithEmail: ReturnType<typeof vi.fn>;
    signupWithEmail: ReturnType<typeof vi.fn>;
    resetPassword: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    localStorage.clear();
    userSignal = signal(null);
    loginStatusSignal = signal(LoginStatus.SignedOut);
    loginErrorSignal = signal(null);

    mockFirebaseService = {
      user: userSignal,
      unverifiedUser: signal(null),
      verificationEmailSent: signal(false),
      verificationError: signal(null),
      loginStatus: loginStatusSignal,
      loginError: loginErrorSignal,
      resendVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
      checkEmailVerification: vi.fn().mockResolvedValue({ verified: true }),
      checkEmailStatus: vi.fn(),
      loginWithGoogle: vi.fn(),
      loginWithEmail: vi.fn(),
      signupWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      logout: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [InlineAuthComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: mockFirebaseService },
        {
          provide: RoutingService,
          useValue: {
            navigateToParts: vi.fn(),
            hrefForView: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  async function createComponent(): Promise<void> {
    fixture = TestBed.createComponent(InlineAuthComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should create in signed-out state with Email step', async () => {
    await createComponent();
    expect(component).toBeTruthy();
    expect(component.isLoggedIn()).toBe(false);
    expect(component.step()).toBe(InlineAuthStep.Email);
  });

  it('should show verification box when loginStatus is NeedsEmailVerification', async () => {
    loginStatusSignal.set(LoginStatus.NeedsEmailVerification);
    mockFirebaseService.unverifiedUser.set({ email: 'unverified@example.com' });
    await createComponent();

    expect(component.isNeedsVerification()).toBe(true);
    expect(component.unverifiedEmail()).toBe('unverified@example.com');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.verification-title')?.textContent).toContain('Verify Your Email Address');
    expect(compiled.querySelector('.verification-text')?.textContent).toContain('unverified@example.com');
  });

  it('should call checkEmailVerification on button click', async () => {
    loginStatusSignal.set(LoginStatus.NeedsEmailVerification);
    mockFirebaseService.unverifiedUser.set({ email: 'unverified@example.com' });
    await createComponent();

    await component.checkEmailVerified();
    expect(mockFirebaseService.checkEmailVerification).toHaveBeenCalled();
  });

  it('should call resendVerificationEmail on button click', async () => {
    loginStatusSignal.set(LoginStatus.NeedsEmailVerification);
    mockFirebaseService.unverifiedUser.set({ email: 'unverified@example.com' });
    await createComponent();

    await component.resendVerificationEmail();
    expect(mockFirebaseService.resendVerificationEmail).toHaveBeenCalled();
    expect(component.resendSuccess()).toContain('verification email has been sent');
  });

  it('should show logged in view when user is signed in', async () => {
    userSignal.set({
      uid: 'user_1',
      firebaseUser: { email: 'user@example.com' },
      member: {
        ...initMember(),
        docId: 'mem_1',
        memberId: 'US123',
        emails: ['user@example.com'],
      },
    });
    await createComponent();

    expect(component.isLoggedIn()).toBe(true);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.user-email-row')?.textContent).toContain('user@example.com');
    expect(compiled.querySelector('.identifier-chip')?.textContent).toContain('US123');
  });

  it('should route to GoogleSignin step when email is Google-managed', async () => {
    mockFirebaseService.checkEmailStatus.mockResolvedValueOnce({
      hasMemberRecord: true,
      hasAuthAccount: true,
      isGoogleManaged: true,
    });

    await createComponent();
    component.email.set('googleuser@gmail.com');
    await component.checkEmail();

    expect(mockFirebaseService.checkEmailStatus).toHaveBeenCalledWith('googleuser@gmail.com');
    expect(component.step()).toBe(InlineAuthStep.GoogleSignin);
  });

  it('should route to PasswordLogin step when existing auth account found', async () => {
    mockFirebaseService.checkEmailStatus.mockResolvedValueOnce({
      hasMemberRecord: true,
      hasAuthAccount: true,
      isGoogleManaged: false,
    });

    await createComponent();
    component.email.set('passworduser@example.com');
    await component.checkEmail();

    expect(component.step()).toBe(InlineAuthStep.PasswordLogin);
  });

  it('should route to CreateAccount step when no auth account found', async () => {
    mockFirebaseService.checkEmailStatus.mockResolvedValueOnce({
      hasMemberRecord: false,
      hasAuthAccount: false,
      isGoogleManaged: false,
    });

    await createComponent();
    component.email.set('newuser@example.com');
    await component.checkEmail();

    expect(component.step()).toBe(InlineAuthStep.CreateAccount);
  });

  it('should call signupWithEmail on password submit in CreateAccount step', async () => {
    mockFirebaseService.signupWithEmail.mockResolvedValueOnce({ success: true });

    await createComponent();
    component.email.set('newuser@example.com');
    component.password.set('validPassword123');
    component.step.set(InlineAuthStep.CreateAccount);

    await component.signupWithEmail();

    expect(mockFirebaseService.signupWithEmail).toHaveBeenCalledWith(
      'validPassword123',
      'newuser@example.com',
    );
  });

  it('should call logout on logout button click', async () => {
    userSignal.set({
      uid: 'user_1',
      firebaseUser: { email: 'user@example.com' },
      member: {
        ...initMember(),
        docId: 'mem_1',
      },
    });
    await createComponent();

    await component.logout();
    expect(mockFirebaseService.logout).toHaveBeenCalled();
  });
});
