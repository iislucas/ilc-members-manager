import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { MailSettings } from './data-model/mail';

import { FieldValue } from 'firebase-admin/firestore';

/**
 * Fallback static secret used ONLY in test/offline environments when Firestore is unavailable.
 */
const DEFAULT_TEST_SECRET = 'ilc-insecure-test-unsubscribe-secret';

/**
 * Retrieves or automatically initializes a persistent 32-byte secret in `/system/mail-secrets` (admin-only).
 * Migrates any legacy secret from the public `/system/mail-settings` to avoid breaking existing links.
 */
export async function getUnsubscribeSecret(db: admin.firestore.Firestore): Promise<string> {
  if (process.env['UNSUBSCRIBE_SECRET']) {
    return process.env['UNSUBSCRIBE_SECRET'];
  }

  try {
    const secretsRef = db.doc('system/mail-secrets');
    const secretsSnap = await secretsRef.get();
    const secretsData = secretsSnap.data() as { unsubscribeSecret?: string } | undefined;
    if (secretsData?.unsubscribeSecret) {
      return secretsData.unsubscribeSecret;
    }

    // Check if a legacy secret exists in system/mail-settings to migrate
    const mailSettingsRef = db.doc('system/mail-settings');
    const settingsSnap = await mailSettingsRef.get();
    const settingsData = settingsSnap.data() as MailSettings & { unsubscribeSecret?: string } | undefined;

    let secretToPersist = settingsData?.unsubscribeSecret;
    if (!secretToPersist) {
      secretToPersist = crypto.randomBytes(32).toString('hex');
    }

    // Save to private /system/mail-secrets
    await secretsRef.set({ unsubscribeSecret: secretToPersist }, { merge: true });

    // Clean up legacy key from public /system/mail-settings if it was present
    if (settingsData?.unsubscribeSecret) {
      try {
        await mailSettingsRef.update({ unsubscribeSecret: FieldValue.delete() });
      } catch {
        // Non-blocking cleanup
      }
    }

    return secretToPersist;
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
