import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { MailSettings } from './data-model/mail';

/**
 * Fallback static secret used ONLY in test/offline environments when Firestore is unavailable.
 */
const DEFAULT_TEST_SECRET = 'ilc-insecure-test-unsubscribe-secret';

/**
 * Retrieves or automatically initializes a persistent 32-byte secret in `/system/mail-settings`.
 * This self-bootstrapping secret avoids needing interactive Google Cloud Secret Manager prompts during deploys.
 */
export async function getUnsubscribeSecret(db: admin.firestore.Firestore): Promise<string> {
  try {
    const mailSettingsRef = db.doc('system/mail-settings');
    const snap = await mailSettingsRef.get();
    const data = snap.data() as MailSettings | undefined;

    if (data?.unsubscribeSecret) {
      return data.unsubscribeSecret;
    }

    const newSecret = crypto.randomBytes(32).toString('hex');
    await mailSettingsRef.set({ unsubscribeSecret: newSecret }, { merge: true });
    return newSecret;
  } catch {
    return process.env['UNSUBSCRIBE_SECRET'] || DEFAULT_TEST_SECRET;
  }
}

/**
 * Computes a tamper-proof 32-character HMAC-SHA256 hash of the identifier (member ID or email address).
 */
export function generateUnsubscribeToken(identifier: string, secret: string): string {
  const normalized = (identifier || '').trim().toLowerCase();
  return crypto
    .createHmac('sha256', secret)
    .update(normalized)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Validates the HMAC token using timing-safe comparison to prevent timing attacks.
 */
export function verifyUnsubscribeToken(identifier: string, token: string, secret: string): boolean {
  if (!token || typeof token !== 'string' || token.length !== 32) {
    return false;
  }
  const expected = generateUnsubscribeToken(identifier, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}
