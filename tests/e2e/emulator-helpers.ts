/*
 * Shared plumbing for the emulator-driven e2e stories: the admin SDK pointed at
 * the emulators, member seeding, polling for asynchronously-fired triggers, and
 * calling a callable the way the browser client does.
 *
 * Import this before `firebase-admin` in a spec (or instead of it): the
 * emulator host variables have to be set before the SDK is loaded, and this
 * module does that at the top.
 */

// Must be set before firebase-admin is imported so the SDK talks to the emulator.
process.env['FIRESTORE_EMULATOR_HOST'] ||= '127.0.0.1:8080';
process.env['FIREBASE_AUTH_EMULATOR_HOST'] ||= '127.0.0.1:9099';

import * as admin from 'firebase-admin';
import { initMember } from '../../functions/src/data-model';

export const PROJECT_ID = 'demo-ilc-test';
export const FUNCTIONS_HOST =
  process.env['FUNCTIONS_EMULATOR_HOST'] || '127.0.0.1:5001';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
export const db = admin.firestore();

export const seedMember = (docId: string, overrides: Record<string, unknown>) =>
  db.collection('members').doc(docId).set({ ...initMember(), ...overrides });

/** Poll until `predicate` is satisfied or the timeout elapses (triggers run async). */
export async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (v: T) => boolean,
  label: string,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${label}. Last: ${JSON.stringify(last)}`);
}

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * An unsigned ID token. The Functions emulator runs with token verification
 * disabled, so this is enough to authenticate a callable as the given email.
 */
export function fakeIdToken(uid: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    auth_time: now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    email,
    email_verified: true,
    firebase: {
      identities: { email: [email] },
      sign_in_provider: 'password',
    },
  };
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
}

/**
 * Calls a callable the way the browser client does, returning the raw HTTP
 * status alongside the decoded body so error cases can be asserted.
 */
export async function callFunction(
  name: string,
  data: unknown,
  token: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(
    `http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/${name}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Origin: 'http://localhost:4200',
      },
      body: JSON.stringify({ data }),
    },
  );
  return { status: res.status, body: await res.json() };
}
