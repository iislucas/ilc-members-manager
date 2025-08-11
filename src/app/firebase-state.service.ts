import { Injectable, Signal, signal, WritableSignal } from '@angular/core';
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
  getIdTokenResult,
  ParsedToken,
} from 'firebase/auth';
import { environment } from '../environments/environment';
import { Analytics, getAnalytics } from 'firebase/analytics';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { toObservable } from '@angular/core/rxjs-interop';
// import {
//   collection,
//   Firestore,
//   getDocs,
//   getFirestore,
// } from 'firebase/firestore';
// import {
//   getFirestore,
//   collection,
//   getDocs,
//   Firestore,
// } from 'firebase/firestore/lite';

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

@Injectable({
  providedIn: 'root',
})
export class FirebaseStateService {
  public app: FirebaseApp;
  public analytics: Analytics;
  private auth: Auth;
  private functions;
  public readonly user = signal<User | null>(null);
  public readonly claims = signal<ParsedToken | null>(null);
  public loggedIn: WritableSignal<Promise<{ user: User; claims: ParsedToken }>>;
  private loggedInResolverFn: (value: {
    user: User;
    claims: ParsedToken;
  }) => void = () => {};
  public readonly user$ = toObservable(this.user);
  public readonly claims$ = toObservable(this.claims);

  constructor() {
    console.log('environment.firebase', environment.firebase);
    this.app = initializeApp(environment.firebase);
    this.auth = getAuth(this.app);
    this.functions = getFunctions(this.app);
    this.analytics = getAnalytics(this.app);

    this.loggedIn = signal(
      new Promise<{ user: User; claims: ParsedToken }>((resolve, reject) => {
        this.loggedInResolverFn = resolve;
      })
    );

    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        const tokenResult = await getIdTokenResult(user);
        this.claims.set(tokenResult.claims);
        this.loggedInResolverFn({ user, claims: tokenResult.claims });
      } else {
        this.loggedIn.set(
          new Promise<{ user: User; claims: ParsedToken }>(
            (resolve, reject) => {
              this.loggedInResolverFn = resolve;
            }
          )
        );
      }
      this.user.set(user);

      // const db = getFirestore(this.app);
      // const membersCol = collection(db, 'members');
      // const members = await getDocs(membersCol);
      // console.log(members.docs.map((doc) => doc.data()));
    });
  }

  addAdmin(uid: string, email: string) {
    const addAdminRole = httpsCallable(this.functions, 'addAdmin');
    return addAdminRole({ uid, email });
  }

  removeAdmin(uid: string, email: string) {
    const removeAdminRole = httpsCallable(this.functions, 'removeAdmin');
    return removeAdminRole({ uid, email });
  }

  public async loginWithGoogle(): Promise<AuthOperationResult> {
    try {
      const userCredential = await signInWithPopup(
        this.auth,
        new GoogleAuthProvider()
      );
      return { success: true, userCredential };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('Google login failed:', error);
      console.error(error);
      // console.error(error.name);
      // console.error(error.message);
      return {
        success: false,
        errorCode: error.code,
      };
    }
  }

  public async loginWithEmail(
    pass: string,
    email: string
  ): Promise<AuthOperationResult> {
    try {
      const userCredential = await signInWithEmailAndPassword(
        this.auth,
        email,
        pass
      );
      return { success: true, userCredential };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('Email login failed:', error);
      // console.log(error);
      // console.log(error.name);
      // console.log(error.message);
      // console.log((error as any).code);
      // console.log(JSON.stringify(error));
      return {
        success: false,
        errorCode: error.code,
      };
    }
  }

  public async signupWithEmail(
    pass: string,
    email: string
  ): Promise<AuthOperationResult> {
    try {
      const userCredential = await createUserWithEmailAndPassword(
        this.auth,
        email,
        pass
      );
      return { success: true, userCredential };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('Email signup failed:', error);
      console.error(error);
      console.error(error.name);
      console.error(error.message);
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
