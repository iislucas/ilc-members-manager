/* flows-catalog.ts
 *
 * Authoritative registry of all end-to-end information flow pipelines (View 4).
 */

import { ArchFlowEntry, FlowCategory } from '../models/arch-flow';

export const FLOWS_CATALOG: ArchFlowEntry[] = [
  {
    id: 'client-reactivity',
    title: 'Client UI Reactivity & Real-Time Snapshot Pipeline',
    category: FlowCategory.ClientReactivity,
    summary:
      'How user gestures update Angular Signals, propagate mutations to Cloud Firestore, and reflect real-time onSnapshot changes without manual page refreshes.',
    trigger: 'User interacts with an input or form (e.g. grading status change, profile update).',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Angular Component UI',
        targetTier: 'Angular Signals / Forms',
        action: 'Form input updates signal value or calls data manager mutation method',
        payloadDescription: 'Typed mutation object e.g. Partial<Grading>',
        codePointers: ['src/app/grading-edit/grading-edit.ts'],
        tierType: 'client',
        protocol: 'Angular Signal Mutation',
      },
      {
        stepNumber: 2,
        sourceTier: 'DataManagerService',
        targetTier: 'Cloud Firestore Client SDK',
        action: 'Calls setDoc or updateDoc with serverTimestamp()',
        payloadDescription: 'Firestore document write payload',
        codePointers: ['src/app/data-manager.service.ts'],
        tierType: 'client',
        protocol: 'Firestore SDK setDoc/updateDoc',
      },
      {
        stepNumber: 3,
        sourceTier: 'Cloud Firestore',
        targetTier: 'onSnapshot Listener',
        action: 'Firestore pushes updated document snapshot via active WebSocket',
        payloadDescription: 'DocumentSnapshot containing raw data',
        codePointers: ['src/app/data-manager.service.ts'],
        tierType: 'database',
        protocol: 'WebSocket onSnapshot Push',
      },
      {
        stepNumber: 4,
        sourceTier: 'SearchableSet',
        targetTier: 'MiniSearch & Signals',
        action: 'Converter firestoreDocToXxx merges defaults; MiniSearch re-indexes; signal updates',
        payloadDescription: 'Complete immutable domain object',
        codePointers: ['src/app/searchable-set.ts'],
        tierType: 'client',
        protocol: 'MiniSearch Re-Index & Signal',
      },
      {
        stepNumber: 5,
        sourceTier: 'Angular View Engine',
        targetTier: 'DOM Render',
        action: 'OnPush change detection evaluates computed signals and updates template with zero zone overhead',
        payloadDescription: 'DOM updates',
        codePointers: ['src/app/app.config.ts'],
        tierType: 'client',
        protocol: 'OnPush DOM Render',
      },
    ],
    inputDataTypes: ['member', 'grading', 'ilc-event'],
    outputDataTypes: ['member', 'grading', 'ilc-event'],
    cloudFunctions: [],
    clientServices: ['DataManagerService', 'FirebaseStateService', 'NavigationTreeService'],
    mermaidDiagram: `flowchart LR
    User[User Input] --> Signal[Angular Signal Form]
    Signal --> DMS[DataManagerService]
    DMS --> FS[(Cloud Firestore)]
    FS -.-> Snap[onSnapshot Listener]
    Snap --> Set[SearchableSet / MiniSearch]
    Set --> View[OnPush Component View]`,
  },
  {
    id: 'trigger-mirroring',
    title: 'Cloud Trigger Automation & Subcollection Fan-Out Pipeline',
    category: FlowCategory.TriggerMirroring,
    summary:
      'How database writes fire background Cloud Functions to maintain ACL caches, mirror rosters to school/instructor subcollections, and dispatch notifications.',
    trigger: 'A document in /gradings/{id}, /members/{id}, or /schools/{id} is created or modified in Firestore.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Cloud Firestore',
        targetTier: 'Cloud Function Trigger',
        action: 'Document write triggers onUpdate or onCreate cloud function',
        payloadDescription: 'Change<DocumentSnapshot>',
        codePointers: ['functions/src/on-grading-update.ts', 'functions/src/on-member-update.ts'],
        tierType: 'database',
        protocol: 'Firestore onUpdate/onCreate Trigger',
      },
      {
        stepNumber: 2,
        sourceTier: 'Trigger Handler',
        targetTier: 'Mirroring Subcollections',
        action: 'Mirrors document copy to /schools/{schoolId}/gradings and /instructors/{instId}/gradings',
        payloadDescription: 'Mirrored document payload',
        codePointers: ['functions/src/on-grading-update.ts'],
        tierType: 'cloud-functions',
        protocol: 'Admin SDK Mirror Write',
      },
      {
        stepNumber: 3,
        sourceTier: 'Trigger Handler',
        targetTier: 'ACL Cache',
        action: 'Rebuilds user permissions snapshot in /acl/{lowercaseEmail}',
        payloadDescription: 'ACL object',
        codePointers: ['functions/src/on-member-update.ts'],
        tierType: 'cloud-functions',
        protocol: 'Admin SDK /acl Cache Write',
      },
      {
        stepNumber: 4,
        sourceTier: 'Trigger Handler',
        targetTier: 'Notifications Store',
        action: 'Generates MemberNotification in /members/{targetMemberDocId}/notifications',
        payloadDescription: 'MemberNotification object',
        codePointers: ['functions/src/on-grading-update.ts'],
        tierType: 'cloud-functions',
        protocol: 'Admin SDK /notifications Write',
      },
    ],
    inputDataTypes: ['grading', 'member', 'school'],
    outputDataTypes: ['grading', 'member', 'acl'],
    cloudFunctions: ['onGradingUpdate', 'onMemberUpdate', 'onSchoolUpdate', 'mirrorInstructorsToPublicProfile'],
    clientServices: ['DataManagerService', 'NotificationService'],
    mermaidDiagram: `flowchart TD
    Write[(Firestore Write)] --> Trigger[Cloud Trigger Function]
    Trigger --> Mirror[(Subcollection Mirrors\n/schools, /instructors)]
    Trigger --> ACL[(ACL Cache\n/acl/{email})]
    Trigger --> Notif[(In-App Notification\n/members/{id}/notifications)]`,
  },
  {
    id: 'ecommerce-webhooks',
    title: 'E-Commerce Checkout & Stripe Webhook Fulfillment Pipeline',
    category: FlowCategory.ECommerceWebhooks,
    summary:
      'The flow from initiating a checkout session for memberships, tickets, or gradings through Stripe payment settlement, webhook validation, and automated idempotent fulfillment.',
    trigger: 'User completes a purchase on Stripe Checkout or recurring subscription renews.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Angular Client',
        targetTier: 'Cloud Function Callable',
        action: 'Calls createStripeCheckoutSession with product docId or tier',
        payloadDescription: 'Product reference & return URLs',
        codePointers: ['src/app/stripe.service.ts', 'functions/src/stripe-checkout.ts'],
        tierType: 'client',
        protocol: 'HTTPS Callable SDK',
      },
      {
        stepNumber: 2,
        sourceTier: 'Stripe Platform',
        targetTier: 'Webhook HTTP Endpoint',
        action: 'Stripe dispatches checkout.session.completed or invoice.paid',
        payloadDescription: 'Stripe Event JSON with HMAC signature header',
        codePointers: ['functions/src/stripe-webhook.ts'],
        tierType: 'external',
        protocol: 'Stripe Webhook Event POST',
      },
      {
        stepNumber: 3,
        sourceTier: 'Webhook Handler',
        targetTier: 'Orders Collection',
        action: 'Verifies Stripe signature, records transaction in /orders/{docId}',
        payloadDescription: 'Order document with paymentStatus: paid',
        codePointers: ['functions/src/stripe-webhook.ts'],
        tierType: 'cloud-functions',
        protocol: 'HMAC Signature Verification & Firestore Write',
      },
      {
        stepNumber: 4,
        sourceTier: 'Fulfillment Engine',
        targetTier: 'Target Collections',
        action: 'Fulfills line items idempotently: extends member expiration, marks grading paid, grants VOD, issues or upgrades event registration',
        payloadDescription: 'Idempotent fulfillment updates across Member, Grading, EventRegistration',
        codePointers: ['functions/src/stripe-fulfillment.ts'],
        tierType: 'cloud-functions',
        protocol: 'Idempotent Transactional Fulfillment',
      },
    ],
    inputDataTypes: ['product', 'order'],
    outputDataTypes: ['order', 'member', 'grading', 'event-registration', 'video-grant'],
    cloudFunctions: ['createStripeCheckoutSession', 'stripeWebhook'],
    clientServices: ['StripeService', 'DataManagerService'],
    mermaidDiagram: `flowchart LR
    Client[Client App] --> Checkout[createStripeCheckoutSession]
    Checkout --> StripePlatform[Stripe Checkout]
    StripePlatform --> Webhook[stripeWebhook]
    Webhook --> Order[(Order Record)]
    Webhook --> Fulfill[stripe-fulfillment.ts]
    Fulfill --> Members[(Members / Gradings / Tickets)]`,
  },
  {
    id: 'media-transcoding',
    title: 'VOD Media Transcoding & HLS Streaming Pipeline',
    category: FlowCategory.MediaTranscoding,
    summary:
      'Automated pipeline from master video file upload in GCS to GCP Transcoder API, multi-bitrate HLS generation, access token authorization, and offline player caching.',
    trigger: 'Administrator uploads a video master file or member requests playback.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Admin / Storage',
        targetTier: 'Cloud Storage Incoming',
        action: 'Master video file uploaded to incoming storage bucket',
        payloadDescription: 'Raw MP4 master',
        codePointers: ['src/app/manage-vod/manage-vod.ts'],
        tierType: 'client',
        protocol: 'GCS Resumable Upload',
      },
      {
        stepNumber: 2,
        sourceTier: 'Transcode Trigger',
        targetTier: 'GCP Cloud Transcoder API',
        action: 'Submits transcoding job generating multi-bitrate HLS streams (.m3u8 and .ts fragments)',
        payloadDescription: 'Transcoder Job Config',
        codePointers: ['functions/src/vod/transcode-video.ts'],
        tierType: 'cloud-functions',
        protocol: 'GCP Transcoder API Job',
      },
      {
        stepNumber: 3,
        sourceTier: 'Pub/Sub',
        targetTier: 'onTranscodeFinished',
        action: 'Transcoder completion fires Pub/Sub message; updates /videos/{id} with master playlist URL',
        payloadDescription: 'Status update to ready',
        codePointers: ['functions/src/vod/on-transcode-finished.ts'],
        tierType: 'external',
        protocol: 'GCP Pub/Sub Trigger',
      },
      {
        stepNumber: 4,
        sourceTier: 'Member Video Player',
        targetTier: 'getVideoPlaybackSession',
        action: 'Calls session callable; validates VideoGrant or subscription; returns signed playback token',
        payloadDescription: 'Signed token & HLS URL',
        codePointers: ['functions/src/vod/get-playback-session.ts'],
        tierType: 'client',
        protocol: 'HTTPS Callable Token Request',
      },
      {
        stepNumber: 5,
        sourceTier: 'VideoPlayerComponent',
        targetTier: 'Hls.js / IndexedDB',
        action: 'Hls.js streams adaptive video; user can download fragments into browser IndexedDB for offline viewing',
        payloadDescription: 'HLS segment buffers',
        codePointers: ['src/app/video-player/video-player.ts', 'src/app/vod-offline-storage.service.ts'],
        tierType: 'client',
        protocol: 'Hls.js Chunk Streaming & IndexedDB',
      },
    ],
    inputDataTypes: ['video-item', 'video-grant'],
    outputDataTypes: ['video-item', 'video-progress'],
    cloudFunctions: ['transcodeVideo', 'onTranscodeFinished', 'getVideoPlaybackSession'],
    clientServices: ['VodOfflineStorageService'],
    mermaidDiagram: `flowchart TD
    Upload[Raw Video Upload] --> Transcoder[GCP Transcoder API]
    Transcoder --> HLS[Multi-bitrate HLS Streams]
    HLS --> Ready[onTranscodeFinished Trigger]
    Ready --> VideoDoc[(/videos/{id} Ready)]
    PlayReq[Player Request] --> Session[getVideoPlaybackSession]
    Session --> Player[Hls.js Player + IndexedDB Cache]`,
  },
  {
    id: 'micro-frontends',
    title: 'Public Micro-Frontend Web Components Embedding Pipeline',
    category: FlowCategory.MicroFrontends,
    summary:
      'Packaging Angular components as standalone Web Components for embedding the event calendar and instructor directory on external affiliate websites.',
    trigger: 'A third-party website loads the embed script.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Angular Build',
        targetTier: 'Angular Elements Bundle',
        action: 'Compiles events-viewer-wc and find-an-instructor-wc into standalone JS/CSS assets',
        payloadDescription: 'dist/events-viewer-wc/events-viewer.wc.js',
        codePointers: ['src/events-viewer.wc.ts', 'src/find-an-instructor.wc.ts'],
        tierType: 'client',
        protocol: 'Angular Elements Build',
      },
      {
        stepNumber: 2,
        sourceTier: 'Third-Party Webpage',
        targetTier: 'Custom Element DOM',
        action: 'Includes script tag and places <events-viewer> custom element on page',
        payloadDescription: 'Custom element initialization',
        codePointers: ['src/events-viewer.wc.html'],
        tierType: 'external',
        protocol: 'Script Tag & Custom Element DOM',
      },
      {
        stepNumber: 3,
        sourceTier: 'Web Component',
        targetTier: 'Public Firestore',
        action: 'Component queries public events and published instructors directly without authentication',
        payloadDescription: 'Public published snapshot streams',
        codePointers: ['src/app/events-viewer/events-viewer.component.ts'],
        tierType: 'database',
        protocol: 'Public Firestore REST / SDK',
      },
    ],
    inputDataTypes: ['ilc-event', 'instructor-profile'],
    outputDataTypes: [],
    cloudFunctions: [],
    clientServices: ['FindInstructorsService'],
    mermaidDiagram: `flowchart LR
    Build[ng build --project events-viewer-wc] --> Bundle[Standalone Web Component]
    Bundle --> Embed[Third-Party Site <events-viewer>]
    Embed --> Read[(Public Firestore Collections)]`,
  },
  {
    id: 'email-queue-processor',
    title: 'Outbound Email Notification & Queue Processing Pipeline',
    category: FlowCategory.EmailAndNotifications,
    summary:
      'Reliable transactional and scheduled email delivery pipeline featuring 3-state dispatch governance (Off, Paused, Active), zero-write on Off, placeholder queuing when Paused, deferred template interpretation upon activation, atomic locks against circular trigger loops, RFC 8058 one-click unsubscribe headers, and Google Workspace Gmail SMTP integration.',
    trigger:
      'A transactional event occurs (Stripe purchase fulfillment, member onboarding), a scheduled cron triggers (weekly/monthly event digest across next 3 months), or an admin sends a test message.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Transactional Trigger / Dispatcher',
        targetTier: 'Status Check & /mail Queue',
        action:
          'Evaluates global MailSendingStatus. If Off, logs and exits with zero writes. If Paused, enqueues placeholder with MailDeliveryState.Paused. If Active, renders template and writes MailDeliveryState.Pending. Admin tests bypass Off/Paused checks with metadata.adminTest: true.',
        payloadDescription: 'MailQueueDoc write payload to /mail/{id}',
        codePointers: ['functions/src/mail-processor.ts', 'functions/src/stripe-fulfillment.ts', 'functions/src/on-member-update.ts'],
        tierType: 'cloud-functions',
        protocol: 'MailSendingStatus Check & Zero-Write',
      },
      {
        stepNumber: 2,
        sourceTier: 'Cloud Firestore',
        targetTier: 'processMailQueue Trigger',
        action: 'Firestore onDocumentCreated / onDocumentWritten trigger invokes queue processor function',
        payloadDescription: 'DocumentSnapshot of /mail/{id}',
        codePointers: ['functions/src/mail-processor.ts'],
        tierType: 'database',
        protocol: 'Firestore onDocumentCreated Trigger',
      },
      {
        stepNumber: 3,
        sourceTier: 'processMailQueue',
        targetTier: 'Atomic Transaction Lock',
        action: 'Acquires Firestore transaction lock advancing status from PENDING to PROCESSING to eliminate duplicate delivery and circular loops',
        payloadDescription: 'Atomic state transition (MailDeliveryState.Processing)',
        codePointers: ['functions/src/mail-processor.ts'],
        tierType: 'cloud-functions',
        protocol: 'Atomic Firestore Transaction Lock',
      },
      {
        stepNumber: 4,
        sourceTier: 'email-dispatcher.ts',
        targetTier: 'Google Workspace Gmail SMTP',
        action: 'Nodemailer sends MIME email via Gmail SMTP using authenticated credentials with RFC 8058 List-Unsubscribe headers and unified footer',
        payloadDescription: 'SMTP RFC 5322 & RFC 8058 MIME message payload',
        codePointers: ['functions/src/email-dispatcher.ts'],
        tierType: 'external',
        protocol: 'Authenticated Gmail SMTP (RFC 5322 & RFC 8058)',
      },
      {
        stepNumber: 5,
        sourceTier: 'processMailQueue',
        targetTier: 'Cloud Firestore /mail/{id}',
        action: 'Records delivery outcome: SUCCESS (messageId, timestamp) or ERROR (message, error trace, attempts increment)',
        payloadDescription: 'Document update with delivery details (MailDeliveryState.Success / Error)',
        codePointers: ['functions/src/mail-processor.ts'],
        tierType: 'database',
        protocol: 'Firestore Outcome Update (SUCCESS / ERROR)',
      },
      {
        stepNumber: 6,
        sourceTier: 'EmailNotificationsComponent',
        targetTier: 'Admin Portal & Queue Operations',
        action: 'HQ Admin views live queue with deep linking (?mailId=...), inspects recipient headers, edits queued messages, batch deletes items, or invokes retryMailItem',
        payloadDescription: 'Callable retryMailItem, batch delete, and edit payload',
        codePointers: ['src/app/email-notifications/email-notifications.component.ts'],
        tierType: 'client',
        protocol: 'Admin Portal (/email-notifications?mailId=...) & retryMailItem',
      },
    ],
    inputDataTypes: ['mail', 'mail-settings', 'order', 'member', 'ilc-event'],
    outputDataTypes: ['mail'],
    cloudFunctions: [
      'processMailQueue',
      'setMailSendingState',
      'sendAdminTestEmail',
      'retryMailItem',
      'processEventDigestWeekly',
      'processEventDigestMonthly',
    ],
    clientServices: ['DataManagerService', 'NavigationTreeService'],
    mermaidDiagram: `flowchart TD
    Trigger[Transactional Trigger / Admin Test] --> StateCheck{MailSendingStatus?}
    StateCheck -->|Off| ZeroWrite[Log & Exit (Zero Writes)]
    StateCheck -->|Paused| Hold[Write Placeholder (PAUSED)]
    StateCheck -->|Active or Test| Enqueue[Write to /mail (PENDING)]
    Enqueue --> FuncTrigger[processMailQueue Trigger]
    FuncTrigger --> AtomicLock[Atomic Lock: PENDING -> PROCESSING]
    AtomicLock --> Dispatcher[Nodemailer SMTP: notifications@iliqchuan.com]
    Dispatcher --> OutcomeUpdate[Update /mail: SUCCESS or ERROR]
    OutcomeUpdate --> AdminUI[Admin Portal /email-notifications + retryMailItem]`,
  },
  {
    id: 'one-click-unsubscribe',
    title: 'RFC 8058 One-Click Unsubscribe & Preference Sync Pipeline',
    category: FlowCategory.EmailAndNotifications,
    summary:
      'Standardized RFC 8058 email unsubscribe handling supporting automated mail client HTTP POSTs (List-Unsubscribe=One-Click) and web browser GETs with HMAC-SHA256 signature verification and atomic member preference updates.',
    trigger:
      'Recipient clicks the unsubscribe link in an outbound email footer or their email client triggers an automated one-click unsubscribe POST request.',
    steps: [
      {
        stepNumber: 1,
        sourceTier: 'Mail Client / Browser',
        targetTier: 'unsubscribeHandler HTTPS Endpoint',
        action:
          'Issues HTTP POST (with List-Unsubscribe=One-Click header) or HTTP GET to /unsubscribeHandler with category (e.g. eventDigest, all) and HMAC token',
        payloadDescription: 'HTTP Request with category & token query/body params',
        codePointers: ['functions/src/unsubscribe-handler.ts', 'functions/src/email-templates.ts'],
        tierType: 'client',
        protocol: 'HTTP POST / GET',
      },
      {
        stepNumber: 2,
        sourceTier: 'unsubscribeHandler',
        targetTier: 'unsubscribe-token.ts',
        action:
          'Calls verifyUnsubscribeToken() retrieving persistent HMAC secret from /system/mail-settings and executes timing-safe comparison to prevent timing attacks',
        payloadDescription: 'HMAC-SHA256 token verification result (boolean)',
        codePointers: ['functions/src/unsubscribe-token.ts'],
        tierType: 'cloud-functions',
        protocol: 'Crypto Verification',
      },
      {
        stepNumber: 3,
        sourceTier: 'unsubscribeHandler',
        targetTier: 'Cloud Firestore /members/{id}',
        action:
          'Locates member document and updates notification opt-out preferences (e.g. opt-out of event digest or all optional notifications)',
        payloadDescription: 'Firestore write updating member notification settings',
        codePointers: ['functions/src/unsubscribe-handler.ts'],
        tierType: 'database',
        protocol: 'Admin SDK Firestore Write',
      },
      {
        stepNumber: 4,
        sourceTier: 'unsubscribeHandler',
        targetTier: 'Client Response / Web Page',
        action:
          'Returns RFC 8058 compliant HTTP 200 OK for automated POSTs, or renders a branded HTML confirmation page with one-click resubscribe option and preferences link for GETs',
        payloadDescription: 'HTTP 200 OK or Rendered HTML landing page',
        codePointers: ['functions/src/unsubscribe-handler.ts'],
        tierType: 'external',
        protocol: 'HTTP Response',
      },
    ],
    inputDataTypes: ['mail-settings', 'member'],
    outputDataTypes: ['member'],
    cloudFunctions: ['unsubscribeHandler'],
    clientServices: [],
    mermaidDiagram: `flowchart TD
    User[Recipient Click / Mail Client] -->|HTTP POST or GET| Endpoint[unsubscribeHandler Endpoint]
    Endpoint --> TokenVerify{verifyUnsubscribeToken\nHMAC-SHA256}
    TokenVerify -->|Invalid| Err[400 Bad Request / Error Page]
    TokenVerify -->|Valid| DBUpdate[(Update Member Preferences\n/members/{id})]
    DBUpdate --> Response[Return 200 OK or Render Confirmation HTML]
    Response --> Prefs[Link to Manage Notification Preferences]`,
  },
];

