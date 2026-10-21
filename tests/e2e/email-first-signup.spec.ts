/*
 * story: email-first-signup
 *
 * Exercises the "prove the email first" model end to end against the Auth +
 * Functions emulators, with the real client SDK, so the blocking functions in
 * functions/src/auth-blocking.ts run exactly as Identity Platform runs them:
 *
 * - email/password sign-up is rejected;
 * - an email-link sign-in creates a verified account;
 * - a legacy unverified account with a password (possibly set by a stranger)
 *   can't password-sign-in, and once the owner proves the email — by link, or
 *   by clicking an old verification email — the old password stays unusable
 *   until the owner sets a new one;
 * - setAccountPassword lets a verified user choose a password;
 * - a verified password account marked trusted (as the migration does for
 *   existing accounts) still signs in.
 *
 * Run with `pnpm test:e2e` (starts the emulators).
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { PROJECT_ID } from './emulator-helpers';
import * as admin from 'firebase-admin';
import { initializeApp, deleteApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  Auth,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { AuthBlockReason, TRUSTED_PASSWORD_CLAIM } from '../../functions/src/data-model/auth';

const AUTH_HOST = process.env['FIREBASE_AUTH_EMULATOR_HOST'] || '127.0.0.1:9099';
const FUNCTIONS_HOST = process.env['FUNCTIONS_EMULATOR_HOST'] || '127.0.0.1:5001';
const CONTINUE_URL = 'http://localhost/login';

let app: FirebaseApp;
let auth: Auth;

async function latestSignInLink(email: string): Promise<string> {
  const res = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  const body = (await res.json()) as { oobCodes: { email: string; oobLink: string; requestType: string }[] };
  const links = body.oobCodes.filter((c) => c.email === email && c.requestType === 'EMAIL_SIGNIN');
  if (!links.length) throw new Error(`No sign-in link was sent to ${email}`);
  return links[links.length - 1].oobLink;
}

async function signInByLink(email: string) {
  await sendSignInLinkToEmail(auth, email, { url: CONTINUE_URL, handleCodeInApp: true });
  return signInWithEmailLink(auth, email, await latestSignInLink(email));
}

async function expectBlocked(p: Promise<unknown>, reason: AuthBlockReason) {
  await expect(p).rejects.toThrow(reason);
}

const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

describe('story: email-first-signup', () => {
  beforeAll(() => {
    app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT_ID, authDomain: 'localhost' }, `e2e-${Date.now()}`);
    auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
    const [host, port] = FUNCTIONS_HOST.split(':');
    connectFunctionsEmulator(getFunctions(app), host, Number(port));
  });

  afterEach(async () => {
    await signOut(auth);
  });

  it('rejects email/password sign-up', async () => {
    const email = uniqueEmail('signup');
    await expectBlocked(createUserWithEmailAndPassword(auth, email, 'chosen-by-anyone'), AuthBlockReason.UnverifiedSignUp);
    await expect(admin.auth().getUserByEmail(email)).rejects.toThrow();
  });

  it('creates a verified account from an email link', async () => {
    const email = uniqueEmail('link');
    const cred = await signInByLink(email);
    expect(cred.user.email).toBe(email);
    expect(cred.user.emailVerified).toBe(true);
  });

  it('lets a verified user set a password and then sign in with it', async () => {
    const email = uniqueEmail('setpw');
    await signInByLink(email);
    await httpsCallable(getFunctions(app), 'setAccountPassword')({ password: 'owner-password' });
    await signOut(auth);
    const cred = await signInWithEmailAndPassword(auth, email, 'owner-password');
    expect(cred.user.emailVerified).toBe(true);
  });

  it('refuses a password that was set before the email was proven, even after the owner verifies', async () => {
    const email = uniqueEmail('squat');
    // A legacy account: password chosen by whoever signed up, email never verified.
    const { uid } = await admin.auth().createUser({ email, password: 'stranger-password', emailVerified: false });

    await expectBlocked(signInWithEmailAndPassword(auth, email, 'stranger-password'), AuthBlockReason.PasswordNotTrusted);

    // The real owner proves the email by link and gets in.
    const cred = await signInByLink(email);
    expect(cred.user.uid).toBe(uid);
    expect(cred.user.emailVerified).toBe(true);
    await signOut(auth);

    // The account is verified now, but the stranger's password still doesn't work.
    await expectBlocked(signInWithEmailAndPassword(auth, email, 'stranger-password'), AuthBlockReason.PasswordNotTrusted);

    // Once the owner sets their own password, password sign-in works again.
    await signInByLink(email);
    await httpsCallable(getFunctions(app), 'setAccountPassword')({ password: 'owner-password' });
    await signOut(auth);
    await signInWithEmailAndPassword(auth, email, 'owner-password');
    expect((await admin.auth().getUserByEmail(email)).customClaims?.[TRUSTED_PASSWORD_CLAIM]).toBe(true);
  });

  it('refuses a stranger password even if the owner clicked an old verification email', async () => {
    const email = uniqueEmail('oldverify');
    const { uid } = await admin.auth().createUser({ email, password: 'stranger-password', emailVerified: false });
    // Equivalent to the owner clicking a verification email the stranger triggered.
    await admin.auth().updateUser(uid, { emailVerified: true });
    await expectBlocked(signInWithEmailAndPassword(auth, email, 'stranger-password'), AuthBlockReason.PasswordNotTrusted);
  });

  it('still signs in a verified password account marked trusted (as migrated accounts are)', async () => {
    const email = uniqueEmail('verified');
    const { uid } = await admin.auth().createUser({ email, password: 'their-password', emailVerified: true });
    await admin.auth().setCustomUserClaims(uid, { [TRUSTED_PASSWORD_CLAIM]: true });
    const cred = await signInWithEmailAndPassword(auth, email, 'their-password');
    expect(cred.user.email).toBe(email);
  });

  it('rejects setAccountPassword without a verified session', async () => {
    await expect(httpsCallable(getFunctions(app), 'setAccountPassword')({ password: 'whatever' })).rejects.toThrow();
  });

  afterAll(async () => {
    await deleteApp(app);
  });
});
