import {
  computed,
  Injectable,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
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
import { Functions, getFunctions } from 'firebase/functions';
import { toObservable } from '@angular/core/rxjs-interop';
import { doc, Firestore, getFirestore, onSnapshot } from 'firebase/firestore';
import { Member } from './member.model';

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
  public analytics?: Analytics;
  public functions: Functions;
  private auth: Auth;
  public readonly user = signal<User | null>(null);
  public readonly userAsMember = signal<Member | null>(null);
  public loggingIn = signal(false);
  public loggedIn: WritableSignal<Promise<{ user: User; member: Member }>>;
  private loggedInResolverFn: (value: { user: User; member: Member }) => void =
    () => {};
  public readonly user$ = toObservable(this.user);
  public readonly userAsMember$ = toObservable(this.userAsMember);
  public readonly userIsAdmin = computed(
    () => this.userAsMember()?.isAdmin ?? false
  );
  private db: Firestore;

  constructor() {
    console.log('environment.firebase', environment.firebase);
    this.app = initializeApp(environment.firebase);
    this.auth = getAuth(this.app);
    this.functions = getFunctions(this.app);
    if (environment.production) {
      this.analytics = getAnalytics(this.app);
    }
    this.db = getFirestore(this.app);

    this.loggedIn = signal(
      new Promise<{ user: User; member: Member }>((resolve, reject) => {
        this.loggedInResolverFn = resolve;
      })
    );

    onAuthStateChanged(this.auth, async (user) => {
      if (user && user.email) {
        this.loggingIn.set(true);
        onSnapshot(doc(this.db, 'members', user.email), (docSnap) => {
          if (docSnap.exists()) {
            const member = docSnap.data() as Member;
            this.userAsMember.set(member);
            this.loggedInResolverFn({ user, member });
          } else {
            // TODO: When the user has no member document, what do we do?
            // For now, we will just not log them in fully.
            console.log('No member document for user', user.email);
          }
          this.loggingIn.set(false);
        });
      } else {
        // logging out
        this.userAsMember.set(null);
        this.loggedIn.set(
          new Promise<{ user: User; member: Member }>((resolve, reject) => {
            this.loggedInResolverFn = resolve;
          })
        );
      }
      this.user.set(user);
    });
  }

  public async loginWithGoogle(): Promise<AuthOperationResult> {
    this.loggingIn.set(true);
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
      this.loggingIn.set(false);
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
    this.loggingIn.set(true);
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
      this.loggingIn.set(false);
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
    this.loggingIn.set(true);
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
