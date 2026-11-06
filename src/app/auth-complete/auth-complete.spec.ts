import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initPathPatterns, ROUTING_CONFIG, Views } from '../app.config';
import {
  createFirebaseStateServiceMock,
  FirebaseStateService,
  LoginStatus,
  UserDetails,
} from '../firebase-state.service';
import { EmailLinkIntent } from '../inline-auth/auth-link-return';
import { RoutingService } from '../routing.service';
import { AuthCompleteComponent } from './auth-complete';

describe('AuthCompleteComponent', () => {
  let fixture: ComponentFixture<AuthCompleteComponent>;
  let component: AuthCompleteComponent;
  let firebaseService: FirebaseStateService;
  let routingService: RoutingService<typeof initPathPatterns>;

  const signedInDetails = {
    member: {
      docId: 'm1',
      memberId: 'US100',
      name: 'Test Member',
      emails: ['monika@example.com'],
    },
    memberProfiles: [],
    isAdmin: false,
    schoolsManaged: [],
    firebaseUser: { email: 'monika@example.com', uid: 'u1', providerData: [] },
  } as unknown as UserDetails;

  beforeEach(async () => {
    window.history.replaceState(null, '', '/auth/complete');
    firebaseService = createFirebaseStateServiceMock();

    await TestBed.configureTestingModule({
      imports: [AuthCompleteComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        { provide: FirebaseStateService, useValue: firebaseService },
      ],
    }).compileComponents();

    routingService = TestBed.inject(RoutingService) as RoutingService<typeof initPathPatterns>;
  });

  function mount(): HTMLElement {
    fixture = TestBed.createComponent(AuthCompleteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows minimal signing-in spinner while email link verification is in flight', () => {
    firebaseService.isCompletingEmailLink.set(true);
    firebaseService.loginStatus.set(LoginStatus.LoggingIn);

    const el = mount();
    expect(el.querySelector('.auth-complete-heading')?.textContent).toContain('Signing you in');
    expect(el.querySelector('#auth-complete-signing-in')).not.toBeNull();
  });

  it('shows password-reset heading while verifying a reset-password link', () => {
    routingService.signals[Views.AuthComplete].urlParams.intent.set(EmailLinkIntent.ResetPassword);
    firebaseService.isCompletingEmailLink.set(true);

    const el = mount();
    expect(el.querySelector('.auth-complete-heading')?.textContent).toContain(
      'Resetting your password',
    );
  });

  it('redirects automatically via replaceState once signed in for a standard sign-in link', async () => {
    const navSpy = vi.spyOn(routingService, 'navigateTo');
    routingService.signals[Views.AuthComplete].urlParams.returnTo.set('/become-a-member?step=1');
    firebaseService.isCompletingEmailLink.set(true);

    mount();
    expect(navSpy).not.toHaveBeenCalled();

    firebaseService.user.set(signedInDetails);
    firebaseService.loginStatus.set(LoginStatus.SignedIn);
    firebaseService.isCompletingEmailLink.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navSpy).toHaveBeenCalledWith('become-a-member?step=1', {
      clearUrlParams: true,
      replaceState: true,
    });
  });

  it('rejects external returnTo open-redirect attempts and redirects to Home instead', async () => {
    const navSpy = vi.spyOn(routingService, 'navigateTo');
    routingService.signals[Views.AuthComplete].urlParams.returnTo.set('https://evil.example/phish');

    firebaseService.user.set(signedInDetails);
    firebaseService.loginStatus.set(LoginStatus.SignedIn);
    mount();
    await fixture.whenStable();

    expect(navSpy).toHaveBeenCalledWith('', {
      clearUrlParams: true,
      replaceState: true,
    });
  });

  it('presents the password-reset form in place when intent=reset-password, then redirects with saved notice', async () => {
    const navSpy = vi.spyOn(routingService, 'navigateTo');
    vi.spyOn(firebaseService, 'setAccountPassword').mockImplementation(async () => {
      firebaseService.offerPasswordSetup.set(false);
      return { success: true };
    });

    routingService.signals[Views.AuthComplete].urlParams.intent.set(EmailLinkIntent.ResetPassword);
    routingService.signals[Views.AuthComplete].urlParams.returnTo.set('/my-gradings');
    firebaseService.user.set(signedInDetails);
    firebaseService.loginStatus.set(LoginStatus.SignedIn);
    firebaseService.offerPasswordSetup.set(true);

    const el = mount();
    await fixture.whenStable();

    // Does NOT auto-redirect before the user chooses or skips their new password!
    expect(navSpy).not.toHaveBeenCalled();
    expect(el.querySelector('.auth-complete-heading')?.textContent).toContain(
      'Choose a new password',
    );

    const input = el.querySelector<HTMLInputElement>('#setup-password-input')!;
    input.value = 'new-trusted-pass-123';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('#save-password-btn')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(firebaseService.passwordSavedNotice()).toBe(true);
    expect(navSpy).toHaveBeenCalledWith('my-gradings', {
      clearUrlParams: true,
      replaceState: true,
    });
  });

  it('prompts for email confirmation when opened on another device and finishes sign-in', async () => {
    const finishSpy = vi
      .spyOn(firebaseService, 'finishEmailLinkSignIn')
      .mockResolvedValue({ success: true });
    firebaseService.pendingEmailLink.set('https://app.local/auth/complete?oobCode=abc&mode=signIn');

    const el = mount();
    expect(el.querySelector('#auth-complete-email')).not.toBeNull();

    const input = el.querySelector<HTMLInputElement>('#auth-complete-email')!;
    input.value = 'Monika@Example.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('#auth-complete-confirm-btn')!.click();
    await fixture.whenStable();

    expect(finishSpy).toHaveBeenCalledWith('monika@example.com');
  });

  it('offers one-click link resend when an email sign-in link has expired', async () => {
    const resendSpy = vi
      .spyOn(firebaseService, 'sendSignInLink')
      .mockResolvedValue({ success: true });
    routingService.signals[Views.AuthComplete].urlParams.intent.set(EmailLinkIntent.ResetPassword);
    firebaseService.emailLinkSignInError.set('auth/expired-action-code');
    firebaseService.failedEmailLinkAddress.set('monika@example.com');

    const el = mount();
    expect(el.querySelector('#auth-complete-error')?.textContent).toContain('expired');

    el.querySelector<HTMLButtonElement>('#auth-complete-resend-btn')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(resendSpy).toHaveBeenCalledWith('monika@example.com', {
      intent: EmailLinkIntent.ResetPassword,
    });
    expect(el.querySelector('#auth-complete-resent')?.textContent).toContain('monika@example.com');
  });
});
