# ILC Members Portal - Setup & Deployment Guide

This guide provides step-by-step instructions to set up, configure, run, and deploy the **ILC Members Portal** (both the frontend Angular application and the backend Firebase Cloud Functions), including configuring automated email notifications.

---

## 1. Local Prerequisites & Installation

The project uses [pnpm](https://pnpm.io/) for managing dependencies.

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/iislucas/ilc-members-manager.git
   cd ilc-members-manager
   ```

2. **Install All Dependencies** (Root, Frontend, and Cloud Functions):
   Running `pnpm install` at the root will automatically trigger installation of the `functions/` directory dependencies as well (via a postinstall hook):
   ```bash
   pnpm install
   ```

---

## 2. Configuration & Environments

### Frontend Environment Configuration
The frontend project requires local environment configuration:
- Copy the template file `src/environments/environment.ts` to `src/environments/environment.local.ts`.
- Fill in the production keys, API endpoints, and Firebase credentials in `src/environments/environment.local.ts` (this file is git-ignored to prevent leak of credentials).

### Google Cloud APIs Configuration
Make sure the following Google Cloud Project APIs are enabled in your console:
- **Secret Manager API** (`secretmanager.googleapis.com`)
- **Google Calendar API** (`calendar-json.googleapis.com`)

To set the quota project on your authenticated CLI:
```bash
export PROJECT="your-firebase-project-name"
gcloud auth application-default set-quota-project ${PROJECT}
```

### Cloud Functions Environment Configuration
The backend Cloud Functions require their own environment configurations:
1. Copy `functions/src/environment/environment.template.ts` and save it as `functions/src/environment/environment.ts`.
2. Configure the necessary backend parameters. Key environment options:
   - **`email.from`**: The default outbound sender email address (e.g. `'info@iliqchuan.com'`). If left empty (`''`), outbound email notifications are automatically disabled and only in-app notifications will be generated.

### Cloud Functions Secret Credentials
Set required API credentials securely using Secret Manager via the Firebase CLI:

1. **Google Calendar API Key**:
   ```bash
   firebase functions:secrets:set GOOGLE_CALENDAR_API_KEY
   ```
2. **Squarespace API Key**:
   ```bash
   firebase functions:secrets:set SQUARESPACE_API_KEY
   ```
3. **Stripe API Secret Key**:
   ```bash
   firebase functions:secrets:set STRIPE_SECRET_KEY
   ```
4. **Stripe Webhook Signing Secret**:
   After setting the `STRIPE_SECRET_KEY` and deploying the `stripeWebhook` function, run the webhook registration script from the repository root:
   ```bash
   pnpm register:stripe-webhook
   ```
   On first execution, this script will register the webhook endpoint with Stripe and output a webhook signing secret (`whsec_...`). Save this secret key to Firebase:
   ```bash
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```

---

## 3. Local Development & Testing

### Running the Development Server
To start the local development server for the Angular application:
```bash
pnpm start
```
The portal will spin up at [http://localhost:4200/](http://localhost:4200/) and automatically reload on file edits.

### Local Emulator (Firebase)
To run Cloud Functions and Firebase resources in the local emulator environment:
```bash
pnpm --prefix functions run emulate
```

### Running Unit Tests
- **Frontend tests**:
  ```bash
  pnpm test:once
  ```
- **Backend Cloud Functions tests**:
  ```bash
  pnpm test:functions
  ```

---

## 4. Deploying to Firebase

### Login and Initialize Project
Before deploying, authenticate with Google Cloud and Firebase CLI:

1. **Authenticate Google Cloud SDK**:
   ```bash
   gcloud auth login
   ```

2. **Authenticate Firebase CLI**:
   ```bash
   pnpm exec firebase login
   ```

3. **Select Firebase Project**:
   ```bash
   export PROJECT="your-firebase-project-name"
   gcloud config set project ${PROJECT}
   gcloud auth application-default login
   pnpm exec firebase use --add ${PROJECT}
   ```

### Deploying Resources
You can deploy all components or just specific parts:

- **Deploy Everything** (Functions, Hosting, Rules, Storage):
  ```bash
  pnpm run deploy
  ```
- **Deploy Frontend Hosting only**:
  ```bash
  pnpm run deploy:hosting
  ```
- **Deploy Cloud Functions only**:
  ```bash
  pnpm run deploy:functions
  ```
- **Deploy Firestore/Storage rules only**:
  ```bash
  pnpm run deploy:rules
  ```

---

## 5. Setting Up Email Notifications

The application automatically enqueues welcome and license activation emails for members and instructors. It does so by writing email task payloads to the `/mail` collection in Firestore.

To enable sending of these emails, you must configure the official **Trigger Email** Firebase Extension.

### Installing and Configuring the Trigger Email Extension

You can install the **Trigger Email** extension either via the web console or directly from the command line.

#### Option A: Command Line Interface (CLI) Installation (Recommended)

1. Run the install command specifying your active project:
   ```bash
   firebase ext:install firebase/firestore-send-email --project=YOUR_PROJECT_ID
   ```
2. The CLI will prompt you interactively to configure the required parameters. Set them as follows:
   - **Users collection**: `mail`
   - **SMTP Connection URI**: Set to your SMTP provider credentials URI:
      - **Option A (Google Workspace SMTP Relay - Free/Enterprise)**:
        `smtps://YOUR_WORKSPACE_EMAIL@YOUR_DOMAIN.com:YOUR_APP_PASSWORD@smtp-relay.gmail.com:465`
        *(Note: You must enable the "SMTP relay service" in your Google Workspace Admin Console under Apps > Google Workspace > Gmail > Routing, and generate an App Password for the sending account if 2-Factor Authentication is active).*
      - **Option B (Twilio SendGrid)**:
        `smtps://apikey:YOUR_SENDGRID_API_KEY@smtp.sendgrid.net:465`
   - **Default From address**: `info@iliqchuan.com`
   - **Default From name**: `I Liq Chuan Association`

*Alternatively, if you want to keep extensions configuration tracked in source control, use the `--local` flag to write local env manifests, and then run `firebase deploy --only extensions`:*
```bash
firebase ext:install firebase/firestore-send-email --local
```

#### Option B: Firebase Console Installation

1. Navigate to the **Firebase Console** -> **Extensions** tab.
2. Search for **Trigger Email** (published by Firebase) and click **Install**.
3. Configure the parameters using the same values as listed above:
   - **Email documents collection**: `mail`
   - **SMTP Connection URI**: 
      - Workspace Relay: `smtps://YOUR_WORKSPACE_EMAIL@YOUR_DOMAIN.com:YOUR_APP_PASSWORD@smtp-relay.gmail.com:465`
      - SendGrid: `smtps://apikey:YOUR_SENDGRID_API_KEY@smtp.sendgrid.net:465`
   - **Default From address**: `info@iliqchuan.com`
   - **Default From name**: `I Liq Chuan Association`

#### How to Generate a SendGrid API Key:
If you are using SendGrid as your email service provider, follow these steps to obtain your API key:
1. Log in to the [SendGrid Dashboard](https://app.sendgrid.com/).
2. In the left navigation menu, expand **Settings** and select **API Keys**.
3. Click the **Create API Key** button in the top right corner.
4. Give the key a descriptive name (e.g. `ILC Members Portal Notification Mailer`).
5. Choose **Restricted Access** for security. Scroll down to **Mail Send** permissions and grant it **Full Access** (this limits the key's capabilities solely to sending mail).
6. Click **Create & View** at the bottom.
7. Copy the key displayed immediately and store it securely (SendGrid will never display this key to you again). Replace `YOUR_SENDGRID_API_KEY` in the SMTP Connection URI configuration above with this key.

### Customizing Email Templates

Once deployed, ILC Administrators can edit email templates directly from the portal:
1. Access the **Settings** area of the app at `#/settings?tab=email-templates`.
2. Edit Subjects and Body templates using standard Markdown syntax.
3. Supported placeholder variables include:
   - **New Members template**: `{name}`, `{memberId}`, `{email}`.
   - **New Instructors template**: `{name}`, `{memberId}`, `{instructorId}`, `{email}`.

---

## 6. Local Firebase Emulator & Testing

For local testing without affecting production databases, use the Firebase Local Emulator Suite.

### Running the Emulator Suite
1. **Start Emulator Services** (Auth, Firestore, Functions, and Storage):
   ```bash
   pnpm run emulator:start
   ```
2. **Start Frontend in Emulator Mode**:
   Starts the local Angular app configured to connect to the local emulator:
   ```bash
   pnpm run start:emulator
   ```
3. **Seed Database**:
   Seeds the local emulator database with mock practitioner profiles:
   ```bash
   pnpm run seed:emulator
   ```

### Running Rules & End-to-End Tests
The project contains automated security rules and end-to-end (E2E) integration tests that run against the Local Emulator:

- **Security Rules Tests**: Verifies read/write restrictions conform to [firestore.rules](file:///Users/ldixon/code/zxd/ilc-members-manager/firestore.rules).
  ```bash
  pnpm run test:rules
  ```
- **End-to-End (E2E) Tests**: Executes full integration tests for order parsing and activation hooks.
  ```bash
  pnpm run test:e2e
  ```

---

## 7. Email Architecture: FAQ & Options

### Do we need the "Trigger Email" extension?
No, it is not strictly required, but it is highly recommended. 
The application triggers simply write a task document to the `/mail` collection in Firestore. 

Using this model has several advantages:
1. **Decoupled Delivery**: The backend Cloud Functions don't wait for mail servers or fail if SMTP connection drops. Tasks are persisted in Firestore and retry automatically on network errors.
2. **Delivery Logs & History**: Sent mail logs, timestamps, error trace details, and delivery attempts are saved automatically on the mail documents in Firestore under `delivery.info`.
3. **No Mail Package Maintenance**: Avoids importing and maintaining mail packages (like `nodemailer`) inside the main backend codebase.

### Who owns the "Trigger Email" extension?
It is owned, published, and maintained officially by the **Firebase team at Google** (`ext-firestore-send-email`).

### What are the other options?
If you choose not to use the Firebase Extension:
- **Direct SMTP Wrapper**: You can import `nodemailer` inside [on-member-update.ts](file:///Users/ldixon/code/zxd/ilc-members-manager/functions/src/on-member-update.ts) and send the mail directly via an SMTP server.
- **REST APIs**: You can call HTTP email endpoints of providers like SendGrid or Mailgun directly using an HTTP library (e.g. `axios`).
- **Custom Mail Queue Trigger**: You can write your own custom Cloud Function that listens to the `mail` collection and sends emails, duplicating what the Firebase Extension does.

---

## 8. Troubleshooting

### Signed URL Generation: "Permission 'iam.serviceAccounts.signBlob' denied"
If backups listing or downloads fail with a `signBlob` permission error, the service account used by your Firebase Functions requires the **Service Account Token Creator** IAM role.

To resolve, run this command:
```bash
export PROJECT_NAME="your-firebase-project-name"
export PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_NAME} --format="value(projectNumber)")

gcloud projects add-iam-policy-binding ${PROJECT_NAME} \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --condition=None

gcloud projects add-iam-policy-binding ${PROJECT_NAME} \
  --member="serviceAccount:${PROJECT_NAME}@appspot.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --condition=None
```
Alternatively, go to **Google Cloud Console** -> **IAM & Admin** -> select default Compute Engine service account -> edit and add the **Service Account Token Creator** role.
