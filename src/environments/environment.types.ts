// Client-Side Application Environment Configuration Types
//
// This file defines the TypeScript interface contract for all frontend environments
// (`environment.ts`, `environment.local.ts`, `environment.emulator.ts`).

// Firebase project initialization credentials.
export interface FirebaseConfig {
  // Firebase Web API key
  apiKey: string;
  // Firebase Auth custom domain or default domain
  authDomain: string;
  // Google Cloud Project ID
  projectId: string;
  // Cloud Storage default bucket name
  storageBucket: string;
  // Firebase Cloud Messaging sender ID
  messagingSenderId: string;
  // Firebase Web Application ID
  appId: string;
  // Google Analytics / Firebase Measurement ID
  measurementId: string;
}

// External store/product links used across the application.
export interface EnvironmentLinks {
  // Link for purchasing annual/life membership
  membership: string;
  // Link for purchasing instructor license
  license: string;
  // Link for video library subscription
  videos: string;
  // Link for grading fee payments
  grading: string;
}

// Global frontend Angular application environment configuration contract.
export interface AppEnvironment {
  // Set to true in production builds
  production: boolean;
  // Set to true when connecting to the local Firebase Emulator Suite
  useEmulator: boolean;
  // Firebase web credentials configuration
  firebase: FirebaseConfig;
  // Google Calendar integration settings
  googleCalendar: {
    // Primary public Google Calendar ID for events
    calendarId: string;
  };
  // Support/admin contact email address
  adminEmail: string;
  // Outbound email address used for password reset requests
  passwordResetEmailSender: string;
  // Base64url VAPID public key used by browser PushManager to subscribe to Web Push
  vapidPublicKey: string;
  // Product and external service URL links
  links: EnvironmentLinks;
}
