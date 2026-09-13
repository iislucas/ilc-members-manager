/* setup-catalog.ts
 *
 * Authoritative registry of all setup, emulator, seeding, and production provisioning guides (View 1).
 */

import { SetupGuideEntry, SetupCategory } from '../models/setup-guide';

export const SETUP_CATALOG: SetupGuideEntry[] = [
  {
    id: 'local-dev-setup',
    title: 'Local Developer Workstation Setup',
    category: SetupCategory.LocalDev,
    summary:
      'Step-by-step instructions for preparing your local workstation, configuring pnpm, and setting up environment files.',
    prerequisites: [
      'Node.js ^22.x or ^24.x installed',
      'pnpm ^11.x installed globally (do NOT use npm or npx)',
      'Java JRE installed (required to run Firebase Emulator Suite)',
      'Google Cloud SDK (gcloud) installed and authenticated',
    ],
    commands: [
      { command: 'pnpm install', explanation: 'Installs all dependencies for both Angular client and functions' },
      { command: 'cp src/environments/environment.ts src/environments/environment.local.ts', explanation: 'Configures local Angular environment file' },
      { command: 'cp functions/src/environment/environment.template.ts functions/src/environment/environment.ts', explanation: 'Creates functions environment file' },
      { command: 'pnpm run stamp-version', explanation: 'Generates version.ts from Git and timestamp' },
    ],
    commonGotchas: [
      { issue: 'pnpm command not found', resolution: 'Ensure ~/.zshrc or ~/.bashrc loads the pnpm bin path.' },
      { issue: 'Functions environment missing', resolution: 'Copy functions/src/environment/environment.template.ts to environment.ts before building.' },
    ],
    verifiedFlows: ['client-reactivity'],
  },
  {
    id: 'firebase-emulators',
    title: 'Firebase Local Emulator Suite Orchestration',
    category: SetupCategory.EmulatorSuite,
    summary:
      'Starting and orchestrating local Firebase emulators for Auth, Firestore, Functions, and Cloud Storage.',
    prerequisites: ['Local workstation setup completed', 'Java JRE installed'],
    commands: [
      { command: 'pnpm build:functions', explanation: 'REQUIRED: Builds the functions/dist directory before starting the emulator' },
      { command: 'pnpm emulator:start', explanation: 'Starts Auth (9099), Firestore (8080), Functions (5001), Storage (9199), and UI (4000)' },
      { command: 'pnpm start:emulator', explanation: 'In a separate terminal, launches the Angular dev server on port 4200 wired to emulators' },
    ],
    commonGotchas: [
      { issue: 'Functions not loaded in emulator', resolution: 'Always run pnpm build:functions before starting the emulator. The emulator loads compiled JS from dist at startup.' },
      { issue: 'FieldValue not found in triggers', resolution: 'Import FieldValue from firebase-admin/firestore directly rather than namespaced admin.firestore.FieldValue.' },
    ],
    verifiedFlows: ['client-reactivity', 'trigger-mirroring'],
  },
  {
    id: 'emulator-seeding-testing',
    title: 'Data Seeding & Test User Credentials',
    category: SetupCategory.EmulatorSuite,
    summary:
      'Populating the local emulator with anonymized production data and authenticated test user accounts.',
    prerequisites: ['Firebase emulators running via pnpm emulator:start'],
    commands: [
      { command: 'pnpm export:anonymized', explanation: 'Exports anonymized production data from production to tmp/seed-data/*.json' },
      { command: 'pnpm seed:emulator', explanation: 'Seeds Firestore collections and pre-creates Firebase Auth accounts with testpassword123' },
    ],
    testAccounts: [
      { persona: 'HQ Administrator', email: 'member-us536@example.com', password: 'testpassword123', roles: 'isAdmin: true, full system read/write' },
      { persona: 'Regular Practitioner', email: 'member-pl100@example.com', password: 'testpassword123', roles: 'Student Level 3, own digital passbook' },
      { persona: 'Licensed Instructor', email: 'member-us289@example.com', password: 'testpassword123', roles: 'Active instructor license, student roster access' },
      { persona: 'School Manager', email: 'member-fr102@example.com', password: 'testpassword123', roles: 'School owner, school student roster' },
    ],
    commonGotchas: [
      { issue: 'Email case mismatch on login', resolution: 'CheckEmailStatus and getUserDetails normalize emails to lowercase. ACL doc IDs are strictly lowercase.' },
      { issue: 'Timestamp deserialization RangeError', resolution: 'Seed script restores {_seconds, _nanoseconds} to proper admin.firestore.Timestamp instances.' },
    ],
    verifiedFlows: ['client-reactivity', 'trigger-mirroring'],
  },
  {
    id: 'production-provisioning',
    title: 'Cloud Instance Provisioning & GCP Setup',
    category: SetupCategory.ProductionProvisioning,
    summary:
      'Creating and deploying a brand-new production instance of ILC Members Manager on Google Cloud / Firebase.',
    prerequisites: ['Google Cloud billing account active', 'Firebase CLI authenticated via firebase login'],
    commands: [
      { command: 'firebase projects:create <project-id>', explanation: 'Initializes new Google Cloud / Firebase project' },
      { command: 'firebase firestore:databases:create --location=<region>', explanation: 'Provisions Cloud Firestore native database' },
      { command: 'pnpm deploy:rules', explanation: 'Deploys firestore.rules and storage.rules' },
      { command: 'pnpm deploy:functions', explanation: 'Builds and deploys all production Firebase Cloud Functions' },
      { command: 'pnpm deploy:hosting', explanation: 'Builds Angular app and deploys static bundles to Firebase Hosting' },
    ],
    verifiedFlows: ['client-reactivity', 'trigger-mirroring', 'ecommerce-webhooks'],
  },
  {
    id: 'third-party-integrations',
    title: 'Stripe, VOD Transcoder & Web Push Setup',
    category: SetupCategory.ThirdPartyIntegrations,
    summary:
      'Configuring Stripe webhooks, Google Cloud Transcoder API for video streaming, and Web Push VAPID keys.',
    prerequisites: ['Stripe CLI installed', 'GCP Service Account with Transcoder Admin permissions'],
    commands: [
      { command: 'pnpm register:stripe-webhook', explanation: 'Registers stripeWebhook endpoint with Stripe API' },
      { command: 'pnpm sync:video-products', explanation: 'Synchronizes purchasable VOD items with Stripe Product & Price catalog' },
    ],
    verifiedFlows: ['ecommerce-webhooks', 'media-transcoding'],
  },
  {
    id: 'email-smtp-setup',
    title: 'Outbound Email, Google Workspace SMTP & Dispatch State Setup',
    category: SetupCategory.ThirdPartyIntegrations,
    summary:
      'Configuring Google Workspace Gmail SMTP credentials, routing mail through notifications@iliqchuan.com with web-helper-team@iliqchuan.com reply-to, managing the 3-state dispatch lifecycle (Off, Paused, Active), and verifying connectivity via the Test Email Sender tool.',
    prerequisites: [
      'Google Workspace administrator access with Gmail App Passwords enabled',
      'Google Group web-helper-team@iliqchuan.com configured as collaborative inbox',
      'Administrator account for accessing /email-notifications',
    ],
    commands: [
      { command: 'firebase functions:secrets:set GMAIL_SMTP_APP_PASSWORD', explanation: 'Stores Google Workspace 16-character App Password securely in GCP Secret Manager' },
      { command: 'pnpm --prefix functions test functions/src/mail-processor.spec.ts', explanation: 'Runs local unit tests verifying zero-write Off enforcement, placeholder queuing, and adminTest bypass' },
      { command: 'pnpm --prefix functions test functions/src/email-dispatcher.spec.ts', explanation: 'Runs unit tests for Nodemailer MIME encoding and Gmail SMTP transport' },
    ],
    commonGotchas: [
      { issue: 'Emails failing with invalid credentials (535-5.7.8)', resolution: 'Standard Google account passwords will not work. Generate a 16-character App Password in Google Workspace Security under 2-Step Verification.' },
      { issue: 'No emails delivered in development or staging', resolution: 'Check /email-notifications status banner. Default state is OFF (zero writes to /mail). Switch to PAUSED or ACTIVE, or send an Admin Test Email to bypass the OFF state.' },
      { issue: 'Hash symbols (#/) breaking email confirmation links', resolution: 'The client router uses HTML5 path routing without hash URLs. Ensure email templates never contain /# or #/.' },
    ],
    verifiedFlows: ['email-queue-processor'],
  },
];
