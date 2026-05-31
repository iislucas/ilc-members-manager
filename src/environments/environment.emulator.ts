/*
 * Environment Configuration (Firebase Emulator)
 *
 * Used when running `pnpm start:emulator`. Connects the Angular app to the
 * local Firebase emulator suite (auth on 9099, Firestore on 8080, storage on
 * 9199) instead of production.
 *
 * The projectId must match the production project so Firestore rules are
 * evaluated correctly. API keys / appId are ignored by the emulator.
 *
 * Start the emulators first:
 *   pnpm emulator:start
 * Then in a second terminal:
 *   pnpm start:emulator
 */

const firebaseConfig = {
  apiKey: 'emulator-api-key',
  authDomain: 'localhost',
  projectId: 'ilc-paris-class-tracker',
  storageBucket: 'ilc-paris-class-tracker.appspot.com',
  messagingSenderId: '',
  appId: '',
  measurementId: '',
};

export const environment = {
  production: false,
  useEmulator: true,
  firebase: firebaseConfig,
  googleCalendar: {
    calendarId: '',
  },
  adminEmail: 'admin@example.com',
  passwordResetEmailSender: 'noreply@example.com',
  links: {
    membership: 'http://localhost:5000/membership',
    license: 'http://localhost:5000/license',
    videos: 'http://localhost:5000/videos',
  },
};
