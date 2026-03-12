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
      members: { loaded: signal(true) } as any,
      schools: { loaded: signal(true) } as any,
      instructors: { loaded: signal(true) } as any,
      myStudents: { loaded: signal(true) } as any,
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

  it('should redirect logged-in users on Login to home', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    vi.spyOn(app.routingService, 'navigateToParts');

    // Simulate being on the login page while logged in
    firebaseStateServiceMock.loginStatus!.set(LoginStatus.SignedIn);
    firebaseStateServiceMock.user!.set({
      member: { membershipType: 'Life' },
      firebaseUser: { photoURL: null }
    } as unknown as UserDetails);
    app.routingService.matchedPatternId.set(Views.Login);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(app.routingService.navigateToParts).toHaveBeenCalledWith(['']);
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
      member: { membershipType: 'Life' },
      firebaseUser: { photoURL: null }
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
});
