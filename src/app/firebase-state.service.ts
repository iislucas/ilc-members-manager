import { Injectable, signal, WritableSignal } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
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

// ----------------------------------------------------------------------------
export type UserDetails = {
  member: Member;
  isAdmin: boolean;
  schoolsManaged: string[];
  firebaseUser: User;
};

@Injectable({
  providedIn: 'root',
})
export class FirebaseStateService {
  public app: FirebaseApp;
  public analytics?: Analytics;
  public functions: Functions;
  private auth: Auth;
  public loggingIn = signal(false);
  public loggedIn: WritableSignal<Promise<UserDetails>>;
  private loggedInResolverFn: (value: UserDetails) => void = () => {};
  public loginError = signal<string | null>(null);

  // public readonly user$ = toObservable(this.user);
  // public readonly userAsMember$ = toObservable(this.userAsMember);
  // public readonly userIsAdmin = computed(
  //   () => this.userAsMember()?.isAdmin ?? false
  // );
  public user = signal<UserDetails | null>(null);
  private db: Firestore;
  private unsubscribeFromMember: Unsubscribe | null = null;

  constructor() {
    this.app = initializeApp(environment.firebase);
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
      if (this.unsubscribeFromMember) {
        this.unsubscribeFromMember();
        this.unsubscribeFromMember = null;
      }

      if (user && user.email) {
        let userDetailsResult: FetchUserDetailsResult;
        try {
          const getUserDetails = httpsCallable<void, FetchUserDetailsResult>(
            this.functions,
            'getUserDetails',
          );
          userDetailsResult = (await getUserDetails()).data;
        } catch (error: unknown) {
          console.warn(error);
          this.loggingIn.set(false);
          this.loginError.set((error as Error).message);
          return;
        }

        const userDetails: UserDetails = {
          firebaseUser: user,
          member: {
            ...initMember(),
            ...userDetailsResult.userMemberData,
          },
          isAdmin: userDetailsResult.isAdmin,
          schoolsManaged: userDetailsResult.schoolsManaged,
        };
        this.user.set(userDetails);
        this.loggedInResolverFn(userDetails);
        this.loggingIn.set(false);

        // From now on, listen to changes to the member document.
        const memberDocRef = doc(this.db, 'members', user.email);
        this.unsubscribeFromMember = onSnapshot(memberDocRef, (doc) => {
          if (!doc.exists()) {
            // logout? show error? The doc was deleted from under their feet?
            return;
          }
          const currentUserDetails = this.user();
          if (currentUserDetails) {
            this.user.set({
              ...currentUserDetails,
              member: firestoreDocToMember(doc),
            });
          }
        });
      } else {
        // logging out
        this.user.set(null);
        this.loggedIn.set(
          new Promise<UserDetails>((resolve, reject) => {
            this.loggedInResolverFn = resolve;
          }),
        );
      }
    });
  }

  public async loginWithGoogle(): Promise<AuthOperationResult> {
    this.loggingIn.set(true);
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
      this.loggingIn.set(false);
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
    this.loggingIn.set(true);
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
      this.loggingIn.set(false);
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
    this.loggingIn.set(true);
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
      this.loggingIn.set(false);
      return {
        success: false,
        errorCode: error.code,
      };
    }
  }

  public async logout(): Promise<LogoutResult> {
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
