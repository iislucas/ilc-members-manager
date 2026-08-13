import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from './firebase-state.service';
import { initializeApp } from 'firebase/app';
import { ROUTING_CONFIG, Views, initPathPatterns, FIREBASE_APP } from './app.config';
import { DataManagerService, DataServiceState } from './data-manager.service';

import { signal } from '@angular/core';
import { LoginStatus, UserDetails } from './firebase-state.service';

describe('App', () => {
  let firebaseStateServiceMock: Partial<FirebaseStateService>;
  let dataManagerServiceMock: Partial<DataManagerService>;

  beforeEach(async () => {
    firebaseStateServiceMock = createFirebaseStateServiceMock();
    dataManagerServiceMock = {
      loadingState: signal(DataServiceState.Loaded) as any,
      members: { loaded: signal(true), loading: signal(false), error: signal(null), get: vi.fn().mockReturnValue(undefined), entries: signal([]) } as any,
      schools: { loaded: signal(true), loading: signal(false), error: signal(null), get: vi.fn().mockReturnValue(undefined), entries: signal([]) } as any,
      instructors: { loaded: signal(true), loading: signal(false), error: signal(null), get: vi.fn().mockReturnValue(undefined), entries: signal([]) } as any,
      myStudents: { loaded: signal(true), loading: signal(false), error: signal(null), get: vi.fn().mockReturnValue(undefined), entries: signal([]) } as any,
      getMember: vi.fn(),
    };


    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: firebaseStateServiceMock },
        { provide: DataManagerService, useValue: dataManagerServiceMock },
        {
          provide: FIREBASE_APP,
          useValue: initializeApp(
            {
              apiKey: 'fake',
              authDomain: 'fake',
              projectId: 'fake',
              storageBucket: 'fake',
              messagingSenderId: 'fake',
              appId: 'fake',
            },
            `test-app-${Math.random()}`,
          ),
        },
        {
          provide: ROUTING_CONFIG,
          useValue: {
            validPathPatterns: initPathPatterns,
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.routingService.matchedPatternId.set(Views.Home);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.title')?.textContent).toContain('Welcome');
  });

  it('should render Members Portal title for logged-in user on Home', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedIn);
    firebaseStateServiceMock.user!.set({
      member: {
        membershipType: 'Life',
        name: 'Test Member',
        dateOfBirth: '2000-01-01',
        country: 'Testland',
      },
      firebaseUser: { photoURL: null },
    } as unknown as UserDetails);
    app.routingService.matchedPatternId.set(Views.Home);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.title')?.textContent).toContain('ILC Portal');
  });

  it('should not redirect logged-out users on Home to login', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    vi.spyOn(app.routingService, 'navigateToParts');

    // Simulate being on the home page while logged out
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedOut);
    app.routingService.matchedPatternId.set(Views.Home);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(app.routingService.navigateToParts).not.toHaveBeenCalled();
  });

  it('should redirect logged-in users on Login to home when no returnUrl', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    vi.spyOn(app.routingService, 'navigateToParts').mockImplementation(() => {});

    // Simulate being on the login page while logged in (no returnUrl set)
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedIn);
    firebaseStateServiceMock.user!.set({
      member: {
        membershipType: 'Life',
        name: 'Test Member',
        dateOfBirth: '2000-01-01',
        country: 'Testland',
      },
      firebaseUser: { photoURL: null },
    } as unknown as UserDetails);
    app.routingService.matchedPatternId.set(Views.Login);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(app.routingService.navigateToParts).toHaveBeenCalledWith(['']);
  });

  it('should redirect logged-in users on Login to returnUrl when set', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    vi.spyOn(app.routingService, 'navigateTo');

    // Simulate being on the login page with a returnUrl
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedIn);
    firebaseStateServiceMock.user!.set({
      member: {
        membershipType: 'Life',
        name: 'Test Member',
        dateOfBirth: '2000-01-01',
        country: 'Testland',
      },
      firebaseUser: { photoURL: null },
    } as unknown as UserDetails);
    app.routingService.matchedPatternId.set(Views.Login);
    app.routingService.signals[Views.Login].urlParams.returnUrl.set('events?q=yoga');

    fixture.detectChanges();
    await fixture.whenStable();

    expect(app.routingService.navigateTo).toHaveBeenCalledWith('events?q=yoga', { clearUrlParams: true });
  });

  it('should show Find an Instructor and correct breadcrumbs when logged out', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedOut);
    app.routingService.matchedPatternId.set(Views.FindAnInstructor);

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-find-an-instructor')).toBeTruthy();

    const breadcrumbLabels = app.breadcrumbs().map((b) => b.label);
    expect(breadcrumbLabels).toEqual([
      'ILC Portal',
      'Practice',
      'Instructors',
    ]);
  });

  it('should show restricted page login prompt and other pages section when logged out on a sub-page', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedOut);
    app.routingService.matchedPatternId.set(Views.ClassVideoLibrary);

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;

    // Should show "This page requires you to be logged in." prompt
    const prompt = compiled.querySelector('.restricted-page-prompt');
    expect(prompt).toBeTruthy();
    expect(prompt?.textContent).toContain('This page requires you to be logged in.');

    // Should show login component
    expect(compiled.querySelector('app-login')).toBeTruthy();

    // Should show "Other pages you might be looking for" section below login
    const otherPagesSection = compiled.querySelector('.other-pages-section');
    expect(otherPagesSection).toBeTruthy();
    expect(otherPagesSection?.querySelector('h2')?.textContent).toContain(
      'Other pages you might be looking for',
    );
    const otherCards = otherPagesSection?.querySelectorAll('.service-link-card');
    expect(otherCards?.length).toBe(5);

    // Should NOT show the generic login app-info welcome message
    expect(compiled.querySelector('.app-info')).toBeNull();
  });

  it('should show generic welcome and options above login on generic login page', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedOut);
    app.routingService.matchedPatternId.set(Views.Login);

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;

    // Should show the generic login app-info welcome message
    const appInfo = compiled.querySelector('.app-info');
    expect(appInfo).toBeTruthy();
    expect(appInfo?.textContent).toContain('Welcome to the ILC App');

    // Should show public service link cards above login
    const loginSiteLinks = compiled.querySelector('.login-site-links');
    expect(loginSiteLinks).toBeTruthy();
    const siteCards = loginSiteLinks?.querySelectorAll('.service-link-card');
    expect(siteCards?.length).toBe(5);

    // Should show login component
    expect(compiled.querySelector('app-login')).toBeTruthy();

    // Should NOT show the restricted page prompt
    expect(compiled.querySelector('.restricted-page-prompt')).toBeNull();

    // Should NOT show the other-pages section below login
    expect(compiled.querySelector('.other-pages-section')).toBeNull();
  });

  it('should correctly parse the members-area post path for a logged-in user', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    // Simulate logged in user
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedIn);
    firebaseStateServiceMock.user!.set({
      member: {
        membershipType: 'Life',
        name: 'Test Member',
        dateOfBirth: '2000-01-01',
        country: 'Testland',
      },
      firebaseUser: { photoURL: null },
    } as unknown as UserDetails);

    // Simulate routing to a post
    app.routingService.matchedPatternId.set(Views.MembersAreaPost);
    app.routingService.signals[Views.MembersAreaPost].pathVars.blogPostPath.set('my-test-post');

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const articleElem = compiled.querySelector('app-squarespace-article');
    expect(articleElem).toBeTruthy();

    // Verify breadcrumbs
    const breadcrumbLabels = app.breadcrumbs().map((b) => b.label);
    expect(breadcrumbLabels).toEqual([
      'ILC Portal',
      'Learn',
      'Members Posts',
      'Article',
    ]);
  });

  it('should intercept click on breadcrumb links and navigate client-side', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    // Simulate logged in user
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedIn);
    firebaseStateServiceMock.user!.set({
      member: {
        membershipType: 'Life',
        name: 'Test Member',
        dateOfBirth: '2000-01-01',
        country: 'Testland',
      },
      firebaseUser: { photoURL: null },
    } as unknown as UserDetails);

    // Simulate routing to a member view
    app.routingService.matchedPatternId.set(Views.ManageMemberView);
    app.routingService.signals[Views.ManageMemberView].pathVars.memberId.set('M1');

    fixture.detectChanges();
    await fixture.whenStable();

    const navigateSpy = vi.spyOn(app.routingService, 'navigateTo').mockImplementation(() => {});

    const compiled = fixture.nativeElement as HTMLElement;
    const crumbLinks = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.crumb-link'));
    const crumbLink = crumbLinks.find((el) => el.getAttribute('href')?.includes('members?jumpTo=M1'))!;
    expect(crumbLink).toBeTruthy();

    // Click it!
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    crumbLink.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith('members?jumpTo=M1');
  });

  // Legacy hash-routing links still turn up in old emails and notifications.
  // main.ts rewrites them on a cold load, but a click inside the app never
  // reloads, so the interceptor has to strip the `#` itself — otherwise it
  // pushes `/#/...` and silently leaves the user on Home.
  it('should navigate to the path equivalent of a legacy hash link', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();

    const navigateSpy = vi.spyOn(app.routingService, 'navigateTo').mockImplementation(() => {});
    const compiled = fixture.nativeElement as HTMLElement;

    for (const [href, expected] of [
      ['/#/resources/instructors/Instructor%20Packet%202026.pdf',
       'resources/instructors/Instructor%20Packet%202026.pdf'],
      ['#/notifications', 'notifications'],
    ]) {
      navigateSpy.mockClear();
      const link = document.createElement('a');
      link.setAttribute('href', href);
      compiled.appendChild(link);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      link.dispatchEvent(clickEvent);

      expect(clickEvent.defaultPrevented).toBe(true);
      expect(navigateSpy).toHaveBeenCalledWith(expected);
    }
  });

  it('should leave genuine in-page anchors to the browser', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();

    const navigateSpy = vi.spyOn(app.routingService, 'navigateTo').mockImplementation(() => {});
    const compiled = fixture.nativeElement as HTMLElement;

    const link = document.createElement('a');
    link.setAttribute('href', '#section-2');
    compiled.appendChild(link);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('should render not-found error page when navigating to an unknown route while logged in', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedIn);
    firebaseStateServiceMock.user!.set({
      member: {
        membershipType: 'Life',
        name: 'Test Member',
        dateOfBirth: '2000-01-01',
        country: 'Testland',
      },
      firebaseUser: { photoURL: null },
    } as unknown as UserDetails);
    app.routingService.matchedPatternId.set(null);

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-not-found')).toBeTruthy();
  });

  it('should render not-found error page when navigating to an unknown route while logged out', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedOut);
    app.routingService.matchedPatternId.set(null);

    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-not-found')).toBeTruthy();
  });

  it('should show hamburger menu on Home when logged in, and back arrow on other pages', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    // Simulate logged in user
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedIn);
    firebaseStateServiceMock.user!.set({
      member: {
        membershipType: 'Life',
        name: 'Test Member',
        dateOfBirth: '2000-01-01',
        country: 'Testland',
      },
      firebaseUser: { photoURL: null },
      schoolsManaged: [],
    } as unknown as UserDetails);

    // 1. On Home:
    app.routingService.matchedPatternId.set(Views.Home);
    fixture.detectChanges();
    await fixture.whenStable();

    let compiled = fixture.nativeElement as HTMLElement;
    // Hamburger menu button should be present
    expect(compiled.querySelector('.menu-anchor button')).toBeTruthy();
    // Back button should not be present
    expect(compiled.querySelector('.header-back-btn')).toBeNull();

    // 2. On Manage Members (top-level page):
    app.routingService.matchedPatternId.set(Views.ManageMembers);
    fixture.detectChanges();
    await fixture.whenStable();

    compiled = fixture.nativeElement as HTMLElement;
    // Hamburger menu should not be present
    expect(compiled.querySelector('.menu-anchor button')).toBeNull();
    // Back button should be present and point to '/?tab=admin'
    const backBtn = compiled.querySelector('.header-back-btn') as HTMLAnchorElement;
    expect(backBtn).toBeTruthy();
    expect(backBtn.getAttribute('href')).toBe('/?tab=admin');
    expect(backBtn.getAttribute('title')).toBe('Back to Admin');
  });

  describe('Share page link', () => {
    it('should render share page link with current URL as href', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      app.routingService.matchedPatternId.set(Views.FindAnInstructor);
      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const shareLink = compiled.querySelector<HTMLAnchorElement>('.share-page-link');
      expect(shareLink).toBeTruthy();
      expect(shareLink?.getAttribute('href')).toBe(window.location.href);
      expect(shareLink?.textContent).toContain('Share');
    });

    it('should call navigator.share when available and clicked', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();

      const shareSpy = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', {
        ...navigator,
        share: shareSpy,
      });

      const compiled = fixture.nativeElement as HTMLElement;
      const shareLink = compiled.querySelector<HTMLAnchorElement>('.share-page-link')!;

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      shareLink.dispatchEvent(clickEvent);
      await fixture.whenStable();

      expect(clickEvent.defaultPrevented).toBe(true);
      expect(shareSpy).toHaveBeenCalledWith({
        title: document.title,
        url: window.location.href,
      });
      expect(app.shareCopied()).toBe(true);
      vi.unstubAllGlobals();
    });

    it('should copy to clipboard and display Copied! when navigator.share is not available', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();

      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', {
        clipboard: { writeText: writeTextSpy },
      });

      const compiled = fixture.nativeElement as HTMLElement;
      const shareLink = compiled.querySelector<HTMLAnchorElement>('.share-page-link')!;

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      shareLink.dispatchEvent(clickEvent);
      await fixture.whenStable();

      expect(clickEvent.defaultPrevented).toBe(true);
      expect(writeTextSpy).toHaveBeenCalledWith(window.location.href);
      expect(app.shareCopied()).toBe(true);

      fixture.detectChanges();
      expect(shareLink.textContent).toContain('Copied!');
      expect(shareLink.classList.contains('copied')).toBe(true);

      vi.unstubAllGlobals();
    });
  });
});

