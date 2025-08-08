import { Injectable, signal } from '@angular/core';
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

type AuthErrorMessage = (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

export type AuthOperationResult =
  | {
      success: true;
      userCredential: UserCredential;
    }
  | {
      success: false;
      // TODO: make the error message be one of the target values of AuthErrorCodes
      errorMessage: AuthErrorMessage;
    };

export type LogoutResult =
  | {
      success: true;
    }
  | {
      success: false;
      errorMessage: AuthErrorMessage;
    };

export type ResetPasswordResult =
  | {
      success: true;
    }
  | {
      success: false;
      errorMessage: AuthErrorMessage;
    };

export type FirebaseAuthError = Error & { code: AuthErrorMessage };

// ----------------------------------------------------------------------------

@Injectable({
  providedIn: 'root',
})
export class FirebaseStateService {
  public app: FirebaseApp;
  public analytics: Analytics;
  private auth: Auth;
  public readonly user = signal<User | null>(null);

  constructor() {
    console.log(environment.firebase);
    this.app = initializeApp(environment.firebase);
    this.auth = getAuth(this.app);
    this.analytics = getAnalytics(this.app);

    onAuthStateChanged(this.auth, (user) => {
      this.user.set(user);
    });
  }

  public async loginWithGoogle(): Promise<AuthOperationResult> {
    try {
      const userCredential = await signInWithPopup(
        this.auth,
        new GoogleAuthProvider()
      );
      return { success: true, userCredential };
    } catch (exception: any) {
      const error = exception as FirebaseAuthError;
      console.error('Google login failed:', error);
      console.error(error);
      console.error(error.name);
      console.error(error.message);
      return {
        success: false,
        errorMessage: error.code,
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
      console.log(error);
      console.log(error.name);
      console.log(error.message);
      console.log((error as any).code);
      console.log(JSON.stringify(error));
      return {
        success: false,
        errorMessage: error.code,
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
        errorMessage: error.code,
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
        errorMessage: error.code,
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
