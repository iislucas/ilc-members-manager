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
   - **`email.from`**: The default outbound sender email address (e.g. `'notifications@iliqchuan.com'`). If left empty (`''`), outbound email notifications are automatically disabled and only in-app notifications will be generated.

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

## 5. Setting Up Email Notifications & Event Digests

The application automatically sends transactional confirmation emails for store orders, event registrations, video on demand purchases, grading fees, subscription renewals, and member onboarding. It also runs cron-scheduled digests of upcoming events for opted-in members.

Outbound delivery uses a decoupled queue architecture:
1. When actions occur (purchases, event registrations, renewals), the system writes task documents to the `/mail` collection in Firestore.
2. The built-in Cloud Function **`processMailQueue`** (`functions/src/mail-processor.ts`) is automatically triggered whenever a document is added to `/mail`. It authenticates with your SMTP server using the secure `SMTP_PASSWORD` secret and delivers the email via `nodemailer`.

### 5.1 Google Workspace Setup for `notifications@iliqchuan.com`

The application uses Google Workspace with an authenticated App Password for reliable, authenticated outbound delivery via `smtp.gmail.com`.

#### Step A: Enable 2-Step Verification & App Passwords in Google Workspace Admin
1. Open the [Google Workspace Admin Console](https://admin.google.com) as an administrator.
2. Navigate to **Security > Authentication > 2-Step Verification**.
3. Under **User enrollment**, ensure **"Allow users to turn on 2-Step Verification"** is checked/enabled for your organization or the organizational unit containing `notifications@iliqchuan.com`.
4. (Optional) If your domain has restrictions on third-party apps, go to **Security > Access and data control > Less secure apps** (or **API Controls**) and ensure user accounts are allowed to manage their own app passwords.

#### Step B: Enable 2SV on `notifications@iliqchuan.com`
1. Open an Incognito/Private browser window and sign in to Google with `notifications@iliqchuan.com`.
2. Go to [Google Account Security](https://myaccount.google.com/security).
3. Turn on **2-Step Verification** (register a phone number or authenticator app).
   > **Note**: Google will only show the **App passwords** option *after* 2-Step Verification is active on the account.

#### Step C: Generate the 16-Character App Password
1. While logged in as `notifications@iliqchuan.com`, go directly to:
   **[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)**
   *(Or search "App passwords" in the search box at the top of your Google Account page).*
2. Enter an app name, e.g. `ILC Members Manager` or `Firebase Cloud Functions`.
3. Click **Create**.
4. Google will display a 16-character code (e.g. `abcd efgh ijkl mnop`). Copy this code (spaces can be omitted or included).

### 5.2 Store SMTP Password in Cloud Secret Manager

Save the 16-character App Password securely in Google Cloud Secret Manager using the Firebase CLI:

```bash
pnpm exec firebase functions:secrets:set SMTP_PASSWORD
```

When prompted, paste the 16-character App Password.

### 5.3 Configure Backend Email Environment

In `functions/src/environment/environment.ts` (and `environment.template.ts`), verify the Google Workspace configuration:

```typescript
export const environment: FunctionsEnvironment = {
  // ...
  email: {
    from: 'notifications@iliqchuan.com', // Outbound sender address
    fromName: 'I Liq Chuan Association',
    contact: 'web-helper-team@iliqchuan.com', // Member reply-to / inquiries
    smtpHost: 'smtp.gmail.com',          // Google Workspace authenticated SMTP host
    smtpPort: 465,                       // 465 for SSL (or 587 for TLS)
    smtpUser: 'notifications@iliqchuan.com', // Authenticaticating Google Workspace user
  },
  // ...
};
```

> **Note**: In local emulator mode or if `SMTP_PASSWORD` is not set, `processMailQueue` safely simulates delivery (logging to console and marking documents as `SUCCESS`) without attempting network connections.


### 5.4 Google Group Configuration for Reply-To (`web-helper-team@iliqchuan.com`)

The application decouples the sending address from the reply address:
- **`From`**: `"I Liq Chuan Association" <notifications@iliqchuan.com>` (authenticates through SMTP).
- **`Reply-To` & Member Inquiries**: `web-helper-team@iliqchuan.com` (Google Group).

When any recipient clicks **Reply** in their email client (Gmail, Apple Mail, Outlook, etc.), the response is routed to the group, which distributes it to the staff configured as members of that group.

#### Critical Google Group Access Settings:
To ensure members and public students can reply successfully:
1. Open the [Google Workspace Admin Console](https://admin.google.com) (or [Google Groups](https://groups.google.com)).
2. Select the **`web-helper-team@iliqchuan.com`** group and click **Group settings**.
3. Under **Access settings** -> **Posting permissions**:
   - Set **"Who can post"** to **"Anyone on the web"** (external users).
   > **Important**: If this is restricted to "Organization only", replies sent by students or members from external email addresses (like `@gmail.com` or `@yahoo.com`) will be rejected by Google Workspace with an incoming bounce notification.
4. Set **"Who can view conversations"** to **"Group members"** (ensuring customer communications remain private to your support team).
5. Set **"Who can view member list"** to **"Group managers"** or **"Group members"**.

### 5.5 DNS Deliverability Records (SPF, DKIM, DMARC)

To prevent outbound emails from landing in recipients' spam or junk folders, configure authentication records on your sending domain's DNS provider (e.g. Cloudflare, Namecheap, Google Domains):

1. **SPF (Sender Policy Framework)**:
   Add or update the `TXT` record for your root domain (`@`):
   - For Google Workspace: `v=spf1 include:_spf.google.com ~all`
   - For SendGrid: `v=spf1 include:sendgrid.net ~all`
   - If using both: `v=spf1 include:_spf.google.com include:sendgrid.net ~all`

2. **DKIM (DomainKeys Identified Mail)**:
   - **Google Workspace**: In Google Workspace Admin Console -> Apps -> Gmail -> Authenticate email, generate a 2048-bit DKIM key, add the `TXT` record at `google._domainkey.iliqchuan.com`, and click "Start Authentication".
   - **SendGrid**: In SendGrid Settings -> Sender Authentication -> Domain Authentication, follow the wizard to add the 2-3 `CNAME` records provided by SendGrid.

3. **DMARC (Domain-based Message Authentication, Reporting, and Conformance)**:
   Add a `TXT` record at `_dmarc.iliqchuan.com`:
   ```text
   v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@iliqchuan.com; sp=quarantine; pct=100
   ```

### 5.6 Email Templates & Foldable Placeholders

ILC Administrators can customize and test all transactional and digest email templates directly from the portal at `/app-notifications`:

#### Template Categories:

1. **Onboarding**:
   - `memberWelcome`: Welcome message sent upon initial membership activation. Placeholders: `{name}`, `{memberId}`, `{email}`, `{appBase}`.
   - `instructorWelcome`: Welcome message sent upon instructor license activation. Placeholders: `{name}`, `{memberId}`, `{instructorId}`, `{email}`, `{appBase}`.
2. **Purchases & Confirmations**:
   - `orderConfirmation`: General store orders and physical merchandise. Placeholders: `{name}`, `{orderNumber}`, `{orderDate}`, `{amount}`, `{currency}`, `{itemsSummary}`, `{receiptUrl}`, `{appBase}`.
   - `eventRegistrationConfirmation`: Event/workshop registration confirmation. Placeholders: `{name}`, `{eventTitle}`, `{eventDates}`, `{eventLocation}`, `{attendanceType}`, `{onlineJoiningLink}`, `{specialInstructions}`, `{amount}`, `{receiptUrl}`, `{appBase}`.
   - `vodPurchaseConfirmation`: Video-on-demand single purchase or series. Placeholders: `{name}`, `{videoTitle}`, `{videoUrl}`, `{amount}`, `{receiptUrl}`, `{appBase}`.
   - `gradingConfirmation`: Grading examination registration/payment. Placeholders: `{name}`, `{levelName}`, `{examDate}`, `{amount}`, `{receiptUrl}`, `{appBase}`.
   - `subscriptionRenewal`: Recurring subscription renewal notices. Placeholders: `{name}`, `{planName}`, `{amount}`, `{renewalDate}`, `{nextRenewalDate}`, `{receiptUrl}`, `{appBase}`.
3. **Upcoming Events Digest (Two-Tier Template)**:
   - `eventDigestOverall`: The outer wrapper email. Placeholders: `{name}`, `{period}`, `{eventsCount}`, `{eventsList}`, `{calendarUrl}`, `{preferencesUrl}`.
   - `eventDigestItem`: The inner card template repeated for each forthcoming event to build `{eventsList}`. Placeholders: `{eventTitle}`, `{eventDetailsUrl}`, `{eventDates}`, `{eventLocation}`, `{attendanceType}`, `{eventInstructors}`, `{eventPrice}`, `{eventSummary}`.

#### Foldable Markdown Toolbar Placeholders:

The `MarkdownEditor` component provides a foldable toolbar section (`[{ }] Placeholders (N) ▾/▸`):

- Click the toggle button to expand or collapse available placeholder chips.
- Hover over any chip to view a tooltip explaining what data it injects.
- Click any chip to insert its `{token}` at the current cursor position in the template.

### 5.7 Scheduled Event Digest Cron Functions

The backend provides two automated digest functions:

- `sendWeeklyEventDigest`: Runs every Monday at 09:00 UTC (`0 9 * * 1`).
- `sendMonthlyEventDigest`: Runs on the 1st of every month at 09:00 UTC (`0 9 1 * *`).

Each function queries `/events` for listed public events in the next 3 months (`today <= end` and `start <= today + 3 months`), filters members who opted into that frequency (`weekly` or `monthly` in their `/members/{memberDocId}` settings), renders the templates, and writes outbound tasks into `/mail`.

Members can adjust their preference at `/notifications/settings` ("Upcoming Events Digest" -> Weekly / Monthly / None).

### 5.8 Mail Document Lifecycle & Anti-Circular Sending Protection

Every outbound email document in `/mail` progresses through a strict, auditable lifecycle:

```
[ PENDING ] ──(processMailQueue locks via transaction)──> [ PROCESSING ] ──(SMTP response)──> [ SUCCESS ]
                                                                                │
                                                                                └──(SMTP error)──> [ ERROR ]
                                                                                                      │
                                              [ retryMailItem callable ] <────────────────────────────┘
```

#### Anti-Circular Sending Architecture:
To prevent circular triggers when `processMailQueue` updates documents in `/mail`:
1. **Pending Status Check**: `processMailQueue` verifies that `status === 'PENDING'` (or `delivery.state === 'PENDING'`). If the document is already in `PROCESSING`, `SUCCESS`, or `ERROR`, the trigger exits immediately.
2. **Atomic Transaction Lock**: When picking up a pending document, `processMailQueue` runs an atomic Firestore transaction to advance the document to `status: 'PROCESSING'`. If another trigger or burst update touched the document first, the lock fails and execution stops.
3. **Completion Updates**: When SMTP dispatch finishes, the document is updated with `status: 'SUCCESS'` (with `messageId` and timestamps) or `status: 'ERROR'` (with error message). Because neither status is `'PENDING'`, no secondary sending cycle can ever occur.

### 5.9 Global Email Sending States (Off, Paused, Active)

The system supports a 3-way global outbound dispatch state stored in `/system/mail-settings` managed by administrators:

1. **OFF (`MailSendingStatus.Off`)**: **(Initial Default)**
   - Automated transactional emails (purchases, registrations, event digests) are completely shut off.
   - **Zero-Write Enforcement**: Backend dispatchers log and return immediately **without writing any documents to `/mail`**.
2. **PAUSED (`MailSendingStatus.Paused`)**:
   - Outbound automated mail is queued. Instead of sending, placeholder documents are written to `/mail` with `status: 'PAUSED'`, storing the raw template key and token data (without interpreting or rendering templates into HTML).
3. **ACTIVE (`MailSendingStatus.Active`)**:
   - Outbound mail sending is fully enabled. Triggered notifications are rendered and enqueued with `status: 'PENDING'`, then dispatched via SMTP.
   - When switching from `PAUSED` to `ACTIVE`, all existing queued placeholder documents are transitioned to `PENDING` and dynamically interpreted with the latest template definitions.

#### Admin Test Email Bypass:
- The **Test Email Sender** (`sendAdminTestEmail`) writes a document to `/mail` with `status: 'PENDING'` and `metadata.adminTest = true`.
- `processMailQueue` explicitly allows test emails with `metadata.adminTest = true` to bypass `OFF` and `PAUSED` checks, enabling administrators to verify SMTP connections and iterate on template designs without turning on automated member communications.

### 5.10 Admin Test Email Tool & Mail Logs Viewer

Administrators have access to real-time email management tools in the portal via the dedicated **Email Notifications** space (`/app-notifications`):

#### 1. Test Email Sender (`/app-notifications?tab=test` -> Test Email Sender):
- Select quick presets (*Quick Ping*, *Welcome Notice*, *Order Confirmation*, *Event Digest*) to auto-populate sample data.
- Live rendered HTML preview alongside raw markdown editing.
- Sends test emails using the exact same code pathway as transactional messages (enqueuing to `/mail` and awaiting queue trigger dispatch).

#### 2. Mail Logs & Queue Viewer (`/app-notifications?tab=logs` -> Mail Logs & Queue):
- **Live Status Inspection**: View all recently dispatched emails, status badges (`SUCCESS` in green, `PENDING`/`PROCESSING` in amber, `ERROR` in red), recipient, and dispatch timestamps.
- **Metric Summary Cards**: Instant counters for Total Tracked, Delivered, In-Flight, and Error counts.
- **Filter & Search**: Quickly search by recipient email, subject line, or Document ID, or filter by delivery status.
- **Detailed Inspection**: Click any row to view the full delivery headers, SMTP Message ID, simulation indicators, error trace logs, and rendered message preview.
- **Retry Failed Emails**: If a temporary SMTP issue caused a message to fail, click **Retry** on the error row to call `retryMailItem`, safely resetting the document to `PENDING` for automatic re-delivery.

#### Security & Anti-Abuse Architecture:
- **Zero Client Access to `/mail`**: `firestore.rules` enforces `allow write: if false;` on `/mail/{mailId}`. No client browser or API token can directly push or manipulate email queue documents.
- **Strict Administrator Verification**: Outbound test sending via `sendAdminTestEmail` and retries via `retryMailItem` require active authentication and strictly verify that the user is an administrator via `await assertAdmin(request)`. Non-admin or unauthenticated calls are rejected with `permission-denied`.
- **Server-Only Transactional Dispatch**: All automated transactional emails are produced solely by backend Cloud Functions in response to cryptographically verified webhooks (Stripe signature checking) or secure server-side cron jobs. The system cannot be used as an open relay or abused by third parties.

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
