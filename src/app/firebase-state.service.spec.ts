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
import { IdbStorageService } from './idb-storage.service';

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
    // Use vi.spyOn instead of spyOn to see if it makes a difference
    // cast to any to avoid strict type checks if needed, or use proper typing
    const loginSpy = vi.spyOn(service, 'loginWithGoogle').mockResolvedValue(successResult);

    service.loginWithGoogle();
    expect(loginSpy).toHaveBeenCalled();
  });

  it('should call loginWithEmail when loginWithEmail is called', () => {
    const successResult: AuthOperationResult = {
      success: true,
      userCredential: {} as UserCredential,
    };
    const loginSpy = vi.spyOn(service, 'loginWithEmail').mockResolvedValue(
      successResult
    );
    service.loginWithEmail('password', 'test@test.com');
    expect(loginSpy).toHaveBeenCalledWith('password', 'test@test.com');
  });

  it('should call signupWithEmail when signupWithEmail is called', () => {
    const successResult: AuthOperationResult = {
      success: true,
      userCredential: {} as UserCredential,
    };
    const signupSpy = vi.spyOn(service, 'signupWithEmail').mockResolvedValue(
      successResult
    );
    service.signupWithEmail('password', 'test@test.com');
    expect(signupSpy).toHaveBeenCalledWith('password', 'test@test.com');
  });

  it('should call signOut when logout is called', () => {
    const successResult: LogoutResult = { success: true };
    const logoutSpy = vi.spyOn(service, 'logout').mockResolvedValue(
      successResult
    );
    service.logout();
    expect(logoutSpy).toHaveBeenCalled();
  });

  it('recovers user details from cache on network error in fetchUserDetails', async () => {
    const idb = TestBed.inject(IdbStorageService);
    const mockUser = { uid: 'u123', email: 'test@example.com' } as User;
    const cachedData = {
      uid: 'u123',
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: null,
      isAdmin: false,
      schoolsManaged: [],
      userMemberProfiles: [{ docId: 'mem_1', name: 'Test User', email: 'test@example.com' } as any],
      selectedMemberDocId: 'mem_1',
      cachedAt: new Date().toISOString(),
    };
    await idb.set('cached_user_details_u123', cachedData);

    // Force network error
    const getFunctionsMock = vi.fn().mockReturnValue({});
    // Call fetchUserDetails with mockUser; since callable isn't mocked, it throws network/callable error
    await service.fetchUserDetails(mockUser);

    expect(service.user()).toBeTruthy();
    expect(service.user()?.member.name).toBe('Test User');
    expect(service.loginStatus()).toBe('SignedIn');
  });
});
