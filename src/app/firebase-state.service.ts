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
  setPersistence,
  browserLocalPersistence,
  User,
  UserCredential,
  sendPasswordResetEmail,
  sendEmailVerification,
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
import { firestoreDocToMember, initMember, Member } from '../../functions/src/data-model/members';
import { CheckEmailStatusResult, FetchUserDetailsResult } from '../../functions/src/data-model/system';
import { IdbStorageService } from './idb-storage.service';
import { NetworkStateService } from './network-state.service';

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
  NeedsEmailVerification = 'NeedsEmailVerification',
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

export interface CachedUserDetails {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  isAdmin: boolean;
  schoolsManaged: string[];
  userMemberProfiles: Member[];
  selectedMemberDocId: string;
  cachedAt: string;
}

export const LAST_ACTIVE_USER_UID_KEY = 'ilc_last_active_user_uid';

@Injectable({
  providedIn: 'root',
})
export class FirebaseStateService {
  public app = inject(FIREBASE_APP);
  public analytics?: Analytics;
  public functions: Functions;
  private auth: Auth;
  private idb = inject(IdbStorageService);
  private networkState = inject(NetworkStateService);

  public loginStatus = signal<LoginStatus>(LoginStatus.FirebaseLoadingStatus);
  public loggedIn: WritableSignal<Promise<UserDetails>>;
  private loggedInResolverFn: (value: UserDetails) => void = () => { };
  public loginError = signal<string | null>(null);
  public user = signal<UserDetails | null>(null);
  public unverifiedUser = signal<User | null>(null);
  public verificationEmailSent = signal<boolean>(false);
  public verificationError = signal<string | null>(null);
  private db: Firestore;
  private unsubscribeFromMember: Unsubscribe | null = null;

  constructor() {
    this.db = getFirestore(this.app);
    this.auth = getAuth(this.app);
    this.functions = getFunctions(this.app);
    if (environment.production) {
      this.analytics = getAnalytics(this.app);
    }

    // Note: without this, the user will be signed out when the app is reloaded,
    // and also, I've seen some strange issues where the user is logged out after 
    // 10-60 seconds.
    setPersistence(this.auth, browserLocalPersistence)
      .then(() => console.log('FirebaseStateService: Persistence set to browserLocalPersistence'))
      .catch((e) => console.error('FirebaseStateService: Failed to set persistence', e));

    this.loggedIn = signal(
      new Promise<UserDetails>((resolve, reject) => {
        this.loggedInResolverFn = resolve;
      }),
    );

    // When coming back online, refresh user details in background
    this.networkState.registerOnlineHandler(async () => {
      const currentUser = this.auth.currentUser;
      if (currentUser && this.loginStatus() === LoginStatus.SignedIn) {
        console.log('FirebaseStateService: Online event, refreshing user details in background...');
        await this.fetchUserDetails(currentUser);
      }
    });

    // Eagerly restore last active user from IndexedDB for instant offline readiness
    this.idb.get<string>(LAST_ACTIVE_USER_UID_KEY).then(async (lastUid) => {
      if (lastUid && !this.user() && this.loginStatus() === LoginStatus.FirebaseLoadingStatus) {
        const cached = await this.idb.get<CachedUserDetails>(`cached_user_details_${lastUid}`);
        if (cached && !this.user() && this.loginStatus() === LoginStatus.FirebaseLoadingStatus) {
          console.log('FirebaseStateService: Eagerly restoring cached profile from IndexedDB:', cached.email);
          const mockUser = {
            uid: cached.uid,
            email: cached.email,
            displayName: cached.displayName,
            photoURL: cached.photoURL,
            emailVerified: true,
          } as unknown as User;
          const selected =
            cached.userMemberProfiles.find((p) => p.docId === cached.selectedMemberDocId) ||
            cached.userMemberProfiles[0];
          const cachedDetails: UserDetails = {
            firebaseUser: mockUser,
            member: selected,
            memberProfiles: cached.userMemberProfiles,
            isAdmin: cached.isAdmin,
            schoolsManaged: cached.schoolsManaged,
          };
          this.user.set(cachedDetails);
          this.loggedInResolverFn(cachedDetails);
          this.loginStatus.set(LoginStatus.SignedIn);
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            this.networkState.markOffline();
          }
        }
      }
    });

    onAuthStateChanged(this.auth, async (user) => {
      if (this.unsubscribeFromMember) {
        this.unsubscribeFromMember();
        this.unsubscribeFromMember = null;
      }

      if (!user || !user.email) {
        // If offline and we already have a cached user session, preserve it!
        if (this.networkState.isOffline() && this.user()) {
          console.log('FirebaseStateService: onAuthStateChanged received null user while offline; preserving local session.');
          return;
        }

        // SignedOut
        console.log('FirebaseStateService: User is null or has no email, setting SignedOut state.');
        this.user.set(null);
        this.unverifiedUser.set(null);
        this.loginStatus.set(LoginStatus.SignedOut);
        this.loggedIn.set(
          new Promise<UserDetails>((resolve, reject) => {
            this.loggedInResolverFn = resolve;
          }),
        );
        return;
      }

      if (!user.emailVerified) {
        console.log('FirebaseStateService: User email is not verified:', user.email);
        this.user.set(null);
        this.unverifiedUser.set(user);
        this.loginStatus.set(LoginStatus.NeedsEmailVerification);
        return;
      }

      this.unverifiedUser.set(null);

      // If the user is already signed in with the same UID, do not trigger the login/fetch flow again!
      // This prevents redundant calls and transient errors during automatic token refreshes or
      // concurrent tab loads from logging the user out.
      const currentUserDetails = this.user();
      if (currentUserDetails && currentUserDetails.firebaseUser.uid === user.uid) {
        console.log('FirebaseStateService: onAuthStateChanged fired for already signed-in user, updating firebaseUser reference.');
        this.user.set({
          ...currentUserDetails,
          firebaseUser: user,
        });
        this.setupMemberSnapshotListener();
        return;
      }

      await this.fetchUserDetails(user);
    });
  }

  public async fetchUserDetails(user: User): Promise<void> {
    this.loginStatus.set(LoginStatus.LoggingIn);
    let userDetailsResult: FetchUserDetailsResult;
    try {
      const getUserDetails = httpsCallable<void, FetchUserDetailsResult>(
        this.functions,
        'getUserDetails',
      );
      userDetailsResult = (await getUserDetails()).data;
    } catch (error: unknown) {
      console.error('Error in getUserDetails:', error);
      
      const errorCode = (error as any)?.code;
      if (errorCode === 'unauthenticated' || errorCode === 'permission-denied') {
        console.warn('Logging out because getUserDetails failed with auth/permission error:', error);
        this.loginStatus.set(LoginStatus.SignedOut);
        this.loginError.set((error as Error).message);
        this.logout();
        return;
      }

      // Transient or network error: attempt offline recovery from IndexedDB
      console.warn('Preserving session: getUserDetails failed with a transient/network error:', error);
      this.networkState.markOffline();

      const cached = await this.idb.get<CachedUserDetails>(`cached_user_details_${user.uid}`);
      if (cached && Array.isArray(cached.userMemberProfiles) && cached.userMemberProfiles.length > 0) {
        console.log('FirebaseStateService: Recovered user profile from local IndexedDB cache for offline mode.');
        const selected =
          cached.userMemberProfiles.find((p) => p.docId === cached.selectedMemberDocId) ||
          cached.userMemberProfiles[0];
        const userDetails: UserDetails = {
          firebaseUser: user,
          member: selected,
          memberProfiles: cached.userMemberProfiles,
          isAdmin: cached.isAdmin,
          schoolsManaged: cached.schoolsManaged,
        };
        this.user.set(userDetails);
        this.loggedInResolverFn(userDetails);
        this.loginStatus.set(LoginStatus.SignedIn);
        return;
      }

      this.loginStatus.set(LoginStatus.SignedOut);
      this.loginError.set((error as Error).message);
      return;
    }

    const profiles = userDetailsResult.userMemberProfiles.map((p) => {
      // TODO: Remove this hack when we fix the data model.
      const member = { ...initMember(), ...p } as Member & { id?: string };
      if (member.id && !member.docId) {
        member.docId = member.id;
      }
      return member;
    });

    if (!profiles || profiles.length === 0) {
      console.warn('No profiles found for user', user.email);
      this.loginStatus.set(LoginStatus.SignedOut);
      this.loginError.set(`We could not find your profile linked to that email address. ` +
        `Might you have used a different email address previously? ` +
        `Please contact ${environment.adminEmail} if you continue to have problems.`);
      console.warn('Logging out because no member profiles were found.');
      this.logout();
      return;
    }

    const userDetails: UserDetails = {
      firebaseUser: user,
      member: profiles[0],
      memberProfiles: profiles,
      isAdmin: userDetailsResult.isAdmin,
      schoolsManaged: userDetailsResult.schoolsManaged,
    };
    this.user.set(userDetails);
    this.loggedInResolverFn(userDetails);
    this.loginStatus.set(LoginStatus.SignedIn);
    this.networkState.markOnline();

    // Cache user details to IndexedDB for offline resilience
    const cacheObj: CachedUserDetails = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      isAdmin: userDetailsResult.isAdmin,
      schoolsManaged: userDetailsResult.schoolsManaged,
      userMemberProfiles: profiles,
      selectedMemberDocId: profiles[0].docId,
      cachedAt: new Date().toISOString(),
    };
    await this.idb.set(`cached_user_details_${user.uid}`, cacheObj);
    await this.idb.set(LAST_ACTIVE_USER_UID_KEY, user.uid);

    // From now on, listen to changes to the member document.
    this.setupMemberSnapshotListener();
  }

  public async selectProfile(memberDocId: string) {
    const currentUserDetails = this.user();
    if (!currentUserDetails) return;

    const newProfile = currentUserDetails.memberProfiles.find(
      (p) => p.docId === memberDocId,
    );
    if (newProfile) {
      this.user.set({
        ...currentUserDetails,
        member: newProfile,
        isAdmin: newProfile.isAdmin,
      });
      const cached = await this.idb.get<CachedUserDetails>(
        `cached_user_details_${currentUserDetails.firebaseUser.uid}`,
      );
      if (cached) {
        cached.selectedMemberDocId = memberDocId;
        await this.idb.set(
          `cached_user_details_${currentUserDetails.firebaseUser.uid}`,
          cached,
        );
      }
      this.setupMemberSnapshotListener();
    }
  }

  public async updateCachedMemberProfile(updatedMember: Member): Promise<void> {
    const currentUserDetails = this.user();
    if (!currentUserDetails) return;

    const profileIdx = currentUserDetails.memberProfiles.findIndex(
      (p) => p.docId === updatedMember.docId,
    );
    if (profileIdx === -1 && currentUserDetails.member.docId !== updatedMember.docId) {
      return;
    }

    const updatedProfiles = [...currentUserDetails.memberProfiles];
    if (profileIdx >= 0) {
      updatedProfiles[profileIdx] = updatedMember;
    }

    const isCurrentActive = currentUserDetails.member.docId === updatedMember.docId;
    const newActiveMember = isCurrentActive ? updatedMember : currentUserDetails.member;

    const updatedDetails: UserDetails = {
      ...currentUserDetails,
      member: newActiveMember,
      memberProfiles: updatedProfiles,
      isAdmin: newActiveMember.isAdmin ?? currentUserDetails.isAdmin,
    };
    this.user.set(updatedDetails);

    try {
      const cached = await this.idb.get<CachedUserDetails>(
        `cached_user_details_${currentUserDetails.firebaseUser.uid}`,
      );
      if (cached) {
        const cachedIdx = cached.userMemberProfiles.findIndex(
          (p) => p.docId === updatedMember.docId,
        );
        if (cachedIdx >= 0) {
          cached.userMemberProfiles[cachedIdx] = updatedMember;
        }
        if (isCurrentActive) {
          cached.isAdmin = updatedMember.isAdmin ?? cached.isAdmin;
        }
        await this.idb.set(
          `cached_user_details_${currentUserDetails.firebaseUser.uid}`,
          cached,
        );
      }
    } catch (err) {
      console.warn('FirebaseStateService: Failed updating cached user profile:', err);
    }
  }

  private setupMemberSnapshotListener() {
    if (this.unsubscribeFromMember) {
      this.unsubscribeFromMember();
      this.unsubscribeFromMember = null;
    }

    const currentUserDetails = this.user();
    if (!currentUserDetails || !currentUserDetails.member.docId) return;

    const memberDocRef = doc(this.db, 'members', currentUserDetails.member.docId);
    this.unsubscribeFromMember = onSnapshot(
      memberDocRef,
      (doc) => {
        if (!doc.exists()) {
          console.warn(`FirebaseStateService: Member doc snapshot says NOT EXISTS for ${currentUserDetails.member.docId}`);
          const status = this.loginStatus();
          if (status === LoginStatus.SignedIn) {
            console.warn('FirebaseStateService: Signing out because doc no longer exists in SignedIn state.');
            this.loginStatus.set(LoginStatus.SignedOut);
            console.warn(
              `The users membership doc (${currentUserDetails.member.docId}) was removed while they were signed in, and they've been signed out.`,
            );
            this.logout();
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
              p.docId === updatedMember.docId ? updatedMember : p,
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
      try {
        await sendEmailVerification(userCredential.user);
        this.verificationEmailSent.set(true);
        this.verificationError.set(null);
      } catch (err: any) {
        console.warn('sendEmailVerification on signup error:', err);
        this.verificationError.set(err?.message || 'Failed to send verification email. Please try clicking "Resend Email".');
      }
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

  public async resendVerificationEmail(): Promise<{ success: boolean; message?: string }> {
    const u = this.auth.currentUser || this.unverifiedUser();
    if (!u) {
      return { success: false, message: 'No user is currently signed in.' };
    }
    try {
      await sendEmailVerification(u);
      this.verificationEmailSent.set(true);
      this.verificationError.set(null);
      return { success: true };
    } catch (error: any) {
      console.error('Failed to resend verification email:', error);
      const msg = error?.message || 'Failed to send verification email. Please try again.';
      this.verificationError.set(msg);
      return { success: false, message: msg };
    }
  }

  public async checkEmailVerification(): Promise<{ verified: boolean; message?: string }> {
    const u = this.auth.currentUser || this.unverifiedUser();
    if (!u) {
      return { verified: false, message: 'No user is currently signed in.' };
    }
    try {
      await u.reload();
      if (u.emailVerified) {
        this.unverifiedUser.set(null);
        this.verificationError.set(null);
        await this.fetchUserDetails(u);
        return { verified: true };
      } else {
        const msg = 'Your email address is not yet verified. Please click the link sent to your email inbox, then try again.';
        this.verificationError.set(msg);
        return {
          verified: false,
          message: msg,
        };
      }
    } catch (error: any) {
      console.error('Failed to reload user verification status:', error);
      const msg = error?.message || 'Unable to check verification status. Please try again.';
      this.verificationError.set(msg);
      return { verified: false, message: msg };
    }
  }

  public async logout(): Promise<LogoutResult> {
    try {
      const lastUid = await this.idb.get<string>(LAST_ACTIVE_USER_UID_KEY);
      if (lastUid) {
        await this.idb.delete(`cached_user_details_${lastUid}`);
      }
      await this.idb.delete(LAST_ACTIVE_USER_UID_KEY);
      this.user.set(null);
      this.loginStatus.set(LoginStatus.SignedOut);
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

  // Pre-auth check: determines whether an email has a member record,
  // a Firebase Auth account, and whether it's Google-managed.
  public async checkEmailStatus(email: string): Promise<CheckEmailStatusResult> {
    const fn = httpsCallable<{ email: string }, CheckEmailStatusResult>(
      this.functions,
      'checkEmailStatus',
    );
    const result = await fn({ email });
    return result.data;
  }

  public isAdmin(): boolean {
    return this.user()?.isAdmin ?? false;
  }
}

export function createFirebaseStateServiceMock(): FirebaseStateService {
  return {
    isAdmin: () => false,
    user: signal(null),
    unverifiedUser: signal(null),
    verificationEmailSent: signal(false),
    verificationError: signal(null),
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
    resendVerificationEmail: () => Promise.resolve({ success: true }),
    checkEmailVerification: () => Promise.resolve({ verified: true }),
    logout: (): Promise<LogoutResult> => Promise.resolve({ success: true }),
    resetPassword: (): Promise<ResetPasswordResult> =>
      Promise.resolve({ success: true }),
    checkEmailStatus: (): Promise<CheckEmailStatusResult> =>
      Promise.resolve({ hasMemberRecord: false, hasAuthAccount: false, isGoogleManaged: false }),
  } as Partial<FirebaseStateService> as FirebaseStateService;
}
