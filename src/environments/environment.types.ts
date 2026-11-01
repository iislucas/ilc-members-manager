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

// External store/product URLs (typically Squarespace/Stripe product pages)
// surfaced to members as purchase and renewal call-to-action buttons.
export interface EnvironmentLinks {
  // Membership purchase/renewal page. Shown on the home page and as the
  // renewal URL in member-details, member-gradings, and download-resource
  // when a member has no active membership.
  membership: string;
  // Instructor-license purchase/renewal page. Shown on the home page and used
  // as the renewal URL in download-resource when an instructor license is
  // required or has lapsed.
  license: string;
  // Video-library subscription page. Linked from the home page's videos CTA.
  videos: string;
  // Grading-fee payment page. Linked from the grading-progress view as the
  // product a member buys to pay for their next grading.
  grading: string;
  // External print store URL for the System Guide and books.
  printStore: string;
  // External apparel store URL for official uniforms and shirts.
  apparelStore: string;
}

// Global frontend Angular application environment configuration contract.
export interface AppEnvironment {
  // Set to true in production builds
  production: boolean;
  // Set to true when connecting to the local Firebase Emulator Suite
  useEmulator: boolean;
  // Firebase web credentials configuration
  firebase: FirebaseConfig;
  // Public support/help contact address. Displayed to users (not emailed
  // automatically) on the login and unauthorized pages, in the footer, and in
  // error dialogs (e.g. firebase-state) inviting them to get in touch.
  //
  // Server-side messages carry the same address as `email.contact` in
  // functions/src/environment. The duplication is deliberate — the two bundles
  // are built and deployed separately, and neither can import the other's config
  // (see the note on `email.contact`) — so keep them in step by hand.
  adminEmail: string;
  // The 'From' address that Firebase Auth emails (password reset and email
  // verification) are sent from. Display-only: shown in the login flow's
  // reset-confirmation and verify-your-email messages so users know which
  // sender to look for (e.g. in a spam folder). The actual send is performed
  // by Firebase Auth, not this value.
  passwordResetEmailSender: string;
  // Base64url VAPID public key used by browser PushManager.subscribe({ applicationServerKey })
  // to bind device Web Push subscriptions to our backend sender.
  //
  // Format & invariants (enforced before deploy by `pnpm env:check`):
  // - Must be an 87-character base64url uncompressed NIST P-256 public key (starts
  //   with 'B' and decodes to 65 bytes beginning with 0x04), generated via
  //   `pnpm dlx web-push generate-vapid-keys` — NOT a Stripe (`pk_...`) or Firebase key.
  // - Must match `vapidPublicKey` in `functions/src/environment/environment.ts` and
  //   correspond to the `VAPID_PRIVATE_KEY` secret in Google Cloud Secret Manager.
  // - Set to '' (in both client and server environments) to disable Web Push.
  vapidPublicKey: string;
  // Outbound transactional email notifications flag. When false or omitted, email
  // sending is disabled and event details / Zoom joining links are accessed directly on the event page.
  emailNotificationsEnabled?: boolean;
  // Product and external service URL links
  links: EnvironmentLinks;
}
