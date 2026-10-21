import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import type { AuthBlockingEvent } from 'firebase-functions/v2/identity';
import {
  beforeCreateHandler,
  beforeSignInHandler,
  setAccountPasswordHandler,
  signInMethodOf,
} from './auth-blocking';
import { AuthBlockReason, TRUSTED_PASSWORD_CLAIM } from './data-model/auth';

const authMock = {
  getUser: vi.fn(),
  updateUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
};

vi.mock('firebase-admin', () => ({
  auth: vi.fn(() => authMock),
  firestore: vi.fn(),
}));

function event(
  method: string,
  data: { emailVerified: boolean; customClaims?: Record<string, unknown> },
): AuthBlockingEvent {
  return {
    eventType: `providers/cloud.auth/eventTypes/user.beforeSignIn:${method}`,
    data: { uid: 'u1', email: 'marco@example.com', providerData: [], ...data },
  } as never as AuthBlockingEvent;
}

describe('signInMethodOf', () => {
  it('prefers credential.signInMethod', () => {
    const e = { ...event('password', { emailVerified: true }), credential: { signInMethod: 'google.com' } };
    expect(signInMethodOf(e as never as AuthBlockingEvent)).toBe('google.com');
  });

  it('falls back to the event type suffix', () => {
    expect(signInMethodOf(event('emailLink', { emailVerified: true }))).toBe('emailLink');
  });

  it('returns empty when no method is present', () => {
    const e = { eventType: 'providers/cloud.auth/eventTypes/user.beforeSignIn' } as never as AuthBlockingEvent;
    expect(signInMethodOf(e)).toBe('');
  });
});

describe('beforeCreateHandler', () => {
  it('allows accounts that arrive with a verified email (email link, Google)', () => {
    expect(() => beforeCreateHandler(event('emailLink', { emailVerified: true }))).not.toThrow();
  });

  it('rejects accounts with an unverified email (email/password sign-up)', () => {
    expect(() => beforeCreateHandler(event('password', { emailVerified: false }))).toThrow(
      AuthBlockReason.UnverifiedSignUp,
    );
  });
});

describe('beforeSignInHandler', () => {
  it('allows a password sign-in with a verified email and a trusted password', () => {
    expect(() =>
      beforeSignInHandler(event('password', { emailVerified: true, customClaims: { [TRUSTED_PASSWORD_CLAIM]: true } })),
    ).not.toThrow();
  });

  it('rejects a password sign-in when the email is unverified', () => {
    expect(() =>
      beforeSignInHandler(event('password', { emailVerified: false, customClaims: { [TRUSTED_PASSWORD_CLAIM]: true } })),
    ).toThrow(AuthBlockReason.PasswordNotTrusted);
  });

  it('rejects a password sign-in when the password was never marked trusted', () => {
    expect(() => beforeSignInHandler(event('password', { emailVerified: true }))).toThrow(
      AuthBlockReason.PasswordNotTrusted,
    );
  });

  it('does not restrict email-link or Google sign-ins', () => {
    expect(() => beforeSignInHandler(event('emailLink', { emailVerified: true }))).not.toThrow();
    expect(() => beforeSignInHandler(event('google.com', { emailVerified: true }))).not.toThrow();
  });
});

describe('setAccountPasswordHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(admin.auth).mockReturnValue(authMock as never);
    authMock.getUser.mockResolvedValue({ customClaims: { other: 'kept' } });
  });

  const req = (token: Record<string, unknown> | null, password: unknown) =>
    ({ auth: token ? { uid: 'u1', token } : undefined, data: { password } }) as never;

  it('sets the password and marks it trusted, keeping other claims', async () => {
    await setAccountPasswordHandler(req({ email: 'marco@example.com', email_verified: true }, 'secret123'));
    expect(authMock.updateUser).toHaveBeenCalledWith('u1', { password: 'secret123' });
    expect(authMock.setCustomUserClaims).toHaveBeenCalledWith('u1', { other: 'kept', [TRUSTED_PASSWORD_CLAIM]: true });
  });

  it('rejects callers without a verified email', async () => {
    await expect(
      setAccountPasswordHandler(req({ email: 'marco@example.com', email_verified: false }, 'secret123')),
    ).rejects.toThrow('verified email');
    await expect(setAccountPasswordHandler(req(null, 'secret123'))).rejects.toThrow('verified email');
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('rejects passwords that are too short', async () => {
    await expect(
      setAccountPasswordHandler(req({ email: 'marco@example.com', email_verified: true }, '123')),
    ).rejects.toThrow('at least');
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });
});
