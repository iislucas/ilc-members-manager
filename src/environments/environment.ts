/**
 * Environment Configuration Template
 * 
 * PURPOSE:
 * - Template for local development configuration.
 * - COMMITTED to git.
 * 
 * USAGE:
 * - Copy this file to `src/environments/environment.local.ts` and fill in your values.
 * 
 * MAINTENANCE:
 * - Whenever you add a new configuration key to `environment.local.ts`, you MUST
 *   add it here with a template/placeholder value so other developers know it exists.
 */

import { AppEnvironment } from './environment.types';

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_AUTH_DOMAIN',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID',
  measurementId: 'YOUR_MEASUREMENT_ID_FROM_FIREBASE',
};

export const environment: AppEnvironment = {
  production: false,
  useEmulator: false,
  firebase: firebaseConfig,
  adminEmail: 'web-helper-team@iliqchuan.com',
  passwordResetEmailSender: 'noreply@app.iliqchuan.com',
  // Web Push VAPID public key: an 87-char base64url uncompressed P-256 public key
  // (starts with 'B', decodes to 65 bytes starting with 0x04 — NOT a Stripe `pk_...`
  // or Firebase key). Generate a pair with `pnpm dlx web-push generate-vapid-keys`:
  // - Put the PUBLIC key here AND identically in `functions/src/environment/environment.ts`.
  // - Store the PRIVATE key in Cloud Secret Manager (`firebase functions:secrets:set VAPID_PRIVATE_KEY`).
  // - Leave '' (empty) in both files to disable Web Push. Verified on deploy by `pnpm env:check`.
  vapidPublicKey: '',
  emailNotificationsEnabled: false,
  links: {
    membership: 'YOUR_MEMBERSHIP_PRODUCT_URL',
    license: 'YOUR_LICENSE_PRODUCT_URL',
    videos: 'YOUR_VIDEOS_PRODUCT_URL',
    grading: 'YOUR_GRADING_PRODUCT_URL',
    printStore: 'https://www.iliqchuan.com/products/print',
    apparelStore: 'https://www.iliqchuan.com/products/apparel',
  }
};
