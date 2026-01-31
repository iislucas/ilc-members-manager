import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { FirebaseApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  User,
  UserCredential,
  sendPasswordResetEmail,
  AuthErrorCodes,
} from 'firebase/auth';
import { environment } from '../environments/environment';
import { FIREBASE_APP } from './app.config';
import { Analytics, getAnalytics } from 'firebase/analytics';
import { Functions, getFunctions, httpsCallable } from 'firebase/functions';
import {
  doc,
  Firestore,
  getFirestore,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import {
  FetchUserDetailsResult,
  firestoreDocToMember,
  initMember,
  Member,
  MemberFirestoreDoc,
} from '../../functions/src/data-model';

type AuthErrorCodeStr = (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

export type AuthOperationResult =
  | {
      success: true;
      userCredential: UserCredential;
    }
  | {
      success: false;
      errorCode: AuthErrorCodeStr;
    };

export type LogoutResult =
  | {
      success: true;
    }
  | {
      success: false;
      errorCode: AuthErrorCodeStr;
    };

export type ResetPasswordResult =
  | {
      success: true;
    }
  | {
      success: false;
      errorMessage: AuthErrorCodeStr;
    };

export type FirebaseAuthError = Error & { code: AuthErrorCodeStr };

export enum LoginStatus {
  FirebaseLoadingStatus = 'FirebaseLoadingStatus',
  LoggingIn = 'LoggingIn',
  SignedIn = 'SignedIn',
  SignedOut = 'SignedOut',
}

// ----------------------------------------------------------------------------
export type UserDetails = {
  member: Member; // The currently selected profile
  memberProfiles: Member[]; // All profiles
  isAdmin: boolean;
  schoolsManaged: string[];
  firebaseUser: User;
};

@Injectable({
  providedIn: 'root',
})
export class FirebaseStateService {
  public app = inject(FIREBASE_APP);
  public analytics?: Analytics;
  public functions: Functions;
  private auth: Auth;

  public loginStatus = signal<LoginStatus>(LoginStatus.FirebaseLoadingStatus);
  public loggedIn: WritableSignal<Promise<UserDetails>>;
  private loggedInResolverFn: (value: UserDetails) => void = () => {};
  public loginError = signal<string | null>(null);
  public user = signal<UserDetails | null>(null);
  private db: Firestore;
  private unsubscribeFromMember: Unsubscribe | null = null;

  constructor() {
    this.db = getFirestore(this.app);
    this.auth = getAuth(this.app);
    this.functions = getFunctions(this.app);
    if (environment.production) {
      this.analytics = getAnalytics(this.app);
    }

    this.loggedIn = signal(
      new Promise<UserDetails>((resolve, reject) => {
        this.loggedInResolverFn = resolve;
      }),
    );

    onAuthStateChanged(this.auth, async (user) => {
        console.log('FirebaseStateService: onAuthStateChanged', this.auth, user);

        if (this.unsubscribeFromMember) {
          this.unsubscribeFromMember();
          this.unsubscribeFromMember = null;
        }

        if (!user || !user.email) {
          // SignedOut
          console.log('FirebaseStateService: User is null or has no email, setting SignedOut state.');
          this.user.set(null);
          this.loginStatus.set(LoginStatus.SignedOut);
          this.loggedIn.set(
            new Promise<UserDetails>((resolve, reject) => {
              this.loggedInResolverFn = resolve;
            }),
          );
          return;
        }

        this.loginStatus.set(LoginStatus.LoggingIn);
        console.log('FirebaseStateService: Fetching user details...');

        let userDetailsResult: FetchUserDetailsResult;
        try {
          const getUserDetails = httpsCallable<void, FetchUserDetailsResult>(
            this.functions,
            'getUserDetails',
          );
          userDetailsResult = (await getUserDetails()).data;
          console.log('FirebaseStateService: userDetailsResult:', userDetailsResult);
        } catch (error: unknown) {
          console.error('Error in getUserDetails:', error);
          this.loginStatus.set(LoginStatus.SignedOut);
          this.loginError.set((error as Error).message);
          console.warn('Logging out because getUserDetails failed.');
          this.auth.signOut();
          return;
        }

        const profiles = userDetailsResult.userMemberProfiles.map((p) => ({
          ...initMember(),
          ...p,
        }));

        if (!profiles || profiles.length === 0) {
          console.warn('No profiles found for user', user.email);
          this.loginStatus.set(LoginStatus.SignedOut);
          this.loginError.set('No profiles found for user');
          console.warn('Logging out because no member profiles were found.');
          this.auth.signOut();
          return;
        }

        const userDetails: UserDetails = {
          firebaseUser: user,
          member: profiles[0],
          memberProfiles: profiles,
          isAdmin: userDetailsResult.isAdmin,
          schoolsManaged: userDetailsResult.schoolsManaged,
        };
        console.log('FirebaseStateService: Setting user signal to details for:', user.email);
        this.user.set(userDetails);
        this.loggedInResolverFn(userDetails);
        this.loginStatus.set(LoginStatus.SignedIn);

        // From now on, listen to changes to the member document.
        this.setupMemberSnapshotListener();
    });
  }

  public selectProfile(memberDocId: string) {
    const currentUserDetails = this.user();
    if (!currentUserDetails) return;

    const newProfile = currentUserDetails.memberProfiles.find(
      (p) => p.id === memberDocId,
    );
    if (newProfile) {
      this.user.set({
        ...currentUserDetails,
        member: newProfile,
        isAdmin: newProfile.isAdmin,
      });
      // We should also re-fetch schoolsManaged if we want to be fully correct,
      // but for now let's assume the user re-logs or we handle it in setupMemberSnapshotListener
      this.setupMemberSnapshotListener();
    }
  }

  private setupMemberSnapshotListener() {
    if (this.unsubscribeFromMember) {
      this.unsubscribeFromMember();
      this.unsubscribeFromMember = null;
    }

    const currentUserDetails = this.user();
    if (!currentUserDetails || !currentUserDetails.member.id) return;

    const memberDocRef = doc(this.db, 'members', currentUserDetails.member.id);
    this.unsubscribeFromMember = onSnapshot(
      memberDocRef,
      (doc) => {
        if (!doc.exists()) {
          console.warn(`FirebaseStateService: Member doc snapshot says NOT EXISTS for ${currentUserDetails.member.id}`);
          const status = this.loginStatus();
          if (status === LoginStatus.SignedIn) {
            console.warn('FirebaseStateService: Signing out because doc no longer exists in SignedIn state.');
            this.loginStatus.set(LoginStatus.SignedOut);
            console.warn(
              `The users membership doc (${currentUserDetails.member.id}) was removed while they were signed in, and they've been signed out.`,
            );
            this.auth.signOut();
          }
          return;
        }
        const updatedDetails = this.user();
        if (updatedDetails) {
          const updatedMember = firestoreDocToMember(doc);
          this.user.set({
            ...updatedDetails,
            member: updatedMember,
            isAdmin: updatedMember.isAdmin,
            // Update the profile in the list as well
            memberProfiles: updatedDetails.memberProfiles.map((p) =>
              p.id === updatedMember.id ? updatedMember : p,
            ),
          });
        }
      },
      (error) => {
        console.error('Error in member snapshot listener:', error);
        // We DON'T sign out here yet, just log it. 
        // If it's a permission error, it might be transient or a rule change.
      },
    );
  }

  public async loginWithGoogle(): Promise<AuthOperationResult> {
    this.loginStatus.set(LoginStatus.LoggingIn);
    try {
      const userCredential = await signInWithPopup(
        this.auth,
        new GoogleAuthProvider(),
      );
      return { success: true, userCredential };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      if (error.code === 'auth/cancelled-popup-request') {
        return {
          success: false,
          errorCode: 'auth/cancelled-popup-request',
        };
      }
      console.error('Google login failed:', error);
      console.error(error);
      this.loginStatus.set(LoginStatus.SignedOut);
      return {
        success: false,
        errorCode: error.code,
      };
    }
  }

  public async loginWithEmail(
    pass: string,
    email: string,
  ): Promise<AuthOperationResult> {
    this.loginStatus.set(LoginStatus.LoggingIn);
    try {
      const userCredential = await signInWithEmailAndPassword(
        this.auth,
        email,
        pass,
      );
      return { success: true, userCredential };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('Email login failed:', error);
      this.loginStatus.set(LoginStatus.SignedOut);
      return {
        success: false,
        errorCode: error.code,
      };
    }
  }

  public async signupWithEmail(
    pass: string,
    email: string,
  ): Promise<AuthOperationResult> {
    this.loginStatus.set(LoginStatus.LoggingIn);
    try {
      const userCredential = await createUserWithEmailAndPassword(
        this.auth,
        email,
        pass,
      );
      return { success: true, userCredential };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('Email signup failed:', error);
      console.error(error);
      console.error(error.name);
      console.error(error.message);
      this.loginStatus.set(LoginStatus.SignedOut);
      return {
        success: false,
        errorCode: error.code,
      };
    }
  }

  public async logout(): Promise<LogoutResult> {
    console.log('logout called');
    try {
      await signOut(this.auth);
      return { success: true };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('Logout failed:', error);
      console.error(error);
      console.error(error.name);
      console.error(error.message);
      return {
        success: false,
        errorCode: error.code,
      };
    }
  }

  public async resetPassword(email: string): Promise<ResetPasswordResult> {
    try {
      await sendPasswordResetEmail(this.auth, email);
      return { success: true };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('Password reset failed:', error);
      console.error(error);
      console.error(error.name);
      console.error(error.message);
      return {
        success: false,
        errorMessage: error.code,
      };
    }
  }
}

export function createFirebaseStateServiceMock(): Partial<FirebaseStateService> {
  return {
    user: signal(null),
    loginStatus: signal(LoginStatus.SignedOut),
    loggedIn: signal(Promise.resolve({} as UserDetails)),
    loginError: signal(null),
    loginWithGoogle: (): Promise<AuthOperationResult> =>
      Promise.resolve({
        success: true,
        userCredential: {} as UserCredential,
      }),
    loginWithEmail: (): Promise<AuthOperationResult> =>
      Promise.resolve({
        success: true,
        userCredential: {} as UserCredential,
      }),
    signupWithEmail: (): Promise<AuthOperationResult> =>
      Promise.resolve({
        success: true,
        userCredential: {} as UserCredential,
      }),
    logout: (): Promise<LogoutResult> => Promise.resolve({ success: true }),
    resetPassword: (): Promise<ResetPasswordResult> =>
      Promise.resolve({ success: true }),
  };
}
