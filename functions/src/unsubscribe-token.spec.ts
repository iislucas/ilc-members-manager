import { describe, it, expect } from 'vitest';
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  getUnsubscribeSecret,
} from './unsubscribe-token';

describe('unsubscribe-token', () => {
  const testSecret = '0123456789abcdef0123456789abcdef';

  it('generates a 32-character hex HMAC token for an identifier', () => {
    const token = generateUnsubscribeToken('mem_123', testSecret);
    expect(token).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(token)).toBe(true);
  });

  it('is case-insensitive and trims whitespace on identifier', () => {
    const token1 = generateUnsubscribeToken('  User@Example.COM ', testSecret);
    const token2 = generateUnsubscribeToken('user@example.com', testSecret);
    expect(token1).toBe(token2);
  });

  it('generates different tokens for different identifiers', () => {
    const token1 = generateUnsubscribeToken('mem_1', testSecret);
    const token2 = generateUnsubscribeToken('mem_2', testSecret);
    expect(token1).not.toBe(token2);
  });

  it('generates different tokens for different secrets', () => {
    const token1 = generateUnsubscribeToken('mem_1', testSecret);
    const token2 = generateUnsubscribeToken('mem_1', 'different-secret-key-1234567890');
    expect(token1).not.toBe(token2);
  });

  it('verifies valid tokens correctly', () => {
    const token = generateUnsubscribeToken('mem_abc', testSecret);
    expect(verifyUnsubscribeToken('mem_abc', token, testSecret)).toBe(true);
    expect(verifyUnsubscribeToken('  MEM_ABC  ', token, testSecret)).toBe(true);
  });

  it('rejects tampered or invalid tokens', () => {
    const token = generateUnsubscribeToken('mem_abc', testSecret);
    expect(verifyUnsubscribeToken('mem_xyz', token, testSecret)).toBe(false);
    expect(verifyUnsubscribeToken('mem_abc', token.slice(0, 31) + '0', testSecret)).toBe(false);
    expect(verifyUnsubscribeToken('mem_abc', 'short', testSecret)).toBe(false);
    expect(verifyUnsubscribeToken('mem_abc', '', testSecret)).toBe(false);
  });

  it('retrieves existing secret or sets a new one in /system/mail-secrets (CRIT-4)', async () => {
    const docs: Record<string, any> = {};
    const mockDb = {
      doc: (path: string) => ({
        get: async () => ({
          exists: Boolean(docs[path]?.unsubscribeSecret),
          data: () => docs[path] || {},
        }),
        set: async (update: any) => {
          docs[path] = { ...docs[path], ...update };
        },
        update: async (update: any) => {
          docs[path] = { ...docs[path], ...update };
        },
      }),
    } as any;

    const secret1 = await getUnsubscribeSecret(mockDb);
    expect(secret1).toHaveLength(64); // 32 bytes in hex = 64 characters
    expect(docs['system/mail-secrets']?.unsubscribeSecret).toBe(secret1);

    const secret2 = await getUnsubscribeSecret(mockDb);
    expect(secret2).toBe(secret1);
  });

  it('migrates legacy secret from /system/mail-settings to /system/mail-secrets', async () => {
    const docs: Record<string, any> = {
      'system/mail-settings': { unsubscribeSecret: 'legacy-secret-1234567890abcdef1234567890abcdef' },
    };
    const mockDb = {
      doc: (path: string) => ({
        get: async () => ({
          exists: Boolean(docs[path]?.unsubscribeSecret),
          data: () => docs[path] || {},
        }),
        set: async (update: any) => {
          docs[path] = { ...docs[path], ...update };
        },
        update: async (update: any) => {
          docs[path] = { ...docs[path], ...update };
        },
      }),
    } as any;

    const secret = await getUnsubscribeSecret(mockDb);
    expect(secret).toBe('legacy-secret-1234567890abcdef1234567890abcdef');
    expect(docs['system/mail-secrets']?.unsubscribeSecret).toBe(secret);
  });
});
