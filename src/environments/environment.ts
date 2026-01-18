// This is the template file, copy it to `environment.local.ts` and fill in the
// values.
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
    calendarId: '06se06gf82c428olklnjagbt6c@group.calendar.google.com',
  },
  adminEmail: 'admin@iliqchuan.com',
};
