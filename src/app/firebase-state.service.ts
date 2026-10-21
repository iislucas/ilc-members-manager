import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { FirebaseApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  setPersistence,
  browserLocalPersistence,
  User,
  UserCredential,
  AuthCredential,
  linkWithCredential,
  linkWithPopup,
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
import { firestoreDocToMember, initMember, Member, normalizeMemberLevels } from '../../functions/src/data-model/members';
import { CheckEmailStatusResult, FetchUserDetailsResult } from '../../functions/src/data-model/system';
import { IdbStorageService } from './idb-storage.service';
import { NetworkStateService } from './network-state.service';
import { RoutingService } from './routing.service';
import { AuthBlockReason } from '../../functions/src/data-model/auth';
import { authBlockReasonOf } from './inline-auth/auth-error-messages';

type AuthErrorCodeStr = (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

export type AuthOperationResult =
  | {
    success: true;
    userCredential: UserCredential;
  }
  | {
    success: false;
    errorCode: AuthErrorCodeStr;
    pendingCredential?: AuthCredential;
    // Set when an auth blocking function refused the request (see
    // functions/src/auth-blocking.ts); errorCode is then auth/internal-error.
    blockReason?: AuthBlockReason;
  };

export type SimpleAuthResult =
  | { success: true }
  | { success: false; errorCode: AuthErrorCodeStr };

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

// localStorage key for the address a sign-in link was sent to, so opening the
// link on the same device finishes sign-in without retyping it.
export const EMAIL_FOR_SIGN_IN_KEY = 'ilc-email-for-sign-in';

// Query parameters Firebase adds to an email sign-in link's return URL.
const EMAIL_LINK_PARAMS = ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'tenantId'];

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
  private routingService = inject(RoutingService, { optional: true });

  public loginStatus = signal<LoginStatus>(LoginStatus.FirebaseLoadingStatus);
  public loggedIn: WritableSignal<Promise<UserDetails>>;
  private loggedInResolverFn: (value: UserDetails) => void = () => { };
  public loginError = signal<string | null>(null);
  public user = signal<UserDetails | null>(null);
  public unverifiedUser = signal<User | null>(null);

  /**
   * The current URL, when it is an email sign-in link we can't finish yet
   * because we don't know which address it was sent to (it was opened on a
   * different device or browser). The sign-in form then asks for the email.
   */
  public pendingEmailLink = signal<string | null>(null);

  /** The address just signed in by email link, so the form can remember it. */
  public completedEmailLinkSignIn = signal<string | null>(null);

  /**
   * True right after an email-link sign-in: the user has just proven their
   * email, which is the moment to offer choosing a password.
   */
  public offerPasswordSetup = signal<boolean>(false);

  /**
   * Indicates whether live Firebase Auth has completed initialization and settled.
   * True when a live verified User token is active (or in offline mode with a restored session).
   * Guarding authenticated Firestore queries with isAuthReady prevents transient
   * "FirebaseError: Missing or insufficient permissions" race conditions on startup.
   */
  public isAuthReady = signal<boolean>(false);

  /**
   * Indicates whether authentication/session synchronization is in progress.
   * Starts true on initial app load, stays true while verifying live auth or restoring profile,
   * and becomes false once auth state has settled.
   */
  public isAuthSyncing = signal<boolean>(true);

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

    this.completeEmailLinkSignInIfPresent();

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
          // Cached copies skip the converter, so normalise their levels here.
          const profiles = cached.userMemberProfiles.map(normalizeMemberLevels);
          const selected =
            profiles.find((p) => p.docId === cached.selectedMemberDocId) || profiles[0];
          const cachedDetails: UserDetails = {
            firebaseUser: mockUser,
            member: selected,
            memberProfiles: profiles,
            isAdmin: cached.isAdmin,
            schoolsManaged: cached.schoolsManaged,
          };
          this.user.set(cachedDetails);
          this.loggedInResolverFn(cachedDetails);
          this.loginStatus.set(LoginStatus.SignedIn);
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            this.networkState.markOffline();
            this.isAuthReady.set(true);
            this.isAuthSyncing.set(false);
          }
        }
      }
    });

    if (typeof this.auth.authStateReady === 'function') {
      this.auth.authStateReady().then(() => {
        if (!this.auth.currentUser && !this.user()) {
          this.isAuthSyncing.set(false);
        }
      }).catch(() => {
        this.isAuthSyncing.set(false);
      });
    }

    onAuthStateChanged(this.auth, async (user) => {
      if (this.unsubscribeFromMember) {
        this.unsubscribeFromMember();
        this.unsubscribeFromMember = null;
      }

      if (!user || !user.email) {
        // If offline and we already have a cached user session, preserve it!
        if (this.networkState.isOffline() && this.user()) {
          console.log('FirebaseStateService: onAuthStateChanged received null user while offline; preserving local session.');
          this.isAuthReady.set(true);
          this.isAuthSyncing.set(false);
          return;
        }

        // SignedOut
        console.log('FirebaseStateService: User is null or has no email, setting SignedOut state.');
        this.user.set(null);
        this.unverifiedUser.set(null);
        this.loginStatus.set(LoginStatus.SignedOut);
        this.isAuthReady.set(false);
        this.isAuthSyncing.set(false);
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
        this.isAuthReady.set(false);
        this.isAuthSyncing.set(false);
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
        this.isAuthReady.set(true);
        this.isAuthSyncing.set(false);
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
        this.isAuthReady.set(false);
        this.isAuthSyncing.set(false);
        this.logout();
        return;
      }

      // Transient or network error: attempt offline recovery from IndexedDB
      console.warn('Preserving session: getUserDetails failed with a transient/network error:', error);
      this.networkState.markOffline();

      const cached = await this.idb.get<CachedUserDetails>(`cached_user_details_${user.uid}`);
      if (cached && Array.isArray(cached.userMemberProfiles) && cached.userMemberProfiles.length > 0) {
        console.log('FirebaseStateService: Recovered user profile from local IndexedDB cache for offline mode.');
        // Cached copies skip the converter, so normalise their levels here.
        const profiles = cached.userMemberProfiles.map(normalizeMemberLevels);
        const selected =
          profiles.find((p) => p.docId === cached.selectedMemberDocId) || profiles[0];
        const userDetails: UserDetails = {
          firebaseUser: user,
          member: selected,
          memberProfiles: profiles,
          isAdmin: cached.isAdmin,
          schoolsManaged: cached.schoolsManaged,
        };
        this.user.set(userDetails);
        this.loggedInResolverFn(userDetails);
        this.loginStatus.set(LoginStatus.SignedIn);
        this.isAuthReady.set(true);
        this.isAuthSyncing.set(false);
        return;
      }

      this.loginStatus.set(LoginStatus.SignedOut);
      this.loginError.set((error as Error).message);
      this.isAuthReady.set(false);
      this.isAuthSyncing.set(false);
      return;
    }

    const profiles = userDetailsResult.userMemberProfiles.map((p) => {
      // TODO: Remove this hack when we fix the data model.
      const member = normalizeMemberLevels({ ...initMember(), ...p } as Member & { id?: string });
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
      this.isAuthReady.set(false);
      this.isAuthSyncing.set(false);
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
    this.isAuthReady.set(true);
    this.isAuthSyncing.set(false);

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
        isAdmin: currentUserDetails.isAdmin,
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
      isAdmin: currentUserDetails.isAdmin,
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
            isAdmin: updatedDetails.isAdmin,
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
      let pendingCredential: AuthCredential | undefined;
      try {
        pendingCredential = (GoogleAuthProvider.credentialFromError(error as any) as AuthCredential) ?? undefined;
      } catch {
        // Ignore if error does not hold a credential
      }
      return {
        success: false,
        errorCode: error.code,
        pendingCredential,
      };
    }
  }

  public async loginWithEmailAndLink(
    pass: string,
    email: string,
    pendingCredential: AuthCredential,
  ): Promise<AuthOperationResult> {
    this.loginStatus.set(LoginStatus.LoggingIn);
    try {
      const userCredential = await signInWithEmailAndPassword(
        this.auth,
        email,
        pass,
      );
      try {
        await linkWithCredential(userCredential.user, pendingCredential);
        console.log('FirebaseStateService: Successfully linked Google credential to account.');
      } catch (linkErr: unknown) {
        console.warn('FirebaseStateService: Failed to link Google credential:', linkErr);
      }
      return { success: true, userCredential };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('Email login and link failed:', error);
      this.loginStatus.set(LoginStatus.SignedOut);
      return {
        success: false,
        errorCode: error.code,
        blockReason: authBlockReasonOf(error.message) ?? undefined,
      };
    }
  }

  public async linkGoogleAccount(): Promise<{ success: boolean; errorCode?: string }> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      return { success: false, errorCode: 'auth/no-current-user' };
    }
    try {
      await linkWithPopup(currentUser, new GoogleAuthProvider());
      await this.fetchUserDetails(currentUser);
      return { success: true };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.warn('FirebaseStateService: linkGoogleAccount failed:', error);
      return { success: false, errorCode: error.code };
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
        blockReason: authBlockReasonOf(error.message) ?? undefined,
      };
    }
  }

  /**
   * Email a sign-in link to `email`. Clicking it proves the address and signs
   * the user in (creating the account if needed). This is the only way to
   * create an email account: a password can be chosen afterwards. The link
   * returns to the current page.
   */
  public async sendSignInLink(email: string): Promise<SimpleAuthResult> {
    try {
      await sendSignInLinkToEmail(this.auth, email, {
        url: `${window.location.origin}${window.location.pathname}`,
        handleCodeInApp: true,
      });
      try {
        localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email);
      } catch {
        // Best effort: without it the user just confirms their email on return.
      }
      return { success: true };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('sendSignInLink failed:', error);
      return { success: false, errorCode: error.code };
    }
  }

  /**
   * For a session whose email isn't verified (an account created under the
   * old password-first sign-up): email a sign-in link to its address and sign
   * the session out. The link is how the owner proves the address; the
   * unverified session itself can't be used for anything.
   */
  public async sendSignInLinkForUnverifiedUser(): Promise<SimpleAuthResult> {
    const email = this.unverifiedUser()?.email;
    if (!email) {
      return { success: false, errorCode: 'auth/invalid-email' as AuthErrorCodeStr };
    }
    const result = await this.sendSignInLink(email);
    if (result.success) {
      await signOut(this.auth);
    }
    return result;
  }

  // If this page was opened from an email sign-in link, finish signing in,
  // or ask for the email if we don't know which address the link was for.
  private completeEmailLinkSignInIfPresent(): void {
    if (typeof window === 'undefined') return;
    const href = window.location.href;
    if (!isSignInWithEmailLink(this.auth, href)) return;
    let email: string | null = null;
    try {
      email = localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
    } catch {
      email = null;
    }
    this.pendingEmailLink.set(href);
    if (email) {
      void this.finishEmailLinkSignIn(email);
    }
  }

  /**
   * Finish signing in with the pending email link, for `email` (which must be
   * the address the link was sent to).
   */
  public async finishEmailLinkSignIn(email: string): Promise<SimpleAuthResult> {
    const link = this.pendingEmailLink();
    if (!link) {
      return { success: false, errorCode: 'auth/invalid-action-code' as AuthErrorCodeStr };
    }
    this.loginStatus.set(LoginStatus.LoggingIn);
    try {
      await signInWithEmailLink(this.auth, email, link);
      try {
        localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
      } catch {
        // ignore
      }
      this.stripEmailLinkParams();
      this.pendingEmailLink.set(null);
      this.completedEmailLinkSignIn.set(email);
      this.offerPasswordSetup.set(true);
      return { success: true };
    } catch (exception: unknown) {
      const error = exception as FirebaseAuthError;
      console.error('finishEmailLinkSignIn failed:', error);
      this.loginStatus.set(LoginStatus.SignedOut);
      if (error.code !== 'auth/invalid-email') {
        // The link itself is unusable (expired, already used); asking for the
        // email again won't help, the user needs a fresh link.
        this.stripEmailLinkParams();
        this.pendingEmailLink.set(null);
      }
      return { success: false, errorCode: error.code };
    }
  }

  private stripEmailLinkParams(): void {
    const url = new URL(window.location.href);
    for (const param of EMAIL_LINK_PARAMS) {
      url.searchParams.delete(param);
    }
    window.history.replaceState(window.history.state, '', url.toString());
  }

  /**
   * Choose a password for the signed-in (verified) user. The server sets it
   * and marks it trusted (see functions/src/auth-blocking.ts); we then sign in
   * with it so this session carries on under the new credentials.
   */
  public async setAccountPassword(password: string): Promise<{ success: true } | { success: false; message: string }> {
    const email = this.auth.currentUser?.email;
    if (!email) {
      return { success: false, message: 'You need to be signed in to set a password.' };
    }
    try {
      await httpsCallable<{ password: string }, { success: true }>(this.functions, 'setAccountPassword')({ password });
      await signInWithEmailAndPassword(this.auth, email, password);
      this.offerPasswordSetup.set(false);
      return { success: true };
    } catch (error: unknown) {
      console.error('setAccountPassword failed:', error);
      const message = (error as { message?: string })?.message;
      return { success: false, message: message || 'Could not save your password. Please try again.' };
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
      this.isAuthReady.set(false);
      this.isAuthSyncing.set(false);
      this.routingService?.navigateTo('', { clearUrlParams: true });
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
    pendingEmailLink: signal(null),
    completedEmailLinkSignIn: signal(null),
    offerPasswordSetup: signal(false),
    loginStatus: signal(LoginStatus.SignedOut),
    loggedIn: signal(Promise.resolve({} as UserDetails)),
    loginError: signal(null),
    isAuthReady: signal(true),
    isAuthSyncing: signal(false),
    loginWithGoogle: (): Promise<AuthOperationResult> =>
      Promise.resolve({
        success: true,
        userCredential: {} as UserCredential,
      }),
    loginWithEmailAndLink: (): Promise<AuthOperationResult> =>
      Promise.resolve({
        success: true,
        userCredential: {} as UserCredential,
      }),
    linkGoogleAccount: () => Promise.resolve({ success: true }),
    loginWithEmail: (): Promise<AuthOperationResult> =>
      Promise.resolve({
        success: true,
        userCredential: {} as UserCredential,
      }),
    sendSignInLink: (): Promise<SimpleAuthResult> => Promise.resolve({ success: true }),
    sendSignInLinkForUnverifiedUser: (): Promise<SimpleAuthResult> => Promise.resolve({ success: true }),
    finishEmailLinkSignIn: (): Promise<SimpleAuthResult> => Promise.resolve({ success: true }),
    setAccountPassword: () => Promise.resolve({ success: true as const }),
    logout: (): Promise<LogoutResult> => Promise.resolve({ success: true }),
    resetPassword: (): Promise<ResetPasswordResult> =>
      Promise.resolve({ success: true }),
    checkEmailStatus: (): Promise<CheckEmailStatusResult> =>
      Promise.resolve({ hasMemberRecord: false, hasAuthAccount: false, isGoogleManaged: false }),
  } as Partial<FirebaseStateService> as FirebaseStateService;
}
