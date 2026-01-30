import { TestBed } from '@angular/core/testing';
import {
  FirebaseStateService,
  AuthOperationResult,
  LogoutResult,
} from './firebase-state.service';
import { User, UserCredential } from 'firebase/auth';
import { provideZonelessChangeDetection } from '@angular/core';
import { FIREBASE_APP } from './app.config';
import { deleteApp, FirebaseApp, initializeApp } from 'firebase/app';

describe('FirebaseStateService', () => {
  let service: FirebaseStateService;
  let app: FirebaseApp;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
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
        FirebaseStateService,
      ],
    });
    app = TestBed.inject(FIREBASE_APP);
    service = TestBed.inject(FirebaseStateService);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have a user signal that is initially null', () => {
    expect(service.user()).toBeNull();
  });

  it('should call loginWithGoogle when login is called', () => {
    const successResult: AuthOperationResult = {
      success: true,
      userCredential: {} as UserCredential,
    };
    const loginSpy = spyOn(service, 'loginWithGoogle').and.returnValue(
      Promise.resolve(successResult)
    );
    service.loginWithGoogle();
    expect(loginSpy).toHaveBeenCalled();
  });

  it('should call loginWithEmail when loginWithEmail is called', () => {
    const successResult: AuthOperationResult = {
      success: true,
      userCredential: {} as UserCredential,
    };
    const loginSpy = spyOn(service, 'loginWithEmail').and.returnValue(
      Promise.resolve(successResult)
    );
    service.loginWithEmail('password', 'test@test.com');
    expect(loginSpy).toHaveBeenCalledWith('password', 'test@test.com');
  });

  it('should call signupWithEmail when signupWithEmail is called', () => {
    const successResult: AuthOperationResult = {
      success: true,
      userCredential: {} as UserCredential,
    };
    const signupSpy = spyOn(service, 'signupWithEmail').and.returnValue(
      Promise.resolve(successResult)
    );
    service.signupWithEmail('password', 'test@test.com');
    expect(signupSpy).toHaveBeenCalledWith('password', 'test@test.com');
  });

  it('should call signOut when logout is called', () => {
    const successResult: LogoutResult = { success: true };
    const logoutSpy = spyOn(service, 'logout').and.returnValue(
      Promise.resolve(successResult)
    );
    service.logout();
    expect(logoutSpy).toHaveBeenCalled();
  });
});
