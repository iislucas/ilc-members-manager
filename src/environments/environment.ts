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

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_AUTH_DOMAIN',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID',
  measurementId: 'YOUR_MEASUREMENT_ID_FROM_FIREBASE',
};

export const environment = {
  production: false,
  firebase: firebaseConfig,
  googleCalendar: {
    calendarId: '12c944d5b7101ad4d3234e063fc6b16b7ae5a05d650dd3d102b5a3a2838b7443@group.calendar.google.com',
  },
  adminEmail: 'web-helper-team@iliqchuan.com',
  passwordResetEmailSender: 'noreply@app.iliqchuan.com',
  links: {
    membership: 'YOUR_MEMBERSHIP_PRODUCT_URL',
    license: 'YOUR_LICENSE_PRODUCT_URL',
    videos: 'YOUR_VIDEOS_PRODUCT_URL'
  }
};
