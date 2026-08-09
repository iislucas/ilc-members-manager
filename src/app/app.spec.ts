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
      members: { loaded: signal(true), get: vi.fn().mockReturnValue(undefined), entries: signal([]) } as any,
      schools: { loaded: signal(true), get: vi.fn().mockReturnValue(undefined), entries: signal([]) } as any,
      instructors: { loaded: signal(true), get: vi.fn().mockReturnValue(undefined), entries: signal([]) } as any,
      myStudents: { loaded: signal(true), get: vi.fn().mockReturnValue(undefined), entries: signal([]) } as any,
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
    // Stub navigation so the logged-out Home redirect effect is a no-op and the
    // view stays on Home (navigateTo now applies History changes synchronously).
    vi.spyOn(app.routingService, 'navigateToParts').mockImplementation(() => {});
    app.routingService.matchedPatternId.set(Views.Home);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.title')?.textContent).toContain('Members Portal App');
  });

  it('should redirect logged-out users on Home to login', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    vi.spyOn(app.routingService, 'navigateToParts');

    // Simulate being on the home page while logged out
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedOut);
    app.routingService.matchedPatternId.set(Views.Home);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(app.routingService.navigateToParts).toHaveBeenCalledWith(['login']);
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
    expect(breadcrumbLabels).toEqual(['I Liq Chuan', 'Members Portal App', 'Find an Instructor']);
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
    expect(breadcrumbLabels).toEqual(['I Liq Chuan', 'Members Portal App', 'Members Area', 'Article']);
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
    // Find the link back to the members list. It carries `jumpTo` so the list
    // scrolls to the member you came from — the same target the in-page back
    // link uses, since both come from the navigation tree.
    const crumbLink = Array.from(compiled.querySelectorAll('.crumb-link'))
      .find((el) => el.getAttribute('href') === '/members?jumpTo=M1') as HTMLAnchorElement;
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
});

